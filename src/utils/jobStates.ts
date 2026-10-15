// 案件ごとの応募・契約ステータス(軸B)の保存・読み出し。
// 設計の根拠は STATUS_MODEL.md §7 を参照。
//
// 背景: 現行の `ContractTask.status` は「チャット単位」の1フィールドしかなく、
// 1つの直接チャットで複数案件に応募している場合に取り違えが起きる
// (todo.md「発見済みバグ(未修正)」参照)。
// ここでは `evaluations.jobStates: { [jobId]: JobState }` を新設し、案件ごとに状態を持つ。
// 移行期間中は後方互換のため、チャット単位の `status` に「最も進んだ案件の状態」を書き戻す。

import type { ContractTask } from '../data/mockDb';

/**
 * 保存する応募・契約ステータス。
 * `working` は `confirmed` にリネーム済み(STATUS_MODEL.md §7.1)。
 * 旧データ(localStorage / Supabase)に残る `working` を読めるよう、union には残しつつ
 * `normalizeEngagementStatus()` で `confirmed` に正規化する。
 */
export type EngagementStatusValue =
  | 'applying'
  | 'offered'
  | 'confirmed'
  | 'working'
  | 'report_pending'
  | 'completed'
  | 'disputed'
  | 'rejected'
  | 'declined'
  | 'cancelled';

/** 正規化後の応募・契約ステータス(旧 `working` を含まない) */
export type NormalizedEngagementStatus = Exclude<EngagementStatusValue, 'working'>;

/** 旧 `working` を `confirmed` に寄せる。それ以外はそのまま。 */
export function normalizeEngagementStatus(status: string | null | undefined): NormalizedEngagementStatus {
  return (status === 'working' ? 'confirmed' : status) as NormalizedEngagementStatus;
}

/** オファーの条件。従来は evaluations.offered* に平置きだったのを案件ごとに持つ。 */
export interface JobOfferInfo {
  price?: number;
  dates?: string;
  details?: string;
  offeredAt?: string;
  expiresAt?: string;
}

/**
 * SBから受領した再委託承諾書の確認記録。
 * 承諾書ファイル自体は機密情報保護のため本アプリへ保存せず、
 * 社内の承認済み保管場所にある原本を照合した証跡だけを保持する。
 */
export interface SbSubcontractApprovalRecord {
  status: 'approved';
  approvalNumber: string;
  approvedOn: string;
  validUntil?: string;
  agencyId: string;
  staffId: string;
  verifiedAt: string;
  verifiedByUserId: string;
  verifiedByName: string;
  originalDocumentConfirmed: true;
}

export interface JobState {
  status: EngagementStatusValue;
  /** ISO 8601。「最も進んだ状態」が同順位のときの決定と、監査用 */
  updatedAt: string;
  /** 承諾時点で契約書の双方承認が必要だったか。将来 `contract_review` を独立ステータス化する際の起点(STATUS_MODEL.md §6) */
  contractApprovalRequired?: boolean;
  /** 応募日(ISO)。旧 evaluations.appliedJobDates[jobId] の移設先 */
  appliedAt?: string;
  /** この案件に提案されたスタッフID。旧 appliedJobStaffIds[jobId] / offeredStaffId の移設先 */
  staffId?: string;
  /** オファー条件。旧 evaluations.offered* の移設先 */
  offer?: JobOfferInfo;
  /** SB再委託承諾書の確認記録。案件・二次委託先・スタッフに固定して保存する。 */
  sbSubcontractApproval?: SbSubcontractApprovalRecord;
}

export type JobStatesMap = Record<string, JobState>;

/**
 * 状態機械上の「進み具合」序列。チャット単位 `status` の後方互換値を決めるために使う。
 * 見送り/辞退/キャンセルは終端だが「進行が止まった」状態なので、
 * 進行中の案件が1つでもあればそちらを優先する(= rank 0)。
 */
const PROGRESS_RANK: Record<EngagementStatusValue, number> = {
  rejected: 0,
  declined: 0,
  cancelled: 0,
  applying: 1,
  offered: 2,
  working: 3,
  confirmed: 3,
  report_pending: 4,
  disputed: 5,
  completed: 6,
};

/**
 * jobStates の中から「最も進んだ案件の状態」を返す。チャット単位 `status` の後方互換値。
 * - 進行中(rank > 0)の案件があれば、その中で最も進んだもの。
 * - すべて終端(見送り/辞退/キャンセル)なら、最後に更新されたもの。
 */
