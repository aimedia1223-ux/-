import { useEffect, useRef, useState } from 'react';
import type { Job, User } from '../data/mockDb';
import { contractDetailLabels, createContractOffer, exportContractDocument, listContractOffers, respondContractOffer } from '../lib/contractConfirmation';
import type { ContractDetails, ContractOffer } from '../lib/contractConfirmation';

const labels = { offered: '相手の確認待ち', confirmed: '契約確定', declined: '辞退', withdrawn: '取り下げ' };
const inputStyle = { width: '100%', padding: 10, border: '1px solid #b9c6d6', borderRadius: 8 };
const emptyDetails: ContractDetails = {tax:'',expenses:'',payment_due:'',inspection_due:'',termination:'',intellectual_property:'',liability:''};

export function ContractConfirmationPanel({ jobs, user, onBack }: { jobs: Job[]; user: User; onBack: () => void }) {
  const [offers,setOffers] = useState<ContractOffer[]>([]);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [now,setNow] = useState(()=>Date.now());
  const [message,setMessage] = useState('');
  const [listNotice,setListNotice] = useState('');
  const [listHidden,setListHidden] = useState(false);
  const [error,setError] = useState('');
  const [jobId,setJobId] = useState('');
  const [agencyId,setAgencyId] = useState('');
  const [staffId,setStaffId] = useState('');
  const [terms,setTerms] = useState('');
  const [contractDetails,setContractDetails] = useState<ContractDetails>({...emptyDetails});
  const [review,setReview] = useState<ContractOffer | null>(null);
  const [agreed,setAgreed] = useState(false);
  const requestId = useRef<string | null>(null);
  const active = useRef(true);
  const working = useRef(false);
  const reloadVersion = useRef(0);
  async function reload() {
    const version = ++reloadVersion.current;
    if (active.current) { setOffers([]); setReview(null); setAgreed(false); setListHidden(false); }
    const data = await listContractOffers();
    if (active.current && version===reloadVersion.current) { setOffers(data); setReview(null); setAgreed(false); }
  }
  useEffect(() => {
    const versionCounter=reloadVersion;
    const timer=window.setInterval(()=>setNow(Date.now()),30000);
    active.current = true;
    void reload().catch(() => { if (active.current) setError('契約一覧を取得できません。接続・管理者権限・127番までのSQLの適用を確認してください。'); })
      .finally(() => { if (active.current) setLoading(false); });
    const clear = () => {
      ++reloadVersion.current;
      setOffers([]); setReview(null); setAgreed(false); setListHidden(true);
    };
    const refresh = () => {
      if (!working.current && document.visibilityState !== 'hidden') {
        void reload().catch(() => { if (active.current) setError('契約一覧を再確認できません。承諾・権限・接続を確認して一覧を更新してください。'); });
      }
    };
    const visibility = () => { if (document.visibilityState === 'hidden') clear(); else refresh(); };
    window.addEventListener('blur', clear);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active.current = false; ++versionCounter.current; window.clearInterval(timer);
      window.removeEventListener('blur', clear);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  function change(action: () => void) { requestId.current = null; setMessage(''); action(); }
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setMessage(''); setListNotice('');
    try { await action(); }
    catch(e) { if (active.current) setError(e instanceof Error ? e.message : '操作の結果を確認できません。一覧を更新してください。'); }
    finally { working.current = false; if (active.current) setBusy(false); }
  }
  function refreshList() {
    void run(async () => {
      try {
        await reload();
        if (active.current) setListNotice('契約一覧を更新しました。');
      } catch(e) {
        if (active.current) setListNotice('契約一覧を更新できませんでした。');
        throw e;
      }
    });
  }
  function propose(event: React.FormEvent) {
    event.preventDefault();
    void run(async () => {
      requestId.current ||= crypto.randomUUID();
      await createContractOffer({requestId: requestId.current,jobId,agencyId,staffId,terms,details:contractDetails});
      await reload();
      if (active.current) {
        setMessage('契約条件を提示しました。二次委託先の管理者の確認待ちです。まだ契約確定ではありません。');
        requestId.current = null; setTerms(''); setContractDetails({...emptyDetails});
      }
    });
  }
  function download(offer:ContractOffer) {
    void run(async()=>{
      const file=await exportContractDocument(offer.id);
      if(!active.current || document.visibilityState==='hidden')return;
      const url=URL.createObjectURL(new Blob([file.text],{type:'application/json;charset=utf-8'}));
      const link=document.createElement('a'); link.href=url;link.download=file.filename;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      setMessage('確定内容の出力データを生成しました。端末で保存結果を確認してください。電子署名付きの契約書PDFではありません。');
    });
  }
  function downloadPdf(offer:ContractOffer) {
    void run(async()=>{
      const canExport=()=>active.current&&document.visibilityState!=='hidden';
      // フォントと描画機能を先に準備し、確定内容は最後にサーバーへ再照会する。
      const [{buildContractPdf,parseContractPdfSource},{loadContractPdfFont}]=await Promise.all([import('../lib/contractPdf'),import('../lib/contractPdfFont')]);
      const font=await loadContractPdfFont();
      if(!canExport())return;
      const file=await exportContractDocument(offer.id,'pdf');
      if(!canExport())return;
      const envelope=JSON.parse(file.text);
      const source=parseContractPdfSource(envelope.canonical_payload,envelope.sha256,offer.id);
      const bytes=buildContractPdf(source,font);
      if(!canExport())return;
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
      const link=document.createElement('a');link.href=url;link.download=`Connexy_contract_${offer.id}_v1.pdf`;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      setMessage('契約書PDFを生成しました。端末で保存結果を確認してください。電子署名は付与されていません。');
    });
  }
  function respond(offer: ContractOffer,action: 'confirm' | 'decline' | 'withdraw') {
    void run(async () => {
      const id = await respondContractOffer(offer.id,action);
      if (active.current) setMessage(action==='confirm' ? `契約を確定しました。契約番号：${id}` : action==='decline' ? '辞退しました。' : '提示を取り下げました。');
      await reload();
    });
  }
  function details(offer: ContractOffer) {
    return <>
      {offer.job_id==='connexy-browser-contract-test' && <p role="note" style={{padding:12,background:'#fff7ed',color:'#9a3412'}}>ブラウザ検証専用です。本物のSB承諾・実契約・支払・稼働ではありません。確認後に検証データを削除します。</p>}
      <p><strong>{offer.job_title}</strong></p>
      <p>一次委託先：{offer.client_name}<br/>二次委託先：{offer.agency_name}<br/>対象スタッフ：{offer.staff_name}</p>
      <p>日程：{offer.work_dates.join('、')}<br/>場所：{offer.work_location || '案件に指定なし'}<br/>時間：{offer.work_hours || '案件に指定なし'}</p>
      <p style={{whiteSpace:'pre-wrap'}}>業務概要：{offer.description}</p>
      {offer.detailed_description && <p style={{whiteSpace:'pre-wrap'}}>業務詳細：{offer.detailed_description}</p>}
      {offer.requirements?.filter(text=>!text.startsWith('__')).length>0 && <p>要件：{offer.requirements.filter(text=>!text.startsWith('__')).join('、')}</p>}
      <p>単価：¥{Number(offer.daily_price).toLocaleString()}／日<br/>日数分の合計：¥{Number(offer.total_price).toLocaleString()}</p>
      <p>回答期限：{new Date(offer.expires_at).toLocaleString('ja-JP')}</p>
      <p style={{whiteSpace:'pre-wrap',padding:12,background:'#f1f5f9'}}>追加条件：<br/>{offer.terms}</p>
      {offer.contract_details ? <dl>{(Object.keys(contractDetailLabels) as (keyof ContractDetails)[]).map(key=><div key={key} style={{marginBottom:10}}><dt><strong>{contractDetailLabels[key]}</strong></dt><dd style={{margin:0,whiteSpace:'pre-wrap'}}>{offer.contract_details![key]}</dd></div>)}</dl>
        : <p role="note">旧形式の提示：必須契約項目は未登録です。未確定の提示は取り下げて再提示してください。</p>}
      {offer.document_version && <p>保存文書の版：{offer.document_version} ／ 確定日時：{new Date(offer.responded_at!).toLocaleString('ja-JP')}</p>}
    </>;
  }
  return <div className="overlay-view show" style={{zIndex:1150,display:'flex',flexDirection:'column'}}>
    <header className="solid-header overlay-header"><button disabled={busy} onClick={onBack}>戻る</button><h1 style={{fontSize:18}}>契約手続き</h1></header>
    <main className="list-area bg-gray" style={{padding:20,overflowY:'auto',paddingBottom:90}}>
      <p>一次委託先が条件を提示し、二次委託先の管理者が内容を確認して確定します。SB承諾は提示時と確定時に確認します。</p>
      <p style={{fontSize:13}}>現在は架空データで確認してください。実際の承諾書・個人情報はまだ登録しないでください。</p>
      <p style={{fontSize:13}}>一覧の取得時に承諾を再確認します。二次委託先では承諾対象の担当者だけが詳細を取得できます。</p>
      <p style={{fontSize:13}}>必須契約条件を提示時に固定し、確定時の内容を保存します。確定後は契約書PDFを出力できます。支払期限の法令判定・電子署名はまだ未対応です。</p>
      {error && <p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
      {message && <p role="status" style={{padding:14,background:'#ecfdf5'}}>{message}</p>}
      {review ? <section style={{padding:16,background:'white',marginTop:18,borderRadius:12}}>
        <h2 style={{fontSize:18}}>確定前の最終確認</h2>{details(review)}
        <label style={{display:'block',margin:'16px 0'}}><input type="checkbox" checked={agreed} disabled={busy} onChange={e=>setAgreed(e.target.checked)}/> 表示された案件・当事者・スタッフ・金額・日程・追加条件を確認し、この内容で確定します。</label>
        <button disabled={busy || !agreed} onClick={()=>respond(review,'confirm')}>{busy ? '処理中…' : 'この内容で契約を確定する'}</button>
        <button disabled={busy} onClick={()=>setReview(null)} style={{marginLeft:12}}>戻る</button>
      </section> : <>
        <details style={{margin:'20px 0'}}><summary>自社案件の契約条件を提示する</summary>
          <form onSubmit={propose} style={{display:'grid',gap:14,marginTop:16}}>
            <label>自社の案件<select required disabled={busy} value={jobId} style={inputStyle} onChange={e=>change(()=>setJobId(e.target.value))}>
              <option value="">選択してください</option>{jobs.filter(j=>j.authorId===user.id).map(j=><option key={j.id} value={j.id}>{j.title}</option>)}
            </select></label>
            {jobs.find(j=>j.id===jobId) && <p>単価：¥{jobs.find(j=>j.id===jobId)!.price.toLocaleString()}／日。提示時点の案件内容を固定します。</p>}
            {jobId==='connexy-browser-contract-test' && <p role="note">この案件はブラウザ検証専用の架空データです。実際のSB承諾や契約ではありません。</p>}
            <label>二次委託先の会社ID<input required disabled={busy} value={agencyId} style={inputStyle} onChange={e=>change(()=>setAgencyId(e.target.value))}/></label>
            <label>対象スタッフのID<input required disabled={busy} value={staffId} style={inputStyle} onChange={e=>change(()=>setStaffId(e.target.value))}/></label>
            <label>追加条件（20文字以上）<textarea required minLength={20} maxLength={20000} rows={6} disabled={busy} value={terms} style={inputStyle} onChange={e=>change(()=>setTerms(e.target.value))}/></label>
            {(Object.keys(contractDetailLabels) as (keyof ContractDetails)[]).map(key=><label key={key}>{contractDetailLabels[key]}（必須）
              {key==='payment_due'||key==='inspection_due'
                ? <input type="date" required disabled={busy} value={contractDetails[key]} style={inputStyle} onChange={e=>change(()=>setContractDetails({...contractDetails,[key]:e.target.value}))}/>
                : <textarea required minLength={2} maxLength={2000} rows={3} disabled={busy} value={contractDetails[key]} style={inputStyle} onChange={e=>change(()=>setContractDetails({...contractDetails,[key]:e.target.value}))}/>}
            </label>)}
            <button disabled={busy || loading || !jobId || terms.trim().length<20}>この条件で提示する</button>
          </form>
        </details>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',margin:'20px 0 12px'}}>
          <h2 style={{fontSize:18,margin:0}}>契約一覧（直近100件）</h2>
          <button type="button" disabled={busy || loading} onClick={refreshList}
            style={{padding:'10px 14px',border:0,borderRadius:8,background:'#0865e8',color:'#fff',fontWeight:700,cursor:busy || loading ? 'wait' : 'pointer'}}>
            契約一覧を更新
          </button>
        </div>
        {listNotice && <p role="status" aria-live="polite">{listNotice}</p>}
        {listHidden && <p role="status">詳細を閉じました。「契約一覧を更新」から再確認してください。</p>}
        {loading ? <p>読み込み中…</p> : offers.length===0 && !error && !listHidden ? <p>契約の提示はまだありません。</p> : null}
        {offers.map(offer=><article key={offer.id} style={{padding:16,marginBottom:16,background:'white',borderRadius:12}}>
          <strong>{labels[offer.status]}</strong>{details(offer)}
          {offer.contract_id && <p>契約番号：{offer.contract_id}</p>}
          {offer.status==='confirmed' && offer.document_version===1 && <button disabled={busy} onClick={()=>download(offer)}>確定内容をJSON出力</button>}
          {offer.status==='confirmed' && offer.document_version===1 && <button disabled={busy} style={{marginLeft:12}} onClick={()=>downloadPdf(offer)}>契約書PDFを出力</button>}
          {offer.status==='offered' && offer.agency_id===user.id && <>
            <button disabled={busy || !offer.contract_details || Date.parse(offer.expires_at)<=now} onClick={()=>{setReview(offer);setAgreed(false);setError('');setMessage('');}}>内容を確認して確定へ</button>
            <button disabled={busy} style={{marginLeft:12}} onClick={()=>{if(window.confirm('この提示を辞退しますか？')) respond(offer,'decline');}}>辞退する</button>
          </>}
          {offer.status==='offered' && offer.client_id===user.id && <button disabled={busy} onClick={()=>{if(window.confirm('この提示を取り下げますか？')) respond(offer,'withdraw');}}>提示を取り下げる</button>}
        </article>)}
      </>}
    </main>
  </div>;
}
