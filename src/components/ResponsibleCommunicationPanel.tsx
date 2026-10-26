import {useEffect,useRef,useState} from 'react';
import {listResponsibleThreads,readResponsibleMessages,sendResponsibleMessage} from '../lib/responsibleCommunications';
import type {ResponsibleThread,ResponsibleMessage} from '../lib/responsibleCommunications';

export function ResponsibleCommunicationPanel({onBack}:{onBack?:()=>void}) {
  const [threads,setThreads]=useState<ResponsibleThread[]>([]);
  const [scope,setScope]=useState<ResponsibleThread|null>(null);
  const [messages,setMessages]=useState<ResponsibleMessage[]>([]);
  const [body,setBody]=useState('');const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [hasOlder,setHasOlder]=useState(false);
  const active=useRef(true),epoch=useRef(0),locked=useRef(false);
  const pending=useRef<{id:string;body:string;approval:string;pv:number;mv:number}|null>(null);
  function clearDetails(){setScope(null);setMessages([]);setBody('');setHasOlder(false);pending.current=null;}
  async function load(approval?:string,before?:string) {
    if(locked.current)return;const request=++epoch.current;setBusy(true);setError('');setNotice('');
    setScope(null);setMessages([]);setThreads([]);setHasOlder(false);
    try {
      if(approval){const next=await readResponsibleMessages(approval,before);
        if(active.current && request===epoch.current){setScope(next.scope);setMessages(next.messages);setHasOlder(next.messages.length===50);}}
      else {clearDetails();const next=await listResponsibleThreads();if(active.current && request===epoch.current)setThreads(next);}
    }catch(e){if(active.current && request===epoch.current){clearDetails();setError(e instanceof Error?e.message:'取得できません。');}}
    finally{if(active.current && request===epoch.current)setBusy(false);}
  }
  useEffect(()=>{
    active.current=true;void load();
    return()=>{active.current=false;++epoch.current;};
  },[]);
  useEffect(()=>{
    // 詳細を長時間残さず、復帰時・30秒経過時には再確認を要求する。
    const hide=()=>{++epoch.current;clearDetails();setThreads([]);setBusy(false);setNotice('一覧を更新して承諾と責任者を再確認してください。');};
    const timer=(scope || threads.length>0)?window.setTimeout(hide,30000):undefined;
    document.addEventListener('visibilitychange',hide);
    return()=>{window.clearTimeout(timer);document.removeEventListener('visibilitychange',hide);};
  },[scope,threads]);
  async function send(event:React.FormEvent){
    event.preventDefault();if(!scope || busy || locked.current || !body.trim())return;
    const selected=scope,text=body.trim();
    if(!pending.current || pending.current.body!==text || pending.current.approval!==selected.approval_id
      || pending.current.pv!==selected.primary_version || pending.current.mv!==selected.manager_version)
      pending.current={id:crypto.randomUUID(),body:text,approval:selected.approval_id,pv:selected.primary_version,mv:selected.manager_version};
    const request=++epoch.current;locked.current=true;setBusy(true);setError('');setNotice('');
    try{
      await sendResponsibleMessage(selected,text,pending.current.id);
      if(active.current && request===epoch.current){setBody('');pending.current=null;setScope(null);setMessages([]);
        const next=await readResponsibleMessages(selected.approval_id);
        if(active.current && request===epoch.current){setScope(next.scope);setMessages(next.messages);setHasOlder(next.messages.length===50);setNotice('責任者へ送信しました。');}}
    }catch(e){if(active.current && request===epoch.current){setScope(null);setMessages([]);setError((e instanceof Error?e.message:'送信結果を確認できません。')+' 再送前に一覧から最新の連絡を確認してください。');}}
    finally{locked.current=false;if(active.current)setBusy(false);}
  }
  const buttonStyle={padding:'10px 14px',borderRadius:8,border:'1px solid #b9c6d6',background:'#fff',color:'#123'};
  return <section className="overlay-view show" style={{zIndex:1150,display:'flex',flexDirection:'column'}}>
    <header className="solid-header overlay-header">{onBack&&<button disabled={busy} onClick={onBack}>管理に戻る</button>}<h1 style={{fontSize:17}}>責任者間の業務連絡</h1></header>
    <main className="list-area bg-gray" style={{padding:20,overflowY:'auto',paddingBottom:100}}>
      <p>一次委託先の窓口と二次委託先の管理責任者だけが送受信できます。スタッフへの直接送信はできません。</p>
      <p style={{fontSize:13}}>現在は架空データで確認してください。実際の機密情報・個人情報・作業指示は入力しないでください。</p>
      <button disabled={busy} style={buttonStyle} onClick={()=>void load()}>連絡先一覧を更新</button>
      {busy&&<p role="status">確認中…</p>}{error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
      {notice&&<p role="status">{notice}</p>}
      {!busy&&!scope&&!error&&<><h2 style={{fontSize:17}}>連絡できる案件（{threads.length}件）</h2>
        {threads.length===0&&<p>連絡できる案件はありません。承諾と双方の責任者登録が必要です。二次責任者は承諾対象の管理者本人に限ります。</p>}
        {threads.map(t=><article key={t.approval_id} style={{background:'#fff',padding:16,marginTop:16,borderRadius:12}}>
          <h3 style={{fontSize:16}}>{t.job_title}</h3><p>一次窓口：{t.primary_name} → 二次管理責任者：{t.manager_name}</p>
          <button style={buttonStyle} onClick={()=>{setBody('');pending.current=null;void load(t.approval_id);}}>責任者との連絡を開く</button>
        </article>)}
      </>}
      {scope&&<>
        <h2 style={{fontSize:17}}>{scope.job_title}</h2><p>送信先：{scope.side==='client'?`二次管理責任者 ${scope.manager_name}`:`一次窓口 ${scope.primary_name}`}</p>
        <p style={{fontSize:13}}>表示は30秒で閉じます。責任者の変更後は、変更前の連絡を表示しません。</p>
        <button disabled={busy} style={buttonStyle} onClick={()=>void load(scope.approval_id)}>最新の連絡を取得</button>
        {hasOlder&&messages[0]&&<button disabled={busy} style={buttonStyle} onClick={()=>void load(scope.approval_id,messages[0].id)}>前の50件を表示</button>}
        {messages.length===0&&<p>連絡はまだありません。</p>}
        {messages.map(m=><article key={m.id} style={{padding:12,margin:'12px 0',background:m.side===scope.side?'#eff6ff':'#fff',borderRadius:8}}>
          <strong>{m.side==='client'?scope.primary_name:scope.manager_name}</strong><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{m.body}</p>
          <small>{new Date(m.created_at).toLocaleString('ja-JP')}</small>
        </article>)}
        <form onSubmit={event=>void send(event)} style={{display:'grid',gap:12}}>
          <label>責任者への連絡<textarea aria-label="責任者への連絡" required maxLength={2000} disabled={busy} value={body} onChange={e=>setBody(e.target.value)} style={{width:'100%',minHeight:100,padding:10,boxSizing:'border-box'}}/></label>
          <button disabled={busy||!body.trim()} style={{...buttonStyle,background:'#0064e6',color:'#fff'}}>責任者へ送信</button>
        </form>
        <p style={{fontSize:13}}>二次委託先スタッフへの連絡は、二次管理責任者が自社の手段で行ってください。アプリ内でのスタッフ向け中継は未対応です。</p>
      </>}
    </main>
  </section>;
}
