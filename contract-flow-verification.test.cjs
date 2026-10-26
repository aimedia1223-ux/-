const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/112_contract_flow_verification.sql','utf8');
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
  create table auth.users(id uuid primary key);
  create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),'')::uuid,(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid)$$;
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;`);
 for(const file of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql']) await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
 await db.exec(`insert into auth.users values('${a}'),('${b}');
  insert into auth.sessions values('${a}','${a}',now()),('${b}','${b}',now());
  insert into public.connexy_auth_memberships values('${a}','demoa','demoastaff','A','admin',true),('${b}','demob','demobstaff','B','admin',true);`);
 return db;
}
async function emptyFixtures(db){
 for(const table of ['public.jobs','public.contract_tasks','connexy_private.contract_offers','connexy_private.sb_approvals'])
  assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n,0);
 assert.equal((await db.query('select auth.uid() as id')).rows[0].id,null);
 assert.equal((await db.query('select count(*)::int n from auth.sessions')).rows[0].n,2);
 assert.equal((await db.query("select count(*)::int n from public.connexy_auth_memberships where active and member_role='admin'")).rows[0].n,2);
}
test('112番はA提示からB確定まで10行成功し、再実行してもデータ・認証条件を残さない',async()=>{
 const db=await setup();
 try{
  for(let retry=0;retry<2;retry++){
   const results=await db.exec(sql);
   const rows=results.flatMap(r=>r.rows || []).filter(r=>r.check_name);
   assert.equal(rows.length,10);assert.ok(rows.every(r=>r.result.startsWith('確認OK')));
   await emptyFixtures(db);
   assert.equal((await db.query("select count(*)::int n from pg_catalog.pg_proc where proname in ('connexy_verify_contract_flow','connexy_contract_probe_identity')")).rows[0].n,0);
  }
 }finally{await db.close();}
});
test('112番はBの期限切れセッションを無効なまま扱い、検証データを作らず停止する',async()=>{
 const db=await setup();
 try{
  await db.exec(`update auth.sessions set created_at=now()-interval '9 hours' where user_id='${b}'`);
  await assert.rejects(db.exec(sql),/B管理者のログイン期限/);await db.exec('rollback');await emptyFixtures(db);
 }finally{await db.close();}
});
test('112番は片側だけの確定が通る不具合を検出し、途中の提示・承諾も取り消す',async()=>{
 const db=await setup();
 try{
  await db.exec("create or replace function public.connexy_respond_contract_offer(target_offer uuid,action text) returns text language sql as $$select 'ct_invalid'::text$$");
  await assert.rejects(db.exec(sql),/A社単独の確定を拒否できていません/);await db.exec('rollback');await emptyFixtures(db);
 }finally{await db.close();}
});
