const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load({ response = { data: [], error: null }, demo = false } = {}) {
  const calls = [], writes = [];
  const stored = { connexy_is_offline: 'true', staff_role_s: 'admin', staff_password_s: 'old-password', company_status_demoa: 'approved' };
  const localStorage = {
    getItem: key => stored[key] ?? null,
    setItem: (key, value) => { writes.push(key); stored[key] = value; },
    removeItem: key => { delete stored[key]; },
  };
  const chain = {};
  for (const method of ['select', 'eq', 'or', 'order', 'single', 'limit', 'insert', 'update', 'upsert', 'delete']) {
    chain[method] = (...args) => { calls.push({ method, args }); return chain; };
  }
  chain.then = (resolve, reject) => Promise.resolve(response).then(resolve, reject);
  const supabase = { from: table => { calls.push({ method: 'from', args: [table] }); return chain; },
    rpc: async (...args) => { calls.push({method:'rpc',args}); return args[0]==='connexy_read_data'?{...response,data:response.data===null?null:{rows:response.data,scope:['uid','demoa','s','admin']}}:{data:[{approved:false,approval_id:null}],error:null}; } };
  function evaluate(file) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, console: { warn() {}, error() {} }, localStorage,
      window: { addEventListener() {}, dispatchEvent() {} }, navigator: { onLine: false },
      require: name => {
        if (name.endsWith('/auth')) return { legacyDemoAuth: demo };
        if (name.endsWith('/supabase')) return { supabase };
        if (name.endsWith('/crypto')) return { encryptData: value => value, decryptData: value => value };
        if (name.endsWith('regionalJobs')) return { regionalJobs: [] };
        if (name.endsWith('readColumns')) return evaluate('src/data/readColumns.ts');
        if (name.endsWith('/sbApprovalGateway')) return evaluate('src/lib/sbApprovalGateway.ts');
        if (name.endsWith('/auditedReads')) return evaluate('src/lib/auditedReads.ts');
        if (name.endsWith('/jobStates')) return { normalizeEngagementStatus: value => value };
        throw new Error(`Unexpected dependency: ${name}`);
      },
    });
    return exports;
  }
  return { api: evaluate('src/data/mockDb.ts').api, calls, writes };
}

test('新認証では旧オフラインフラグがあってもサーバーから空配列を読む', async () => {
  const { api, calls, writes } = load();
  assert.equal((await api.getJobs()).length, 0);
  assert.ok(calls.some(c => c.method === 'rpc' && c.args[0] === 'connexy_read_data' && c.args[1].target_table === 'jobs'));
  assert.equal(calls.some(c=>c.method==='from'),false);
  assert.equal(writes.length, 0);
});

test('未承諾の契約確定はサーバー確認後に停止し、INSERTもローカル保存も行わない', async () => {
  const {api,calls,writes}=load();
  await assert.rejects(api.createContractTask({id:'ct',jobId:'ja',agency_id:'demob',sbStaffId:'demobstaff',status:'confirmed',evaluations:{sbSubcontractApproval:{status:'approved'}}}),/事前書面承諾/);
  assert.ok(calls.some(c=>c.method==='rpc' && c.args[0]==='connexy_check_sb_approval'));
  assert.equal(calls.some(c=>c.method==='insert'),false);
  assert.equal(writes.length,0);
});
test('RLS拒否・通信障害でデモデータを表示したり代替保存したりしない', async () => {
  const error = { code: '42501', message: 'denied' };
  const { api, writes } = load({ response: { data: null, error } });
  for (const read of [() => api.getJobs(), () => api.getContractTasks(), () => api.getAnnouncements()]) {
    await assert.rejects(read(), e => e === error);
  }
  await assert.rejects(api.saveAnnouncement({ id: 'a', date: '2026-10-23', title: 'a', content: 'a' }), e => e === error);
  await assert.rejects(api.deleteAnnouncement('a'), e => e === error);
  assert.equal(writes.length, 0);
});
test('新認証ではスタッフ一覧の余分な全件取得と初期パスワード生成を行わない', async () => {
  const { api, calls, writes } = load({ response: { data: [{ id: 's', user_id: 'demoa', name: 'A' }], error: null } });
  const staffs = await api.getStaffsByUserId('demoa');
  assert.equal(calls.filter(c => c.method === 'from').length, 0);
  assert.equal(calls.filter(c => c.method === 'rpc').length, 1);
  assert.equal(staffs[0].role, 'staff');
  assert.equal(staffs[0].password, undefined);
  assert.equal(staffs[0].loginId, undefined);
  assert.equal(writes.length, 0);
});
test('取得列にワイルドカード・パスワード・ログインIDを含めない', async () => {
  const { api, calls } = load();
  await api.getJobs(); await api.getTalents(); await api.getAllStaffs(); await api.getUsers(); await api.getContractTasks(); await api.getAnnouncements();
  assert.equal(calls.filter(c=>c.method==='rpc'&&c.args[0]==='connexy_read_data').length,6);
  assert.equal(calls.some(c=>c.method==='select'||c.method==='from'),false);
  for (const call of calls.filter(c => c.method === 'select')) {
    assert.ok(!call.args[0].includes('*'));
    assert.ok(!/password|login_id/.test(call.args[0]));
  }
});
test('会社承認状態はブラウザ保存値で上書きしない', async () => {
  const { api } = load({ response: { data: [{ id: 'demoa', name: 'A', status: 'pending', role: 'contractor', password: 'old-password' }], error: null } });
  const user = (await api.getUsers())[0];
  assert.equal(user.status, 'pending');
  assert.equal(user.password, undefined);
});
test('権限・会社承認・会社情報の変更をローカル保存で成功扱いしない', async () => {
  const { api, writes } = load();
  await assert.rejects(api.updateStaffRole('s', 'admin'));
  await assert.rejects(api.updateCompanyStatus('demoa', 'approved'));
  await assert.rejects(api.updateUser({ id: 'demoa', name: 'A' }));
  assert.equal(writes.length, 0);
});
