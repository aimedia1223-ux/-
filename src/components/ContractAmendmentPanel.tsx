import {useEffect,useRef,useState} from 'react';
import {contractDetailLabels} from '../lib/contractConfirmation';
import type {ContractDetails} from '../lib/contractConfirmation';
import {getContractHistory,proposeContractAmendment,respondContractAmendment} from '../lib/contractAmendments';
import type {ContractAmendment,ContractHistory,ContractVersion} from '../lib/contractAmendments';
import {prepareContractFile,savePreparedContractFile} from '../lib/contractDownload';

const inputStyle={width:'100%',padding:10,border:'1px solid #b9c6d6',borderRadius:8};
const labels={offered:'相手の回答待ち',confirmed:'変更合意済み',declined:'辞退',withdrawn:'取り下げ'};
function Changes({before,terms,details}:{before:ContractVersion;terms:string;details:ContractDetails}){
 const rows=[{label:'追加条件',before:before.terms,after:terms},...(Object.keys(contractDetailLabels) as (keyof ContractDetails)[]).map(k=>({label:contractDetailLabels[k],before:before.details[k],after:details[k]}))].filter(r=>r.before!==r.after);
 return rows.length ? <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}><thead><tr><th>項目</th><th>変更前（版{before.version}）</th><th>変更後</th></tr></thead><tbody>{rows.map(r=><tr key={r.label}>{[r.label,r.before,r.after].map((text,i)=><td key={i} style={{border:'1px solid #cbd5e1',padding:8,verticalAlign:'top',whiteSpace:'pre-wrap',overflowWrap:'anywhere',background:i===2?'#eff6ff':'white'}}>{text}</td>)}</tr>)}</tbody></table></div> : <p>変更された条件はありません。</p>;
}

