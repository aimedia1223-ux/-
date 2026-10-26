import { readColumns } from './readColumns';
import { readAuditedRows } from '../lib/auditedReads';
import { requireSbApproval } from '../lib/sbApprovalGateway';
import { legacyDemoAuth, getAuthenticatedUser, loginWithAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { encryptData, decryptData } from '../lib/crypto';
import { regionalJobs } from './regionalJobs';
import { applyJobState, seedAppliedJobStates, normalizeEngagementStatus } from '../utils/jobStates';
import type { EngagementStatusValue } from '../utils/jobStates';

// ユーザーの型定義
export interface User {
  id: string;
  name: string;
  role: 'contractor' | 'worker' | 'admin';
  loginId?: string;
  password?: string;
  status?: 'pending' | 'approved' | 'rejected';
  invoiceNumber?: string;
  staffId?: string;
  staffName?: string;
  staffRole?: 'admin' | 'staff';
  representativeName?: string;
  email?: string;
  website?: string;
  address?: string;
  prText?: string;
  companyType?: 'client' | 'agency' | 'both';
  gender?: '男性' | '女性' | 'その他' | '無回答';
  contractTemplate?: string;
  contractPdf?: string;
  favoriteJobIds?: string[];
  favoriteTalentIds?: string[];
  favoriteFolders?: {
    id: string;
    name: string;
    itemIds: string[];
  }[];
}

// 評価(Evaluation)の型定義
export interface Evaluation {
  id: string;
  rating: number; // 1 to 5 stars
  comment?: string;
  evaluatorName: string;
  createdAt: string;
  hasLateness?: boolean;
}

// 研修(Training)の型定義
export interface Training {
  id: string;
  title: string;
  zoomLink: string;
}

// 案件(Job)の型定義
export interface Job {
  id: string;
  title: string;
  description: string;
  lat: number; // 曖昧な緯度（市区町村の中心）
  lng: number; // 曖昧な経度（市区町村の中心）
  exactLat?: number; // 正確な緯度
  exactLng?: number; // 正確な経度
  authorId: string;
  price: number;
  locationName?: string;
  workHours?: string;
  requirements?: string[];
  detailedDescription?: string;
  roleType?: 'キャンペーンクルー' | 'クローザー' | 'ディレクター';
  salesChannel?: '量販店' | 'ショップ';
  carrier?: 'docomo' | 'au/UQmobile' | 'SoftBank/Y!mobile' | 'BB';
  eventDate?: string;
  applicationDeadline?: string;
  workLocation?: '店内' | '外販（複合施設など）' | '外販（スーパーなど）' | '外販（その他）';
  isUrgent?: boolean;
  allowedCompanyIds?: string[];
  exactLocation?: string;

  // 追加拡張フィールド（requirementsの配列要素としてシリアライズしてDB保存）
  dailyPrices?: { [date: string]: number };
  expenses?: {
    transportType: 'none' | 'pay_separate' | 'arranged' | 'actual' | 'flat';
    transportValue?: number;
    accommodationType: 'none' | 'pay_separate' | 'arranged' | 'actual' | 'flat';
    accommodationValue?: number;
  };
  status?: 'active' | 'cancelled';
  jobCode?: string;
  /** SB事前書面承諾ゲートを明示的に有効化する。既存SB/Y!mobile案件はcarrierから自動判定。 */
  requiresSbSubcontractApproval?: boolean;
}

// Hashing function to get consistent job codes for legacy seed jobs
const getConsistentJobCode = (jobId: string) => {
  let hash = 0;
  for (let i = 0; i < jobId.length; i++) {
    hash = jobId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const codeNum = Math.abs(hash % 900000) + 100000;
  return `JOB-${codeNum}`;
};

// 人材(Talent)の型定義
export interface Talent {
  id: string;
  name: string;
  description: string;
  lat: number;
  lng: number;
  userId: string;
  price: number;
  skills: string[];
  prText?: string;
  experience?: string;
  preferredArea?: string;
  locationName: string;
  companyName: string;
  maskedName: string;
  baseLocation?: string;
  nearestStation?: string;
  carriers?: string[];
  availableDates?: string;
  completedTrainings?: string[];
  hasCertificate?: boolean;
}

// 登録済みスタッフ(Staff)の型定義
export interface Staff {
  id: string;
  userId: string;
  name: string;
  maskedName: string;
  baseLocation: string;
  nearestStation?: string;
  preferredArea?: string;
  price: number;
  skills: string[];
  carriers: string[];
  experience?: string;
  prText?: string;
  completedTrainings?: string[];
  hasCertificate?: boolean;
  role?: 'admin' | 'staff';
  loginId?: string;
  password?: string;
  furigana?: string;
  commuteMethod?: '公共交通機関' | '自家用車';
  gender?: '男性' | '女性';
  birthday?: string;
}

// 契約タスク(ContractTask)の型定義
export interface ContractTask {
  sbStaffId?: string;
  sbApprovalId?: string;
  id: string;
  jobId: string;
  jobTitle: string;
  workerName: string;
  companyName: string;
  clientName: string;
  price: number;
  date: string;
  // `confirmed` は旧 `working`(STATUS_MODEL.md §7.1)。読み出しは mapContractTask で正規化。
  status: 'applying' | 'offered' | 'confirmed' | 'report_pending' | 'completed' | 'disputed' | 'rejected' | 'declined' | 'cancelled';
  disputedReason?: string;
  evaluations?: {
    byClient?: Evaluation;
    byWorker?: Evaluation;
    byStaffToAgency?: Evaluation;
    byAgencyToStaff?: Evaluation;
    byStaffToField?: Evaluation;
    /** 案件ごとの応募・契約ステータス(軸B)。詳細は src/utils/jobStates.ts / STATUS_MODEL.md §7 */
    jobStates?: Record<string, { status: string; updatedAt: string; contractApprovalRequired?: boolean }>;
  };
  agency_id?: string;
  client_id?: string;
  clientContractText?: string;
  clientContractApprovedByClient?: boolean;
  clientContractApprovedByAgency?: boolean;
  agencyContractText?: string;
  agencyContractApprovedByClient?: boolean;
  agencyContractApprovedByAgency?: boolean;
  clientContractPdf?: string;
  agencyContractPdf?: string;
}

// 運営からのお知らせ
export interface Announcement {
  id: string;
  date: string;      // 表示用の日付文字列(例: "2026/06/13")
  title: string;
  content: string;
  isImportant: boolean;
}

const mapAnnouncement = (row: any): Announcement => ({
  id: row.id,
  date: row.date,
  title: row.title,
  content: row.content,
  isImportant: !!(row.is_important ?? row.isImportant),
});

const unmapAnnouncement = (a: Announcement): any => ({
  id: a.id,
  date: a.date,
  title: a.title,
  content: a.content,
  is_important: a.isImportant,
});

// 研修マスタ(DBではなく固定データとする)
const mockTrainings: Training[] = [
  {
    id: 'tr1',
    title: '【基礎】店頭イベント接客マナー研修',
    zoomLink: 'https://zoom.us/j/mock-event-manner'
  },
  {
    id: 'tr2',
    title: '【応用】光回線獲得・クロージング研修',
    zoomLink: 'https://zoom.us/j/mock-closing-skills'
  },
  {
    id: 'tr3',
    title: '【管理者向け】現場責任者（ディレクター）講習',
    zoomLink: 'https://zoom.us/j/mock-director-training'
  }
];

// Helper functions for mapping
const mapJob = (row: any): Job => {
  let lat = Number(row.lat);
  let lng = Number(row.lng);
  if (!lat || !lng || isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) {
    const locName = row.location_name || '';
    if (locName.includes('新宿')) {
      lat = 35.6895; lng = 139.6917;
    } else if (locName.includes('渋谷')) {
      lat = 35.6580; lng = 139.7016;
    } else if (locName.includes('池袋') || locName.includes('豊島')) {
      lat = 35.7295; lng = 139.7109;
    } else if (locName.includes('品川')) {
      lat = 35.6284; lng = 139.7388;
    } else if (locName.includes('秋葉原')) {
      lat = 35.6997; lng = 139.7711;
    } else if (locName.includes('上野')) {
      lat = 35.7138; lng = 139.7773;
    } else if (locName.includes('横浜')) {
      lat = 35.4437; lng = 139.6380;
    } else {
      const offsetLat = (Math.random() - 0.5) * 0.05;
      const offsetLng = (Math.random() - 0.5) * 0.05;
      lat = 35.6812 + offsetLat;
      lng = 139.7671 + offsetLng;
    }
  }

  const requirements: string[] = row.requirements || [];
  let dailyPrices: Job['dailyPrices'] = undefined;
  let expenses: Job['expenses'] = undefined;
  let status: 'active' | 'cancelled' = 'active';
  let jobCode: string | undefined = undefined;
  let requiresSbSubcontractApproval = false;

  const cleanRequirements = requirements.filter(req => {
    if (req === '__STATUS_CANCELLED__') {
      status = 'cancelled';
      return false;
    }
    if (req.startsWith('__DAILY_PRICES__::')) {
      try {
        dailyPrices = JSON.parse(req.substring('__DAILY_PRICES__::'.length));
      } catch (e) {
        console.error('Failed to parse daily prices:', e);
      }
      return false;
    }
    if (req.startsWith('__EXPENSES__::')) {
      try {
        expenses = JSON.parse(req.substring('__EXPENSES__::'.length));
      } catch (e) {
        console.error('Failed to parse expenses:', e);
      }
      return false;
    }
    if (req.startsWith('__JOB_CODE__::')) {
      jobCode = req.substring('__JOB_CODE__::'.length);
      return false;
    }
    if (req === '__SB_SUBCONTRACT_APPROVAL_REQUIRED__') {
      requiresSbSubcontractApproval = true;
      return false;
    }
    return true;
  });

  if (!jobCode) {
    jobCode = getConsistentJobCode(row.id);
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    lat,
    lng,
    authorId: row.author_id,
    price: row.price,
    locationName: row.location_name || '千代田区の店舗',
    workHours: row.work_hours,
    requirements: cleanRequirements,
    detailedDescription: row.detailed_description,
    roleType: row.role_type,
    salesChannel: row.sales_channel,
    carrier: row.carrier,
    eventDate: row.event_date,
    applicationDeadline: row.application_deadline,
    workLocation: row.work_location,
    isUrgent: row.is_urgent,
    allowedCompanyIds: row.allowed_company_ids,
    exactLocation: row.exact_location,
    dailyPrices,
    expenses,
    status,
    jobCode,
    requiresSbSubcontractApproval
  };
};

const unmapJob = (job: Partial<Job>): any => {
  const row: any = { ...job };
  if ('status' in row) delete row.status;
  if ('jobCode' in row) delete row.jobCode;
  if ('authorId' in job) { row.author_id = job.authorId; delete row.authorId; }
  if ('locationName' in job) { row.location_name = job.locationName; delete row.locationName; }
  if ('workHours' in job) { row.work_hours = job.workHours; delete row.workHours; }
  if ('detailedDescription' in job) { row.detailed_description = job.detailedDescription; delete row.detailedDescription; }
  if ('roleType' in job) { row.role_type = job.roleType; delete row.roleType; }
  if ('salesChannel' in job) { row.sales_channel = job.salesChannel; delete row.salesChannel; }
  if ('eventDate' in job) { row.event_date = job.eventDate; delete row.eventDate; }
  if ('applicationDeadline' in job) { row.application_deadline = job.applicationDeadline; delete row.applicationDeadline; }
  if ('workLocation' in job) { row.work_location = job.workLocation; delete row.workLocation; }
  if ('isUrgent' in job) { row.is_urgent = job.isUrgent; delete row.isUrgent; }
  if ('allowedCompanyIds' in job) { row.allowed_company_ids = job.allowedCompanyIds; delete row.allowedCompanyIds; }
  if ('exactLocation' in job) { row.exact_location = job.exactLocation; delete row.exactLocation; }

  // Serialize dailyPrices, expenses and jobCode into requirements array
  const requirements = [...(job.requirements || [])];
  if (job.status === 'cancelled') {
    requirements.push('__STATUS_CANCELLED__');
  }
  if (job.dailyPrices) {
    requirements.push(`__DAILY_PRICES__::${JSON.stringify(job.dailyPrices)}`);
  }
  if (job.expenses) {
    requirements.push(`__EXPENSES__::${JSON.stringify(job.expenses)}`);
  }
  if (job.jobCode) {
    requirements.push(`__JOB_CODE__::${job.jobCode}`);
  }
  if (job.requiresSbSubcontractApproval) {
    requirements.push('__SB_SUBCONTRACT_APPROVAL_REQUIRED__');
  }
  row.requirements = requirements;

  delete row.dailyPrices;
  delete row.expenses;
  delete row.requiresSbSubcontractApproval;

  return row;
};

const mapTalent = (row: any): Talent => {
  let lat = Number(row.lat);
  let lng = Number(row.lng);
  if (!lat || !lng || isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) {
    const locName = row.location_name || '';
    if (locName.includes('新宿')) {
      lat = 35.6895; lng = 139.6917;
    } else if (locName.includes('渋谷')) {
      lat = 35.6580; lng = 139.7016;
    } else if (locName.includes('池袋') || locName.includes('豊島')) {
      lat = 35.7295; lng = 139.7109;
    } else if (locName.includes('品川')) {
      lat = 35.6284; lng = 139.7388;
    } else {
      const offsetLat = (Math.random() - 0.5) * 0.05;
      const offsetLng = (Math.random() - 0.5) * 0.05;
      lat = 35.6812 + offsetLat;
      lng = 139.7671 + offsetLng;
    }
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    lat,
    lng,
    userId: row.user_id,
    price: row.price,
    skills: row.skills || [],
    prText: row.pr_text,
    experience: row.experience,
    preferredArea: row.preferred_area,
    locationName: row.location_name || '東京都千代田区',
    companyName: row.company_name,
    maskedName: row.masked_name,
    baseLocation: row.base_location,
    nearestStation: row.nearest_station,
    carriers: row.carriers || [],
    availableDates: row.available_dates,
    completedTrainings: row.completed_trainings || [],
    hasCertificate: row.has_certificate
  };
};

const unmapTalent = (talent: Partial<Talent>): any => {
  const row: any = { ...talent };
  if ('userId' in talent) { row.user_id = talent.userId; delete row.userId; }
  if ('prText' in talent) { row.pr_text = talent.prText; delete row.prText; }
  if ('preferredArea' in talent) { row.preferred_area = talent.preferredArea; delete row.preferredArea; }
  if ('locationName' in talent) { row.location_name = talent.locationName; delete row.locationName; }
  if ('companyName' in talent) { row.company_name = talent.companyName; delete row.companyName; }
  if ('maskedName' in talent) { row.masked_name = talent.maskedName; delete row.maskedName; }
  if ('baseLocation' in talent) { row.base_location = talent.baseLocation; delete row.baseLocation; }
  if ('nearestStation' in talent) { row.nearest_station = talent.nearestStation; delete row.nearestStation; }
  if ('availableDates' in talent) { row.available_dates = talent.availableDates; delete row.availableDates; }
  if ('completedTrainings' in talent) { row.completed_trainings = talent.completedTrainings; delete row.completedTrainings; }
  if ('hasCertificate' in talent) { row.has_certificate = talent.hasCertificate; delete row.hasCertificate; }
  return row;
};

const mapStaff = (row: any): Staff => {
  const localRole = legacyDemoAuth ? localStorage.getItem('staff_role_' + row.id) : null;
  const demoRole = localRole as 'admin' | 'staff' | null;
  const localLogin = legacyDemoAuth ? localStorage.getItem('staff_login_' + row.id) : null;
  const localPassword = legacyDemoAuth ? localStorage.getItem('staff_password_' + row.id) : null;

  const completedTrainings = row.completed_trainings || [];
  let furigana = '';
  let commuteMethod: '公共交通機関' | '自家用車' | undefined = undefined;
  let gender: '男性' | '女性' | undefined = undefined;
  let birthday = '';

  completedTrainings.forEach((t: string) => {
    if (t.startsWith('STAFF_FURIGANA_')) {
      furigana = t.replace('STAFF_FURIGANA_', '');
    } else if (t.startsWith('STAFF_COMMUTE_')) {
      const val = t.replace('STAFF_COMMUTE_', '');
      if (val === '公共交通機関' || val === '自家用車') {
        commuteMethod = val;
      }
    } else if (t.startsWith('STAFF_GENDER_')) {
      const val = t.replace('STAFF_GENDER_', '');
      if (val === '男性' || val === '女性') {
        gender = val;
      }
    } else if (t.startsWith('STAFF_BIRTHDAY_')) {
      birthday = t.replace('STAFF_BIRTHDAY_', '');
    }
  });

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    maskedName: row.masked_name,
    baseLocation: row.base_location,
    nearestStation: row.nearest_station,
    preferredArea: row.preferred_area,
    price: row.price,
    skills: row.skills || [],
    carriers: row.carriers || [],
    experience: row.experience,
    prText: row.pr_text,
    completedTrainings,
    hasCertificate: row.has_certificate,
    role: legacyDemoAuth ? (demoRole || row.role || 'staff') : 'staff',
    loginId: legacyDemoAuth ? (localLogin || row.login_id || '') : undefined,
    password: legacyDemoAuth ? (decryptData(localPassword || row.password) || '') : undefined,
    furigana,
    commuteMethod,
    gender,
    birthday
  };
};

const unmapStaff = (staff: Partial<Staff>): any => {
  const row: any = { ...staff };
  if ('userId' in staff) { row.user_id = staff.userId; delete row.userId; }
  if ('maskedName' in staff) { row.masked_name = staff.maskedName; delete row.maskedName; }
  if ('baseLocation' in staff) { row.base_location = staff.baseLocation; delete row.baseLocation; }
  if ('nearestStation' in staff) { row.nearest_station = staff.nearestStation; delete row.nearestStation; }
  if ('preferredArea' in staff) { row.preferred_area = staff.preferredArea; delete row.preferredArea; }
  if ('prText' in staff) { row.pr_text = staff.prText; delete row.prText; }
  if ('completedTrainings' in staff) { row.completed_trainings = staff.completedTrainings; delete row.completedTrainings; }
  if ('hasCertificate' in staff) { row.has_certificate = staff.hasCertificate; delete row.hasCertificate; }
  if ('role' in staff) { row.role = staff.role; }
  if ('loginId' in staff) { row.login_id = staff.loginId; delete row.loginId; }
  if ('password' in staff) { row.password = encryptData(staff.password); }

  // Strip custom fields
  delete row.furigana;
  delete row.commuteMethod;
  delete row.gender;
  delete row.birthday;

  if (!legacyDemoAuth) { delete row.role; delete row.login_id; delete row.password; }
  return row;
};

const mapContractTask = (row: any): ContractTask => ({
  sbStaffId: row.sb_staff_id,
  sbApprovalId: row.sb_approval_id,
  id: row.id,
  jobId: row.job_id,
  jobTitle: row.job_title,
  workerName: row.worker_name,
  companyName: row.company_name,
  clientName: row.client_name,
  price: row.price,
  date: row.date,
  status: normalizeEngagementStatus(row.status),
  disputedReason: row.disputed_reason,
  evaluations: row.evaluations || {},
  agency_id: row.agency_id,
  client_id: row.client_id,
  clientContractText: row.client_contract_text,
  clientContractApprovedByClient: row.client_contract_approved_by_client,
  clientContractApprovedByAgency: row.client_contract_approved_by_agency,
  agencyContractText: row.agency_contract_text,
  agencyContractApprovedByClient: row.agency_contract_approved_by_client,
  agencyContractApprovedByAgency: row.agency_contract_approved_by_agency,
  clientContractPdf: row.client_contract_pdf,
  agencyContractPdf: row.agency_contract_pdf
});

const unmapContractTask = (task: Partial<ContractTask>): any => {
  const row: any = { ...task };
  if ('sbStaffId' in task) { row.sb_staff_id = task.sbStaffId; delete row.sbStaffId; }
  if ('sbApprovalId' in task) { row.sb_approval_id = task.sbApprovalId; delete row.sbApprovalId; }
  if ('jobId' in task) { row.job_id = task.jobId; delete row.jobId; }
  if ('jobTitle' in task) { row.job_title = task.jobTitle; delete row.jobTitle; }
  if ('workerName' in task) { row.worker_name = task.workerName; delete row.workerName; }
  if ('companyName' in task) { row.company_name = task.companyName; delete row.companyName; }
  if ('clientName' in task) { row.client_name = task.clientName; delete row.clientName; }
  if ('disputedReason' in task) { row.disputed_reason = task.disputedReason; delete row.disputedReason; }
  if ('clientContractText' in task) { row.client_contract_text = task.clientContractText; delete row.clientContractText; }
  if ('clientContractApprovedByClient' in task) { row.client_contract_approved_by_client = task.clientContractApprovedByClient; delete row.clientContractApprovedByClient; }
  if ('clientContractApprovedByAgency' in task) { row.client_contract_approved_by_agency = task.clientContractApprovedByAgency; delete row.clientContractApprovedByAgency; }
  if ('agencyContractText' in task) { row.agency_contract_text = task.agencyContractText; delete row.agencyContractText; }
  if ('agencyContractApprovedByClient' in task) { row.agency_contract_approved_by_client = task.agencyContractApprovedByClient; delete row.agencyContractApprovedByClient; }
  if ('agencyContractApprovedByAgency' in task) { row.agency_contract_approved_by_agency = task.agencyContractApprovedByAgency; delete row.agencyContractApprovedByAgency; }
  if ('clientContractPdf' in task) { row.client_contract_pdf = task.clientContractPdf; delete row.clientContractPdf; }
  if ('agencyContractPdf' in task) { row.agency_contract_pdf = task.agencyContractPdf; delete row.agencyContractPdf; }
  return row;
};

// --- OFFLINE LOCAL DB FALLBACK SYSTEM ---
let useOfflineMock = false;

/** ローカルDBが書き換わったことを通知するイベント名(同一タブ向け)。cross-tab は 'storage' イベントで拾う。 */
export const DATA_CHANGED_EVENT = 'connexy:data-changed';
export const DATA_ACCESS_ERROR_EVENT = 'connexy:data-access-error';

function notifyDataAccessError() {
  try { window.dispatchEvent(new Event(DATA_ACCESS_ERROR_EVENT)); } catch { /* 非ブラウザのテスト環境 */ }
}

/**
 * チャットメッセージのマージ。呼び出し側の `next` を正とし(既存メッセージの編集を保持)、
 * 保存済み `existing` にしかない ID のメッセージ(= 呼び出し側がロード後に届いた相手の発言)を
 * 末尾に足す。同時送信でメッセージが消えるのを防ぐ。
 */
const mergeChatMessages = (existing: any[] | undefined, next: any[]): any[] => {
  const ex = existing || [];
  if (ex.length === 0) return next;
  const nextById = new Map((next || []).filter((m) => m && m.id).map((m) => [m.id, m]));
  const existingIds = new Set(ex.map((m) => m && m.id).filter(Boolean));
  // 既存メッセージは順序を保ったまま(next 側に同一IDの編集版があれば差し替え)。
  // next にしか無いメッセージ(新規発言・同時送信で届いた相手の発言)を末尾に足す。
  // ※ next が「過去を非共有で追加された担当者向けにスライスされた一覧」でも順序が崩れない。
  const merged = ex.map((m) => (m && m.id && nextById.has(m.id) ? nextById.get(m.id) : m));
  const appended = (next || []).filter((m) => m && (!m.id || !existingIds.has(m.id)));
  return appended.length ? [...merged, ...appended] : merged;
};

// Attempt to detect if running in an offline or sandboxed environment
if (legacyDemoAuth && typeof window !== 'undefined') {
  if (localStorage.getItem('connexy_is_offline') === 'true' || !navigator.onLine) {
    useOfflineMock = true;
  }
}

// 自己回復: 一度でも Supabase 呼び出しに失敗すると `connexy_is_offline` が永続化され、
// リロードしてもオフラインモードのまま(= 別アカウント間でデータが同期されない)。
// オンラインに戻っている場合、起動時に軽い疎通確認をして成功したらフラグを解除する。
if (legacyDemoAuth && typeof window !== 'undefined' && navigator.onLine && localStorage.getItem('connexy_is_offline') === 'true') {
  (async () => {
    try {
      const { error } = await supabase.from('companies').select('id').limit(1);
      if (!error) {
        useOfflineMock = false;
        localStorage.removeItem('connexy_is_offline');
        console.info('Supabase reachable again — cleared offline mode.');
        try { window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { table: 'contract_tasks' } })); } catch { /* noop */ }
      }
    } catch {
      /* まだ到達不可 — オフラインモードのまま */
    }
  })();
}

