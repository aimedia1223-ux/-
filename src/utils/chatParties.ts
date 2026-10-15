// 直接チャット(`chat_<会社A>_<会社B>`)の相手会社を解決するヘルパー。
// 経費申請まわりの各ハンドラに同じ文字列分割ロジックがコピーされていたのを集約。

/** チャットIDから、自分でない側の会社IDを返す(解決できなければ null)。 */
export function getOpponentCompanyId(chatId: string | undefined, currentUserId: string): string | null {
  if (!chatId) return null;
  const parts = chatId.split('_');
  // 期待形式: ['chat', '<会社A>', '<会社B>']
  if (parts.length < 3) return null;
  return parts[1] === currentUserId ? parts[2] : parts[1];
}

/** チャットの相手会社名を返す(見つからなければ fallback)。 */
export function getOpponentCompanyName(
  chatId: string | undefined,
  currentUserId: string,
  companies: Array<{ id: string; name: string }>,
  fallback = 'パートナー会社',
): string {
  const id = getOpponentCompanyId(chatId, currentUserId);
  if (!id) return fallback;
  return companies.find((c) => c.id === id)?.name || fallback;
}
