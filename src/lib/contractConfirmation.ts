import { supabase } from './supabase';

export const contractDetailLabels = {
  tax: '税の取扱い', expenses: '経費の負担・精算方法', payment_due: '支払日', inspection_due: '検査期限',
  termination: '中途解約の条件', intellectual_property: '成果物・知的財産の取扱い', liability: '責任・損害賠償の条件',
};
export type ContractDetails = Record<keyof typeof contractDetailLabels, string>;

export type ContractOffer = {
  id: string; job_id: string; job_title: string;
  client_id: string; agency_id: string; staff_id: string;
  client_name: string; agency_name: string; staff_name: string;
  description: string; detailed_description: string | null; requirements: string[];
  work_location: string | null; work_hours: string | null;
  work_dates: string[]; daily_price: number; total_price: number; terms: string;
  status: 'offered' | 'confirmed' | 'declined' | 'withdrawn';
  created_at: string; expires_at: string; responded_at: string | null; contract_id: string | null;
  contract_details: ContractDetails | null; document_version: number | null;
  latest_version_confirmed_at?:string;
};

function fail(code?: string): never {
  if (code === '42501') throw new Error('当事者の管理者権限・追加認証・SB承諾・提示内容を確認できないため、操作を停止しました。');
  if (code === '22023') throw new Error('必須契約条件・具体的な支払日と検査期限・回答期限を確認してください。旧形式や変更が必要な提示は取り下げて再提示してください。');
  if (code === '23505') throw new Error('同じ対象への提示または契約がすでにあります。一覧を更新してください。');
  throw new Error('契約処理の結果を確認できません。一覧を更新してください。再送するときは入力内容を変えずに同じボタンを押してください。');
}

export async function listContractOffers(): Promise<ContractOffer[]> {
  const {data,error} = await supabase.rpc('connexy_list_contract_offers');
  if (error) fail(error.code);
  if (!Array.isArray(data)) fail();
  return data;
}

export async function createContractOffer(input: { requestId: string; jobId: string; agencyId: string; staffId: string; terms: string; details: ContractDetails }): Promise<string> {
  const {data,error} = await supabase.rpc('connexy_create_contract_offer', {
    request_id: input.requestId, target_job: input.jobId, target_agency: input.agencyId.trim(),
    target_staff: input.staffId.trim(), contract_terms: input.terms.trim(), contract_details: input.details,
  });
  if (error) fail(error.code);
  if (typeof data !== 'string') fail();
  return data;
}

export async function exportContractDocument(offerId: string,format:'json'|'pdf'='json',version=1): Promise<{filename:string;text:string}> {
  if(!Number.isSafeInteger(version)||version<1)fail();
  const {data,error}=await supabase.rpc(format==='pdf'?'connexy_read_contract_version_pdf':'connexy_export_contract_version',{target_offer:offerId,target_version:version});
  if(error)fail(error.code);
  if(!data || typeof data.canonical_payload!=='string' || !/^[a-f0-9]{64}$/.test(data.sha256)
    || data.filename!==`Connexy_contract_${offerId}_v${version}.json`)fail();
  let payload;
  try { payload=JSON.parse(data.canonical_payload); } catch { fail(); }
  if(!payload || payload.record_type!=='confirmed_contract' || payload.version!==version || payload.offer_id!==offerId || payload.signature!=='none')fail();
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data.canonical_payload));
  if(Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('')!==data.sha256)fail();
  return{filename:data.filename,text:JSON.stringify({canonical_payload:data.canonical_payload,sha256:data.sha256},null,2)};
}

export async function respondContractOffer(id: string, action: 'confirm' | 'decline' | 'withdraw'): Promise<string | null> {
  const {data,error} = await supabase.rpc('connexy_respond_contract_offer', { target_offer: id, action });
  if (error) fail(error.code);
  if (action==='confirm' && typeof data!=='string') fail();
  return data;
}