// 一度きりのデータ移行: 保存値 `working` → `confirmed`(STATUS_MODEL.md §7.1)。
// 読み出しは mapContractTask で正規化するが、保存済みデータも揃えておく。
if (legacyDemoAuth && typeof window !== 'undefined' && localStorage.getItem('connexy_migrated_working_to_confirmed') !== '1') {
  try {
    const rawTasks = localStorage.getItem('offline_db_contract_tasks');
    if (rawTasks) {
      const list = JSON.parse(rawTasks);
      if (Array.isArray(list)) {
        let changed = false;
        for (const row of list) {
          if (row && row.status === 'working') { row.status = 'confirmed'; changed = true; }
          const js = row?.evaluations?.jobStates;
          if (js && typeof js === 'object') {
            for (const k of Object.keys(js)) {
              if (js[k]?.status === 'working') { js[k].status = 'confirmed'; changed = true; }
            }
          }
        }
        if (changed) localStorage.setItem('offline_db_contract_tasks', JSON.stringify(list));
      }
    }
    localStorage.setItem('connexy_migrated_working_to_confirmed', '1');
  } catch {
    /* 移行に失敗しても致命的ではない(読み出し時に正規化される) */
  }
}

// Persisted localStorage helpers
const getOfflineData = (table: string, defaultData: any[]): any[] => {
  if (!legacyDemoAuth) throw new Error('個人認証ではブラウザ保存の業務データを読み出せません。');
  if (typeof window === 'undefined') return defaultData;
  const data = localStorage.getItem('offline_db_' + table);
  if (data) {
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        let merged = [...parsed];
        let updated = false;
        defaultData.forEach((defItem: any) => {
          const existingIndex = merged.findIndex((item: any) => item.id === defItem.id);
          if (existingIndex === -1) {
            merged.push(defItem);
            updated = true;
          } else {
            // Update lat/lng and price if the default item has them but cached item doesn't (or they differ)
            if (defItem.lat !== undefined && merged[existingIndex].lat !== defItem.lat) {
              merged[existingIndex].lat = defItem.lat;
              merged[existingIndex].lng = defItem.lng;
              updated = true;
            }
            if (defItem.price !== undefined && merged[existingIndex].price !== defItem.price) {
              merged[existingIndex].price = defItem.price;
              updated = true;
            }
          }
        });
        if (updated) {
          localStorage.setItem('offline_db_' + table, JSON.stringify(merged));
        }
        return merged;
      }
      return parsed;
    } catch (e) {
      return defaultData;
    }
  }
  localStorage.setItem('offline_db_' + table, JSON.stringify(defaultData));
  return defaultData;
};

