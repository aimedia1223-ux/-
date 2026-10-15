// ContractTask は「直接チャット(応募・オファー・商談)」「現場グループチャット」「実契約」の
// 3種類を1レコードで兼務している。その判別を1箇所に集約する。
// (ContractTask 型分離の中間ステップ。将来的には別テーブル/別型に分ける。)

export type ContractTaskKind = 'direct_chat' | 'group_chat' | 'contract';

interface TaskIdLike {
  id: string;
  jobId?: string;
}

/**
 * ID の形から種類を判定する。
 * - `chat_group_*` / `chat_au_group` … 現場グループチャット
 * - `chat_<会社A>_<会社B>` … 2社間の直接チャット(応募・オファー・商談)
 * - それ以外(`ct_*` や実 job_id を持つレコード) … 実契約
 */
export function getContractTaskKind(task: TaskIdLike): ContractTaskKind {
  if (task.id.startsWith('chat_group_') || task.id === 'chat_au_group') return 'group_chat';
  if (task.id.startsWith('chat_')) return 'direct_chat';
  return 'contract';
}

export const isDirectChat = (task: TaskIdLike): boolean => getContractTaskKind(task) === 'direct_chat';
export const isGroupChat = (task: TaskIdLike): boolean => getContractTaskKind(task) === 'group_chat';
export const isContractRecord = (task: TaskIdLike): boolean => getContractTaskKind(task) === 'contract';
