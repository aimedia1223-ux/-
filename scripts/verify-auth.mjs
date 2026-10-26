import { createClient } from '@supabase/supabase-js';
import { existsSync, writeFileSync } from 'node:fs';

// 接続先は検証専用の設定からのみ読む。アプリの本番設定を自動流用しない。
if (existsSync('.env.auth-test.local')) process.loadEnvFile('.env.auth-test.local');
const required = ['AUTH_TEST_URL', 'AUTH_TEST_ANON_KEY', 'AUTH_TEST_EMAIL_A',
  'AUTH_TEST_PASSWORD_A', 'AUTH_TEST_COMPANY_A', 'AUTH_TEST_STAFF_A',
  'AUTH_TEST_EMAIL_B', 'AUTH_TEST_PASSWORD_B', 'AUTH_TEST_COMPANY_B', 'AUTH_TEST_STAFF_B'];
const missing = required.filter(name => !process.env[name]?.trim());
if (missing.length) {
  console.log(`未設定: ${missing.join(', ')}。秘密の値は画面やチャットへ貼り付けず、.env.auth-test.localに設定してください。`);
  process.exit(2);
}
if (process.env.AUTH_TEST_EMAIL_A === process.env.AUTH_TEST_EMAIL_B ||
    process.env.AUTH_TEST_COMPANY_A === process.env.AUTH_TEST_COMPANY_B) {
  console.log('別会社に所属する別々の架空アカウントA/Bが必要です。');
  process.exit(2);
}
const url = new URL(process.env.AUTH_TEST_URL);
if (url.protocol !== 'https:' || url.username || url.password) {
  console.log('検証先は認証情報を含まないHTTPS URLにしてください。');
  process.exit(2);
}
if (process.argv.includes('--check')) {
  console.log('検証設定あり。ネットワーク接続は未実施。');
  process.exit(0);
}
if (process.env.AUTH_TEST_CONFIRM_DISPOSABLE !== 'true') {
  console.log('架空データ専用の検証先を確認し、AUTH_TEST_CONFIRM_DISPOSABLE=trueを設定してください。');
  process.exit(2);
}
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } };
const client = () => createClient(url.href, process.env.AUTH_TEST_ANON_KEY, options);
const results = [];
const clients = [];
function check(name, condition) {
  results.push({ name, passed: Boolean(condition) });
  if (!condition) throw new Error(name);
}
let failed = false;
try {
  const anon = client();
  const unauthenticated = await anon.rpc('connexy_current_identity');
  check('未認証では本人情報RPCを実行不可', Boolean(unauthenticated.error));
  for (const suffix of ['A', 'B']) {
    const authenticated = client();
    clients.push(authenticated);
    const login = await authenticated.auth.signInWithPassword({
      email: process.env[`AUTH_TEST_EMAIL_${suffix}`], password: process.env[`AUTH_TEST_PASSWORD_${suffix}`],
    });
    check(`${suffix}: 個人認証成功`, !login.error && Boolean(login.data.user));
    const identity = await authenticated.rpc('connexy_current_identity');
    check(`${suffix}: 所属は期待した会社・スタッフのみ`, !identity.error && identity.data?.length === 1 &&
      identity.data[0].company_id === process.env[`AUTH_TEST_COMPANY_${suffix}`] &&
      identity.data[0].staff_id === process.env[`AUTH_TEST_STAFF_${suffix}`] &&
      identity.data[0].status === 'approved');
    const membership = await authenticated.from('connexy_auth_memberships').select('auth_user_id');
    check(`${suffix}: 所属管理表を直接取得不可`, Boolean(membership.error));
    const logout = await authenticated.auth.signOut({ scope: 'local' });
    check(`${suffix}: ログアウト成功`, !logout.error);
    const afterLogout = await authenticated.rpc('connexy_current_identity');
    check(`${suffix}: ログアウト後に本人情報取得不可`, Boolean(afterLogout.error));
  }
} catch {
  failed = true;
  // SDKの生エラーやレスポンスを出力しない（個人情報・トークン混入防止）。
  console.log('検証失敗。接続先・SQL適用・アカウント・所属設定を確認してください。');
} finally {
  for (const authenticated of clients) {
    try { await authenticated.auth.signOut({ scope: 'local' }); } catch { /* 結果を上書きしない */ }
  }
  for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}`);
  writeFileSync('auth-verification.local.json', JSON.stringify({
    testedAt: new Date().toISOString(), passed: !failed, checks: results,
    scope: 'Auth本人情報RPCのみ。一般テーブルの会社・案件別RLSは対象外。',
  }, null, 2));
}
process.exitCode = failed ? 1 : 0;
