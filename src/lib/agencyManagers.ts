import { supabase } from './supabase';
import { parseJobContacts } from './jobResponsibilities';
import type { JobContacts } from './jobResponsibilities';

export type AgencyManager = { manager_staff_id: string; manager_name: string; is_current: boolean; version: number; updated_at: string };
export type AgencyManagerScope = {
  approval_id: string; side: 'agency' | 'client'; approved: boolean; can_edit: boolean; has_assignment: boolean;
  job_title: string; client_name: string | null; agency_name: string | null;
  primary_contacts: JobContacts | null; manager: AgencyManager | null;
};
export type AgencyManagerState = { items: AgencyManagerScope[]; candidates: { id: string; name: string }[] };
function fail(code?: string): never {
  if (code === '42501') throw new Error('管理者権限・追加認証・承諾対象・ログイン期限を確認してください。');
  if (code === '40001' || code === '23505') throw new Error('別の更新が保存されています。一覧を更新してから確認してください。');
  if (code === '22023') throw new Error('自社の有効な担当者を選択し、現在の登録内容を確認してください。');
  throw new Error('取得・保存結果を確認できません。接続と120番SQLの適用を確認して一覧を更新してください。');
}
export function parseAgencyManager(row: unknown): AgencyManager | null {
  if (row == null) return null;
  const value = row as AgencyManager;
  if (typeof value.manager_staff_id !== 'string' || typeof value.manager_name !== 'string'
    || typeof value.is_current !== 'boolean' || typeof value.updated_at !== 'string'
    || !Number.isSafeInteger(value.version) || value.version < 1) fail();
  return {manager_staff_id:value.manager_staff_id,manager_name:value.manager_name,is_current:value.is_current,version:value.version,updated_at:value.updated_at};
}
export async function listAgencyManagers(): Promise<AgencyManagerState> {
  const {data,error} = await supabase.rpc('connexy_list_agency_managers');
  if (error) fail(error.code);
  if (!data || !Array.isArray(data.items) || !Array.isArray(data.candidates)) fail();
  const items = data.items.map((value: AgencyManagerScope): AgencyManagerScope => {
    if (!value || typeof value.approval_id !== 'string' || !['agency','client'].includes(value.side)
      || typeof value.approved !== 'boolean' || typeof value.can_edit !== 'boolean' || typeof value.has_assignment !== 'boolean'
      || typeof value.job_title !== 'string' || (value.client_name!==null && typeof value.client_name!=='string')
      || (value.agency_name!==null && typeof value.agency_name!=='string')) fail();
    return {approval_id:value.approval_id,side:value.side,approved:value.approved,can_edit:value.can_edit,
      has_assignment:value.has_assignment,job_title:value.job_title,client_name:value.client_name,agency_name:value.agency_name,
      primary_contacts:parseJobContacts(value.primary_contacts),manager:parseAgencyManager(value.manager)};
  });
  const candidates = data.candidates.map((value: { id: string; name: string }) => {
    if (!value || typeof value.id!=='string' || typeof value.name!=='string') fail();
    return {id:value.id,name:value.name};
  });
  return {items,candidates};
}
export async function saveAgencyManager(approvalId: string,managerId: string,expectedVersion: number): Promise<AgencyManager> {
  const {data,error} = await supabase.rpc('connexy_save_agency_manager', {
    target_approval:approvalId,manager_staff:managerId,expected_version:expectedVersion,
  });
  if (error) fail(error.code);
  const saved = parseAgencyManager(data);
  if (!saved || !saved.is_current) fail();
  return saved;
}
