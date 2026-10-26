import { supabase } from './supabase';

export type JobContacts = {
  version: number; updated_at: string; is_current: boolean;
  sb_contact_staff_id: string; sb_contact_name: string;
  agency_contact_staff_id: string; agency_contact_name: string;
  incident_contact_staff_id: string; incident_contact_name: string;
};
export type ResponsibilityState = { contacts: JobContacts | null; candidates: { id: string; name: string }[] };

// 追加フィールド（Auth UID等）を表示側へ流さない。
export function parseJobContacts(value: unknown): JobContacts | null {
  if (value == null) return null;
  if (typeof value !== 'object') throw new Error('責任者の情報を確認できません。再取得してください。');
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.version) || Number(row.version) <= 0 || typeof row.updated_at !== 'string'
    || typeof row.is_current !== 'boolean') throw new Error('責任者の情報を確認できません。再取得してください。');
  const text = (key: string): string => {
    if (typeof row[key] !== 'string') throw new Error('責任者の情報を確認できません。再取得してください。');
    return row[key];
  };
  return { version: Number(row.version), updated_at: row.updated_at, is_current: row.is_current,
    sb_contact_staff_id: text('sb_contact_staff_id'), sb_contact_name: text('sb_contact_name'),
    agency_contact_staff_id: text('agency_contact_staff_id'), agency_contact_name: text('agency_contact_name'),
    incident_contact_staff_id: text('incident_contact_staff_id'), incident_contact_name: text('incident_contact_name') };
}
function fail(code?: string): never {
  if (code === '42501') throw new Error('自社案件の管理者権限・追加認証・ログイン期限を確認してください。');
  if (code === '40001') throw new Error('別の更新が保存されています。「登録内容を再取得」で最新の内容を確認してください。');
  if (code === '22023') throw new Error('3つの役割に自社の有効な担当者を選択してください。');
  throw new Error('責任者の取得・保存結果を確認できません。接続と119番SQLの適用を確認し、登録内容を再取得してください。');
}
export async function getJobResponsibilities(jobId: string): Promise<ResponsibilityState> {
  const { data, error } = await supabase.rpc('connexy_get_job_responsibilities', { target_job: jobId });
  if (error) fail(error.code);
  if (!data || !Array.isArray(data.candidates) || !('contacts' in data)) fail();
  const candidates = data.candidates.map((row: {id?: unknown; name?: unknown}) => {
    if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') fail();
    return { id: row.id, name: row.name };
  });
  return { contacts: parseJobContacts(data.contacts), candidates };
}
export async function saveJobResponsibilities(input: { jobId: string; sbContact: string; agencyContact: string; incidentContact: string; expectedVersion: number }): Promise<JobContacts> {
  const { data, error } = await supabase.rpc('connexy_save_job_responsibilities', {
    target_job: input.jobId, sb_contact: input.sbContact, agency_contact: input.agencyContact,
    incident_contact: input.incidentContact, expected_version: input.expectedVersion,
  });
  if (error) fail(error.code);
  const contacts = parseJobContacts(data);
  if (!contacts || !contacts.is_current) fail();
  return contacts;
}
