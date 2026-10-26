import {supabase} from './supabase';
export const checkLabels:Record<string,string>={return:'返還の確認',external_files:'社内・外部保管ファイル',downloads:'端末へ保存したファイル',backups:'バックアップ',subcontractor:'二次委託先・再委託先'};
export type DeletionCheck={category:string;status:'pending'|'reported';evidence_reference:string|null;evidence_sha256:string|null;version:number;updated_at:string|null};
export type DeletionRecord={id:string;deletion_event_id:string;action:string;target_type:string;target_id:string|null;deleted_at:string;created_at:string;recorded_by_staff_id:string;scope:'application_target_only';external_verification:'unverified';checks:DeletionCheck[]};
export type DeletionCandidate={id:string;action:string;target_type:string;target_id:string|null;occurred_at:string};
export type DeletionState={records:DeletionRecord[];candidates:DeletionCandidate[]};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function fail(code?:string):never{
 if(code==='42501')throw new Error('自社管理者の追加認証と対象の削除ログを確認してください。');
 if(code==='40001')throw new Error('別の更新が保存されています。一覧を取得し直してください。');
 if(code==='22023')throw new Error('状態・内部管理番号・SHA256・登録の版を確認してください。');
 throw new Error('削除実施記録を取得・保存できません。接続と126番SQLの適用を確認してください。');
}
export async function listDeletionRecords():Promise<DeletionState>{
 const{data,error}=await supabase.rpc('connexy_list_deletion_records');if(error)fail(error.code);
 if(!data||!Array.isArray(data.records)||!Array.isArray(data.candidates))fail();
 const records=data.records.map((r:DeletionRecord):DeletionRecord=>{
  if(!r||typeof r.id!=='string'||!uuid.test(r.id)||typeof r.deletion_event_id!=='string'||!/^\d+$/.test(r.deletion_event_id)
   ||typeof r.action!=='string'||!r.action.endsWith('.deleted')||typeof r.target_type!=='string'
   ||(r.target_id!==null&&typeof r.target_id!=='string')||typeof r.deleted_at!=='string'||!Number.isFinite(Date.parse(r.deleted_at))
   ||typeof r.created_at!=='string'||!Number.isFinite(Date.parse(r.created_at))
   ||typeof r.recorded_by_staff_id!=='string'||r.scope!=='application_target_only'||r.external_verification!=='unverified'
   ||!Array.isArray(r.checks)||r.checks.length!==5||r.checks.some(c=>!c)||new Set(r.checks.map(c=>c.category)).size!==5)fail();
  const checks=r.checks.map((c:DeletionCheck):DeletionCheck=>{
   if(!c||!Object.hasOwn(checkLabels,c.category)||!['pending','reported'].includes(c.status)||!Number.isSafeInteger(c.version)||c.version<1
     ||(c.evidence_reference!==null&&typeof c.evidence_reference!=='string')||(c.evidence_sha256!==null&&typeof c.evidence_sha256!=='string')
     ||(c.updated_at!==null&&typeof c.updated_at!=='string'))fail();
   return{category:c.category,status:c.status,evidence_reference:c.evidence_reference,evidence_sha256:c.evidence_sha256,version:c.version,updated_at:c.updated_at};
  });
  return{id:r.id,deletion_event_id:r.deletion_event_id,action:r.action,target_type:r.target_type,target_id:r.target_id,deleted_at:r.deleted_at,
   created_at:r.created_at,recorded_by_staff_id:r.recorded_by_staff_id,scope:r.scope,external_verification:r.external_verification,checks};
 });
 const candidates=data.candidates.map((r:DeletionCandidate):DeletionCandidate=>{
  if(!r||typeof r.id!=='string'||!/^\d+$/.test(r.id)||typeof r.action!=='string'||!r.action.endsWith('.deleted')
   ||typeof r.target_type!=='string'||(r.target_id!==null&&typeof r.target_id!=='string')||typeof r.occurred_at!=='string')fail();
  return{id:r.id,action:r.action,target_type:r.target_type,target_id:r.target_id,occurred_at:r.occurred_at};
 });
 return{records,candidates};
}
export async function createDeletionRecord(eventId:string):Promise<string>{
 const{data,error}=await supabase.rpc('connexy_create_deletion_record',{target_event:eventId});if(error)fail(error.code);
 if(typeof data!=='string'||!uuid.test(data))fail();return data;
}
export async function saveDeletionCheck(recordId:string,check:DeletionCheck,status:'pending'|'reported',reference:string,hash:string):Promise<void>{
 const{error}=await supabase.rpc('connexy_save_deletion_check',{target_record:recordId,target_category:check.category,check_status:status,
  evidence_reference:status==='pending'?null:reference,evidence_sha256:status==='pending'?null:hash,expected_version:check.version});if(error)fail(error.code);
}
export async function exportDeletionRecord(recordId:string):Promise<{filename:string;text:string}>{
 const{data,error}=await supabase.rpc('connexy_export_deletion_record',{target_record:recordId});if(error)fail(error.code);
 if(!data||typeof data.canonical_payload!=='string'||typeof data.sha256!=='string'||!/^([0-9a-f]{64})$/.test(data.sha256)
  ||data.filename!==`Connexy_deletion_record_${recordId}.json`)fail();
 let payload;try{payload=JSON.parse(data.canonical_payload);}catch{fail();}
 if(!payload||payload.record_type!=='application_deletion_execution_record'||payload.record?.id!==recordId
   ||payload.record.scope!=='application_target_only'||payload.record.external_verification!=='unverified'||payload.signature!=='none')fail();
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data.canonical_payload));
 const digest=Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');if(digest!==data.sha256)fail();
 return{filename:data.filename,text:JSON.stringify({canonical_payload:data.canonical_payload,sha256:data.sha256},null,2)};
}
