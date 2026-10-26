const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const setupSQL=fs.readFileSync('supabase/113_browser_contract_fixture.sql','utf8');
const cleanupSQL=fs.readFileSync('supabase/114_browser_contract_cleanup.sql','utf8');
const job='connexy-browser-contract-test';
const proof='00000000-0000-4000-9000-000000000113';
const terms='ブラウザ検証専用です。本物のSB承諾・実契約・支払・稼働ではありません。税込10000円、経費なしの架空条件として確認後に削除します。';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
  create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
  create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',auth.uid()::text,'aal','aal2')$$;`);
 for(const file of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql','103_demo_job_access.sql'])await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
 await db.exec(`insert into auth.users values('${a}'),('${b}');insert into auth.sessions values('${a}','${a}',now()),('${b}','${b}',now());
  insert into public.connexy_auth_memberships values('${a}','demoa','demoastaff','A','admin',true),('${b}','demob','demobstaff','B','admin',true);`);
 return db;
}
async function identity(db,id){await db.query("select set_config('request.jwt.sub',$1,false)",[id]);}
async function propose(db,text=terms){await identity(db,a);return (await db.query("select public.connexy_create_contract_offer(gen_random_uuid(),$1,'demob','demobstaff',$2) as id",[job,text])).rows[0].id;}
async function finalize(db,id){await identity(db,b);await db.query("select public.connexy_respond_contract_offer($1,'confirm')",[id]);await identity(db,'');}
test('ブラウザ検証データの作成は冪等で、確定後の片付けも再実行でき元の案件を維持する',async()=>{
 const db=await setup();try{
  const before=(await db.query('select id,title,price from public.jobs order by id')).rows;
  await db.exec(setupSQL);await db.exec(setupSQL);
  assert.equal((await db.query('select count(*)::int n from connexy_private.sb_approvals')).rows[0].n,1);
  const id=await propose(db);await finalize(db,id);
  assert.equal((await db.query("select count(*)::int n from public.contract_tasks where status='confirmed'")).rows[0].n,1);
  await db.exec(cleanupSQL);await db.exec(cleanupSQL);
  for(const table of ['public.contract_tasks','connexy_private.contract_offers','connexy_private.sb_approvals'])assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n,0);
  assert.deepEqual((await db.query('select id,title,price from public.jobs order by id')).rows,before);
  assert.equal((await db.query("select tgenabled from pg_trigger where tgname='enforce_sb_contract_gate'")).rows[0].tgenabled,'O');
 }finally{await db.close();}
});
test('検証IDが別の案件なら作成・削除とも停止し、既存データを保持する',async()=>{
 const db=await setup();try{
  await db.query("insert into public.jobs(id,author_id,title) values($1,'demoa','別の案件')",[job]);
  await assert.rejects(db.exec(setupSQL),/上書きせず/);await db.exec('rollback');
  await assert.rejects(db.exec(cleanupSQL),/削除せず/);await db.exec('rollback');
  assert.equal((await db.query('select title from public.jobs where id=$1',[job])).rows[0].title,'別の案件');
 }finally{await db.close();}
});
test('想定外の条件が含まれる提示は片付けで削除せず停止する',async()=>{
 const db=await setup();try{
  await db.exec(setupSQL);const id=await propose(db,'想定した検証用の文章とは異なる条件が含まれています。');await identity(db,'');
  await assert.rejects(db.exec(cleanupSQL),/予期しない条件提示/);await db.exec('rollback');
  assert.equal((await db.query('select status from connexy_private.contract_offers where id=$1',[id])).rows[0].status,'offered');
  assert.equal((await db.query('select count(*)::int n from connexy_private.sb_approvals')).rows[0].n,1);
 }finally{await db.close();}
});
test('検証後に承諾を取り消しても、保護トリガーを無効化せず片付けできる',async()=>{
 const db=await setup();try{
  await db.exec(setupSQL);const id=await propose(db);await finalize(db,id);
  await db.query("update connexy_private.sb_approvals set status='revoked' where id=$1",[proof]);
  await db.exec(cleanupSQL);
  assert.equal((await db.query('select count(*)::int n from public.contract_tasks')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from public.jobs where id=$1',[job])).rows[0].n,0);
 }finally{await db.close();}
});
