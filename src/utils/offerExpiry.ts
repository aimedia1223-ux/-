// 内定オファーの有効期限。
// オファー送信時に evaluations.offeredAt / offerExpiresAt を記録し、
// 期限切れのオファーは承諾できないようにする。

/** オファーの既定有効日数 */
export const OFFER_VALID_DAYS = 7;
/** 「期限が近い」とみなす残り日数 */
export const OFFER_SOON_DAYS = 2;

export interface OfferExpiryState {
  /** 有効期限の情報を持っているか(旧データは false) */
  hasExpiry: boolean;
  expiresAt: Date | null;
  isExpired: boolean;
  /** 期限が近い(残り OFFER_SOON_DAYS 日以内)か */
  isSoon: boolean;
  /** 残り日数(切り上げ。期限切れは 0) */
  daysLeft: number;
  /** 表示用ラベル。例: "有効期限: 2026/09/19（あと6日）" / "有効期限切れ" */
  label: string;
}

/** 送信時刻から有効期限(ISO文字列)を計算する。 */
export function calcOfferExpiresAt(offeredAtIso: string, validDays: number = OFFER_VALID_DAYS): string {
  const base = new Date(offeredAtIso);
  base.setDate(base.getDate() + validDays);
  return base.toISOString();
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/** evaluations(offeredAt / offerExpiresAt を含む)から期限状態を求める。 */
export function getOfferExpiryState(
  evals: { offeredAt?: string; offerExpiresAt?: string } | null | undefined,
  now: Date = new Date(),
): OfferExpiryState {
  const iso = evals?.offerExpiresAt
    || (evals?.offeredAt ? calcOfferExpiresAt(evals.offeredAt) : undefined);

  if (!iso) {
    return { hasExpiry: false, expiresAt: null, isExpired: false, isSoon: false, daysLeft: 0, label: '' };
  }

  const expiresAt = new Date(iso);
  const msLeft = expiresAt.getTime() - now.getTime();
  const isExpired = msLeft <= 0;
  const daysLeft = isExpired ? 0 : Math.ceil(msLeft / 86400000);
  const isSoon = !isExpired && daysLeft <= OFFER_SOON_DAYS;

  const label = isExpired
    ? '有効期限切れ'
    : `有効期限: ${formatDate(expiresAt)}（あと${daysLeft}日）`;

  return { hasExpiry: true, expiresAt, isExpired, isSoon, daysLeft, label };
}