export function mostAdvancedStatus(jobStates: JobStatesMap): EngagementStatusValue | null {
  const entries = Object.values(jobStates);
  if (entries.length === 0) return null;

  const active = entries.filter((s) => PROGRESS_RANK[s.status] > 0);
  if (active.length > 0) {
    return active.reduce((a, b) => (PROGRESS_RANK[b.status] > PROGRESS_RANK[a.status] ? b : a)).status;
  }
  return entries.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a)).status;
}

type TaskLike = Pick<ContractTask, 'status'> & {
  evaluations?: unknown;
};

interface LinkedJobEvals {
  appliedJobIds?: string[];
  offeredJobId?: string;
  jobStates?: JobStatesMap;
}

/**
 * チャットに紐づく案件ID一覧(応募 `appliedJobIds` / オファー `offeredJobId` / `jobStates` を統合、重複排除)。
 * チャット⇔案件の紐付けを1箇所に集約するための入口。
 */
export function getLinkedJobIds(evaluations: unknown): string[] {
  const e = (evaluations || {}) as LinkedJobEvals;
  const ids = new Set<string>();
  if (Array.isArray(e.appliedJobIds)) e.appliedJobIds.forEach((id) => id && ids.add(id));
  if (e.offeredJobId) ids.add(e.offeredJobId);
  if (e.jobStates && typeof e.jobStates === 'object') Object.keys(e.jobStates).forEach((id) => ids.add(id));
  return [...ids];
}

/** 主たる紐付け案件ID(応募 → オファー → jobStates の順で最初の1件)。 */
export function getPrimaryLinkedJobId(evaluations: unknown): string | null {
  const e = (evaluations || {}) as LinkedJobEvals;
  return (
    e.appliedJobIds?.[0] ||
    e.offeredJobId ||
    (e.jobStates && typeof e.jobStates === 'object' ? Object.keys(e.jobStates)[0] : undefined) ||
    null
  );
}

/** 案件 `jobId` がこのチャットに紐づいているか。 */
export function isJobLinkedToChat(evaluations: unknown, jobId: string): boolean {
  return getLinkedJobIds(evaluations).includes(jobId);
}

function readJobStates(task: TaskLike): JobStatesMap {
  const js = (task.evaluations as { jobStates?: JobStatesMap } | undefined)?.jobStates;
  return js && typeof js === 'object' ? js : {};
}

/**
 * 案件 `jobId` の現在の応募・契約ステータス。
 * jobStates に無ければチャット単位の `task.status` にフォールバック(移行期間中の後方互換)。
 */
export function getJobStatus(task: TaskLike, jobId: string): EngagementStatusValue {
  const js = readJobStates(task)[jobId];
  if (js?.status) return normalizeEngagementStatus(js.status);
  return normalizeEngagementStatus(task.status);
}

/** 案件 `jobId` の JobState(無ければ undefined) */
export function getJobState(task: TaskLike, jobId: string): JobState | undefined {
  return readJobStates(task)[jobId];
}

interface JobDetailEvals {
  jobStates?: JobStatesMap;
  appliedJobDates?: Record<string, string>;
  appliedJobStaffIds?: Record<string, string>;
  offeredStaffId?: string;
  offeredJobId?: string;
  offeredPrice?: number;
  offeredDates?: string;
  offeredDetails?: string;
  offeredAt?: string;
  offerExpiresAt?: string;
}

/** 案件 `jobId` の応募日。jobStates 優先、無ければ旧 appliedJobDates。 */
export function getJobAppliedAt(evaluations: unknown, jobId: string): string | undefined {
  const e = (evaluations || {}) as JobDetailEvals;
  return e.jobStates?.[jobId]?.appliedAt || e.appliedJobDates?.[jobId];
}

/** 案件 `jobId` に紐づくスタッフID。jobStates 優先、無ければ旧 appliedJobStaffIds / offeredStaffId。 */
export function getJobStaffId(evaluations: unknown, jobId: string): string | undefined {
  const e = (evaluations || {}) as JobDetailEvals;
  return (
    e.jobStates?.[jobId]?.staffId ||
    e.appliedJobStaffIds?.[jobId] ||
    (e.offeredJobId === jobId ? e.offeredStaffId : undefined) ||
    e.offeredStaffId
  );
}

/** チャットに紐づく全スタッフID(重複排除)。「自社スタッフが提案されているか」の判定用。 */
export function getLinkedStaffIds(evaluations: unknown): string[] {
  const e = (evaluations || {}) as JobDetailEvals;
  const ids = new Set<string>();
  if (e.jobStates) Object.values(e.jobStates).forEach((s) => s?.staffId && ids.add(s.staffId));
  if (e.appliedJobStaffIds) Object.values(e.appliedJobStaffIds).forEach((id) => id && ids.add(id));
  if (e.offeredStaffId) ids.add(e.offeredStaffId);
  return [...ids];
}