const saveOfflineData = (table: string, data: any[]) => {
  if (!legacyDemoAuth) throw new Error('個人認証では業務データをブラウザに代替保存できません。');
  if (typeof window !== 'undefined') {
    localStorage.setItem('offline_db_' + table, JSON.stringify(data));
    try {
      window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { table } }));
    } catch {
      /* CustomEvent 非対応環境は無視 */
    }
  }
};

/**
 * `contract_tasks` の変更を購読する。
 * - オフライン時: 同一タブのカスタムイベント + 別タブの storage イベント(ほぼ即時)。
 * - オンライン時: Supabase Realtime を試みつつ、**Realtime が有効化されていない場合に備えて
 *   短い間隔のポーリングも併走させる**(Realtime が SUBSCRIBED になったら間隔を延ばす)。
 *   ※ Realtime はプロジェクトごとに opt-in のため「購読できた」と決め打ちしない。
 * 返り値の関数を呼ぶと購読解除。
 */
export function subscribeToContractTaskChanges(onChange: () => void): () => void {
  if (!legacyDemoAuth) return () => {}; // 新認証の専用画面は再取得を明示し、旧チャットの定期取得を起動しない。
  if (typeof window === 'undefined') return () => {};

  const handleLocal = () => onChange();
  const handleStorage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith('offline_db_') || e.key.startsWith('connexy_last_read_msg_')) onChange();
  };
  window.addEventListener(DATA_CHANGED_EVENT, handleLocal);
  window.addEventListener('storage', handleStorage);

  // オンライン時は Realtime が確認できるまで短間隔でポーリングする(取りこぼし防止)。
  const FAST_MS = 5000;
  const SLOW_MS = 45000;
  let pollMs = useOfflineMock ? SLOW_MS : FAST_MS;
  let timer: ReturnType<typeof setInterval> = setInterval(onChange, pollMs);
  const setPoll = (ms: number) => {
    if (ms === pollMs) return;
    pollMs = ms;
    clearInterval(timer);
    timer = setInterval(onChange, pollMs);
  };

  let channel: ReturnType<typeof supabase.channel> | null = null;
  if (!useOfflineMock) {
    try {
      channel = supabase
        .channel('contract_tasks_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'contract_tasks' }, () => onChange())
        .subscribe((status: string) => {
          // Realtime が確実に動いているときだけポーリング間隔を延ばす。
          if (status === 'SUBSCRIBED') setPoll(SLOW_MS);
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setPoll(FAST_MS);
        });
    } catch {
      /* Realtime 未設定でもポーリングで動作する */
    }
  }

  return () => {
    window.removeEventListener(DATA_CHANGED_EVENT, handleLocal);
    window.removeEventListener('storage', handleStorage);
    clearInterval(timer);
    if (channel) {
      try { supabase.removeChannel(channel); } catch { /* noop */ }
    }
  };
}

// Error wrapper that automatically enables local fallback on failures.
// このセッション中はオフラインにフォールバックするが、`connexy_is_offline` の永続化は
// 「ブラウザがオフライン」のときだけにする。オンラインなのに一時的に失敗しただけなら、
// 次回リロードで再度 Supabase を試せるようにする(永続オフラインで別アカウント間の
// データ同期が止まる事故を防ぐ)。回復用フラグは起動時の疎通確認でも解除される。
async function callSupabase<T>(apiFn: () => Promise<T>, fallbackFn: () => T | Promise<T>): Promise<T> {
  if (!legacyDemoAuth) {
    try { return await apiFn(); }
    catch (error) { notifyDataAccessError(); throw error; }
  }
  if (useOfflineMock) {
    return await fallbackFn();
  }
  try {
    return await apiFn();
  } catch (e) {
    console.warn("Supabase API failed, falling back to local storage offline mock", e);
    useOfflineMock = true;
    if (typeof window !== 'undefined' && !navigator.onLine) {
      localStorage.setItem('connexy_is_offline', 'true');
    }
    return await fallbackFn();
  }
}

const mapUser = (row: any): User => {
  if (!legacyDemoAuth) return {
    id: row.id, name: row.name, role: row.role, status: row.status,
    invoiceNumber: row.invoice_number, representativeName: row.representative_name,
    email: row.email, website: row.website, address: row.address, prText: row.pr_text,
    companyType: row.company_type, gender: row.gender,
    contractTemplate: row.contract_template, contractPdf: row.contract_pdf,
  };
  const localStatus = localStorage.getItem('company_status_' + row.id) as 'pending' | 'approved' | 'rejected' | null;
  const localInvoice = localStorage.getItem('company_invoice_' + row.id);
  const localRep = localStorage.getItem('company_rep_' + row.id);
  const localEmail = localStorage.getItem('company_email_' + row.id);
  const localWebsite = localStorage.getItem('company_website_' + row.id);
  const localAddress = localStorage.getItem('company_address_' + row.id);
  const localPr = localStorage.getItem('company_pr_' + row.id);
  const localType = localStorage.getItem('company_type_' + row.id) as 'client' | 'agency' | 'both' | null;
  const localGender = localStorage.getItem('company_gender_' + row.id) as '男性' | '女性' | 'その他' | '無回答' | null;
  const localContractTemplate = localStorage.getItem('company_contract_template_' + row.id);
  const localContractPdf = localStorage.getItem('company_contract_pdf_' + row.id);
  
  let favoriteJobIds: string[] = [];
  let favoriteTalentIds: string[] = [];
  try { favoriteTalentIds = JSON.parse(localStorage.getItem('company_favorite_talents_' + row.id) || '[]'); } catch(e) {}
  let favoriteFolders: any[] = [];
  try { favoriteFolders = JSON.parse(localStorage.getItem('company_favorite_folders_' + row.id) || '[]'); } catch(e) {}
  try {
    favoriteJobIds = JSON.parse(localStorage.getItem('company_favorite_jobs_' + row.id) || '[]');
  } catch(e) {}
  
  const defaultReps: { [key: string]: string } = {
    sigma: '高橋 誠一',
    alpha: '中村 大輔',
    beta: '斉藤 隆',
    gamma: '藤田 健太',
    delta: '小林 修',
    seals: '佐藤 海人',
    freer: '林 克樹',
    cocolabo: '伊内 美伊'
  };
 
  const defaultEmails: { [key: string]: string } = {
    sigma: 'contact@sigma-comm.co.jp',
    alpha: 'info@alpha-agency.com',
    beta: 'support@beta-corp.jp',
    gamma: 'info@gamma-llc.net',
    delta: 'contact@delta-partners.jp',
    seals: 'info@seals-comm.co.jp',
    freer: 'contact@freer-vision.net',
    cocolabo: 'support@cocolabo-solutions.com'
  };
 
  const defaultWebsites: { [key: string]: string } = {
    sigma: 'https://sigma-comm.co.jp',
    alpha: 'https://alpha-agency.com',
    beta: 'https://beta-corp.jp',
    gamma: 'https://gamma-llc.net',
    delta: 'https://delta-partners.jp',
    seals: 'https://seals-comm.co.jp',
    freer: 'https://freer-vision.net',
    cocolabo: 'https://cocolabo-solutions.com'
  };
 
  const defaultAddresses: { [key: string]: string } = {
    sigma: '東京都新宿区西新宿2-8-1',
    alpha: '東京都品川区大崎1-11-1',
    beta: '東京都渋谷区渋谷3-21-3',
    gamma: '神奈川県横浜市中区港町1-1',
    delta: '埼玉県さいたま市大宮区吉敷町1-1',
    seals: '東京都品川区西五反田1-5-1',
    freer: '東京都港区南青山2-2-15',
    cocolabo: '大阪府大阪市北区梅田2-2-2'
  };
 
  const defaultPrs: { [key: string]: string } = {
    sigma: '全国対応の通信キャリアイベント獲得特化集団。量販店・ショップでの稼働実績多数。',
    alpha: '光回線・モバイルの獲得に特化した営業支援代理店。経験豊富なクローザーが稼働中。',
    beta: 'ディレクターやキャンペーンクルーの手配から現場の運営までワンストップで受託します。',
    gamma: '地域密着型のブース販売と店舗支援が得意です。ドコモ・au等全キャリア対応。',
    delta: '緊急案件の対応力に強み。週末のショップ応援や臨時イベント要員の供給に自信あり。',
    seals: '通信キャリアのイベント代行と人材手配。現場の課題にコミットするプロ集団です。',
    freer: '未来のビジョンをフリーに共創する、モバイル営業代行およびコンサルティング企業。',
    cocolabo: 'コラボレーションによるイノベーション。通信業界の各種ソリューションをご提案。'
  };
 
  const defaultTypes: { [key: string]: 'client' | 'agency' | 'both' } = {
    sigma: 'both',
    alpha: 'agency',
    beta: 'agency',
    gamma: 'both',
    delta: 'client',
    seals: 'both',
    freer: 'agency',
    cocolabo: 'both'
  };
 
  const defaultContractTemplate = `業務委託契約書

発注者（以下「甲」という）と、受注者（以下「乙」という）は、甲乙間で合意した業務（以下「本業務」という）の委託に関し、以下の通り契約を締結する。

第1条（業務内容）
乙は、甲の指示に従い、本件案件に関わる業務を善良な管理者の注意をもって遂行する。

第2条（委託期間）
本契約の有効期間は、該当案件の稼働予定日とし、本業務完了をもって終了する。

第3条（委託料及び支払方法）
委託料は、本アプリ上で双方合意した金額とし、指定の期日までに乙に支払う。甲は、電子請求書の発行を確認し、所定の手続きを行う。

第4条（自己責任及び免責）
相互承認が完了していない状態での稼働により生じた一切のトラブル・紛争について、運営会社はその責任を一切負わないものとする。

第5条（管轄裁判所）
本契約に関連して生じた紛争については、甲の本社所在地を管轄する地方裁判所を第一審の専属的合意管轄裁判所とする。`;
 
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    loginId: row.login_id,
    password: row.password,
    status: ['sigma', 'alpha', 'beta', 'gamma', 'delta', 'seals', 'freer', 'cocolabo'].includes(row.id) ? 'approved' : (localStatus || row.status || 'approved'),
    invoiceNumber: localInvoice || row.invoice_number,
    representativeName: localRep || row.representative_name || defaultReps[row.id] || '未登録',
    email: localEmail || row.email || defaultEmails[row.id] || '',
    website: localWebsite || row.website || defaultWebsites[row.id] || '',
    address: localAddress || row.address || defaultAddresses[row.id] || '',
    prText: localPr || row.pr_text || defaultPrs[row.id] || '',
    companyType: localType || row.company_type || defaultTypes[row.id] || 'both',
    gender: localGender || '男性',
    contractTemplate: localContractTemplate || defaultContractTemplate,
    contractPdf: localContractPdf || undefined,
    favoriteJobIds,
    favoriteTalentIds,
    favoriteFolders
  };
};

const initializeDefaultStaffLogins = (allStaffsData: any[]) => {
  if (!legacyDemoAuth) return;
  const companyGroups: { [key: string]: any[] } = {};
  allStaffsData.forEach((row: any) => {
    if (!companyGroups[row.user_id]) companyGroups[row.user_id] = [];
    companyGroups[row.user_id].push(row);
  });
  
  for (const companyId of Object.keys(companyGroups)) {
    const sorted = [...companyGroups[companyId]].sort((a, b) => {
      const idA = a.id !== undefined && a.id !== null ? String(a.id) : '';
      const idB = b.id !== undefined && b.id !== null ? String(b.id) : '';
      return idA.localeCompare(idB);
    });
    sorted.forEach((row, index) => {
      const existingLogin = localStorage.getItem('staff_login_' + row.id);
      if (!existingLogin) {
        localStorage.setItem('staff_login_' + row.id, companyId + '_s' + (index + 1));
        localStorage.setItem('staff_password_' + row.id, 'pass');
      }
    });
  }
};

const defaultOfflineCompanies = [
  { id: 'sigma', name: '株式会社シグマ通信', role: 'contractor', login_id: 'sigma', password: 'pass', status: 'approved', representative_name: '高橋 誠一', email: 'contact@sigma-comm.co.jp', address: '東京都新宿区西新宿2-8-1', company_type: 'both' },
  { id: 'alpha', name: '株式会社アルファ', role: 'contractor', login_id: 'alpha', password: 'pass', status: 'approved', representative_name: '中村 大輔', email: 'info@alpha-agency.com', address: '東京都品川区大崎1-11-1', company_type: 'agency' },
  { id: 'beta', name: 'ベータ株式会社', role: 'contractor', login_id: 'beta', password: 'pass', status: 'approved', representative_name: '斉藤 隆', email: 'support@beta-corp.jp', address: '東京都渋谷区渋谷3-21-3', company_type: 'agency' },
  { id: 'gamma', name: '合同会社ガンマ', role: 'contractor', login_id: 'gamma', password: 'pass', status: 'approved', representative_name: '藤田 健太', email: 'info@gamma-llc.net', address: '神奈川県横浜市中区港町1-1', company_type: 'both' },
  { id: 'delta', name: 'デルタ合同会社', role: 'contractor', login_id: 'delta', password: 'pass', status: 'approved', representative_name: '小林 修', email: 'contact@delta-partners.jp', address: '埼玉県さいたま市吉敷町1-1', company_type: 'client' },
  { id: 'seals', name: '株式会社SEALs', role: 'contractor', login_id: 'seals', password: 'pass', status: 'approved', representative_name: '佐藤 海人', email: 'info@seals-comm.co.jp', address: '東京都品川区西五反田1-5-1', company_type: 'both' },
  { id: 'freer', name: '株式会社FreeR VisioN', role: 'contractor', login_id: 'freer', password: 'pass', status: 'approved', representative_name: '林 克樹', email: 'contact@freer-vision.net', address: '東京都港区南青山2-2-15', company_type: 'agency' },
  { id: 'cocolabo', name: 'ココラボ・ソリューションズ', role: 'contractor', login_id: 'cocolabo', password: 'pass', status: 'approved', representative_name: '伊内 美伊', email: 'support@cocolabo-solutions.com', address: '大阪府大阪市北区梅田2-2-2', company_type: 'both' }
];

