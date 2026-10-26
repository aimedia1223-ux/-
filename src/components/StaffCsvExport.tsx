import {useEffect,useRef,useState} from 'react';
import {getStaffCsv} from '../lib/auditedReads';
export function StaffCsvExport(){
 const[busy,setBusy]=useState(false),[notice,setNotice]=useState('');const locked=useRef(false);
 const active=useRef(true);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 async function download(){
  if(locked.current)return;locked.current=true;setBusy(true);setNotice('');
  try{
   const result=await getStaffCsv();
   if(!active.current)return;
   const url=URL.createObjectURL(new Blob(['\uFEFF',result.csv],{type:'text/csv;charset=utf-8;'}));
   try{const a=document.createElement('a');a.href=url;a.download=result.filename;document.body.appendChild(a);a.click();a.remove();}
   finally{window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
   setNotice(`${result.count}名分の出力データを生成しました。ファイルの保存結果は端末で確認してください。`);
  }catch(e){if(active.current)setNotice(e instanceof Error?e.message:'CSVを生成できません。');}
  finally{locked.current=false;if(active.current)setBusy(false);}
 }
 return <div style={{marginBottom:16}}><button disabled={busy} onClick={()=>void download()} className="btn-secondary" style={{padding:10}}>自社スタッフ一覧をCSV出力</button>
  <p style={{fontSize:12}}>スタッフID・氏名・表示名を出力します。出力データの生成操作は監査ログに記録されます。</p>
  {notice&&<p role="status" style={{fontSize:13}}>{notice}</p>}</div>;
}
