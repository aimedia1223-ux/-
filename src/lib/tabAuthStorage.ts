type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type TabAuthOptions = {
  session: () => SessionStore;
  persistent: () => Pick<Storage, 'removeItem'>;
  randomId: () => string;
};

// トークンの保存先をsessionStorageに限定。使えなければメモリだけとしlocalStorageへ戻さない。
// ブラウザのタブ復元・複製ではsessionStorage自体が引き継がれることがある。
export function createTabAuthStorage(projectUrl: string, options: TabAuthOptions) {
  const project = new URL(projectUrl).hostname.split('.')[0];
  const marker = `connexy-auth-tab:${project}`;
  let session: SessionStore;
  const memory = new Map<string, string>();
  try {
    session = options.session();
    const probe = `${marker}:probe`;
    session.setItem(probe, '1');
    session.removeItem(probe);
  } catch {
    session = {
      getItem: key => memory.get(key) ?? null,
      setItem: (key, value) => { memory.set(key, value); },
      removeItem: key => { memory.delete(key); },
    };
  }
  let tabId = session.getItem(marker);
  if (!tabId || !/^[0-9a-f-]{36}$/i.test(tabId)) {
    tabId = options.randomId();
    session.setItem(marker, tabId);
  }
  // SDK既定のBroadcastChannelを別タブと共有しないため、タブ別のキーを使う。
  const storageKey = `connexy-tab-auth-${project}-${tabId}`;
  // 旧版の認証情報だけを撤去。業務データ・監査・他アプリの保存には触れない。
  // 使用不可の場合も旧トークンを読んだり新しい保存に移したりしない。
  const previousKey = `sb-${project}-auth-token`;
  try {
    const persistent = options.persistent();
    for (const key of [previousKey, `${previousKey}-code-verifier`, `${previousKey}-user`]) persistent.removeItem(key);
  } catch { /* 旧ストレージを参照しない */ }
  return { storage: session, storageKey };
}
