import {useEffect,useRef,useState} from 'react';
import {auditActions,listAuditEvents} from '../lib/auditLog';
import type {AuditGroup,AuditPage} from '../lib/auditLog';
const targetLabels:Record<string,string>={job:'案件',staff:'スタッフ',approval:'承諾照合記録',offer:'契約提示',contract:'契約',message:'連絡',collection:'一覧',audit:'監査ログ'};
export function AuditLogPanel({onBack}:{onBack:()=>void}){
 const [group,setGroup]=useState<AuditGroup>('all');const [page,setPage]=useState<AuditPage|null>(null);
 const [busy,setBusy]=useState(true),[error,setError]=useState('');
 const active=useRef(true),epoch=useRef(0);
 async function load(nextGroup:AuditGroup,before:string|null=null){
  const request=++epoch.current;setBusy(true);setError('');setPage(null);
  try{const result=await listAuditEvents(nextGroup,before);if(active.current&&request===epoch.current)setPage(result);}
  catch(e){if(active.current&&request===epoch.current)setError(e instanceof Error?e.message:'取得できません。');}
  finally{if(active.current&&request===epoch.current)setBusy(false);}
 }
 useEffect(()=>{
  active.current=true;const request=++epoch.current;
  void listAuditEvents('all').then(result=>{if(active.current&&request===epoch.current)setPage(result);})
   .catch(e=>{if(active.current&&request===epoch.current)setError(e instanceof Error?e.message:'取得できません。');})
   .finally(()=>{if(active.current&&request===epoch.current)setBusy(false);});
  return()=>{active.current=false;};
 },[]);
 useEffect(()=>{
  const hide=()=>{++epoch.current;setPage(null);setBusy(false);};
  const timer=page?window.setTimeout(hide,30000):undefined;
  document.addEventListener('visibilitychange',hide);
  return()=>{window.clearTimeout(timer);document.removeEventListener('visibilitychange',hide);};
 },[page]);
 return <section className="overlay-view show" style={{zIndex:1150,display:'flex',flexDirection:'column'}}>
  <header className="solid-header overlay-header"><button onClick={onBack}>管理に戻る</button><h1 style={{fontSize:18}}>監査ログ</h1></header>
  <main className="list-area bg-gray" style={{padding:20,overflowY:'auto',paddingBottom:90}}>
   <p>自社に関係する対象操作の記録です。いつ・誰が・何をしたか確認できます。</p>
   <p style={{fontSize:13}}>記録開始後の成功した対象操作を表示します。本文・契約内容は含みません。削除履歴は、バックアップを含む消去証明ではありません。</p>
   <details style={{fontSize:13,marginBottom:16}}><summary>今回記録する範囲</summary>
    <p>専用画面での承諾済み案件詳細・責任者・契約提示・連絡の取得と、対象データの登録・変更・送信・削除です。</p>
    <p>通常一覧は監査付き取得の適用後に記録します。スタッフCSVは出力データ生成を記録し、端末への保存完了は証明しません。失敗した操作はまだ対象外です。</p>
   </details>
   <label>表示する操作<select value={group} disabled={busy} onChange={e=>{const value=e.target.value as AuditGroup;setGroup(value);void load(value);}} style={{padding:10,marginLeft:10}}>
    <option value="all">すべて</option><option value="read">閲覧・取得</option><option value="change">登録・変更・送信</option><option value="delete">削除</option>
   </select></label>
   <button disabled={busy} onClick={()=>void load(group)} style={{padding:10,margin:'12px 0',display:'block'}}>最新の記録を取得</button>
   {busy&&<p role="status">確認中…</p>}{error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
   {!page&&!busy&&!error&&<p>最新の記録を取得してください。</p>}
   {page&&<><p>今回の表示：{page.items.length}件（新しい順・最大50件）</p>
    {page.items.length===0&&<p>この条件の記録はありません。</p>}
    {page.items.map(row=><article key={row.id} style={{padding:16,background:'#fff',border:'1px solid #dbe3ed',borderRadius:12,marginBottom:12,overflowWrap:'anywhere'}}>
     <time>{new Date(row.occurred_at).toLocaleString('ja-JP')}</time>
     <h2 style={{fontSize:16,margin:'8px 0'}}>{auditActions[row.action]}</h2>
     <p>操作者：{row.actor_kind==='server'?'サーバー管理操作':row.actor_kind==='counterparty'?'取引相手側の操作':row.actor_name||'自社担当者'}</p>
     {row.actor_staff_id&&<p style={{fontSize:12}}>担当者ID：{row.actor_staff_id}</p>}
     <p>対象：{targetLabels[row.target_type]}{row.target_id?` ／ ${row.target_id}`:''}</p>
     {row.version!==null&&<p>登録の版：{row.version}</p>}
     {row.item_count!==null&&<p>{row.action==='approval.deleted'?'関連連絡の削除対象件数':'取得件数'}：{row.item_count}件</p>}
     <small>記録番号：{row.id}</small>
    </article>)}
    {page.has_more&&<button disabled={busy} onClick={()=>void load(group,page.next_before_id)} style={{padding:12}}>前の50件を表示</button>}
   </>}
   <p style={{fontSize:12}}>この画面から記録を編集・削除することはできません。表示は30秒で閉じます。自社担当者の氏名は現在の登録名です。</p>
  </main>
 </section>;
}
