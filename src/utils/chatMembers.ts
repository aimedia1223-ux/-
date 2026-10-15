// 直接チャットへの「自社メンバー追加」機能。
// 追加された担当者は evaluations.addedMembers に記録される。
// 追加時に過去のトークを共有しない選択をした場合は、参加時点の最終メッセージIDを
// joinAfterMsgId として残し、その担当者にはそれ以降のメッセージだけを見せる。

export interface AddedChatMember {
  /** 追加された担当者のスタッフID */
  staffId: string;
  /** その担当者の所属会社ID(チャットの2社のいずれか) */
  companyId: string;
  name: string;
  addedByStaffId?: string;
  addedByName: string;
  /** ISO 8601 */
  addedAt: string;
  /** 追加した側が過去のトーク共有を選んだか */
  historyShared: boolean;
  /** historyShared=false のとき、参加時点の最終メッセージID(これ以降を表示) */
  joinAfterMsgId: string | null;
}

interface MemberEvals {
  addedMembers?: AddedChatMember[];
}

export function getAddedMembers(evaluations: unknown): AddedChatMember[] {
  const e = (evaluations || {}) as MemberEvals;
  return Array.isArray(e.addedMembers) ? e.addedMembers : [];
}

/** 追加メンバーとしてこのチャットに参加している全スタッフID */
export function getAddedMemberStaffIds(evaluations: unknown): string[] {
  return getAddedMembers(evaluations).map((m) => m.staffId).filter(Boolean);
}

/** 指定スタッフが「過去のトーク非共有」で追加されたメンバーなら、表示開始位置のメッセージIDを返す。 */
export function getHistoryCutoffMsgId(evaluations: unknown, staffId: string | undefined): string | null {
  if (!staffId) return null;
  const m = getAddedMembers(evaluations).find((x) => x.staffId === staffId);
  if (m && !m.historyShared) return m.joinAfterMsgId ?? null;
  return null;
}

/** addedMembers に1件追加した新しい配列を返す(同一スタッフIDは上書き)。 */
export function upsertAddedMember(existing: AddedChatMember[], member: AddedChatMember): AddedChatMember[] {
  const rest = (existing || []).filter((m) => m.staffId !== member.staffId);
  return [...rest, member];
}