const defaultOfflineStaffs = [
  { id: 's1', user_id: 'sigma', name: '高橋 誠一', role: 'admin', login_id: 'sigma_s1', password: 'pass', base_location: '東京都新宿区', nearest_station: '新宿駅', price: 15000, skills: ['イベント運営', 'キャンペーンMC'], completed_trainings: [] },
  { id: 's2', user_id: 'sigma', name: '森 健太', role: 'staff', login_id: 'sigma_s2', password: 'pass', base_location: '東京都渋谷区', nearest_station: '渋谷駅', price: 12000, skills: ['モバイル販売'], completed_trainings: [] },
  { id: 's3', user_id: 'sigma', name: '岡田 直樹', role: 'staff', login_id: 'sigma_s3', password: 'pass', base_location: '神奈川県横浜市', nearest_station: '横浜駅', price: 13000, skills: ['イベント運営'], completed_trainings: [] },
  { id: 's4', user_id: 'alpha', name: '井上 洋平', role: 'staff', login_id: 'alpha_s1', password: 'pass', base_location: '東京都品川区', nearest_station: '大崎駅', price: 14000, skills: ['モバイル販売'], completed_trainings: [] },
  { id: 's5', user_id: 'alpha', name: '田村 亮', role: 'staff', login_id: 'alpha_s2', password: 'pass', base_location: '千葉県船橋市', nearest_station: '船橋駅', price: 12000, skills: ['ブース獲得'], completed_trainings: [] },
  { id: 's6', user_id: 'alpha', name: '松田 涼', role: 'staff', login_id: 'alpha_s3', password: 'pass', base_location: '埼玉県さいたま市', nearest_station: '大宮駅', price: 13000, skills: ['イベント運営'], completed_trainings: [] },
  { id: 's7', user_id: 'beta', name: '清水 一馬', role: 'staff', login_id: 'beta_s1', password: 'pass', base_location: '東京都渋谷区', nearest_station: '渋谷駅', price: 14000, skills: ['モバイル販売'], completed_trainings: [] },
  { id: 's8', user_id: 'beta', name: '大野 剛', role: 'staff', login_id: 'beta_s2', password: 'pass', base_location: '神奈川県川崎市', nearest_station: '川崎駅', price: 12000, skills: ['ブース獲得'], completed_trainings: [] },
  { id: 's9', user_id: 'beta', name: '福田 学', role: 'staff', login_id: 'beta_s3', password: 'pass', base_location: '東京都豊島区', nearest_station: '池袋駅', price: 13000, skills: ['イベント運営'], completed_trainings: [] },
  
  { id: 's_seals_admin', user_id: 'seals', name: '岡田 哲弥', role: 'admin', login_id: 'seals_s1', password: 'pass', base_location: '東京都品川区', nearest_station: '五反田駅', price: 16000, skills: ['イベント運営', 'キャンペーンMC'], completed_trainings: [] },
  { id: 's_seals_staff1', user_id: 'seals', name: '中嶋 晴希', role: 'staff', login_id: 'seals_s2', password: 'pass', base_location: '神奈川県川崎市', nearest_station: '川崎駅', price: 13000, skills: ['モバイル販売'], completed_trainings: [] },
  { id: 's_seals_staff2', user_id: 'seals', name: '野田 悠斗', role: 'staff', login_id: 'seals_s3', password: 'pass', base_location: '東京都世田谷区', nearest_station: '下北沢駅', price: 13000, skills: ['イベント運営'], completed_trainings: [] },

  { id: 's_freer_admin', user_id: 'freer', name: '林 克樹', role: 'admin', login_id: 'freer_s1', password: 'pass', base_location: '東京都港区', nearest_station: '表参道駅', price: 16000, skills: ['モバイル販売', 'クローザー'], completed_trainings: [] },
  { id: 's_freer_staff1', user_id: 'freer', name: '大西 涼太', role: 'staff', login_id: 'freer_s2', password: 'pass', base_location: '東京都目黒区', nearest_station: '中目黒駅', price: 13000, skills: ['モバイル販売'], completed_trainings: [] },
  { id: 's_freer_staff2', user_id: 'freer', name: '佐々木 遼', role: 'staff', login_id: 'freer_s3', password: 'pass', base_location: '神奈川県横浜市', nearest_station: '横浜駅', price: 13000, skills: ['ブース獲得'], completed_trainings: [] },

  { id: 's_cocolabo_admin', user_id: 'cocolabo', name: '伊内 美伊', role: 'admin', login_id: 'cocolabo_s1', password: 'pass', base_location: '大阪府大阪市', nearest_station: '梅田駅', price: 16000, skills: ['ディレクター', 'イベントMC'], completed_trainings: [] },
  { id: 's_cocolabo_staff1', user_id: 'cocolabo', name: '川口 彩香', role: 'staff', login_id: 'cocolabo_s2', password: 'pass', base_location: '兵庫県神戸市', nearest_station: '三ノ宮駅', price: 13000, skills: ['モバイル販売'], completed_trainings: [] },
  { id: 's_cocolabo_staff2', user_id: 'cocolabo', name: '西田 桃子', role: 'staff', login_id: 'cocolabo_s3', password: 'pass', base_location: '京都府京都市', nearest_station: '京都駅', price: 13000, skills: ['イベント運営'], completed_trainings: [] }
];

const generate100RandomJobs = (): any[] => {
  const jobsList: any[] = [];
  const companies = ['sigma', 'alpha', 'beta', 'gamma', 'delta', 'seals', 'freer', 'cocolabo'];
  const stations = ['新宿', '渋谷', '池袋', '五反田', '品川', '横浜', '梅田', '大崎', '六本木', '秋葉原'];
  const locations = [
    '東京都新宿区新宿', '東京都渋谷区神南', '東京都豊島区東池袋', '東京都品川区西五反田',
    '東京都港区高輪', '神奈川県横浜市中区', '大阪府大阪市北区梅田', '東京都品川区大崎',
    '東京都港区六本木', '東京都千代田区外神田'
  ];
  const roleTypes = ['キャンペーンクルー', 'クローザー', 'ディレクター', 'イベントMC'];
  const salesChannels = ['ショップ', '量販店', '商業施設', '外販（スーパーなど）'];
  const carriers = ['docomo', 'au/UQmobile', 'SoftBank/Y!mobile', 'Rakuten Mobile'];
  const workLocations = ['店内', '外販（複合施設など）', '外販（スーパーなど）'];
  
  const titleTemplates = [
    '【{station}】{carrier} 臨時イベントプロモーション・接客案内スタッフ',
    '【{station}駅前】{role}募集！{carrier}ショップ獲得イベント要員',
    '【{station}近郊】高単価！{carrier}・モバイル相談会ディレクション・運営',
    '【{station}量販店】{carrier}ブース販売・クロージング特化クルー募集'
  ];
  
  const descriptions = [
    '大手通信キャリアのイベントブースにて、お声がけやティッシュ配り、サービスのご案内を行うお仕事です。未経験の方も歓迎します！',
    'モバイル端末の新規契約、MNP乗り換え相談に特化した業務です。獲得スキルやクロージングに自信のある方のご応募お待ちしております。',
    'イベントスペースや店舗前のブース設営から運営、集客のマイクパフォーマンス（MC）まで幅広くお任せします。リーダーシップを発揮できる環境です。',
    '週末の来店客数増加に伴う、店頭プロモーション応援業務です。活気のある現場で、チームワークを活かして獲得目標を目指します！'
  ];

  for (let i = 1; i <= 100; i++) {
    const rCompany = companies[i % companies.length];
    const rIndex = i % stations.length;
    const rStation = stations[rIndex];
    const rLocation = locations[rIndex];
    const rRole = roleTypes[i % roleTypes.length];
    const rChannel = salesChannels[i % salesChannels.length];
    const rCarrier = carriers[i % carriers.length];
    const rWorkLoc = workLocations[i % workLocations.length];
    const price = 12000 + (i % 9) * 1000;
    
    let title = titleTemplates[i % titleTemplates.length]
      .replace('{station}', rStation)
      .replace('{carrier}', rCarrier)
      .replace('{role}', rRole);
      
    const desc = descriptions[i % descriptions.length];
    const isUrgent = i % 7 === 0;
    
    const eventDay = 20 + (i % 25);
    const eventMonth = 7 + Math.floor((20 + (i % 25)) / 31);
    const eventMonthStr = eventMonth.toString().padStart(2, '0');
    const eventDayStr = (eventDay % 28 + 1).toString().padStart(2, '0');
    const eventDate = `2026-${eventMonthStr}-${eventDayStr}`;
    
    const dlDay = (eventDay % 28 + 1) - 2;
    const dlDayStr = (dlDay > 0 ? dlDay : 1).toString().padStart(2, '0');
    const applicationDeadline = `2026-${eventMonthStr}-${dlDayStr}`;

    jobsList.push({
      id: `rand_j_${i}`,
      title,
      description: desc,
      author_id: rCompany,
      price,
      location_name: rLocation,
      work_hours: i % 2 === 0 ? '10:00 - 19:00' : '11:00 - 20:00',
      requirements: [`__JOB_CODE__::JOB-RAND-${1000 + i}`],
      jobCode: `JOB-RAND-${1000 + i}`,
      role_type: rRole,
      sales_channel: rChannel,
      carrier: rCarrier,
      event_date: eventDate,
      application_deadline: applicationDeadline,
      work_location: rWorkLoc,
      is_urgent: isUrgent
    });
  }
  return jobsList;
};

const defaultOfflineJobs = [
  ...regionalJobs,
  { id: 'j1', title: '【大崎駅】ドコモショップ出張ブース販売イベント要員', description: 'ドコモショップ出張イベントでのブース案内・獲得業務です。経験者優遇。', author_id: 'sigma', price: 15000, location_name: '東京都品川区大崎', work_hours: '10:00 - 19:00', requirements: ['__JOB_CODE__::JOB-100201'], role_type: 'キャンペーンクルー', sales_channel: 'ショップ', carrier: 'docomo', event_date: '2026-07-20', application_deadline: '2026-07-18', work_location: '外販（複合施設など）', is_urgent: true },
  { id: 'j2', title: '【新宿駅】au・UQモバイルの乗り換え案内スタッフ募集', description: '量販店店頭でのau・UQモバイル乗り換え案内クロージング業務です。', author_id: 'alpha', price: 18000, location_name: '東京都新宿区新宿', work_hours: '10:00 - 19:00', requirements: ['__JOB_CODE__::JOB-100202'], role_type: 'クローザー', sales_channel: '量販店', carrier: 'au/UQmobile', event_date: '2026-07-22', application_deadline: '2026-07-20', work_location: '店内', is_urgent: false },
  { id: 'j3', title: '【渋谷駅】ソフトバンク・ワイモバイルの臨時イベントMC/クルー', description: '店舗前ブースでのチラシ・ノベルティ配布、およびマイクMC進行。未経験歓迎！', author_id: 'beta', price: 14000, location_name: '東京都渋谷区渋谷', work_hours: '11:00 - 20:00', requirements: ['__JOB_CODE__::JOB-100203'], role_type: 'キャンペーンクルー', sales_channel: 'ショップ', carrier: 'SoftBank/Y!mobile', event_date: '2026-07-21', application_deadline: '2026-07-19', work_location: '外販（スーパーなど）', is_urgent: false },
  ...generate100RandomJobs()
];

const defaultOfflineTalents = [
  { id: 't1', name: 'タレント A', description: '獲得特化クローザー。週末獲得実績多数。', lat: 35.6895, lng: 139.6917, user_id: 'alpha', price: 16000, skills: ['クローザー', 'モバイル販売'], experience: '5年以上', preferred_area: '東京都内', location_name: '東京都新宿区', company_name: '株式会社アルファ', masked_name: 'T**** A', completed_trainings: [] },
  { id: 't2', name: 'タレント B', description: 'イベントディレクター・MC対応可能。', lat: 35.6580, lng: 139.7016, user_id: 'beta', price: 18000, skills: ['ディレクター', 'イベントMC'], experience: '3年以上', preferred_area: '渋谷・新宿', location_name: '東京都渋谷区', company_name: 'ベータ株式会社', masked_name: 'T**** B', completed_trainings: [] }
];

const defaultOfflineTasks = [
  { id: 'task1', job_id: 'j1', job_title: '【大崎駅】ドコモショップ出張ブース販売イベント要員', worker_name: '井上 洋平', company_name: '株式会社アルファ', client_name: '株式会社シグマ通信', price: 15000, date: '2026-07-20', status: 'completed', agency_id: 'alpha', client_id: 'sigma', evaluations: { messages: [] } },
  { id: 'task2', job_id: 'j2', job_title: '【新宿駅】au・UQモバイルの乗り換え案内スタッフ募集', worker_name: '森 健太', company_name: '株式会社シグマ通信', client_name: '株式会社アルファ', price: 18000, date: '2026-07-22', status: 'applying', agency_id: 'sigma', client_id: 'alpha', evaluations: { messages: [] } }
];

