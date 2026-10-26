const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('新規スキーマと閲覧ポリシーをPostgreSQLで検証する', async t => {
  const db = new PGlite();
  const ids = { adminA: '00000000-0000-4000-8000-000000000001', staffA: '00000000-0000-4000-8000-000000000002', staffB: '00000000-0000-4000-8000-000000000003', unknown: '00000000-0000-4000-8000-000000000004' };
  async function asUser(id, sql) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec('set role authenticated');
    return db.query(sql);
  }
  async function owner(sql) { await db.exec('reset role'); return db.exec(sql); }
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth, public to anon, authenticated;
    `);
    await db.exec(fs.readFileSync('supabase/100_new_project_schema.sql', 'utf8'));
    await db.exec(fs.readFileSync('supabase/102_read_access.sql', 'utf8'));
    for (const id of Object.values(ids)) await db.query('insert into auth.users values($1)', [id]);
    await db.exec(`
      insert into public.staffs(id,user_id,name) values ('a2','demoa','A2');
      insert into public.connexy_auth_memberships values
        ('${ids.adminA}','demoa','demoastaff','Admin A','admin',true),
        ('${ids.staffA}','demoa','a2','Staff A','staff',true),
        ('${ids.staffB}','demob','demobstaff','Staff B','staff',true);
      insert into public.jobs(id,author_id,title) values ('ja1','demoa','A1'),('ja2','demoa','A2'),('jb','demob','B');
      insert into public.contract_tasks(id,job_id,client_id,agency_id) values ('ct-test','ja1','demoa','demob');
      insert into connexy_private.job_readers values ('ja1','${ids.staffA}','demoa');
      insert into public.talents(id,user_id,name,staff_id) values
        ('ta1','demoa','Admin','demoastaff'),('ta2','demoa','Staff','a2'),('tb','demob','B','demobstaff');
    `);
    await t.test('管理者でも他社の会社・スタッフ・案件・人材は読めない', async () => {
      for (const [table, expected] of [['companies',['demoa']],['staffs',['a2','demoastaff']],['jobs',['ja1','ja2']],['talents',['ta1','ta2']]]) {
        const { rows } = await asUser(ids.adminA, `select id from public.${table} order by id`);
        assert.deepEqual(rows.map(row => row.id), expected);
      }
    });
    await t.test('一般担当者は本人のスタッフ・人材と割当案件だけを読める', async () => {
      for (const [table, expected] of [['staffs',['a2']],['jobs',['ja1']],['talents',['ta2']]]) {
        const { rows } = await asUser(ids.staffA, `select id from public.${table} order by id`);
        assert.deepEqual(rows.map(row => row.id), expected);
      }
    });
    await t.test('別会社の担当者と所属未登録者はA社案件を読めない', async () => {
      for (const id of [ids.staffB,ids.unknown]) {
        const { rows } = await asUser(id, "select id from public.jobs where author_id='demoa'");
        assert.equal(rows.length, 0);
      }
    });
    await t.test('自社の案件であっても担当者が自分で割当・権限・契約を変更できない', async () => {
      for (const sql of ["insert into connexy_private.job_readers values ('ja2',auth.uid(),'demoa')", "update public.connexy_auth_memberships set member_role='admin'", "update public.jobs set author_id='demob' where id='ja1'", "update public.contract_tasks set status='confirmed'"]) {
        await assert.rejects(asUser(ids.staffA,sql), e => e.code === '42501');
      }
      assert.equal((await asUser(ids.adminA,'select * from public.contract_tasks')).rows.length,0);
    });
    await t.test('所属停止と会社承認取消を即座に閲覧へ反映する', async () => {
      await owner(`update public.connexy_auth_memberships set active=false where auth_user_id='${ids.staffA}'`);
      assert.equal((await asUser(ids.staffA,'select id from public.jobs')).rows.length,0);
      await owner(`update public.connexy_auth_memberships set active=true where auth_user_id='${ids.staffA}'; update public.companies set status='pending' where id='demoa'`);
      assert.equal((await asUser(ids.adminA,'select id from public.jobs')).rows.length,0);
      await owner("update public.companies set status='approved' where id='demoa'");
    });
    await t.test('他社案件を誤って割り当てても詳細は読めない', async () => {
      await owner(`insert into connexy_private.job_readers values ('jb','${ids.staffA}','demoa')`);
      assert.equal((await asUser(ids.staffA,"select id from public.jobs where id='jb'")).rows.length,0);
    });
    await t.test('匿名は業務テーブルと本人情報を取得できない', async () => {
      await owner('set role anon');
      for (const sql of ['select * from public.jobs','select * from public.companies','select * from public.connexy_current_identity()']) {
        await assert.rejects(db.query(sql), e => e.code === '42501');
      }
    });
    await t.test('実機確認用の架空案件2件を再実行しても重複せず、A/B管理者が自社の1件だけ読める', async () => {
      await owner(`update public.connexy_auth_memberships set member_role='admin' where auth_user_id='${ids.staffB}'`);
      const fixture = fs.readFileSync('supabase/103_demo_job_access.sql','utf8');
      await owner(fixture);
      await owner(fixture);
      const expected = [[ids.adminA,'connexy-access-test-a'],[ids.staffB,'connexy-access-test-b']];
      for (const [id, expectedId] of expected) {
        const { rows } = await asUser(id, "select id from public.jobs where id like 'connexy-access-test-%'");
        assert.deepEqual(rows.map(row => row.id), [expectedId]);
      }
      await db.exec('reset role');
      const { rows } = await db.query("select count(*)::int as count from public.jobs where id like 'connexy-access-test-%'");
      assert.equal(rows[0].count,2);
    });
    await t.test('一般担当者用の登録SQLは割当案件1件だけを開示し、未割当・他社の案件を開示しない', async () => {
      const fixture = fs.readFileSync('supabase/104_general_staff_access.sql','utf8')
        .replaceAll('REPLACE_WITH_GENERAL_USER_UUID',ids.unknown);
      await owner(fixture);
      await owner(fixture);
      const { rows } = await asUser(ids.unknown,'select id from public.jobs order by id');
      assert.deepEqual(rows.map(row => row.id),['connexy-access-test-a']);
      const staff = await asUser(ids.unknown,'select id from public.staffs');
      assert.deepEqual(staff.rows.map(row => row.id),['demoageneral']);
      const identity = await asUser(ids.unknown,'select member_role from public.connexy_current_identity()');
      assert.equal(identity.rows[0].member_role,'staff');
    });
    await t.test('既存のA管理者を誤指定しても所属や役割を上書きしない', async () => {
      const fixture = fs.readFileSync('supabase/104_general_staff_access.sql','utf8')
        .replaceAll('REPLACE_WITH_GENERAL_USER_UUID',ids.adminA);
      await assert.rejects(owner(fixture), /既存の所属・役割/);
      await db.exec('rollback');
      const identity = await asUser(ids.adminA,'select member_role from public.connexy_current_identity()');
      assert.equal(identity.rows[0].member_role,'admin');
    });
    await t.test('閲覧の割当を取り消すと一般担当者の案件一覧から消える', async () => {
      await owner(`delete from connexy_private.job_readers where auth_user_id='${ids.unknown}'`);
      assert.equal((await asUser(ids.unknown,'select id from public.jobs')).rows.length,0);
    });
  } finally { await db.close(); }
});
