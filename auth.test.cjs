const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const vm = require('node:vm');
const fs = require('node:fs');

function setup({ identity, user = { id: 'auth-1' }, rpcError = null, loginError = null, dev = false, demo = 'true', aal = 'aal2', next = 'aal2', mfaError = null, factors = [], mfaRequired = true, policyError = null } = {}) {
  const calls = [];
  const supabase = {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({data: {currentLevel: aal, nextLevel: next}, error: mfaError}),
        listFactors: async () => ({data: {totp: factors}, error: null}),
      },
      getUser: async () => ({ data: { user }, error: null }),
      signInWithPassword: async (input) => { calls.push(input); return { error: loginError }; },
      signOut: async () => { calls.push('signOut'); return { error: null }; },
    },
    rpc: async (name) => { calls.push(name); return name === 'connexy_mfa_is_required' ? {data:mfaRequired,error:policyError} : { data: identity ? [identity] : [], error: rpcError }; },
  };
  const source = fs.readFileSync('src/lib/auth.ts', 'utf8')
    .replaceAll('import.meta.env.DEV', JSON.stringify(dev))
    .replaceAll('import.meta.env.VITE_ENABLE_LEGACY_DEMO_AUTH', JSON.stringify(demo));
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => name === './sessionActivity'
    ? { isSessionLocked: () => false, markSessionActive: () => {} } : { supabase } });
  return { api: exports, calls };
}
const approved = { company_id: 'company-a', company_name: 'Company A', staff_id: 'staff-a', display_name: 'A', member_role: 'staff', status: 'approved' };

test('本番でデモフラグを指定しても旧認証を有効にしない', () => {
  assert.equal(setup().api.legacyDemoAuth, false);
  assert.equal(setup({ dev: true }).api.legacyDemoAuth, true);
  assert.equal(setup({ dev: true, demo: 'false' }).api.legacyDemoAuth, false);
});
test('本人未認証なら会社紐付けを取得しない', async () => {
  const { api, calls } = setup({ user: null, identity: approved });
  assert.equal(await api.getAuthenticatedUser(), null);
  assert.equal(calls.length, 0);
});
test('所属・役割はサーバーの紐付けから取得し、パスワードを返さない', async () => {
  const { api } = setup({ identity: approved });
  const user = await api.loginWithAuth(' person@example.com ', 'secret');
  assert.equal(user.id, 'company-a');
  assert.equal(user.staffRole, 'staff');
  assert.equal(user.password, undefined);
});
test('未登録または未承認の所属ならログインを拒否してセッションを破棄', async () => {
  for (const identity of [undefined, { ...approved, status: 'pending' }, { ...approved, status: 'rejected' }]) {
    const { api, calls } = setup({ identity });
    assert.equal(await api.loginWithAuth('a@example.com', 'secret'), null);
    assert.ok(calls.includes('signOut'));
  }
});
test('紐付け取得の通信障害をデモ認証に切り替えず失敗させる', async () => {
  const { api, calls } = setup({ rpcError: new Error('network') });
  await assert.rejects(api.loginWithAuth('a@example.com', 'secret'), /network/);
  assert.ok(calls.includes('signOut'));
});
test('パスワード認証失敗時は所属を取得しない', async () => {
  const { api, calls } = setup({ loginError: new Error('invalid credentials'), identity: approved });
  assert.equal(await api.loginWithAuth('a@example.com', 'wrong'), null);
  assert.equal(calls.length, 1);
});

test('未登録・未検証のセッションでは所属RPCを呼ばず追加認証へ進む', async () => {
  for (const next of ['aal1', 'aal2']) {
    const {api,calls}=setup({identity:approved,aal:'aal1',next});
    await assert.rejects(api.loginWithAuth('a@example.com','secret'), api.MfaRequiredError);
    assert.equal(calls.includes('connexy_current_identity'),false);
    assert.equal(calls.includes('signOut'),false);
  }
});
test('保存済みの未検証セッションも追加認証が必要', async () => {
  const {api,calls}=setup({identity:approved,aal:'aal1',factors:[{id:'factor1',friendly_name:'Test'}]});
  await assert.rejects(api.getAuthenticatedUser(), e=>e instanceof api.MfaRequiredError && e.account.factors[0].id==='factor1');
  assert.deepEqual(calls,['connexy_mfa_is_required']);
});
test('追加認証の確認が通信障害なら所属RPCを実行しない', async () => {
  const {api,calls}=setup({identity:approved,mfaError:new Error('mfa unavailable')});
  await assert.rejects(api.loginWithAuth('a@example.com','secret'),/mfa unavailable/);
  assert.deepEqual(calls.slice(1),['signOut']);
});

test('公開版もサーバーが明示的に省略を許可した本人だけ所属を取得する',async()=>{
 for(const dev of [true,false]){
 const {api,calls}=setup({identity:approved,dev,aal:'aal1',mfaRequired:false});
 assert.equal((await api.getAuthenticatedUser()).id,'company-a');
 assert.deepEqual(calls,['connexy_mfa_is_required','connexy_current_identity']);
 }
});
test('公開版も例外なし・取得エラー・形式不正では追加認証を維持する',async()=>{
 for(const options of [{dev:false,mfaRequired:true},{dev:true,mfaRequired:true},{dev:false,mfaRequired:false,policyError:{code:'ERROR'}},{dev:false,mfaRequired:null}]){
  const {api,calls}=setup({identity:approved,aal:'aal1',...options});
  await assert.rejects(api.getAuthenticatedUser(),api.MfaRequiredError);
  assert.equal(calls.includes('connexy_current_identity'),false);
 }
});
