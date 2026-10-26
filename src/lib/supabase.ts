import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabasePublicKey } from './supabaseConfig';
import { createTabAuthStorage } from './tabAuthStorage';

const tabAuth = createTabAuthStorage(supabaseUrl, {
  session: () => window.sessionStorage,
  persistent: () => window.localStorage,
  randomId: () => crypto.randomUUID(),
});

// 接続情報はリポジトリへ直接書かず、ローカルまたはGitHub Secretsから注入する。
// 未設定時は新しい個人認証を利用できない。認証ではデモへ切り替えない。
export const supabase = createClient(supabaseUrl, supabasePublicKey, {
  auth: {
    storage: tabAuth.storage,
    storageKey: tabAuth.storageKey,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
});
