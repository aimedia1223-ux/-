import type { ContractTask, Job } from '../data/mockDb';
import { getJobState } from './jobStates';
import type { SbSubcontractApprovalRecord } from './jobStates';

/** SoftBank / Y!mobile案件、または明示指定された案件だけに承諾ゲートを適用する。 */
export function requiresSbSubcontractApproval(job: Job | null | undefined): boolean {
  if (!job) return false;
  return job.requiresSbSubcontractApproval === true || job.carrier === 'SoftBank/Y!mobile';
}

export function getSbSubcontractApproval(
  task: Pick<ContractTask, 'status' | 'evaluations'> | null | undefined,
  jobId: string | null | undefined,
): SbSubcontractApprovalRecord | undefined {
  if (!task || !jobId) return undefined;
  return getJobState(task, jobId)?.sbSubcontractApproval;
}

interface ApprovalContext {
  agencyId?: string | null;
  staffId?: string | null;
  now?: Date;
}

export function validateSbSubcontractApproval(
  record: SbSubcontractApprovalRecord | null | undefined,
  context: ApprovalContext,
): { valid: boolean; reason?: string } {
  if (!record || record.status !== 'approved') {
    return { valid: false, reason: 'SBの再委託承諾が登録されていません。' };
  }
  if (!record.originalDocumentConfirmed || !record.approvalNumber.trim() || !record.approvedOn) {
    return { valid: false, reason: '承諾書の確認記録が不完全です。' };
  }
  if (context.agencyId && record.agencyId !== context.agencyId) {
    return { valid: false, reason: '承諾された二次委託先とオファー先が一致しません。' };
  }
  if (context.staffId && record.staffId !== context.staffId) {
    return { valid: false, reason: '承諾された従事者と提案スタッフが一致しません。' };
  }
  if (record.validUntil) {
    const now = context.now || new Date();
    const endOfValidity = new Date(`${record.validUntil}T23:59:59`);
    if (!Number.isNaN(endOfValidity.getTime()) && now > endOfValidity) {
      return { valid: false, reason: 'SBの再委託承諾の有効期限が切れています。' };
    }
  }
  return { valid: true };
}
