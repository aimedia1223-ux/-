import { useRef, useState } from 'react';
import type { Job } from '../data/mockDb';
import { checkSbApproval } from '../lib/sbApprovalGateway';

export function SbApprovalPanel({ jobs, onBack }: { jobs: Job[]; onBack: () => void }) {
  const [jobId, setJobId] = useState('');
  const [agencyId, setAgencyId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const version = useRef(0);
  function change(action: () => void) { ++version.current; setResult(''); action(); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const request = ++version.current; setBusy(true); setResult('');
    try {
      const gate = await checkSbApproval(jobId, agencyId.trim(), staffId.trim());
      if (version.current === request) setResult(gate.approved
        ? 'SB再委託承認済み：原本照合記録と案件・二次委託先・スタッフ・日程が一致しています。'
        : '承諾未確認：未登録・期限切れ・対象変更などのため、契約確定・スタッフ確定・現場投入を許可できません。');
    } catch {
      if (version.current === request) setResult('承諾記録を確認できません。接続・権限・承諾ゲートの設定を確認してください。承認済みにはしていません。');
    } finally { setBusy(false); }
  }
  return <div className="overlay-view show" style={{ zIndex: 1150, display: 'flex', flexDirection: 'column' }}>
    <header className="solid-header overlay-header">
      <button type="button" onClick={onBack}>戻る</button><h1 style={{ fontSize: 18 }}>SB再委託承諾の確認</h1>
    </header>
    <main className="list-area bg-gray" style={{ padding: 20, overflowY: 'auto', paddingBottom: 90 }}>
      <p>社内で原本照合を終えた記録を確認します。この画面で承認を付けることはできません。</p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        <label>自社の案件
          <select required disabled={busy} value={jobId} onChange={e => change(() => setJobId(e.target.value))} style={{ width: '100%', padding: 10 }}>
            <option value="">選択してください</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </label>
        <label>二次委託先の会社ID
          <input required disabled={busy} value={agencyId} onChange={e => change(() => setAgencyId(e.target.value))} style={{ width: '100%', padding: 10 }} />
        </label>
        <label>対象スタッフのID
          <input required disabled={busy} value={staffId} onChange={e => change(() => setStaffId(e.target.value))} style={{ width: '100%', padding: 10 }} />
        </label>
        <button disabled={busy} type="submit" style={{ padding: 12 }}>{busy ? '確認中…' : '承諾状況を確認する'}</button>
      </form>
      {result && <p role="status" style={{ padding: 16, background: '#fff', borderRadius: 10 }}>{result}</p>}
      <p style={{ fontSize: 13 }}>承諾書本体・実名・店舗情報はまだ登録しないでください。承諾番号の入力やチェックだけで承認済みになることはありません。</p>
      <p style={{ fontSize: 13 }}>契約の提示・確定は「管理 → 契約手続き」から行います。一次委託先の提示後、二次委託先の管理者の確認が必要です。対象区分が未確認の案件も承諾確認を必須にしています。</p>
    </main>
  </div>;
}
