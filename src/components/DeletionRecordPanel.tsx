import {useEffect,useRef,useState} from 'react';
import {checkLabels,createDeletionRecord,exportDeletionRecord,listDeletionRecords,saveDeletionCheck} from '../lib/deletionRecords';
import type{DeletionCheck,DeletionState}from'../lib/deletionRecords';
import {auditActions}from'../lib/auditLog';
export function DeletionRecordPanel({onBack}:{onBack:()=>void}){
 const[state,setState]=useState<DeletionState|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const[eventId,setEventId]=useState('');const[editing,setEditing]=useState<{id:string;check:DeletionCheck}|null>(null);
 const[status,setStatus]=useState<'pending'|'reported'>('pending'),[reference,setReference]=useState(''),[hash,setHash]=useState('');
 const active=useRef(true),epoch=useRef(0),locked=useRef(false);
 async function reload(){const request=++epoch.current;setBusy(true);setState(null);setEditing(null);setEventId('');setError('');
  try{const next=await listDeletionRecords();if(active.current&&request===epoch.current)setState(next);}
  catch(e){if(active.current&&request===epoch.current)setError(e instanceof Error?e.message:'取得できません。');}
  finally{if(active.current&&request===epoch.current)setBusy(false);}}
 useEffect(()=>{active.current=true;const request=++epoch.current;
  void listDeletionRecords().then(next=>{if(active.current&&request===epoch.current)setState(next);})
   .catch(e=>{if(active.current&&request===epoch.current)setError(e instanceof Error?e.message:'取得できません。');})
   .finally(()=>{if(active.current&&request===epoch.current)setBusy(false);});return()=>{active.current=false;};},[]);
 useEffect(()=>{const hide=()=>{++epoch.current;setState(null);setEditing(null);setBusy(false);setNotice('一覧を取得して権限と記録を再確認してください。');};
  const timer=state?window.setTimeout(hide,60000):undefined;document.addEventListener('visibilitychange',hide);
  return()=>{window.clearTimeout(timer);document.removeEventListener('visibilitychange',hide);};},[state]);
 async function run(operation:()=>Promise<void>){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('');
  try{await operation();if(active.current)await reload();}
  catch(e){if(active.current){setState(null);setEditing(null);setError(e instanceof Error?e.message:'処理結果を確認できません。');}}
  finally{locked.current=false;if(active.current)setBusy(false);}}
 async function download(id:string){await run(async()=>{const file=await exportDeletionRecord(id);if(!active.current)return;
  const url=URL.createObjectURL(new Blob([file.text],{type:'application/json;charset=utf-8'}));
  try{const a=document.createElement('a');a.href=url;a.download=file.filename;document.body.appendChild(a);a.click();a.remove();}
  finally{window.setTimeout(()=>URL.revokeObjectURL(url),1000);}setNotice('削除実施記録の出力データを生成しました。完全削除の証明書ではありません。');});}
 return<section className="overlay-view show"style={{zIndex:1150,display:'flex',flexDirection:'column'}}>
  <header className="solid-header overlay-header"><button disabled={busy}onClick={onBack}>管理に戻る</button><h1 style={{fontSize:17}}>削除実施記録</h1></header>
  <main className="list-area bg-gray"style={{padding:20,overflowY:'auto',paddingBottom:90}}>
   <p>自社の実行済み削除ログに結び付けて記録します。対象以外のデータや、外部保存・バックアップの消去は別途確認が必要です。</p>
   <p style={{fontSize:13}}>現在は架空データで確認してください。証跡は内部管理番号とSHA256だけを登録し、原本・個人情報・秘密情報は入力しないでください。</p>
   <button disabled={busy}onClick={()=>void reload()}style={{padding:10}}>保存済み一覧を更新</button>
   {busy&&<p role="status">確認中…</p>}{error&&<p role="alert"style={{color:'#b91c1c'}}>{error}</p>}{notice&&<p role="status">{notice}</p>}
   {!state&&!busy&&!error&&<p>一覧を更新してください。</p>}
   {state&&<>
    <h2 style={{fontSize:17}}>削除ログから実施記録を作成</h2>
    <label>対象の削除ログ<select disabled={busy}value={eventId}onChange={e=>setEventId(e.target.value)}style={{width:'100%',padding:10}}>
     <option value="">選択してください</option>{state.candidates.map(e=><option key={e.id}value={e.id}>記録{e.id}：{auditActions[e.action]||e.action} ／ {e.target_id||'対象番号なし'}</option>)}
    </select></label>
    <button disabled={busy||!eventId}onClick={()=>void run(async()=>{await createDeletionRecord(eventId);if(active.current)setNotice('削除実施記録を保存しました。外部の消去状況は未確認です。');})}style={{padding:10,marginTop:10}}>実施記録を作成</button>
    <h2 style={{fontSize:17,marginTop:24}}>保存済みの実施記録（{state.records.length}件・直近100件）</h2>
    {state.records.length===0&&<p>保存済みの記録はありません。</p>}
    {state.records.map(r=><article key={r.id}style={{background:'#fff',border:'1px solid #dbe3ed',borderRadius:12,padding:16,marginBottom:16,overflowWrap:'anywhere'}}>
     <strong>{auditActions[r.action]||r.action}</strong><p>対象番号：{r.target_id||'なし'}</p><p>削除ログ番号：{r.deletion_event_id}</p>
     <p>削除日時：{new Date(r.deleted_at).toLocaleString('ja-JP')}</p><p style={{fontSize:12}}>実施記録番号：{r.id}</p>
     <p style={{padding:10,background:'#fffbeb'}}>記録範囲：指定されたアプリ内対象のみ。外部の消去状況は未検証です。</p>
     {r.checks.map(c=><div key={c.category}style={{borderTop:'1px solid #e5e7eb',padding:'10px 0'}}>
      <strong>{checkLabels[c.category]}</strong><p>{c.status==='pending'?'未確認':'証跡の申告あり（内容は未検証）'}</p>
      {c.evidence_reference&&<p>内部管理番号：{c.evidence_reference}</p>}
      <button disabled={busy}onClick={()=>{setEditing({id:r.id,check:c});setStatus(c.status);setReference(c.evidence_reference||'');setHash(c.evidence_sha256||'');}}>確認状況を入力</button>
      {editing?.id===r.id&&editing.check.category===c.category&&<form onSubmit={e=>{e.preventDefault();void run(()=>saveDeletionCheck(r.id,editing.check,status,reference,hash));}}style={{display:'grid',gap:10,marginTop:12}}>
       <label>確認状況<select value={status}disabled={busy}onChange={e=>setStatus(e.target.value as 'pending'|'reported')}><option value="pending">未確認</option><option value="reported">証跡を申告（内容は未検証）</option></select></label>
       {status==='reported'&&<><label>内部管理番号<input required pattern="[A-Z0-9][A-Z0-9_-]{2,79}"value={reference}onChange={e=>setReference(e.target.value)}placeholder="TEST_EVIDENCE_001"style={{width:'100%'}}/></label>
        <label>証跡のSHA256<input required pattern="[0-9a-f]{64}"value={hash}onChange={e=>setHash(e.target.value)}style={{width:'100%'}}/></label></>}
       <button disabled={busy}>確認状況を保存</button><button type="button"disabled={busy}onClick={()=>setEditing(null)}>入力を閉じる</button>
      </form>}
     </div>)}
     <button disabled={busy}onClick={()=>void download(r.id)}style={{padding:10,marginTop:12}}>実施記録をJSON出力</button>
     <p style={{fontSize:12}}>チェックサム付きの実施記録です。電子署名や完全削除の証明書ではありません。証跡の申告だけでは「消去確認済み」にはなりません。</p>
    </article>)}
   </>}
  </main>
 </section>;
}
