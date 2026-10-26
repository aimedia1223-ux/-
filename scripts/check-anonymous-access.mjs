import { createClient } from '@supabase/supabase-js';
import { loadEnvFile } from 'node:process';

loadEnvFile('.env.local');
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('ローカル接続設定が未入力です。');
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
});
const results = [];
try {
  const settings = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: key }, signal: AbortSignal.timeout(15000),
  });
  results.push({ check: 'Auth接続・公開用キー有効', passed: settings.status === 200, status: settings.status });
  // 本文を表示・保存しない。拒否は権限不足コード42501だけを成功とする。
  const identity = await client.rpc('connexy_current_identity');
  results.push({ check: '匿名の本人情報RPCを拒否', passed: identity.error?.code === '42501', code: identity.error?.code ?? null });
  for (const table of ['companies', 'staffs', 'jobs', 'talents', 'contract_tasks', 'announcements', 'connexy_auth_memberships']) {
    const column = table === 'connexy_auth_memberships' ? 'auth_user_id' : 'id';
    const response = await client.from(table).select(column).limit(1);
    results.push({ check: `匿名の${table}取得を拒否`, passed: response.error?.code === '42501', code: response.error?.code ?? null });
  }
  console.log(JSON.stringify(results, null, 2));
  process.exitCode = results.every(result => result.passed) ? 0 : 1;
} catch {
  console.log('接続確認に失敗しました。ネットワークまたは設定を確認してください。');
  process.exitCode = 1;
}
