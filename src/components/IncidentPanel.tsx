import {useEffect,useRef,useState} from 'react';
import {createIncident,evidenceLabels,externalLabels,incidentCategories,incidentStatuses,incidentTemplate,listIncidents,readIncident,saveIncidentContact,updateIncident} from '../lib/incidents';
import type {EvidenceState,ExternalState,IncidentCategory,IncidentDetail,IncidentList,IncidentStatus} from '../lib/incidents';
const field={display:'block',width:'100%',padding:10,border:'1px solid #bacadd',borderRadius:8,boxSizing:'border-box' as const,margin:'6px 0 14px'};
const card={padding:16,background:'#fff',border:'1px solid #dbe3ed',borderRadius:12,margin:'14px 0',overflowWrap:'anywhere' as const};
const button={padding:'10px 14px',borderRadius:8,border:'1px solid #b8c9df',background:'#fff',cursor:'pointer'};
function nowLocal(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export function IncidentPanel({onBack}:{onBack:()=>void}){
 const [data,setData]=useState<IncidentList|null>(null),[detail,setDetail]=useState<IncidentDetail|null>(null);
 const [busy,setBusy]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [category,setCategory]=useState<IncidentCategory>('loss'),[discovered,setDiscovered]=useState(nowLocal),[summary,setSummary]=useState(''),[initial,setInitial]=useState('');
 const [contact,setContact]=useState(''),[lead,setLead]=useState('');
 const [status,setStatus]=useState<IncidentStatus>('reported'),[note,setNote]=useState(''),[evidence,setEvidence]=useState<EvidenceState>('unconfirmed'),[external,setExternal]=useState<ExternalState>('unreported');
 const [showTemplate,setShowTemplate]=useState(false);
 const alive=useRef(true),epoch=useRef(0),working=useRef(false),nonce=useRef(crypto.randomUUID());
 useEffect(()=>{
  alive.current=true;const request=++epoch.current;
  void listIncidents().then(value=>{if(alive.current&&request===epoch.current&&!document.hidden){setData(value);setContact(value.contact?.contact||'');setLead(value.contact?.lead_staff_id||'');}})
   .catch(e=>{if(alive.current&&request===epoch.current)setError(e instanceof Error?e.message:'取得できません。');})
   .finally(()=>{if(alive.current)setBusy(false);});
  return()=>{alive.current=false;};
 },[]);
 // 機微な内容を別タブ・画面非表示後や長時間そのまま残さない。
 useEffect(()=>{
  const hide=()=>{epoch.current++;setData(null);setDetail(null);setShowTemplate(false);setSummary('');setInitial('');setNote('');setContact('');setLead('');setMessage('');nonce.current=crypto.randomUUID();};
  const visibility=()=>{if(document.hidden)hide();};
  const timer=data?window.setTimeout(hide,5*60*1000):undefined;
  document.addEventListener('visibilitychange',visibility);
  return()=>{window.clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);};
 },[data]);
 async function run(action:()=>Promise<void>){
  if(working.current)return;working.current=true;setBusy(true);setError('');setMessage('');
  try{await action();}catch(e){if(alive.current){setDetail(null);setShowTemplate(false);setError(e instanceof Error?e.message:'保存できません。');}}
  finally{working.current=false;if(alive.current)setBusy(false);}
 }
 async function load(){
  if(!alive.current||document.hidden)return;
  const request=++epoch.current;setData(null);setDetail(null);setShowTemplate(false);
  const value=await listIncidents();if(!alive.current||document.hidden||request!==epoch.current)return;
  setData(value);setContact(value.contact?.contact||'');setLead(value.contact?.lead_staff_id||'');
 }
 async function open(id:string){
  if(!alive.current||document.hidden)return;
  const request=++epoch.current;setDetail(null);setShowTemplate(false);setNote('');
  const r=await readIncident(id);if(!alive.current||document.hidden||request!==epoch.current)return;
  setDetail(r);setStatus(r.status);setEvidence(r.history[0].evidence_state);setExternal(r.history[0].external_state);
 }
 return <section className="overlay-view show" style={{zIndex:1150,display:'flex',flexDirection:'column'}}>
  <header className="solid-header overlay-header"><button style={button} onClick={onBack}>管理に戻る</button><h1 style={{fontSize:18}}>インシデント報告</h1></header>
  <main className="list-area bg-gray" style={{padding:20,overflowY:'auto',paddingBottom:100}}>
   <div style={{...card,background:'#fff7ed',borderColor:'#fdba74'}}><strong>紛失・誤送信・不正アクセスは、疑いの段階で連絡してください。</strong><p>登録だけでは緊急連絡・SBへの報告は完了しません。電話など、定められた経路でも直ちに連絡してください。この画面に自動通知機能はありません。</p></div>
   <p>現在は架空検証用です。実名・店舗名・顧客情報・パスワード・認証コード・証拠原本は入力しないでください。</p>
   <button style={{...button,background:'#005fe8',color:'#fff'}} disabled={busy} onClick={()=>void run(load)}>報告一覧・緊急連絡先を更新</button>
   {busy&&<p role="status">処理中…</p>}{error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}{message&&<p role="status">{message}</p>}
   {!data&&!busy&&<p>一覧を更新してください。表示は5分経過、または画面が非表示になると閉じます。</p>}
   {data&&<>
    <article style={card}><h2 style={{fontSize:17}}>緊急連絡先・初動責任者</h2>
     {data.contact?<><p style={{whiteSpace:'pre-wrap'}}>{data.contact.contact}</p><p>初動責任者のスタッフID：{data.contact.lead_staff_id}</p><small>更新：{new Date(data.contact.updated_at).toLocaleString('ja-JP')}</small></>:<p style={{color:'#b91c1c'}}>未登録です。管理者に確認し、既存の緊急連絡経路を使ってください。</p>}
     {data.can_manage&&<details><summary>連絡先を登録・変更する</summary><form onSubmit={e=>{e.preventDefault();void run(async()=>{const v=data.contact?.version||0;await saveIncidentContact(contact,lead,v);await load();setMessage('緊急連絡先を保存しました。');});}}>
      <label>24時間の緊急連絡経路（架空検証用）<textarea required minLength={5} maxLength={1000} value={contact} onChange={e=>setContact(e.target.value)} style={field}/></label>
      <label>初動責任者のスタッフID（有効な自社管理者）<input required value={lead} onChange={e=>setLead(e.target.value)} style={field}/></label>
      <button style={button} disabled={busy}>連絡先を保存</button></form></details>}
    </article>
    <details style={card}><summary style={{fontWeight:700}}>新しいインシデントを報告する</summary>
     <form onChange={()=>{nonce.current=crypto.randomUUID();}} onSubmit={e=>{e.preventDefault();void run(async()=>{const id=nonce.current;await createIncident(id,category,new Date(discovered).toISOString(),summary,initial);nonce.current=crypto.randomUUID();setSummary('');setInitial('');await load();await open(id);setMessage('社内の報告記録を保存しました。緊急連絡先への連絡も行ってください。');});}}>
      <label>種別<select value={category} onChange={e=>setCategory(e.target.value as IncidentCategory)} style={field}>{Object.entries(incidentCategories).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>発見日時（この端末の時刻）<input type="datetime-local" required value={discovered} onChange={e=>setDiscovered(e.target.value)} style={field}/></label>
      <label>分かっている状況・疑い（10〜2,000文字）<textarea required minLength={10} maxLength={2000} rows={4} value={summary} onChange={e=>setSummary(e.target.value)} style={field}/></label>
      <label>行った初動・証拠保全（不明な点は未確認と記入）<textarea maxLength={2000} rows={3} value={initial} onChange={e=>setInitial(e.target.value)} style={field}/></label>
      <p style={{fontSize:13}}>証拠やログは管理者の手順に従って保全し、削除・改変しないでください。証拠ファイルの添付機能はありません。</p>
      <button style={{...button,background:'#b91c1c',color:'#fff'}} disabled={busy}>社内に報告を登録</button>
     </form>
    </details>
    <h2 style={{fontSize:18}}>{data.can_manage?'自社の報告一覧':'自分の報告一覧'}（直近50件）</h2>
    {data.items.length===0&&<p>報告はまだありません。</p>}
    {data.items.map(r=><article style={card} key={r.id}><strong>{incidentCategories[r.category]}</strong><p>{incidentStatuses[r.status]} ／ {new Date(r.created_at).toLocaleString('ja-JP')}</p><small style={{display:'block'}}>報告番号：{r.id}</small><button style={{...button,marginTop:10}} disabled={busy} onClick={()=>void run(()=>open(r.id))}>内容・対応履歴を開く</button></article>)}
    {detail&&<article style={{...card,border:'2px solid #005fe8'}}><h2 style={{fontSize:18}}>報告内容・対応履歴</h2><small>報告番号：{detail.id} ／ 第{detail.version}版</small>
     <p>{incidentStatuses[detail.status]} ／ {incidentCategories[detail.category]}</p><p>発見：{new Date(detail.discovered_at).toLocaleString('ja-JP')}</p><p>報告者のスタッフID：{detail.reporter_staff_id}</p>
     <h3 style={{fontSize:15}}>初回の状況（原文を保持）</h3><p style={{whiteSpace:'pre-wrap'}}>{detail.summary}</p><p style={{whiteSpace:'pre-wrap'}}>初動：{detail.initial_action||'未記入'}</p>
     <button style={button} onClick={()=>setShowTemplate(!showTemplate)}>SB等への第一報ひな形を{showTemplate?'閉じる':'表示'}</button>
     {showTemplate&&<><p>宛先・内容・契約上の報告経路を確認し、別の手段で送ってください。</p><textarea aria-label="第一報の下書き" readOnly rows={12} value={incidentTemplate(detail)} style={field}/></>}
     {data.can_manage&&<form style={{marginTop:20}} onSubmit={e=>{e.preventDefault();void run(async()=>{const id=detail.id;await updateIncident(id,detail.version,status,note,evidence,external);await load();await open(id);setMessage('対応記録を追記しました。過去の記録は保持されています。');});}}>
      <h3>管理者の対応を追記</h3>
      <label>対応状況<select value={status} onChange={e=>setStatus(e.target.value as IncidentStatus)} style={field}>{Object.entries(incidentStatuses).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>証拠保全<select value={evidence} onChange={e=>setEvidence(e.target.value as EvidenceState)} style={field}>{Object.entries(evidenceLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>SB等への別経路での連絡<select value={external} onChange={e=>setExternal(e.target.value as ExternalState)} style={field}>{Object.entries(externalLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>対応・連絡日時・連絡経路・今後の予定（10文字以上）<textarea required minLength={10} maxLength={2000} rows={4} value={note} onChange={e=>setNote(e.target.value)} style={field}/></label>
      <p style={{fontSize:13}}>「連絡した」「保全した」は管理者の記録です。送信・受領や原本をシステムが証明するものではありません。</p>
      <button style={button} disabled={busy}>対応を保存する</button>
     </form>}
     <h3>保存済みの履歴（新しい順・直近100件）</h3>{detail.history.map(h=><div key={h.version} style={{borderTop:'1px solid #dbe3ed',padding:'12px 0'}}><strong>第{h.version}版：{incidentStatuses[h.status]}</strong><p>{new Date(h.occurred_at).toLocaleString('ja-JP')} ／ {h.actor_staff_id}</p><p style={{whiteSpace:'pre-wrap'}}>{h.note}</p><small>{evidenceLabels[h.evidence_state]} ／ {externalLabels[h.external_state]}</small></div>)}
    </article>}
   </>}
  </main>
 </section>;
}
