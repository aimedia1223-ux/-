// ステータス表示ラベルの一元管理。
// 設計の根拠は STATUS_MODEL.md を参照。
// このファイルは「表示」専用。保存値の遷移ロジックはここには置かない。

import type { Job, ContractTask } from '../data/mockDb';

// ────────────────────────────────────────────────────────────────
// 軸A: 案件(募集)の掲載ステータス
// ────────────────────────────────────────────────────────────────

export type JobListingStatusKey = 'active' | 'closing_soon' | 'closed' | 'suspended';

export interface JobListingStatus {
  key: JobListingStatusKey;
  label: string;
  color: string; // 文字色
  bg: string;    // バッジ背景色
}

/** 「締切間近」とみなす、締切までの残り日数のしきい値 */
export const CLOSING_SOON_DAYS = 2;

export function getJobListingStatus(
  job: Pick<Job, 'status' | 'applicationDeadline'>,
  today: Date = new Date(),
): JobListingStatus {
  if (job.status === 'cancelled') {
    return { key: 'suspended', label: '募集停止', color: '#991B1B', bg: '#FEE2E2' };
  }

  const deadline = parseIsoDate(job.applicationDeadline);
  if (deadline) {
    const diffDays = Math.round((startOfDay(deadline).getTime() - startOfDay(today).getTime()) / 86400000);
    if (diffDays < 0) {
      return { key: 'closed', label: '掲載締切', color: '#64748B', bg: '#E2E8F0' };
    }
    if (diffDays <= CLOSING_SOON_DAYS) {
      return { key: 'closing_soon', label: '締切間近', color: '#D97706', bg: '#FEF3C7' };
    }
  }

  return { key: 'active', label: '掲載中', color: '#1D4ED8', bg: '#EFF6FF' };
}

// ────────────────────────────────────────────────────────────────
// 軸B: 応募・契約ステータス
// ────────────────────────────────────────────────────────────────

export type EngagementViewer = 'client' | 'agency';

export interface EngagementStatus {
  /** 表示上のキー。保存値そのものではなく、confirmed は稼働日から waiting/working/ended に分岐する */
  key: string;
  label: string;
  /** 例: 「契約書承認待ち」。稼働待ち中に契約書が未承認のとき付く */
  subBadge?: string;
  color: string;
  bg: string;
}

export interface EngagementLabelOptions {
  /** 見る人の立場。ラベル文言が変わる(状態そのものは同じ) */
  viewer?: EngagementViewer;
  /** 契約書の双方承認が完了しているか。false のとき「稼働待ち」に承認待ちバッジを付ける */
  contractApproved?: boolean;
  today?: Date;
}

/**
 * 応募・契約の保存値(+ 案件の稼働日 + 視点)から表示ラベルを求める。
 * `working` は将来 `confirmed` へリネームする予定のため、両方を同じ扱いにしている。
 */
export function getEngagementStatusLabel(
  status: string,
  job: Pick<Job, 'eventDate' | 'dailyPrices'> | null | undefined,
  options: EngagementLabelOptions = {},
): EngagementStatus {
  const { viewer, contractApproved, today = new Date() } = options;

  switch (status) {
    case 'applying':
      return {
        key: 'applying',
        label: viewer === 'client' ? '選考中(応募あり)' : '選考中',
        color: '#D97706', bg: '#FEF3C7',
      };

    case 'offered':
      return {
        key: 'offered',
        label:
          viewer === 'client' ? '内定通知済み(返答待ち)' :
          viewer === 'agency' ? '内定が届いています(要返答)' :
          '内定・承諾待ち',
        color: '#7E22CE', bg: '#F3E8FF',
      };

    case 'confirmed':
    case 'working': {
      const phase = getWorkPhase(job, today);
      if (phase === 'during') {
        return { key: 'working', label: '稼働中', color: '#065F46', bg: '#D1FAE5' };
      }
      if (phase === 'after') {
        return { key: 'ended', label: '稼働終了(報告待ち)', color: '#1D4ED8', bg: '#EFF6FF' };
      }
      // before / unknown → 稼働待ち
      const waiting: EngagementStatus = { key: 'waiting', label: '稼働待ち', color: '#065F46', bg: '#D1FAE5' };
      if (contractApproved === false) waiting.subBadge = '契約書承認待ち';
      return waiting;
    }

    case 'report_pending':
      return { key: 'report_pending', label: '評価待ち', color: '#1D4ED8', bg: '#EFF6FF' };

    case 'completed':
      return { key: 'completed', label: '完了', color: '#1D4ED8', bg: '#EFF6FF' };

    case 'disputed':
      // 内部キーは disputed のまま、表示は「内容確認中」(STATUS_MODEL.md §3.1)
      return { key: 'disputed', label: '内容確認中', color: '#B45309', bg: '#FFFBEB' };

    case 'rejected':
      return {
        key: 'rejected',
        label: viewer === 'agency' ? '不採用' : '見送り',
        color: '#475569', bg: '#F1F5F9',
      };

    case 'declined':
      return {
        key: 'declined',
        label: viewer === 'client' ? '辞退された' : viewer === 'agency' ? '辞退済み' : '辞退',
        color: '#475569', bg: '#F1F5F9',
      };

    case 'cancelled':
      return { key: 'cancelled', label: 'キャンセル', color: '#991B1B', bg: '#FEE2E2' };

    default:
      return { key: status, label: status, color: '#1E293B', bg: '#E2E8F0' };
  }
}

/** 契約書の双方承認が完了しているか(現行 MessagePage の派生ロジックを移設) */
export function isContractApproved(
  task: Pick<
    ContractTask,
    | 'clientContractApprovedByClient'
    | 'clientContractApprovedByAgency'
    | 'agencyContractText'
    | 'agencyContractApprovedByClient'
    | 'agencyContractApprovedByAgency'
  >,
): boolean {
  const clientOk = !!task.clientContractApprovedByClient && !!task.clientContractApprovedByAgency;
  const agencyOk =
    !task.agencyContractText ||
    (!!task.agencyContractApprovedByClient && !!task.agencyContractApprovedByAgency);
  return clientOk && agencyOk;
}

// ────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────

export type WorkPhase = 'before' | 'during' | 'after' | 'unknown';

/**
 * 案件の稼働日と今日から、稼働前(before) / 稼働中(during) / 稼働後(after) / 不明(unknown) を判定。
 * 「稼働前キャンセル可否」の判定などに使う。
 */
export function getWorkPhase(
  job: Pick<Job, 'eventDate' | 'dailyPrices'> | null | undefined,
  today: Date = new Date(),
): WorkPhase {
  const dates = getWorkDates(job);
  if (dates.length === 0) return 'unknown';
  const t0 = startOfDay(today).getTime();
  const first = startOfDay(dates[0]).getTime();
  const last = startOfDay(dates[dates.length - 1]).getTime();
  if (t0 < first) return 'before';
  if (t0 > last) return 'after';
  return 'during';
}

/** 案件の稼働日を昇順の Date 配列で返す(eventDate と dailyPrices のキーの両方から) */
function getWorkDates(job: Pick<Job, 'eventDate' | 'dailyPrices'> | null | undefined): Date[] {
  if (!job) return [];
  const raw: string[] = [];
  if (job.eventDate) raw.push(...job.eventDate.split(',').map((s) => s.trim()));
  if (job.dailyPrices) raw.push(...Object.keys(job.dailyPrices));
  const parsed = raw
    .map(parseIsoDate)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  return parsed;
}

function parseIsoDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(/\//g, '-'));
  return isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