export function ContractAmendmentPanel({offerId,companyId,onBack}:{offerId:string;companyId:string;onBack:()=>void}){
 const[state,setState]=useState<ContractHistory|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const[draft,setDraft]=useState<{base:ContractVersion;terms:string;details:ContractDetails;reason:string}|null>(null);
 const[preview,setPreview]=useState(false),[review,setReview]=useState<string|null>(null),[agreed,setAgreed]=useState(false),[now,setNow]=useState(()=>Date.now());
 const active=useRef(true),working=useRef(false),sequence=useRef(0),nonce=useRef<string|null>(null);
 async function reload(){
  const n=++sequence.current;setState(null);setDraft(null);setReview(null);setAgreed(false);setPreview(false);nonce.current=null;
  const data=await getContractHistory(offerId);if(active.current&&n===sequence.current&&document.visibilityState!=='hidden')setState(data);
 }
 async function run(action:()=>Promise<void>){
  if(working.current)return;working.current=true;setBusy(true);setError('');setNotice('');
  try{await action();}catch(e){if(active.current)setError(e instanceof Error?e.message:'変更合意を確認できません。');}
  finally{working.current=false;if(active.current)setBusy(false);}
 }
 useEffect(()=>{
  active.current=true;const n=++sequence.current;
  void getContractHistory(offerId).then(data=>{if(active.current&&sequence.current===n&&document.visibilityState!=='hidden')setState(data);})
   .catch(()=>{if(active.current&&sequence.current===n)setError('履歴を取得できません。接続・権限・130番SQLを確認してください。');});
  const counter=sequence;
  const clear=()=>{++counter.current;setState(null);setDraft(null);setReview(null);setAgreed(false);setPreview(false);nonce.current=null;setNotice('詳細を閉じました。「履歴を更新」で再取得してください。');};
  const visibility=()=>{if(document.visibilityState==='hidden')clear();};
  const timer=window.setInterval(()=>setNow(Date.now()),30000);
  window.addEventListener('blur',clear);document.addEventListener('visibilitychange',visibility);
  return()=>{active.current=false;++counter.current;window.clearInterval(timer);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',visibility);};
 // offerId単位で親がkeyを設定する。更新は明示操作で行う。
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 function edit(change:Partial<NonNullable<typeof draft>>){if(draft){setDraft({...draft,...change});setPreview(false);nonce.current=null;}}
 function propose(){if(!draft)return;void run(async()=>{
  nonce.current ||= crypto.randomUUID();await proposeContractAmendment({requestId:nonce.current,offerId,version:draft.base.version,terms:draft.terms,details:draft.details,reason:draft.reason});
  if(!active.current)return;await reload();if(active.current)setNotice('変更条件を提示しました。相手方の同意までは現在の版を維持します。');
 });}
 function respond(a:ContractAmendment,action:'confirm'|'decline'|'withdraw'){void run(async()=>{
  const version=await respondContractAmendment(a.id,action);if(!active.current)return;await reload();
  if(active.current)setNotice(action==='confirm'?`変更合意を保存しました。現在の版は${version}です。旧版も履歴に残っています。`:action==='decline'?'変更提示を辞退しました。現在の版は変わりません。':'変更提示を取り下げました。現在の版は変わりません。');
 });}
 function download(version:number,format:'json'|'pdf'){void run(async()=>{
  const file=await prepareContractFile(offerId,version,format,()=>active.current&&document.visibilityState!=='hidden');
  if(!file)return;savePreparedContractFile(file);setNotice(`版${version}の${format==='pdf'?'PDF':'JSON'}を生成しました。端末で保存結果を確認してください。電子署名は付与されていません。`);
 });}
 const current=state?.versions[0],pending=state?.amendments.find(a=>a.status==='offered');
 const pendingBase=state?.versions.find(v=>v.version===pending?.base_version),mine=pending?.proposed_company_id===companyId;
 const expired=pending?Date.parse(pending.expires_at)<=now:false;
 return <div className="overlay-view show" style={{zIndex:1160,display:'flex',flexDirection:'column'}}>
  <header className="solid-header overlay-header"><button disabled={busy} onClick={onBack}>契約一覧に戻る</button><h1 style={{fontSize:17}}>契約の変更合意・版履歴</h1></header>
  <main className="list-area bg-gray" style={{padding:20,overflowY:'auto',paddingBottom:90}}>
   <p>変更提示だけでは契約条件は変わりません。相手方の同意後に新しい版を保存し、旧版を残します。電子署名は未対応です。</p>
   <p style={{fontSize:13}}>変更できるのは追加条件・税・経費・支払日・検査期限・中途解約・知財・責任条件です。業務・単価・日程・当事者・スタッフの変更は、新しい承諾と契約を別途確認してください。現在は架空データで検証してください。</p>
   <button disabled={busy} onClick={()=>void run(reload)}>履歴を更新</button>
   {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}{notice&&<p role="status" style={{padding:12,background:'#eff6ff'}}>{notice}</p>}
   {state&&current&&<>
    <p style={{overflowWrap:'anywhere'}}>契約番号：{state.contract_id}<br/><strong>現在の版：{current.version}</strong></p>
    {!state.can_propose&&<p>承諾または契約状態を確認できないため、変更操作を停止しています。</p>}
    {pending&&pendingBase&&<section style={{padding:14,background:'white',margin:'16px 0',borderRadius:10}}><h2 style={{fontSize:18}}>回答待ちの変更提示</h2>
      <p>{mine?'自社からの提示':'相手方からの提示'} ／ 回答期限：{new Date(pending.expires_at).toLocaleString('ja-JP')}</p>
      <p style={{whiteSpace:'pre-wrap'}}>変更理由：{pending.reason}</p><Changes before={pendingBase} terms={pending.terms} details={pending.details}/>
      {expired&&<p>回答期限切れです。取り下げまたは辞退し、必要なら再提示してください。</p>}
      {state.can_propose&&(mine?<button disabled={busy} onClick={()=>{if(window.confirm('変更提示を取り下げますか？'))respond(pending,'withdraw');}}>変更提示を取り下げる</button>:<>
       {review!==pending.id?<button disabled={busy||expired} onClick={()=>{setReview(pending.id);setAgreed(false);}}>変更内容の最終確認へ</button>:<div style={{padding:12,background:'#eff6ff'}}>
        <h3>変更合意の最終確認</h3><p>同意すると版{pendingBase.version+1}を保存します。現在の版{pendingBase.version}も履歴に残ります。</p>
        <label><input type="checkbox" checked={agreed} disabled={busy} onChange={e=>setAgreed(e.target.checked)}/>変更理由と変更前後の条件を確認し、この変更に同意します。</label>
        <button disabled={busy||!agreed||expired} onClick={()=>respond(pending,'confirm')}>この変更に同意して新しい版を確定する</button>
       </div>}
       <button disabled={busy} onClick={()=>{if(window.confirm('変更提示を辞退しますか？現在の版は変わりません。'))respond(pending,'decline');}}>変更提示を辞退する</button>
      </>)}
     </section>}
    {state.can_propose&&!pending&&!draft&&<button disabled={busy} onClick={()=>{setDraft({base:current,terms:current.terms,details:{...current.details},reason:''});setPreview(false);nonce.current=null;}}>現在の版から変更を提示する</button>}
    {draft&&<section style={{background:'white',padding:14,margin:'16px 0',borderRadius:10}}><h2 style={{fontSize:18}}>版{draft.base.version}からの変更案</h2>
     <form onSubmit={e=>{e.preventDefault();setPreview(true);}} style={{display:'grid',gap:12}}>
      <label>変更理由（5文字以上）<textarea required minLength={5} maxLength={2000} rows={3} disabled={busy||preview} style={inputStyle} value={draft.reason} onChange={e=>edit({reason:e.target.value})}/></label>
      <label>追加条件（20文字以上）<textarea required minLength={20} maxLength={20000} rows={5} disabled={busy||preview} style={inputStyle} value={draft.terms} onChange={e=>edit({terms:e.target.value})}/></label>
      {(Object.keys(contractDetailLabels) as (keyof ContractDetails)[]).map(k=><label key={k}>{contractDetailLabels[k]}（必須）
       {k==='payment_due'||k==='inspection_due'?<input type="date" required disabled={busy||preview} value={draft.details[k]} style={inputStyle} onChange={e=>edit({details:{...draft.details,[k]:e.target.value}})}/>:<textarea required minLength={2} maxLength={2000} rows={3} disabled={busy||preview} value={draft.details[k]} style={inputStyle} onChange={e=>edit({details:{...draft.details,[k]:e.target.value}})}/>}
      </label>)}
      {!preview&&<button disabled={busy}>変更前後を確認する</button>}
     </form>
     {preview&&<><h3>提示前の確認</h3><p style={{whiteSpace:'pre-wrap'}}>変更理由：{draft.reason}</p><Changes before={draft.base} terms={draft.terms} details={draft.details}/>
      <button disabled={busy} onClick={propose}>この変更内容を相手方に提示する</button><button disabled={busy} onClick={()=>setPreview(false)}>編集に戻る</button></>}
     <button disabled={busy} onClick={()=>{setDraft(null);setPreview(false);nonce.current=null;}}>変更案を閉じる</button>
    </section>}
    <h2 style={{fontSize:18,marginTop:24}}>確定した版の履歴</h2>
    {state.versions.map(v=><details key={v.version} style={{background:'white',padding:14,marginBottom:12,borderRadius:10}}><summary>版{v.version}{v.version===current.version?'（現在）':'（旧版）'} ／ {new Date(v.confirmed_at).toLocaleString('ja-JP')}</summary>
     {v.change_reason&&<p style={{whiteSpace:'pre-wrap'}}>変更理由：{v.change_reason}</p>}
     <p style={{whiteSpace:'pre-wrap'}}>追加条件：{v.terms}</p>{(Object.keys(contractDetailLabels) as (keyof ContractDetails)[]).map(k=><p key={k} style={{whiteSpace:'pre-wrap'}}><strong>{contractDetailLabels[k]}：</strong>{v.details[k]}</p>)}
     <p style={{fontSize:12,overflowWrap:'anywhere'}}>原データSHA256：{v.sha256}</p>
     <button disabled={busy} onClick={()=>download(v.version,'json')}>版{v.version}のJSON</button><button disabled={busy} onClick={()=>download(v.version,'pdf')}>版{v.version}のPDF</button>
    </details>)}
    <h2 style={{fontSize:18}}>変更提示の履歴（直近100件）</h2>
    {!state.amendments.length&&<p>変更提示はまだありません。</p>}
    {state.amendments.map(a=><details key={a.id} style={{padding:12,background:'white',marginBottom:10}}><summary>{labels[a.status]} ／ 元の版{a.base_version} ／ {new Date(a.created_at).toLocaleString('ja-JP')}</summary>
     <p style={{whiteSpace:'pre-wrap'}}>変更理由：{a.reason}</p>{state.versions.find(v=>v.version===a.base_version)&&<Changes before={state.versions.find(v=>v.version===a.base_version)!} terms={a.terms} details={a.details}/>}
    </details>)}
   </>}
  </main>
 </div>;
}