/** 案件 `jobId` のオファー条件。jobStates.offer 優先、無ければ旧 evaluations.offered*。 */
export function getJobOfferInfo(evaluations: unknown, jobId: string): JobOfferInfo {
  const e = (evaluations || {}) as JobDetailEvals;
  const fromState = e.jobStates?.[jobId]?.offer;
  if (fromState) return fromState;
  if (e.offeredJobId === jobId) {
    return {
      price: e.offeredPrice,
      dates: e.offeredDates,
      details: e.offeredDetails,
      offeredAt: e.offeredAt,
      expiresAt: e.offerExpiresAt,
    };
  }
  return {};
}

/**
 * 応募時に、まだ jobStates エントリが無い案件へ `applying` を seed する(純粋関数)。
 * 既存エントリ(offered / working など)は上書きしない。
 * `staffIds` があれば、その案件の提案スタッフIDも記録する。
 */
export function seedAppliedJobStates(
  evaluations: Record<string, unknown> | null | undefined,
  jobIds: string[] | undefined | null,
  staffIds?: Record<string, string> | null,
  now: Date = new Date(),
): Record<string, unknown> {
  const base = (evaluations && typeof evaluations === 'object' ? evaluations : {}) as Record<string, unknown>;
  if (!jobIds || jobIds.length === 0) return base;

  const prev = (base.jobStates as JobStatesMap | undefined) || {};
  const next: JobStatesMap = { ...prev };
  const iso = now.toISOString();
  let changed = false;
  for (const jobId of jobIds) {
    if (!next[jobId]) {
      next[jobId] = { status: 'applying', updatedAt: iso, appliedAt: iso };
      if (staffIds && staffIds[jobId]) next[jobId].staffId = staffIds[jobId];
      changed = true;
    } else if (staffIds && staffIds[jobId] && !next[jobId].staffId) {
      next[jobId] = { ...next[jobId], staffId: staffIds[jobId] };
      changed = true;
    }
  }
  return changed ? { ...base, jobStates: next } : base;
}

export interface ApplyJobStateOptions {
  contractApprovalRequired?: boolean;
  /** この案件に紐づくスタッフID(オファー・承諾時に記録) */
  staffId?: string;
  /** オファー条件(status='offered' 遷移時に記録) */
  offer?: JobOfferInfo;
  /** SB再委託承諾書の確認記録 */
  sbSubcontractApproval?: SbSubcontractApprovalRecord;
  /** テスト用。既定は new Date() */
  now?: Date;
}

export interface ApplyJobStateResult {
  /** jobStates を更新した新しい evaluations オブジェクト(不変更新) */
  evaluations: Record<string, unknown>;
  /** チャット単位 `status` に書き戻すべき後方互換値 */
  chatStatus: EngagementStatusValue;
}

/**
 * evaluations に対し、案件 `jobId` の状態を `status` に更新した新オブジェクトを返す(純粋関数)。
 * あわせて、チャット単位 `status` に書き戻すべき「最も進んだ状態」を計算して返す。
 */
export function applyJobState(
  evaluations: Record<string, unknown> | null | undefined,
  jobId: string,
  status: EngagementStatusValue,
  options: ApplyJobStateOptions = {},
): ApplyJobStateResult {
  const { contractApprovalRequired, staffId, offer, sbSubcontractApproval, now = new Date() } = options;
  const base = (evaluations && typeof evaluations === 'object' ? evaluations : {}) as Record<string, unknown>;
  const prev = (base.jobStates as JobStatesMap | undefined) || {};

  const nextEntry: JobState = {
    ...prev[jobId],
    status,
    updatedAt: now.toISOString(),
  };
  if (contractApprovalRequired !== undefined) {
    nextEntry.contractApprovalRequired = contractApprovalRequired;
  }
  if (staffId) nextEntry.staffId = staffId;
  if (offer) nextEntry.offer = { ...nextEntry.offer, ...offer };
  if (sbSubcontractApproval) nextEntry.sbSubcontractApproval = { ...sbSubcontractApproval };

  const nextJobStates: JobStatesMap = { ...prev, [jobId]: nextEntry };
  const nextEvaluations = { ...base, jobStates: nextJobStates };
  const chatStatus = mostAdvancedStatus(nextJobStates) ?? status;

  return { evaluations: nextEvaluations, chatStatus };
}
