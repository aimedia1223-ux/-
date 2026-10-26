import {supabase} from './supabase';
import type {ContractDetails} from './contractConfirmation';
export type ContractVersion={version:number;terms:string;details:ContractDetails;confirmed_at:string;sha256:string;change_reason:string|null};
export type ContractAmendment={id:string;base_version:number;terms:string;details:ContractDetails;reason:string;proposed_company_id:string;status:'offered'|'confirmed'|'declined'|'withdrawn';created_at:string;expires_at:string;responded_at:string|null};
export type ContractHistory={offer_id:string;contract_id:string;client_id:string;agency_id:string;work_dates:string[];versions:ContractVersion[];amendments:ContractAmendment[];can_propose:boolean};
function fail(code?:string):never{
 if(code==='42501')throw new Error('当事者管理者・追加認証・有効なSB承諾を確認できません。');
 if(code==='40001')throw new Error('契約の版が更新されています。一覧を取得し直して変更内容を確認してください。');
 if(code==='23505')throw new Error('回答待ちの変更提示があります。先に回答または取り下げを行ってください。');
 if(code==='22023')throw new Error('変更理由・追加条件・必須項目・日付・回答期限・現在の状態を確認してください。');
 throw new Error('変更合意の結果を確認できません。130番SQLの適用と接続を確認して、一覧を更新してください。');
}
function details(d:ContractDetails):ContractDetails{
 const keys=['tax','expenses','payment_due','inspection_due','termination','intellectual_property','liability'] as const;
 if(!d||keys.some(k=>typeof d[k]!=='string'||!d[k].trim()))fail();
 return Object.fromEntries(keys.map(k=>[k,d[k]])) as ContractDetails;
}
export async function getContractHistory(offerId:string):Promise<ContractHistory>{
 const{data,error}=await supabase.rpc('connexy_get_contract_history',{target_offer:offerId});if(error)fail(error.code);
 if(!data||data.offer_id!==offerId||typeof data.contract_id!=='string'||typeof data.client_id!=='string'||typeof data.agency_id!=='string'||typeof data.can_propose!=='boolean'
  ||!Array.isArray(data.work_dates)||data.work_dates.some((v:unknown)=>typeof v!=='string')||!Array.isArray(data.versions)||!data.versions.length||!Array.isArray(data.amendments))fail();
 const versions=data.versions.map((v:ContractVersion):ContractVersion=>{
  if(!v||!Number.isSafeInteger(v.version)||v.version<1||typeof v.terms!=='string'||typeof v.confirmed_at!=='string'||!Number.isFinite(Date.parse(v.confirmed_at))||typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256)||(v.change_reason!==null&&typeof v.change_reason!=='string'))fail();
  return{version:v.version,terms:v.terms,details:details(v.details),confirmed_at:v.confirmed_at,sha256:v.sha256,change_reason:v.change_reason};
 });
 if(versions.some((v:ContractVersion,i:number)=>v.version!==versions.length-i))fail();
 const amendments=data.amendments.map((a:ContractAmendment):ContractAmendment=>{
  if(!a||typeof a.id!=='string'||!Number.isSafeInteger(a.base_version)||a.base_version<1||typeof a.terms!=='string'||typeof a.reason!=='string'
   ||![data.client_id,data.agency_id].includes(a.proposed_company_id)||!['offered','confirmed','declined','withdrawn'].includes(a.status)
   ||typeof a.created_at!=='string'||!Number.isFinite(Date.parse(a.created_at))||typeof a.expires_at!=='string'||!Number.isFinite(Date.parse(a.expires_at))
   ||(a.responded_at!==null&&(typeof a.responded_at!=='string'||!Number.isFinite(Date.parse(a.responded_at)))))fail();
  return{id:a.id,base_version:a.base_version,terms:a.terms,details:details(a.details),reason:a.reason,proposed_company_id:a.proposed_company_id,status:a.status,created_at:a.created_at,expires_at:a.expires_at,responded_at:a.responded_at};
 });
 return{offer_id:offerId,contract_id:data.contract_id,client_id:data.client_id,agency_id:data.agency_id,work_dates:data.work_dates,versions,amendments,can_propose:data.can_propose};
}
export async function proposeContractAmendment(input:{requestId:string;offerId:string;version:number;terms:string;details:ContractDetails;reason:string}):Promise<string>{
 const{data,error}=await supabase.rpc('connexy_propose_contract_amendment',{request_id:input.requestId,target_offer:input.offerId,expected_version:input.version,contract_terms:input.terms.trim(),contract_details:input.details,change_reason:input.reason.trim()});if(error)fail(error.code);if(typeof data!=='string')fail();return data;
}
export async function respondContractAmendment(id:string,action:'confirm'|'decline'|'withdraw'):Promise<number|null>{
 const{data,error}=await supabase.rpc('connexy_respond_contract_amendment',{target_amendment:id,action});if(error)fail(error.code);
 if(action==='confirm'?(!Number.isSafeInteger(data)||data<2):data!==null)fail();return data;
}
