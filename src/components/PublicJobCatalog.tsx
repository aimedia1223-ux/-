import { useEffect, useRef, useState } from 'react';
import { listJobSummaries, readApprovedJob } from '../lib/jobDisclosure';
import type { JobSummary, ApprovedJobDetail } from '../lib/jobDisclosure';

// 元のJob型・地図・ブラウザ保存と共有しない。他社詳細は開示操作の都度取得する。
export function PublicJobCatalog({ onBack }: { onBack: () => void }) {
  const [summaries, setSummaries] = useState<JobSummary[]>([]);
  const [detail, setDetail] = useState<ApprovedJobDetail | null>(null);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const epoch = useRef(0);
  const detailTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function clearDetail() {
    ++epoch.current;
    clearTimeout(detailTimer.current);
    setDetail(null);
    setLoading(false);
  }
  async function reload() {
    clearDetail(); setSummaries([]); setNotice(''); setLoading(true);
    const version = epoch.current;
    try {
      const rows = await listJobSummaries();
      if (version === epoch.current) setSummaries(rows);
    } catch (error) {
      if (version === epoch.current) setNotice(error instanceof Error ? error.message : '公開概要を取得できません。');
    } finally { if (version === epoch.current) setLoading(false); }
  }
  async function open(summary: JobSummary) {
    clearDetail(); setNotice(''); setLoading(true);
    const version = epoch.current;
    try {
      const row = await readApprovedJob(summary.public_id);
      if (version === epoch.current) {
        setDetail(row);
        detailTimer.current = setTimeout(() => {
          clearDetail(); setNotice('詳細の表示を終了しました。続ける場合は、もう一度詳細を確認してください。');
        }, 30_000);
      }
    } catch (error) {
      if (version === epoch.current) setNotice(error instanceof Error ? error.message : '詳細を開示できません。');
    } finally { if (version === epoch.current) setLoading(false); }
  }
  useEffect(() => {
    void reload();
    const hide = () => { clearDetail(); };
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', hide);
    return () => {
      ++epoch.current; clearTimeout(detailTimer.current);
      window.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);

  return <div className="overlay-view show" style={{zIndex:2100,display:'flex',flexDirection:'column'}}>
    <header className="solid-header overlay-header"><button onClick={onBack}>戻る</button><h1 style={{fontSize:18}}>他社案件の公開概要</h1></header>
    <main className="list-area bg-gray" style={{padding:20,overflowY:'auto',paddingBottom:90}}>
      <p>地域と業務区分だけを掲載しています。会社名・店舗・住所・日程は、承諾対象の担当者だけが詳細を確認できます。</p>
      <button disabled={loading} onClick={() => void reload()} style={{padding:'10px 14px',background:'#0865e8',color:'#fff',border:0,borderRadius:8}}>公開概要を更新</button>
      {loading && <p role="status">確認中…</p>}
      {notice && <p role="status" style={{padding:12,background:'#fff7ed'}}>{notice}</p>}
      {!loading && !notice && summaries.length === 0 && <p>公開概要はまだありません。</p>}
      {detail && <section aria-label="承諾確認済みの案件詳細" style={{padding:16,background:'#fff',margin:'16px 0',border:'2px solid #0865e8',borderRadius:12}}>
        <h2 style={{fontSize:18}}>{detail.title}</h2>
        <p>会社：{detail.company_name}</p>
        <p>場所：{detail.exact_location || detail.location_name || '記載なし'}</p>
        <p>日程：{detail.event_date || '記載なし'}／時間：{detail.work_hours || '記載なし'}</p>
        <p>単価：¥{detail.price.toLocaleString()}／日</p>
        <p style={{whiteSpace:'pre-wrap'}}>{detail.detailed_description || detail.description}</p>
        {detail.contacts ? <section aria-label="一次委託先の連絡窓口">
          <h3 style={{fontSize:15}}>一次委託先の連絡窓口</h3>
          <p>SBとの窓口：{detail.contacts.sb_contact_name}</p>
          <p>二次委託先との窓口：{detail.contacts.agency_contact_name}</p>
          <p>事故対応責任者：{detail.contacts.incident_contact_name}</p>
        </section> : <p>連絡窓口は未登録、または再確認が必要です。</p>}
        <p style={{fontSize:12}}>30秒後、または画面を離れると詳細を閉じます。再表示時に承諾を再確認します。</p>
        <button onClick={clearDetail}>詳細を閉じる</button>
      </section>}
      {summaries.map(summary => <article key={summary.public_id} style={{padding:16,background:'#fff',marginTop:16,borderRadius:12,border:'1px solid #dbe3ed'}}>
        <h2 style={{fontSize:16}}>{summary.region}の業務委託案件</h2>
        <p>{summary.category}</p><p style={{fontSize:13}}>会社・店舗・住所・稼働詳細は非公開</p>
        <button disabled={loading} onClick={() => void open(summary)}>承諾を確認して詳細を開く</button>
      </article>)}
    </main>
  </div>;
}
