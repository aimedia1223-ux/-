import {supabase} from './supabase';
export const auditActions:Record<string,string>={
 'responsibility.saved':'案件責任者を保存','responsibility.deleted':'案件責任者を削除',
 'agency_manager.saved':'二次管理責任者を保存','agency_manager.deleted':'二次管理責任者を削除',
 'offer.created':'契約条件を提示','offer.confirmed':'契約条件に同意・確定','offer.declined':'契約条件を辞退','offer.withdrawn':'契約提示を取下げ','offer.deleted':'契約提示を削除',
 'contract.created':'契約を登録','contract.updated':'契約を変更','contract.deleted':'契約を削除',
 'message.sent':'責任者へ連絡を送信','message.updated':'連絡を変更','message.deleted':'連絡を削除',
 'job.created':'案件を登録','job.updated':'案件を変更','job.deleted':'案件を削除',
 'staff.created':'スタッフを登録','staff.updated':'スタッフを変更','staff.deleted':'スタッフを削除',
 'approval.created':'承諾照合記録を登録','approval.revoked':'承諾照合記録を取消','approval.deleted':'承諾照合記録を削除',
 'job_detail.read':'承諾済み案件の詳細を取得','responsibility.read':'案件責任者を取得','agency_manager.read':'二次管理責任者の一覧を取得',
 'offer.read':'契約提示の詳細を取得','message.read':'責任者間連絡を取得','thread.read':'責任者の連絡先一覧を取得','audit.read':'監査ログを取得',
 'data.read':'通常一覧のデータを取得','staff_export.read':'スタッフCSVの出力データを生成',
 'deletion_record.created':'削除実施記録を作成','deletion_check.saved':'外部証跡の確認状況を保存',
 'deletion_records.read':'削除実施記録の一覧を取得','deletion_record.read':'削除実施記録の出力データを生成',
 'contract_pdf.read':'契約書PDF用の確定内容を取得',
};
export type AuditGroup='all'|'read'|'change'|'delete';
export type AuditEvent={id:string;occurred_at:string;action:string;actor_kind:'own'|'counterparty'|'server';actor_staff_id:string|null;actor_name:string|null;target_type:string;target_id:string|null;version:number|null;item_count:number|null};
export type AuditPage={items:AuditEvent[];has_more:boolean;next_before_id:string|null};
function fail(code?:string):never{
 if(code==='42501')throw new Error('自社の管理者権限・追加認証・ログイン期限を確認してください。');
 if(code==='22023')throw new Error('表示条件を確認し、最新の一覧からやり直してください。');
 throw new Error('監査ログを取得できません。接続と124番SQLの適用を確認してください。');
}
export async function listAuditEvents(group:AuditGroup='all',beforeId:string|null=null):Promise<AuditPage>{
 const {data,error}=await supabase.rpc('connexy_list_audit_events',{before_id:beforeId,event_group:group});
 if(error)fail(error.code);
 if(!data||!Array.isArray(data.items)||typeof data.has_more!=='boolean'
   ||(data.next_before_id!==null&&(typeof data.next_before_id!=='string'||!/^\d+$/.test(data.next_before_id)))
   ||(data.has_more&&data.next_before_id===null))fail();
 const items=data.items.map((r:AuditEvent):AuditEvent=>{
  if(!r||typeof r.id!=='string'||!/^\d+$/.test(r.id)||typeof r.occurred_at!=='string'||!Number.isFinite(Date.parse(r.occurred_at))
   ||!Object.prototype.hasOwnProperty.call(auditActions,r.action)||!['own','counterparty','server'].includes(r.actor_kind)
   ||!['job','staff','approval','offer','contract','message','collection','audit'].includes(r.target_type)
   ||(r.target_id!==null&&typeof r.target_id!=='string')||(r.actor_staff_id!==null&&typeof r.actor_staff_id!=='string')
   ||(r.actor_name!==null&&typeof r.actor_name!=='string')
   ||(r.version!==null&&(!Number.isSafeInteger(r.version)||r.version<1))
   ||(r.item_count!==null&&(!Number.isSafeInteger(r.item_count)||r.item_count<0)))fail();
  // 相手側の氏名・担当者IDは、応答に混入しても画面へ渡さない。
  return{id:r.id,occurred_at:r.occurred_at,action:r.action,actor_kind:r.actor_kind,
   actor_staff_id:r.actor_kind==='own'?r.actor_staff_id:null,actor_name:r.actor_kind==='own'?r.actor_name:null,
   target_type:r.target_type,target_id:r.target_id,version:r.version,item_count:r.item_count};
 });
 return{items,has_more:data.has_more,next_before_id:data.next_before_id};
}
