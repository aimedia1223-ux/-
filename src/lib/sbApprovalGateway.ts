import { supabase } from './supabase';

export type SbGateResult = { approved: boolean; approval_id: string | null; reason: string };

export async function checkSbApproval(jobId: string, agencyId: string, staffId: string): Promise<SbGateResult> {
  if (!jobId || !agencyId || !staffId) throw new Error('案件・二次委託先・スタッフを指定してください。');
  const { data, error } = await supabase.rpc('connexy_check_sb_approval', {
    target_job: jobId, target_agency: agencyId, target_staff: staffId,
  });
  if (error || !data?.[0] || typeof data[0].approved !== 'boolean') {
    throw new Error('承諾記録を確認できません。接続・権限・107番SQLの適用を確認してください。');
  }
  return data[0];
}

export async function requireSbApproval(jobId: string, agencyId: string, staffId: string): Promise<string> {
  const result = await checkSbApproval(jobId, agencyId, staffId);
  if (!result.approved || !result.approval_id) throw new Error('SBの事前書面承諾を確認できないため、確定操作を停止しました。');
  return result.approval_id;
}
