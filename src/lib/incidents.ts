import {supabase} from './supabase';
export const incidentCategories={loss:'紛失・盗難',misdelivery:'誤送信・誤開示',unauthorized:'不正アクセスの疑い',other:'その他の疑い'};
export const incidentStatuses={reported:'報告受付',investigating:'調査中',contained:'拡大防止対応済み',resolved:'対応完了'};
export const evidenceLabels={unconfirmed:'保全未確認',preserved:'保全したとの記録',unavailable:'保全できない・要対応'};
export const externalLabels={unreported:'連絡未完了・未確認',reported:'社外へ連絡したとの記録'};
export type IncidentCategory=keyof typeof incidentCategories;
export type IncidentStatus=keyof typeof incidentStatuses;
export type EvidenceState=keyof typeof evidenceLabels;
export type ExternalState=keyof typeof externalLabels;
export type IncidentSummary={id:string;category:IncidentCategory;status:IncidentStatus;created_at:string;version:number};
export type IncidentEvent={version:number;actor_staff_id:string;status:IncidentStatus;note:string;evidence_state:EvidenceState;external_state:ExternalState;occurred_at:string};
export type IncidentDetail=IncidentSummary&{discovered_at:string;summary:string;initial_action:string;reporter_staff_id:string;updated_at:string;history:IncidentEvent[]};
export type IncidentContact={contact:string;lead_staff_id:string;version:number;updated_at:string};
export type IncidentList={items:IncidentSummary[];contact:IncidentContact|null;can_manage:boolean};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const version=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
function fail(code?:string):never{
 if(code==='42501')throw new Error('ログイン状態・所属・この報告を確認する権限を確認してください。');
 if(code==='40001')throw new Error('別の更新があります。報告または一覧を開き直してください。');
 if(code==='22023')throw new Error('発見日時・入力文字数・状態・自社管理者のスタッフIDを確認してください。');
 throw new Error('報告を取得・保存できません。接続と135番SQLの適用を確認してください。');
}
function summary(r:IncidentSummary):IncidentSummary{
 if(!r||typeof r.id!=='string'||!uuid.test(r.id)||!Object.hasOwn(incidentCategories,r.category)||!Object.hasOwn(incidentStatuses,r.status)||!date(r.created_at)||!version(r.version))fail();
 return{id:r.id,category:r.category,status:r.status,created_at:r.created_at,version:r.version};
}
export async function listIncidents():Promise<IncidentList>{
 const{data,error}=await supabase.rpc('connexy_list_incidents');if(error)fail(error.code);
 if(!data||!Array.isArray(data.items)||data.items.length>50||typeof data.can_manage!=='boolean')fail();
 const c:IncidentContact|null=data.contact;
 if(c!==null&&(!c||typeof c.contact!=='string'||typeof c.lead_staff_id!=='string'||!version(c.version)||!date(c.updated_at)))fail();
 return{items:data.items.map(summary),can_manage:data.can_manage,contact:c?{contact:c.contact,lead_staff_id:c.lead_staff_id,version:c.version,updated_at:c.updated_at}:null};
}
export async function readIncident(id:string):Promise<IncidentDetail>{
 const{data:r,error}=await supabase.rpc('connexy_read_incident',{target_report:id});if(error)fail(error.code);
 const base=summary(r);
 if(base.id!==id||!date(r.discovered_at)||!date(r.updated_at)||typeof r.summary!=='string'||typeof r.initial_action!=='string'||typeof r.reporter_staff_id!=='string'||!Array.isArray(r.history)||r.history.length===0||r.history.length>100)fail();
 const history=r.history.map((e:IncidentEvent):IncidentEvent=>{
  if(!e||!version(e.version)||!Object.hasOwn(incidentStatuses,e.status)||typeof e.actor_staff_id!=='string'||typeof e.note!=='string'||!Object.hasOwn(evidenceLabels,e.evidence_state)||!Object.hasOwn(externalLabels,e.external_state)||!date(e.occurred_at))fail();
  return{version:e.version,actor_staff_id:e.actor_staff_id,status:e.status,note:e.note,evidence_state:e.evidence_state,external_state:e.external_state,occurred_at:e.occurred_at};
 });
 if(history[0].version!==base.version||history[0].status!==base.status)fail();
 return{...base,discovered_at:r.discovered_at,updated_at:r.updated_at,summary:r.summary,initial_action:r.initial_action,reporter_staff_id:r.reporter_staff_id,history};
}
export async function createIncident(id:string,category:IncidentCategory,discovered:string,summaryText:string,initialAction:string):Promise<string>{
 const{data,error}=await supabase.rpc('connexy_create_incident',{report_id:id,report_category:category,discovered,report_summary:summaryText,initial_actions:initialAction});if(error)fail(error.code);
 if(data!==id)fail();return id;
}
export async function updateIncident(id:string,v:number,status:IncidentStatus,note:string,evidence:EvidenceState,external:ExternalState):Promise<void>{
 const{error}=await supabase.rpc('connexy_update_incident',{target_report:id,expected_version:v,next_status:status,response_note:note,evidence,external_report:external});if(error)fail(error.code);
}
export async function saveIncidentContact(contact:string,lead:string,v:number):Promise<void>{
 const{error}=await supabase.rpc('connexy_save_incident_contact',{contact_text:contact,lead_staff:lead,expected_version:v});if(error)fail(error.code);
}
export function incidentTemplate(r:IncidentDetail):string{
 return `【インシデント第一報・下書き】\n報告番号：${r.id}\n種別：${incidentCategories[r.category]}\n発見日時：${new Date(r.discovered_at).toLocaleString('ja-JP')}\n状況：${r.summary}\n初動：${r.initial_action||'未確認'}\n証拠保全：${evidenceLabels[r.history[0].evidence_state]}\n影響範囲・件数：未確認（確認後に記入）\n発生原因：調査中\n報告先・報告者・次回報告予定：確認して記入\n※この文面は下書きです。SB等への送信は行っていません。`;
}
