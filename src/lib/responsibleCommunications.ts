import { supabase } from './supabase';
export type ResponsibleThread = {approval_id:string;job_title:string;side:'client'|'agency';primary_version:number;manager_version:number;primary_name:string;manager_name:string};
export type ResponsibleMessage = {id:string;side:'client'|'agency';body:string;created_at:string};
function fail(code?:string):never {
  if(code==='42501') throw new Error('追加認証・ログイン期限・承諾・現在の責任者を確認してから一覧を更新してください。');
  if(code==='40001') throw new Error('責任者が変更されています。一覧を更新してください。');
  if(code==='22023') throw new Error('本文または送信内容を確認できません。一覧を更新してください。');
  throw new Error('通信結果を確認できません。接続と122番SQLの適用を確認してください。');
}
function parseThread(value:unknown):ResponsibleThread {
  const r=value as ResponsibleThread;
  if(!r || typeof r.approval_id!=='string' || typeof r.job_title!=='string' || !['client','agency'].includes(r.side)
    || typeof r.primary_name!=='string' || typeof r.manager_name!=='string'
    || !Number.isSafeInteger(r.primary_version) || r.primary_version<1 || !Number.isSafeInteger(r.manager_version) || r.manager_version<1) fail();
  return {approval_id:r.approval_id,job_title:r.job_title,side:r.side,primary_version:r.primary_version,manager_version:r.manager_version,primary_name:r.primary_name,manager_name:r.manager_name};
}
export async function listResponsibleThreads():Promise<ResponsibleThread[]> {
  const {data,error}=await supabase.rpc('connexy_list_responsible_threads');
  if(error)fail(error.code); if(!Array.isArray(data))fail(); return data.map(parseThread);
}
export async function readResponsibleMessages(approvalId:string,beforeId:string|null=null):Promise<{scope:ResponsibleThread;messages:ResponsibleMessage[]}> {
  const {data,error}=await supabase.rpc('connexy_read_responsible_messages',{target_approval:approvalId,before_id:beforeId});
  if(error)fail(error.code); if(!data || !Array.isArray(data.messages))fail();
  return {scope:parseThread(data.scope),messages:data.messages.map((r:ResponsibleMessage)=>{
    if(!r || typeof r.id!=='string' || !/^\d+$/.test(r.id) || !['client','agency'].includes(r.side) || typeof r.body!=='string' || typeof r.created_at!=='string')fail();
    return {id:r.id,side:r.side,body:r.body,created_at:r.created_at};
  })};
}
export async function sendResponsibleMessage(scope:ResponsibleThread,body:string,requestId:string):Promise<string> {
  const {data,error}=await supabase.rpc('connexy_send_responsible_message',{target_approval:scope.approval_id,message_body:body,request_id:requestId,
    expected_primary_version:scope.primary_version,expected_manager_version:scope.manager_version});
  if(error)fail(error.code);if(!data || typeof data.id!=='string' || !/^\d+$/.test(data.id))fail();return data.id;
}
