const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ts = require('typescript');
const exportsObject = {};
const code = ts.transpileModule(fs.readFileSync('src/utils/loadManagementSections.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, { exports: exportsObject });

test('契約や案件の取得が失敗しても所属会社のスタッフを取得できる', async () => {
  const calls = [];
  const result = await exportsObject.loadManagementSections({
    getContractTasks: async () => { throw { code: '42501' }; },
    getTrainings: async () => [],
    getJobs: async () => { throw new Error('network'); },
    getUsers: async () => [],
    getStaffsByUserId: async companyId => { calls.push(companyId); return [{ id: 'demoastaff', name: '架空担当者A' }]; },
  }, 'demoa');
  assert.equal(result.tasks.status, 'rejected');
  assert.equal(result.jobs.status, 'rejected');
  assert.equal(result.staffs.status, 'fulfilled');
  assert.equal(result.staffs.value[0].name, '架空担当者A');
  assert.deepEqual(calls, ['demoa']);
});
test('スタッフ取得失敗は正常な0名と区別し、他の一覧の成功を維持する', async () => {
  const result = await exportsObject.loadManagementSections({
    getContractTasks: async () => [], getTrainings: async () => [],
    getJobs: async () => [{ id: 'j' }], getUsers: async () => [],
    getStaffsByUserId: async () => { throw { code: '42501' }; },
  }, 'demoa');
  assert.equal(result.staffs.status, 'rejected');
  assert.equal(result.jobs.status, 'fulfilled');
  assert.equal(exportsObject.managementErrorCode(result.staffs.reason), '42501');
});
test('確認コードは生エラーや認証情報を表示しない', () => {
  assert.equal(exportsObject.managementErrorCode({ code: 'PGRST204' }), 'PGRST204');
  assert.equal(exportsObject.managementErrorCode({ code: 'secret token' }), 'CONNECTION_ERROR');
  assert.equal(exportsObject.managementErrorCode(new Error('private response')), 'CONNECTION_ERROR');
});
