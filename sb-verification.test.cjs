const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const verification=fs.readFileSync('supabase/109_sb_gate_verification.sql','utf8');
const approvedVerification=fs.readFileSync('supabase/110_sb_approved_scope_verification.sql','utf8');

async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
  create table auth.users(id uuid primary key);
  create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
  create function auth.uid() returns uuid language sql as $$select null::uuid$$;
  create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;`);
 for(const file of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql',
  '106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql','103_demo_job_access.sql'])
  await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
 return db;
}
test('109番は7項目成功し、契約・承諾・一時検証関数を残さない',async()=>{
 const db=await setup();
 try{
  const responses=await db.exec(verification);
  const rows=responses.flatMap(response=>response.rows || []).filter(row=>row.check_name);
  assert.equal(rows.length,7);
  assert.ok(rows.every(row=>row.result.startsWith('確認OK')));
  assert.equal((await db.query('select count(*)::int as n from public.contract_tasks')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int as n from connexy_private.sb_approvals')).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int as n from pg_catalog.pg_proc where proname='connexy_verify_sb_gate'")).rows[0].n,0);
 }finally{await db.close();}
});
test('承諾ゲートが壊れてINSERTが成功しても取消し、検証成功と判定しない',async()=>{
 const db=await setup();
 try{
  // ローカルDBだけで意図的に壊す。実環境のSQLには含めない。
  await db.exec("create or replace function connexy_private.enforce_sb_contract_gate() returns trigger language plpgsql as $$begin return new;end;$$");
  await assert.rejects(db.exec(verification),/想定した承諾ゲートの拒否ではありません/);
  await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int as n from public.contract_tasks')).rows[0].n,0);
 }finally{await db.close();}
});
test('無効なトリガーや別の案件を使う条件では検証を開始しない',async()=>{
 const db=await setup();
 try{
  await db.exec('alter table public.contract_tasks disable trigger enforce_sb_contract_gate');
  await assert.rejects(db.exec(verification),/トリガーが有効になっていません/);
  await db.exec('rollback;alter table public.contract_tasks enable trigger enforce_sb_contract_gate');
  await db.exec("update public.jobs set title='別の案件' where id='connexy-access-test-a'");
  await assert.rejects(db.exec(verification),/架空のA社案件/);
  await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int as n from public.contract_tasks')).rows[0].n,0);
 }finally{await db.close();}
});

test('110番は正常系・対象不一致・取消を11行で確認し、架空の承諾と契約を残さない',async()=>{
 const db=await setup();
 try{
  const before=(await db.query('select id,title,price from public.jobs order by id')).rows;
  for(let retry=0;retry<2;retry++) {
   const responses=await db.exec(approvedVerification);
   const rows=responses.flatMap(r=>r.rows || []).filter(r=>r.check_name);
   assert.equal(rows.length,11);
   assert.ok(rows.every(row=>row.result.startsWith('確認OK')));
   assert.equal((await db.query('select count(*)::int as n from public.contract_tasks')).rows[0].n,0);
   assert.equal((await db.query('select count(*)::int as n from connexy_private.sb_approvals')).rows[0].n,0);
   assert.deepEqual((await db.query('select id,title,price from public.jobs order by id')).rows,before);
   assert.equal((await db.query("select count(*)::int as n from pg_catalog.pg_proc where proname='connexy_verify_sb_approved_scope'")).rows[0].n,0);
  }
 }finally{await db.close();}
});
test('110番は対象外の変更が通る不具合を検出し、作った承諾・契約も全て取消す',async()=>{
 const db=await setup();
 try{
  await db.exec("create or replace function connexy_private.enforce_sb_contract_gate() returns trigger language plpgsql as $$begin return new;end;$$");
  await assert.rejects(db.exec(approvedVerification),/想定した承諾ゲートの拒否ではありません/);
  await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int as n from public.contract_tasks')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int as n from connexy_private.sb_approvals')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int as n from public.jobs')).rows[0].n,2);
 }finally{await db.close();}
});