// 運営からのお知らせ。ハードコード配列でなくデータソース(Supabase の `announcements` テーブル、
// オフライン時は localStorage)として扱う。将来的に運営向け管理画面から投稿・編集できるようにする。
const defaultOfflineAnnouncements = [
  {
    id: 'ann-1',
    date: '2026/06/13',
    title: 'プライバシーマーク（Pマーク）取得に向けた個人情報取扱方針の改定について',
    content: '平素はConnexyをご利用いただき誠にありがとうございます。Connexyでは、ユーザーの皆様に安全かつ信頼性の高いお仕事管理環境を提供するため、将来的なプライバシーマーク（Pマーク）の取得に向けたシステム監査および個人情報取扱方針の改定を実施いたします。\n\n【主な変更点】\n1. GPSによる位置情報取得時の同意取得フローの厳格化\n2. チャット内の不要な個人情報（電話番号、メールアドレス等）の自動マスキング（伏字化）処理の導入\n3. データベースにおけるRow Level Security（行レベルセキュリティ）ポリシーの適用強化\n\n本改定に伴うユーザー様への操作上の影響はございません。今後とも個人情報の厳重な管理体制を維持し、プライバシー保護に努めてまいりますので、ご理解とご協力のほどよろしくお願い申し上げます。',
    is_important: true,
  },
  {
    id: 'ann-2',
    date: '2026/06/10',
    title: '【重要】システムメンテナンスに伴う一時利用停止のお知らせ（6月18日深夜）',
    content: 'サーバー性能向上およびインフラ増強のため、下記の日程でシステムメンテナンスを実施いたします。\n\n【メンテナンス日時】\n2026年6月18日（木） 午前1:00 〜 午前5:00\n※作業の進捗状況により、時間が前後する場合がございます。\n\n【影響範囲】\nメンテナンス時間帯は、アプリへのログイン、求人の検索、チャットの送受信、打刻など全ての機能がご利用いただけません。\nご利用の皆様にはご不便をおかけいたしますが、ご理解とご協力を賜りますようお願い申し上げます。',
    is_important: true,
  },
  {
    id: 'ann-3',
    date: '2026/06/05',
    title: 'マッチング手数料（10%）の明細表示機能リリースのお知らせ',
    content: 'いつもConnexyをご利用いただきありがとうございます。\nこの度、売上・振込予定額の透明性を高めるため、ダッシュボード詳細にてマッチング手数料（10%）および早期出金手数料（7.5%）の具体的な差し引き額を明記するアップデートを反映いたしました。売上予定額と実際の受取予定額がひと目でわかるようになりますので、ぜひご活用ください。',
    is_important: false,
  },
];

