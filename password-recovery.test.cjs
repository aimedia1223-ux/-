const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/passwordRecovery.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: api, URLSearchParams });

test('通常アクセスはメール送信画面、無効なリンクは設定不可', () => {
  assert.equal(api.readRecoveryLink('').kind, 'request');
  for (const hash of ['#type=recovery', '#access_token=x', '#type=signup&access_token=x&refresh_token=y', '#error_code=otp_expired']) {
    assert.equal(api.readRecoveryLink(hash).kind, 'invalid');
  }
});
test('回復リンクがない場合は既存のログイン状態を利用しない', async () => {
  let calls = 0;
  await assert.rejects(api.verifyRecoveryLink({ setSession: async () => { calls++; }, getUser: async () => { calls++; } }, ''));
  assert.equal(calls, 0);
});
test('無効・期限切れトークンなら本人確認へ進まない', async () => {
  let calls = 0;
  await assert.rejects(api.verifyRecoveryLink({ setSession: async () => ({ error: {} }), getUser: async () => { calls++; } }, '#type=recovery&access_token=x&refresh_token=y'));
  assert.equal(calls, 0);
});
test('メールの回復トークンを検証した本人を設定対象にする', async () => {
  const user = await api.verifyRecoveryLink({
    setSession: async tokens => { assert.equal(tokens.access_token, 'x'); return { error: null }; },
    getUser: async () => ({ data: { user: { id: 'account-b' } }, error: null }),
  }, '#type=recovery&access_token=x&refresh_token=y');
  assert.equal(user.id, 'account-b');
});
test('サーバーの本人確認失敗時は設定不可', async () => {
  await assert.rejects(api.verifyRecoveryLink({
    setSession: async () => ({ error: null }), getUser: async () => ({ error: {}, data: { user: null } }),
  }, '#type=recovery&access_token=x&refresh_token=y'));
});
test('短いパスワードと確認不一致を拒否', () => {
  assert.ok(api.validateNewPassword('short', 'short'));
  assert.ok(api.validateNewPassword('long-enough-password', 'different-password'));
  assert.equal(api.validateNewPassword('long-enough-password', 'long-enough-password'), null);
});