export const api = {
  getJobs: async (limit?: number, offset?: number): Promise<Job[]> => {
    if (!legacyDemoAuth) return (await readAuditedRows('jobs', {limit,offset})).map(mapJob);
    return callSupabase(
      async () => {
        let query = supabase.from('jobs').select(legacyDemoAuth ? '*' : readColumns.jobs);
        if (typeof limit === 'number' && typeof offset === 'number') {
          query = query.range(offset, offset + limit - 1);
        }
        const { data, error } = await query;
        if (error) throw error;
        return data.map(mapJob);
      },
      () => {
        let list = getOfflineData('jobs', defaultOfflineJobs).map(mapJob);
        if (typeof limit === 'number' && typeof offset === 'number') {
          list = list.slice(offset, offset + limit);
        }
        return list;
      }
    );
  },

  getTalents: async (limit?: number, offset?: number): Promise<Talent[]> => {
    if (!legacyDemoAuth) return (await readAuditedRows('talents', {limit,offset})).map(mapTalent);
    return callSupabase(
      async () => {
        let query = supabase.from('talents').select(legacyDemoAuth ? '*' : readColumns.talents);
        if (typeof limit === 'number' && typeof offset === 'number') {
          query = query.range(offset, offset + limit - 1);
        }
        const { data, error } = await query;
        if (error) throw error;
        return data.map(mapTalent);
      },
      () => {
        let list = getOfflineData('talents', defaultOfflineTalents).map(mapTalent);
        if (typeof limit === 'number' && typeof offset === 'number') {
          list = list.slice(offset, offset + limit);
        }
        return list;
      }
    );
  },

  getUserById: async (id: string): Promise<User | undefined> => {
    if (!legacyDemoAuth) { const rows = await readAuditedRows('companies', {id}); return rows[0] ? mapUser(rows[0]) : undefined; }
    return callSupabase(
      async () => {
        const { data, error } = await supabase.from('companies').select(legacyDemoAuth ? '*' : readColumns.companies).eq('id', id).single();
        if (error || !data) return undefined;
        return mapUser(data);
      },
      () => {
        const list = getOfflineData('companies', defaultOfflineCompanies);
        const found = list.find((c: any) => c.id === id);
        return found ? mapUser(found) : undefined;
      }
    );
  },

  getCurrentUser: async (): Promise<User | null> => {
    if (!legacyDemoAuth) return getAuthenticatedUser();
    const userId = localStorage.getItem('connexy_current_user_id');
    if (!userId) return null;

    return callSupabase(
      async () => {
        const { data, error } = await supabase.from('companies').select(legacyDemoAuth ? '*' : readColumns.companies).eq('id', userId).single();
        if (error || !data) return null;
        
        const companyUser = mapUser(data);
        const staffId = localStorage.getItem('connexy_current_staff_id');
        if (staffId) {
          const { data: staffData } = await supabase.from('staffs').select(legacyDemoAuth ? '*' : readColumns.staffs).eq('id', staffId).single();
          if (staffData) {
            const staff = mapStaff(staffData);
            companyUser.staffId = staff.id;
            companyUser.staffName = staff.name;
            companyUser.staffRole = staff.role || 'staff';
          }
        } else {
          companyUser.staffName = companyUser.representativeName;
          companyUser.staffRole = 'admin';
        }
        return companyUser;
      },
      () => {
        const list = getOfflineData('companies', defaultOfflineCompanies);
        const found = list.find((c: any) => c.id === userId);
        if (!found) return null;
        const companyUser = mapUser(found);
        
        const staffId = localStorage.getItem('connexy_current_staff_id');
        if (staffId) {
          const staffs = getOfflineData('staffs', defaultOfflineStaffs);
          const staffFound = staffs.find((s: any) => s.id === staffId);
          if (staffFound) {
            const staff = mapStaff(staffFound);
            companyUser.staffId = staff.id;
            companyUser.staffName = staff.name;
            companyUser.staffRole = staff.role || 'staff';
          }
        } else {
          companyUser.staffName = companyUser.representativeName;
          companyUser.staffRole = 'admin';
        }
        return companyUser;
      }
    );
  },

  login: async (loginId: string, password: string): Promise<User | null> => {
    if (!legacyDemoAuth) return loginWithAuth(loginId, password);
    return callSupabase(
      async () => {
        // 1. Try to authenticate against companies table
        const { data: companyData } = await supabase
          .from('companies')
          .select('*')
          .eq('login_id', loginId)
          .eq('password', password)
          .single();
          
        if (companyData) {
          localStorage.setItem('connexy_current_user_id', companyData.id);
          localStorage.removeItem('connexy_current_staff_id');
          return mapUser(companyData);
        }
        
        // 2. Try to authenticate against staffs table
        const { data: allStaffsData } = await supabase.from('staffs').select(legacyDemoAuth ? '*' : readColumns.staffs);
        if (allStaffsData) {
          initializeDefaultStaffLogins(allStaffsData);
          for (const sRow of allStaffsData) {
            const staff = mapStaff(sRow);
            if (staff.loginId === loginId && staff.password === password) {
              localStorage.setItem('connexy_current_user_id', staff.userId);
              localStorage.setItem('connexy_current_staff_id', staff.id);
              
              const { data: companyData2 } = await supabase.from('companies').select(legacyDemoAuth ? '*' : readColumns.companies).eq('id', staff.userId).single();
              if (companyData2) {
                const user = mapUser(companyData2);
                user.staffId = staff.id;
                user.staffName = staff.name;
                user.staffRole = staff.role || 'staff';
                return user;
              }
            }
          }
        }
        return null;
      },
      () => {
        const companies = getOfflineData('companies', defaultOfflineCompanies);
        const comp = companies.find((c: any) => c.login_id === loginId && c.password === password);
        if (comp) {
          localStorage.setItem('connexy_current_user_id', comp.id);
          localStorage.removeItem('connexy_current_staff_id');
          return mapUser(comp);
        }

        const staffs = getOfflineData('staffs', defaultOfflineStaffs);
        initializeDefaultStaffLogins(staffs);
        for (const sRow of staffs) {
          const staff = mapStaff(sRow);
          if (staff.loginId === loginId && staff.password === password) {
            localStorage.setItem('connexy_current_user_id', staff.userId);
            localStorage.setItem('connexy_current_staff_id', staff.id);
            
            const comp2 = companies.find((c: any) => c.id === staff.userId);
            if (comp2) {
              const user = mapUser(comp2);
              user.staffId = staff.id;
              user.staffName = staff.name;
              user.staffRole = staff.role || 'staff';
              return user;
            }
          }
        }
        return null;
      }
    );
  },

  logout: async (): Promise<void> => {
    if (!legacyDemoAuth) {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
    }
    localStorage.removeItem('connexy_current_user_id');
    localStorage.removeItem('connexy_current_staff_id');
  },

  getStaffsByUserId: async (userId: string): Promise<Staff[]> => {
    if (!legacyDemoAuth) return (await readAuditedRows('staffs', {company:userId})).map(mapStaff);
    return callSupabase(
      async () => {
        const { data, error } = await supabase.from('staffs').select(legacyDemoAuth ? '*' : readColumns.staffs).eq('user_id', userId);
        if (error) throw error;
        
        if (legacyDemoAuth) {
          const { data: allStaffsData } = await supabase.from('staffs').select('*');
          if (allStaffsData) initializeDefaultStaffLogins(allStaffsData);
        }
        return data.map(mapStaff);
      },
      () => {
        const list = getOfflineData('staffs', defaultOfflineStaffs);
        initializeDefaultStaffLogins(list);
        return list.filter((s: any) => s.user_id === userId).map(mapStaff);
      }
    );
  },

  getAllStaffs: async (): Promise<Staff[]> => {
    if (!legacyDemoAuth) return (await readAuditedRows('staffs')).map(mapStaff);
    return callSupabase(
      async () => {
        const { data, error } = await supabase.from('staffs').select(legacyDemoAuth ? '*' : readColumns.staffs);
        if (error) throw error;
        if (data) {
          initializeDefaultStaffLogins(data);
        }
        return data.map(mapStaff);
      },
      () => {
        const list = getOfflineData('staffs', defaultOfflineStaffs);
        initializeDefaultStaffLogins(list);
        return list.map(mapStaff);
      }
    );
  },

  addJob: async (job: Omit<Job, 'id'>): Promise<Job> => {
    const id = 'j' + Date.now();
    const jobCode = 'JOB-' + Math.floor(100000 + Math.random() * 900000);
    const newJob = { ...job, id, jobCode };

    return callSupabase(
      async () => {
        const row = unmapJob(newJob);
        const { error } = await supabase.from('jobs').insert([row]);
        if (error) throw error;
        return newJob;
      },
      () => {
        const list = getOfflineData('jobs', defaultOfflineJobs);
        const row = unmapJob(newJob);
        list.push(row);
        saveOfflineData('jobs', list);
        return newJob;
      }
    );
  },

  updateJob: async (jobId: string, updates: Partial<Job>): Promise<void> => {
    return callSupabase(
      async () => {
        const row = unmapJob(updates);
        delete row.id;
        const { error } = await supabase.from('jobs').update(row).eq('id', jobId);
        if (error) throw error;
      },
      () => {
        const list = getOfflineData('jobs', defaultOfflineJobs);
        const index = list.findIndex((j: any) => j.id === jobId);
        if (index !== -1) {
          const rowUpdates = unmapJob(updates);
          delete rowUpdates.id;
          list[index] = { ...list[index], ...rowUpdates };
          saveOfflineData('jobs', list);
        }
      }
    );
  },

  addTalent: async (talent: Omit<Talent, 'id'>): Promise<Talent> => {
    const id = 't' + Date.now();
    const newTalent = { ...talent, id };

    return callSupabase(
      async () => {
        const row = unmapTalent(newTalent);
        const { error } = await supabase.from('talents').insert([row]);
        if (error) throw error;
        return newTalent;
      },
      () => {
        const list = getOfflineData('talents', defaultOfflineTalents);
        const row = unmapTalent(newTalent);
        list.push(row);
        saveOfflineData('talents', list);
        return newTalent;
      }
    );
  },

  addStaff: async (staff: Omit<Staff, 'id'>): Promise<Staff> => {
    const id = 's' + Date.now();
    const extraTags: string[] = [];
    if (staff.furigana) extraTags.push('STAFF_FURIGANA_' + staff.furigana);
    if (staff.commuteMethod) extraTags.push('STAFF_COMMUTE_' + staff.commuteMethod);
    if (staff.gender) extraTags.push('STAFF_GENDER_' + staff.gender);
    if (staff.birthday) extraTags.push('STAFF_BIRTHDAY_' + staff.birthday);

    const newStaff = { ...staff, id, completedTrainings: extraTags };
    if (legacyDemoAuth && newStaff.role) {
      localStorage.setItem('staff_role_' + id, newStaff.role);
    }
    if (legacyDemoAuth && newStaff.loginId) {
      localStorage.setItem('staff_login_' + id, newStaff.loginId);
    }
    if (legacyDemoAuth && newStaff.password) {
      localStorage.setItem('staff_password_' + id, newStaff.password);
    }

    return callSupabase(
      async () => {
        const row = unmapStaff(newStaff);
        const { error } = await supabase.from('staffs').insert([row]);
        if (error) {
          console.warn('addStaff database insert failed, attempting fallback insertion without role/login_id/password columns:', error);
          const fallbackRow = { ...row };
          delete fallbackRow.role;
          delete fallbackRow.login_id;
          delete fallbackRow.password;
          const { error: errorFallback } = await supabase.from('staffs').insert([fallbackRow]);
          if (errorFallback) throw errorFallback;
        }
        return newStaff;
      },
      () => {
        const list = getOfflineData('staffs', defaultOfflineStaffs);
        const row = unmapStaff(newStaff);
        list.push(row);
        saveOfflineData('staffs', list);
        return newStaff;
      }
    );
  },

  getTrainings: async (): Promise<Training[]> => {
    return mockTrainings;
  },

  // 運営からのお知らせ一覧(日付の新しい順)。
  // ※ 補助的な機能なので callSupabase は使わない。`announcements` テーブルが無い等で
  //   失敗してもアプリ全体をオフラインモードに落とさず、ローカル/既定データを返す。
  getAnnouncements: async (): Promise<Announcement[]> => {
    if (!legacyDemoAuth) return (await readAuditedRows('announcements')).map(mapAnnouncement).sort((a,b)=>b.date.localeCompare(a.date));
    const localList = () =>
      [...getOfflineData('announcements', defaultOfflineAnnouncements).map(mapAnnouncement)]
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    if (legacyDemoAuth && useOfflineMock) return localList();
    try {
      const { data, error } = await supabase.from('announcements').select(legacyDemoAuth ? '*' : readColumns.announcements).order('date', { ascending: false });
      if (error) throw error;
      if (!data || data.length === 0) return legacyDemoAuth ? localList() : [];
      return data.map(mapAnnouncement);
    } catch (e) {
      if (!legacyDemoAuth) throw e;
      console.warn('getAnnouncements: falling back to local announcements (non-fatal)', e);
      return localList();
    }
  },

  // 運営向け: お知らせの作成・更新(id が既存なら更新)。失敗はローカル保存にフォールバック(非致命)。
  saveAnnouncement: async (announcement: Announcement): Promise<void> => {
    const row = unmapAnnouncement(announcement);
    const saveLocal = () => {
      const list = getOfflineData('announcements', defaultOfflineAnnouncements);
      const idx = list.findIndex((a: any) => a.id === announcement.id);
      if (idx === -1) list.unshift(row);
      else list[idx] = { ...list[idx], ...row };
      saveOfflineData('announcements', list);
    };
    if (legacyDemoAuth && useOfflineMock) return saveLocal();
    try {
      const { error } = await supabase.from('announcements').upsert(row);
      if (error) throw error;
    } catch (e) {
      if (!legacyDemoAuth) throw e;
      console.warn('saveAnnouncement: falling back to local save (non-fatal)', e);
      saveLocal();
    }
  },

  // 運営向け: お知らせの削除。失敗はローカル削除にフォールバック(非致命)。
  deleteAnnouncement: async (id: string): Promise<void> => {
    const deleteLocal = () => {
      const list = getOfflineData('announcements', defaultOfflineAnnouncements).filter((a: any) => a.id !== id);
      saveOfflineData('announcements', list);
    };
    if (legacyDemoAuth && useOfflineMock) return deleteLocal();
    try {
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) throw error;
    } catch (e) {
      if (!legacyDemoAuth) throw e;
      console.warn('deleteAnnouncement: falling back to local delete (non-fatal)', e);
      deleteLocal();
    }
  },

  completeTraining: async (staffId: string, trainingId: string): Promise<void> => {
    return callSupabase(
      async () => {
        const { data: staffData, error: staffError } = await supabase.from('staffs').select(legacyDemoAuth ? '*' : readColumns.staffs).eq('id', staffId).single();
        if (staffError || !staffData) return;
        const staff = mapStaff(staffData);

        const updatedTrainings = Array.from(new Set([...(staff.completedTrainings || []), trainingId]));
        await supabase.from('staffs').update({ completed_trainings: updatedTrainings }).eq('id', staffId);

        const { data: talentData } = await supabase.from('talents').select(legacyDemoAuth ? '*' : readColumns.talents).or(`name.eq."${staff.name}",masked_name.eq."${staff.maskedName}"`);
        if (talentData && talentData.length > 0) {
          for (const t of talentData) {
            const talent = mapTalent(t);
            const newTalentTrainings = Array.from(new Set([...(talent.completedTrainings || []), trainingId]));
            await supabase.from('talents').update({ completed_trainings: newTalentTrainings }).eq('id', talent.id);
          }
        }
      },
      () => {
        const staffs = getOfflineData('staffs', defaultOfflineStaffs);
        const staffIndex = staffs.findIndex((s: any) => s.id === staffId);
        if (staffIndex === -1) return;
        
        const staff = mapStaff(staffs[staffIndex]);
        const updatedTrainings = Array.from(new Set([...(staff.completedTrainings || []), trainingId]));
        staffs[staffIndex].completed_trainings = updatedTrainings;
        saveOfflineData('staffs', staffs);

        const talents = getOfflineData('talents', defaultOfflineTalents);
        for (let i = 0; i < talents.length; i++) {
          const talent = mapTalent(talents[i]);
          if (talent.name === staff.name || talent.maskedName === staff.maskedName) {
            const newTalentTrainings = Array.from(new Set([...(talent.completedTrainings || []), trainingId]));
            talents[i].completed_trainings = newTalentTrainings;
          }
        }
        saveOfflineData('talents', talents);
      }
    );
  },

  getContractTasks: async (): Promise<ContractTask[]> => {
    if (!legacyDemoAuth) return (await readAuditedRows('contract_tasks')).map(mapContractTask);
    return callSupabase(
      async () => {
        const { data, error } = await supabase.from('contract_tasks').select(legacyDemoAuth ? '*' : readColumns.contract_tasks);
        if (error) throw error;
        return data.map(mapContractTask);
      },
      () => {
        const list = getOfflineData('contract_tasks', defaultOfflineTasks);
        return list.map(mapContractTask);
      }
    );
  },

  saveContractTaskChat: async (
    taskId: string, 
    messages: any[], 
    jobTitle: string, 
    clientName: string, 
    workerName: string, 
    appliedJobIds?: string[],
    appliedJobStaffIds?: { [jobId: string]: string }
  ): Promise<void> => {
    return callSupabase(
      async () => {
        const { data } = await supabase.from('contract_tasks').select('evaluations').eq('id', taskId);
        const exists = data && data.length > 0;
        
        let evaluations: any = { messages };
        if (exists) {
          const existingEvals = data[0].evaluations || {};
          const mergedAppliedJobIds = Array.from(new Set([
            ...(existingEvals.appliedJobIds || []),
            ...(appliedJobIds || [])
          ]));
          const existingAppliedJobDates = existingEvals.appliedJobDates || {};
          const newAppliedJobDates: { [jobId: string]: string } = {};
          const todayStr = new Date().toISOString().split('T')[0];
          (appliedJobIds || []).forEach(jobId => {
            if (!existingAppliedJobDates[jobId]) newAppliedJobDates[jobId] = todayStr;
          });
          evaluations = {
            ...existingEvals,
            messages: mergeChatMessages(existingEvals.messages, messages),
            appliedJobIds: mergedAppliedJobIds,
            appliedJobDates: { ...existingAppliedJobDates, ...newAppliedJobDates },
            appliedJobStaffIds: {
              ...(existingEvals.appliedJobStaffIds || {}),
              ...(appliedJobStaffIds || {})
            }
          };
          evaluations = seedAppliedJobStates(evaluations, appliedJobIds, (evaluations as any).appliedJobStaffIds);
          const { error } = await supabase.from('contract_tasks').update({ evaluations }).eq('id', taskId);
          if (error) throw error;
        } else {
          const todayStr = new Date().toISOString().split('T')[0];
          evaluations.appliedJobIds = appliedJobIds || [];
          evaluations.appliedJobDates = Object.fromEntries((appliedJobIds || []).map(jobId => [jobId, todayStr]));
          evaluations.appliedJobStaffIds = appliedJobStaffIds || {};
          evaluations = seedAppliedJobStates(evaluations, appliedJobIds, (evaluations as any).appliedJobStaffIds);
          const isApplication = appliedJobIds && appliedJobIds.length > 0;
          // chat_<会社A>_<会社B> から2社を推定し、NOT NULL 制約対策として両IDを埋める。
          const chatParts = taskId.split('_');
          const partyA = chatParts[1];
          const partyB = chatParts[2];
          const row: any = {
            id: taskId,
            job_id: 'chat',
            job_title: jobTitle,
            client_name: clientName,
            worker_name: workerName,
            price: 0,
            date: new Date().toISOString().split('T')[0],
            status: isApplication ? 'applying' : 'confirmed',
            evaluations
          };
          if (partyA && partyB) {
            row.client_id = partyA;
            row.agency_id = partyB;
          }
          let { error } = await supabase.from('contract_tasks').insert([row]);
          if (error && (row.client_id || row.agency_id)) {
            // 列が存在しない等で失敗したら client_id/agency_id を外して再試行
            console.warn('contract_tasks insert failed, retrying without client_id/agency_id', error);
            const fallbackRow = { ...row };
            delete fallbackRow.client_id;
            delete fallbackRow.agency_id;
            ({ error } = await supabase.from('contract_tasks').insert([fallbackRow]));
          }
          if (error) throw error;
        }
      },
      () => {
        const list = getOfflineData('contract_tasks', defaultOfflineTasks);
        const index = list.findIndex((t: any) => t.id === taskId);
        let evaluations: any = { messages };
        if (index !== -1) {
          const existingEvals = list[index].evaluations || {};
          const mergedAppliedJobIds = Array.from(new Set([
            ...(existingEvals.appliedJobIds || []),
            ...(appliedJobIds || [])
          ]));
          const existingAppliedJobDates = existingEvals.appliedJobDates || {};
          const newAppliedJobDates: { [jobId: string]: string } = {};
          const todayStr = new Date().toISOString().split('T')[0];
          (appliedJobIds || []).forEach(jobId => {
            if (!existingAppliedJobDates[jobId]) newAppliedJobDates[jobId] = todayStr;
          });
          evaluations = {
            ...existingEvals,
            messages: mergeChatMessages(existingEvals.messages, messages),
            appliedJobIds: mergedAppliedJobIds,
            appliedJobDates: { ...existingAppliedJobDates, ...newAppliedJobDates },
            appliedJobStaffIds: {
              ...(existingEvals.appliedJobStaffIds || {}),
              ...(appliedJobStaffIds || {})
            }
          };
          evaluations = seedAppliedJobStates(evaluations, appliedJobIds, (evaluations as any).appliedJobStaffIds);
          list[index].evaluations = evaluations;
        } else {
          const todayStr = new Date().toISOString().split('T')[0];
          evaluations.appliedJobIds = appliedJobIds || [];
          evaluations.appliedJobDates = Object.fromEntries((appliedJobIds || []).map(jobId => [jobId, todayStr]));
          evaluations.appliedJobStaffIds = appliedJobStaffIds || {};
          evaluations = seedAppliedJobStates(evaluations, appliedJobIds, (evaluations as any).appliedJobStaffIds);
          const isApplication = appliedJobIds && appliedJobIds.length > 0;
          const row = {
            id: taskId,
            job_id: 'chat',
            job_title: jobTitle,
            client_name: clientName,
            worker_name: workerName,
            price: 0,
            date: new Date().toISOString().split('T')[0],
            status: isApplication ? 'applying' : 'confirmed',
            evaluations
          };
          list.push(row);
        }
        saveOfflineData('contract_tasks', list);
      }
    );
  },
  updateContractApproval: async (taskId: string, side: 'client' | 'agency', approved: boolean): Promise<void> => {
    return callSupabase(
      async () => {
        const updates: any = {};
        if (side === 'client') {
          updates.client_contract_approved_by_client = approved;
          updates.agency_contract_approved_by_client = approved;
        } else {
          updates.client_contract_approved_by_agency = approved;
          updates.agency_contract_approved_by_agency = approved;
        }
        const { error } = await supabase.from('contract_tasks').update(updates).eq('id', taskId);
        if (error) throw error;
      },
      () => {
        const list = getOfflineData('contract_tasks', defaultOfflineTasks);
        const index = list.findIndex((t: any) => t.id === taskId);
        if (index !== -1) {
          if (side === 'client') {
            list[index].clientContractApprovedByClient = approved;
            list[index].agencyContractApprovedByClient = approved;
          } else {
            list[index].clientContractApprovedByAgency = approved;
            list[index].agencyContractApprovedByAgency = approved;
          }
          saveOfflineData('contract_tasks', list);
        }
      }
    );
  },

  hasPastTransaction: async (cId1: string, cId2: string): Promise<boolean> => {
    if (!cId1 || !cId2 || cId1 === cId2) return false;
    const tasks = getOfflineData('contract_tasks', defaultOfflineTasks);
    return tasks.some((t: any) => {
      const isCompleted = t.status === 'completed';
      if (!isCompleted) return false;
      const tAgencyId = t.agency_id || (t.company_name?.includes('アルファ') ? 'alpha' : t.company_name?.includes('シグマ') ? 'sigma' : t.company_name?.includes('ベータ') ? 'beta' : t.company_name?.includes('ガンマ') ? 'gamma' : t.company_name?.includes('デルタ') ? 'delta' : t.company_name?.includes('SEALs') ? 'seals' : t.company_name?.includes('FreeR') ? 'freer' : t.company_name?.includes('ココラボ') ? 'cocolabo' : '');
      const tClientId = t.client_id || (t.client_name?.includes('アルファ') ? 'alpha' : t.client_name?.includes('シグマ') ? 'sigma' : t.client_name?.includes('ベータ') ? 'beta' : t.client_name?.includes('ガンマ') ? 'gamma' : t.client_name?.includes('デルタ') ? 'delta' : t.client_name?.includes('SEALs') ? 'seals' : t.client_name?.includes('FreeR') ? 'freer' : t.client_name?.includes('ココラボ') ? 'cocolabo' : '');
      return (tAgencyId === cId1 && tClientId === cId2) || (tAgencyId === cId2 && tClientId === cId1);
    });
  },

  updateContractTaskStatus: async (taskId: string, status: 'applying' | 'offered' | 'confirmed' | 'report_pending' | 'completed' | 'disputed' | 'rejected' | 'declined' | 'cancelled', additionalEvals?: any): Promise<void> => {
    return callSupabase(
      async () => {
        const { data: taskData } = await supabase.from('contract_tasks').select('evaluations').eq('id', taskId).single();
        let evaluations = taskData?.evaluations || {};
        if (additionalEvals) {
          evaluations = { ...evaluations, ...additionalEvals };
        }
        const { error } = await supabase.from('contract_tasks').update({ status, evaluations }).eq('id', taskId);
        if (error) throw error;
      },
      () => {
        const list = getOfflineData('contract_tasks', defaultOfflineTasks);
        const index = list.findIndex((t: any) => t.id === taskId);
        if (index !== -1) {
          let evaluations = list[index].evaluations || {};
          if (additionalEvals) {
            evaluations = { ...evaluations, ...additionalEvals };
          }
          list[index].status = status;
          list[index].evaluations = evaluations;
          saveOfflineData('contract_tasks', list);
        }
      }
    );
  },

  // 直接チャットへ自社メンバーを追加する。
  // evaluations.addedMembers に追記し、システムメッセージを1件加える。
  // 詳細は src/utils/chatMembers.ts。
  addChatMembers: async (
    taskId: string,
    newMembers: any[],
    systemMessages: any[],
  ): Promise<void> => {
    const applyLocal = (rawEvals: any) => {
      const evals = rawEvals || {};
      const existing: any[] = Array.isArray(evals.addedMembers) ? evals.addedMembers : [];
      const byId = new Map<string, any>(existing.map((m: any) => [m.staffId, m]));
      for (const m of newMembers) byId.set(m.staffId, m);
      const msgs = Array.isArray(evals.messages) ? evals.messages : [];
      const existingIds = new Set(msgs.map((x: any) => x && x.id).filter(Boolean));
      const appended = systemMessages.filter((x) => !x.id || !existingIds.has(x.id));
      return { ...evals, addedMembers: [...byId.values()], messages: [...msgs, ...appended] };
    };

    return callSupabase(
      async () => {
        const { data } = await supabase.from('contract_tasks').select('evaluations').eq('id', taskId).single();
        const evaluations = applyLocal(data?.evaluations);
        const { error } = await supabase.from('contract_tasks').update({ evaluations }).eq('id', taskId);
        if (error) throw error;
      },
      () => {
        const list = getOfflineData('contract_tasks', defaultOfflineTasks);
        const index = list.findIndex((t: any) => t.id === taskId);
        if (index !== -1) {
          list[index].evaluations = applyLocal(list[index].evaluations);
          saveOfflineData('contract_tasks', list);
        }
      },
    );
  },

  // 直接チャットから「メンバー追加」で参加した担当者を外す。
  removeChatMembers: async (
    taskId: string,
    staffIds: string[],
    systemMessages: any[],
  ): Promise<void> => {
    const applyLocal = (rawEvals: any) => {
      const evals = rawEvals || {};
      const remove = new Set(staffIds);
      const kept = (Array.isArray(evals.addedMembers) ? evals.addedMembers : []).filter((m: any) => !remove.has(m.staffId));
      const msgs = Array.isArray(evals.messages) ? evals.messages : [];
      const existingIds = new Set(msgs.map((x: any) => x && x.id).filter(Boolean));
      const appended = systemMessages.filter((x) => !x.id || !existingIds.has(x.id));
      return { ...evals, addedMembers: kept, messages: [...msgs, ...appended] };
    };
    return callSupabase(
      async () => {
        const { data } = await supabase.from('contract_tasks').select('evaluations').eq('id', taskId).single();
        const evaluations = applyLocal(data?.evaluations);
        const { error } = await supabase.from('contract_tasks').update({ evaluations }).eq('id', taskId);
        if (error) throw error;
      },
      () => {
        const list = getOfflineData('contract_tasks', defaultOfflineTasks);
        const index = list.findIndex((t: any) => t.id === taskId);
        if (index !== -1) {
          list[index].evaluations = applyLocal(list[index].evaluations);
          saveOfflineData('contract_tasks', list);
        }
      },
    );
  },

  // 案件ごとのステータス更新。evaluations.jobStates[jobId] を書き換え、
  // 後方互換のためチャット単位 status には「最も進んだ案件の状態」を書き戻す。
  // 詳細は src/utils/jobStates.ts / STATUS_MODEL.md §7。
  updateContractTaskJobStatus: async (
    taskId: string,
    jobId: string,
    status: EngagementStatusValue,
    options?: { contractApprovalRequired?: boolean; staffId?: string; offer?: any; sbSubcontractApproval?: import('../utils/jobStates').SbSubcontractApprovalRecord; additionalEvals?: any },
  ): Promise<void> => {
    const applyLocal = (rawEvals: any) => {
      let evals = rawEvals || {};
      if (options?.additionalEvals) evals = { ...evals, ...options.additionalEvals };
      const { evaluations, chatStatus } = applyJobState(evals, jobId, status, {
        contractApprovalRequired: options?.contractApprovalRequired,
        staffId: options?.staffId,
        offer: options?.offer,
        sbSubcontractApproval: options?.sbSubcontractApproval,
      });
      return { evaluations, chatStatus };
    };

    return callSupabase(
      async () => {
        const { data: taskData } = await supabase.from('contract_tasks').select('evaluations').eq('id', taskId).single();
        const { evaluations, chatStatus } = applyLocal(taskData?.evaluations);
        const { error } = await supabase
          .from('contract_tasks')
          .update({ status: chatStatus, evaluations })
          .eq('id', taskId);
        if (error) throw error;
      },
      () => {
        const list = getOfflineData('contract_tasks', defaultOfflineTasks);
        const index = list.findIndex((t: any) => t.id === taskId);
        if (index !== -1) {
          const { evaluations, chatStatus } = applyLocal(list[index].evaluations);
          list[index].status = chatStatus;
          list[index].evaluations = evaluations;
          saveOfflineData('contract_tasks', list);
        }
      },
    );
  },

  createContractTask: async (task: ContractTask): Promise<void> => {
    return callSupabase(
      async () => {
        const row = unmapContractTask(task);
        if (!legacyDemoAuth && ['offered','confirmed','working','report_pending','completed','disputed'].includes(task.status)) {
          row.sb_approval_id = await requireSbApproval(task.jobId, task.agency_id || '', task.sbStaffId || '');
        }
        row.evaluations = task.evaluations;
        const { error } = await supabase.from('contract_tasks').insert([row]);
        if (error) throw error;
      },
      () => {
        const list = getOfflineData('contract_tasks', defaultOfflineTasks);
        const row = unmapContractTask(task);
        row.evaluations = task.evaluations;
        list.push(row);
        saveOfflineData('contract_tasks', list);
      }
    );
  },

  submitReport: async (
    taskId: string,
    rating: number,
    comment: string,
    evaluatorName: string,
    target: 'byClient' | 'byWorker' | 'byStaffToField',
    hasLateness?: boolean
  ): Promise<ContractTask> => {
    return callSupabase(
      async () => {
        const { data: taskData, error: taskError } = await supabase.from('contract_tasks').select(legacyDemoAuth ? '*' : readColumns.contract_tasks).eq('id', taskId).single<{ job_id: string; evaluations: ContractTask['evaluations'] }>();
        if (taskError || !taskData) throw new Error('Task not found');
        const task = mapContractTask(taskData);

        const newEval: Evaluation = {
          id: `ev_${Date.now()}`,
          rating,
          comment,
          evaluatorName,
          createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
          hasLateness
        };

        if (!task.evaluations) task.evaluations = {};
        task.evaluations[target] = newEval;

        if (rating <= 2) {
          task.status = 'disputed';
        } else {
          task.status = 'completed';
        }

        const { error: updateError } = await supabase
          .from('contract_tasks')
          .update(unmapContractTask({ status: task.status, evaluations: task.evaluations }))
          .eq('id', taskId);

        if (updateError) throw updateError;

        if (target === 'byClient' && hasLateness !== undefined) {
          try {
            const { data: staffsData } = await supabase.from('staffs').select(legacyDemoAuth ? '*' : readColumns.staffs);
            if (staffsData) {
              const staffRow = staffsData.find((s: any) => s.name === task.workerName);
              if (staffRow) {
                const staff = mapStaff(staffRow);
                const nowStr = new Date().toISOString().split('T')[0];
                const timeStr = new Date().toTimeString().split(' ')[0].substring(0, 5);
                const statusSuffix = hasLateness ? 'LATE' : 'OK';
                const newLog = `ATTENDANCE_LOG_${nowStr}_${timeStr}_${statusSuffix}`;
                const updatedTrainings = [...(staff.completedTrainings || []), newLog];
                await supabase.from('staffs').update({ completed_trainings: updatedTrainings }).eq('id', staff.id);
              }
            }
          } catch (e) {
            console.error('Failed to append staff attendance log on report submit:', e);
          }
        }
        return task;
      },
      async () => {
        const list = getOfflineData('contract_tasks', defaultOfflineTasks);
        const index = list.findIndex((t: any) => t.id === taskId);
        if (index === -1) throw new Error('Task not found');
        const task = mapContractTask(list[index]);

        const newEval: Evaluation = {
          id: `ev_${Date.now()}`,
          rating,
          comment,
          evaluatorName,
          createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
          hasLateness
        };

        if (!task.evaluations) task.evaluations = {};
        task.evaluations[target] = newEval;

        if (rating <= 2) {
          task.status = 'disputed';
        } else {
          task.status = 'completed';
        }

        list[index].status = task.status;
        list[index].evaluations = task.evaluations;
        saveOfflineData('contract_tasks', list);

        if (target === 'byClient' && hasLateness !== undefined) {
          const staffs = getOfflineData('staffs', defaultOfflineStaffs);
          const staffIndex = staffs.findIndex((s: any) => s.name === task.workerName);
          if (staffIndex !== -1) {
            const staff = mapStaff(staffs[staffIndex]);
            const nowStr = new Date().toISOString().split('T')[0];
            const timeStr = new Date().toTimeString().split(' ')[0].substring(0, 5);
            const statusSuffix = hasLateness ? 'LATE' : 'OK';
            const newLog = `ATTENDANCE_LOG_${nowStr}_${timeStr}_${statusSuffix}`;
            const updatedTrainings = [...(staff.completedTrainings || []), newLog];
            staffs[staffIndex].completed_trainings = updatedTrainings;
            saveOfflineData('staffs', staffs);
          }
        }
        return task;
      }
    );
  },

  // 「内容確認中」(disputed)の解消。approve → completed / reject → disputed のまま理由更新。
  // STATUS_MODEL.md §3.2。案件ごとの jobStates も更新し、理由は evaluations.disputedReason に持つ。
  respondToDispute: async (taskId: string, action: 'approve' | 'reject', reason?: string): Promise<ContractTask> => {
    const nextStatus: EngagementStatusValue = action === 'approve' ? 'completed' : 'disputed';
    const rejectReason = reason || '内容が事実と異なります。';

    const buildEvals = (rawEvals: any, jobId: string | undefined) => {
      let evals = rawEvals || {};
      if (action === 'reject') evals = { ...evals, disputedReason: rejectReason };
      if (jobId && jobId !== 'chat') {
        const { evaluations, chatStatus } = applyJobState(evals, jobId, nextStatus);
        return { evaluations, chatStatus };
      }
      return { evaluations: evals, chatStatus: nextStatus };
    };

    return callSupabase(
      async () => {
        const { data: taskData, error: taskError } = await supabase.from('contract_tasks').select(legacyDemoAuth ? '*' : readColumns.contract_tasks).eq('id', taskId).single<{ job_id: string; evaluations: ContractTask['evaluations'] }>();
        if (taskError || !taskData) throw new Error('Task not found');
        const { evaluations, chatStatus } = buildEvals(taskData.evaluations, taskData.job_id);
        const { error: updateError } = await supabase
          .from('contract_tasks')
          .update({ status: chatStatus, evaluations })
          .eq('id', taskId);
        if (updateError) throw updateError;
        const task = mapContractTask({ ...taskData, status: chatStatus, evaluations });
        if (action === 'reject') task.disputedReason = rejectReason;
        return task;
      },
      async () => {
        const list = getOfflineData('contract_tasks', defaultOfflineTasks);
        const index = list.findIndex((t: any) => t.id === taskId);
        if (index === -1) throw new Error('Task not found');
        const { evaluations, chatStatus } = buildEvals(list[index].evaluations, list[index].job_id || list[index].jobId);
        list[index].status = chatStatus;
        list[index].evaluations = evaluations;
        saveOfflineData('contract_tasks', list);
        const task = mapContractTask(list[index]);
        if (action === 'reject') task.disputedReason = rejectReason;
        return task;
      }
    );
  },

  getUsers: async (): Promise<User[]> => {
    if (!legacyDemoAuth) return (await readAuditedRows('companies')).map(mapUser);
    return callSupabase(
      async () => {
        const { data, error } = await supabase.from('companies').select(legacyDemoAuth ? '*' : readColumns.companies);
        if (error) throw error;
        return data.map(mapUser);
      },
      () => {
        const list = getOfflineData('companies', defaultOfflineCompanies);
        return list.map(mapUser);
      }
    );
  },

  registerCompany: async (company: Omit<User, 'id'>): Promise<User> => {
    const id = 'c' + Date.now();
    const newUser: User = { ...company, id, status: 'pending', role: 'contractor' };
    if (!legacyDemoAuth) throw new Error('会社登録は管理者による招待が必要です。');
    localStorage.setItem('company_status_' + id, 'pending');
    if (newUser.invoiceNumber) {
      localStorage.setItem('company_invoice_' + id, newUser.invoiceNumber);
    }
    if (newUser.representativeName) {
      localStorage.setItem('company_rep_' + id, newUser.representativeName);
    }

    return callSupabase(
      async () => {
        const row = {
          id: newUser.id,
          name: newUser.name,
          role: newUser.role,
          login_id: newUser.loginId,
          password: newUser.password,
          status: newUser.status,
          invoice_number: newUser.invoiceNumber,
          representative_name: newUser.representativeName
        };
        const { error } = await supabase.from('companies').insert([row]);
        if (error) {
          const fallbackRow = {
            id: row.id,
            name: row.name,
            role: row.role,
            login_id: row.login_id,
            password: row.password
          };
          const { error: errorFallback } = await supabase.from('companies').insert([fallbackRow]);
          if (errorFallback) throw errorFallback;
        }
        return newUser;
      },
      () => {
        const list = getOfflineData('companies', defaultOfflineCompanies);
        const row = {
          id: newUser.id,
          name: newUser.name,
          role: newUser.role,
          login_id: newUser.loginId,
          password: newUser.password,
          status: newUser.status,
          invoice_number: newUser.invoiceNumber,
          representative_name: newUser.representativeName
        };
        list.push(row);
        saveOfflineData('companies', list);
        return newUser;
      }
    );
  },

  updateStaffRole: async (staffId: string, role: 'admin' | 'staff'): Promise<void> => {
    if (!legacyDemoAuth) throw new Error('権限変更は管理者のサーバー処理が必要です。');
    localStorage.setItem('staff_role_' + staffId, role);
    return callSupabase(
      async () => {
        await supabase.from('staffs').update({ role }).eq('id', staffId);
      },
      () => {
        const list = getOfflineData('staffs', defaultOfflineStaffs);
        const index = list.findIndex((s: any) => s.id === staffId);
        if (index !== -1) {
          list[index].role = role;
          saveOfflineData('staffs', list);
        }
      }
    );
  },

  updateStaff: async (staffId: string, staff: Partial<Staff>): Promise<void> => {
    if (legacyDemoAuth && staff.role) {
      localStorage.setItem('staff_role_' + staffId, staff.role);
    }
    if (legacyDemoAuth && staff.loginId) {
      localStorage.setItem('staff_login_' + staffId, staff.loginId);
    }
    if (legacyDemoAuth && staff.password) {
      localStorage.setItem('staff_password_' + staffId, staff.password);
    }

    return callSupabase(
      async () => {
        const { data: existingStaffData } = await supabase.from('staffs').select('completed_trainings').eq('id', staffId).single();
        let completedTrainings: string[] = [];
        if (existingStaffData && existingStaffData.completed_trainings) {
          completedTrainings = [...existingStaffData.completed_trainings];
        }

        if ('furigana' in staff) {
          completedTrainings = completedTrainings.filter((t: any) => !t.startsWith('STAFF_FURIGANA_'));
          if (staff.furigana) completedTrainings.push('STAFF_FURIGANA_' + staff.furigana);
        }
        if ('commuteMethod' in staff) {
          completedTrainings = completedTrainings.filter((t: any) => !t.startsWith('STAFF_COMMUTE_'));
          if (staff.commuteMethod) completedTrainings.push('STAFF_COMMUTE_' + staff.commuteMethod);
        }
        if ('gender' in staff) {
          completedTrainings = completedTrainings.filter((t: any) => !t.startsWith('STAFF_GENDER_'));
          if (staff.gender) completedTrainings.push('STAFF_GENDER_' + staff.gender);
        }
        if ('birthday' in staff) {
          completedTrainings = completedTrainings.filter((t: any) => !t.startsWith('STAFF_BIRTHDAY_'));
          if (staff.birthday) completedTrainings.push('STAFF_BIRTHDAY_' + staff.birthday);
        }

        const updatedStaff: Partial<Staff> = { ...staff, completedTrainings };
        const row = unmapStaff(updatedStaff);
        const { error } = await supabase.from('staffs').update(row).eq('id', staffId);
        if (error) {
          const fallbackRow = { ...row };
          delete fallbackRow.role;
          delete fallbackRow.login_id;
          delete fallbackRow.password;
          const { error: error2 } = await supabase.from('staffs').update(fallbackRow).eq('id', staffId);
          if (error2) throw error2;
        }
      },
      () => {
        const list = getOfflineData('staffs', defaultOfflineStaffs);
        const index = list.findIndex((s: any) => s.id === staffId);
        if (index === -1) return;

        let completedTrainings: string[] = list[index].completed_trainings || [];
        if ('furigana' in staff) {
          completedTrainings = completedTrainings.filter((t: any) => !t.startsWith('STAFF_FURIGANA_'));
          if (staff.furigana) completedTrainings.push('STAFF_FURIGANA_' + staff.furigana);
        }
        if ('commuteMethod' in staff) {
          completedTrainings = completedTrainings.filter((t: any) => !t.startsWith('STAFF_COMMUTE_'));
          if (staff.commuteMethod) completedTrainings.push('STAFF_COMMUTE_' + staff.commuteMethod);
        }
        if ('gender' in staff) {
          completedTrainings = completedTrainings.filter((t: any) => !t.startsWith('STAFF_GENDER_'));
          if (staff.gender) completedTrainings.push('STAFF_GENDER_' + staff.gender);
        }
        if ('birthday' in staff) {
          completedTrainings = completedTrainings.filter((t: any) => !t.startsWith('STAFF_BIRTHDAY_'));
          if (staff.birthday) completedTrainings.push('STAFF_BIRTHDAY_' + staff.birthday);
        }

        const updatedStaff: Partial<Staff> = { ...staff, completedTrainings };
        const rowUpdates = unmapStaff(updatedStaff);
        list[index] = { ...list[index], ...rowUpdates };
        saveOfflineData('staffs', list);
      }
    );
  },

  toggleFavoriteJob: async (userId: string, jobId: string): Promise<string[]> => {
    let currentFavorites: string[] = [];
    try {
      currentFavorites = JSON.parse(localStorage.getItem('company_favorite_jobs_' + userId) || '[]');
    } catch(e) {}
    
    if (currentFavorites.includes(jobId)) {
      currentFavorites = currentFavorites.filter(id => id !== jobId);
    } else {
      currentFavorites.push(jobId);
    }
    localStorage.setItem('company_favorite_jobs_' + userId, JSON.stringify(currentFavorites));
    return currentFavorites;
  },

  toggleFavoriteTalent: async (userId: string, talentId: string): Promise<string[]> => {
    let currentFavorites: string[] = [];
    try {
      currentFavorites = JSON.parse(localStorage.getItem('company_favorite_talents_' + userId) || '[]');
    } catch(e) {}
    
    if (currentFavorites.includes(talentId)) {
      currentFavorites = currentFavorites.filter(id => id !== talentId);
    } else {
      currentFavorites.push(talentId);
    }
    localStorage.setItem('company_favorite_talents_' + userId, JSON.stringify(currentFavorites));
    return currentFavorites;
  },

  updateUser: async (user: User): Promise<void> => {
    if (!legacyDemoAuth) throw new Error('会社情報の更新はサーバー側の保存処理を準備中です。');
    localStorage.setItem('company_favorite_jobs_' + user.id, JSON.stringify(user.favoriteJobIds || []));
    localStorage.setItem('company_favorite_talents_' + user.id, JSON.stringify(user.favoriteTalentIds || []));
    localStorage.setItem('company_favorite_folders_' + user.id, JSON.stringify(user.favoriteFolders || []));
    
    // In a real app we would update Supabase, but for now we rely on localStorage
    // since other mock fields are largely based on local overrides.
    // Let's also update the local offline list just in case.
    const list = getOfflineData('companies', defaultOfflineCompanies);
    const index = list.findIndex((c: any) => c.id === user.id);
    if (index !== -1) {
      list[index] = { ...list[index], ...user };
      saveOfflineData('companies', list);
    }
  },

  updateCompanyStatus: async (companyId: string, status: 'pending' | 'approved' | 'rejected'): Promise<void> => {
    if (!legacyDemoAuth) throw new Error('会社承認は管理者のサーバー処理が必要です。');
    localStorage.setItem('company_status_' + companyId, status);
    return callSupabase(
      async () => {
        await supabase.from('companies').update({ status }).eq('id', companyId);
      },
      () => {
        const list = getOfflineData('companies', defaultOfflineCompanies);
        const index = list.findIndex((c: any) => c.id === companyId);
        if (index !== -1) {
          list[index].status = status;
          saveOfflineData('companies', list);
        }
      }
    );
  },

  seedStaffAttendanceLogs: async (): Promise<void> => {
    return callSupabase(
      async () => {
        const { data: staffs, error } = await supabase.from('staffs').select(legacyDemoAuth ? '*' : readColumns.staffs);
        if (error || !staffs) return;
        for (const sRow of staffs) {
          const staff = mapStaff(sRow);
          const attendanceLogs = (staff.completedTrainings || []).filter((t: any) => t.startsWith('ATTENDANCE_LOG_'));
          if (attendanceLogs.length >= 8) continue;

          const newLogs: string[] = [];
          const times = ['08:50', '08:53', '08:55', '08:57', '08:58', '08:59', '09:00', '09:01', '09:02', '09:03', '09:05', '09:08'];
          const dates = [
            '2026-06-05', '2026-06-04', '2026-06-03', '2026-06-02', '2026-06-01',
            '2026-05-29', '2026-05-28', '2026-05-27', '2026-05-26', '2026-05-25',
            '2026-05-22', '2026-05-21', '2026-05-20', '2026-05-19', '2026-05-18',
            '2026-05-15', '2026-05-14', '2026-05-13', '2026-05-12', '2026-05-11'
          ];
          
          const shuffled = [...dates].sort(() => 0.5 - Math.random());
          const selectedDates = shuffled.slice(0, 15);
          selectedDates.forEach(date => {
            const randTime = times[Math.floor(Math.random() * times.length)];
            const isLate = randTime > '09:00';
            newLogs.push(`ATTENDANCE_LOG_${date}_${randTime}_${isLate ? 'LATE' : 'OK'}`);
          });

          const cleanTrainings = (staff.completedTrainings || []).filter((t: any) => !t.startsWith('ATTENDANCE_LOG_'));
          const updatedTrainings = [...cleanTrainings, ...newLogs];
          
          await supabase.from('staffs').update({ completed_trainings: updatedTrainings }).eq('id', staff.id);
        }
      },
      () => {
        const staffs = getOfflineData('staffs', defaultOfflineStaffs);
        for (let i = 0; i < staffs.length; i++) {
          const staff = mapStaff(staffs[i]);
          const attendanceLogs = (staff.completedTrainings || []).filter((t: any) => t.startsWith('ATTENDANCE_LOG_'));
          if (attendanceLogs.length >= 8) continue;

          const newLogs: string[] = [];
          const times = ['08:50', '08:53', '08:55', '08:57', '08:58', '08:59', '09:00', '09:01', '09:02', '09:03', '09:05', '09:08'];
          const dates = [
            '2026-06-05', '2026-06-04', '2026-06-03', '2026-06-02', '2026-06-01',
            '2026-05-29', '2026-05-28', '2026-05-27', '2026-05-26', '2026-05-25',
            '2026-05-22', '2026-05-21', '2026-05-20', '2026-05-19', '2026-05-18',
            '2026-05-15', '2026-05-14', '2026-05-13', '2026-05-12', '2026-05-11'
          ];
          
          const shuffled = [...dates].sort(() => 0.5 - Math.random());
          const selectedDates = shuffled.slice(0, 15);
          selectedDates.forEach(date => {
            const randTime = times[Math.floor(Math.random() * times.length)];
            const isLate = randTime > '09:00';
            newLogs.push(`ATTENDANCE_LOG_${date}_${randTime}_${isLate ? 'LATE' : 'OK'}`);
          });

          const cleanTrainings = (staff.completedTrainings || []).filter((t: any) => !t.startsWith('ATTENDANCE_LOG_'));
          staffs[i].completed_trainings = [...cleanTrainings, ...newLogs];
        }
        saveOfflineData('staffs', staffs);
      }
    );
  },

  getUserAverageRating: async (userId: string): Promise<{ average: number, count: number }> => {
    const tasks = await api.getContractTasks();
    let total = 0;
    let count = 0;
    tasks.forEach(t => {
      // client_id -> evaluated byWorker
      if (t.client_id === userId && t.evaluations?.byWorker) {
        total += t.evaluations.byWorker.rating;
        count++;
      }
      // agency_id -> evaluated byClient
      if (t.agency_id === userId && t.evaluations?.byClient) {
        total += t.evaluations.byClient.rating;
        count++;
      }
    });
    return { average: count > 0 ? Number((total / count).toFixed(1)) : 0, count };
  }
};
