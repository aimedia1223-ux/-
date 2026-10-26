const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const setupSQL=fs.readFileSync('supabase/117_browser_disclosure_fixture.sql','utf8');
const cleanupSQL=fs.readFileSync('supabase/118_browser_disclosure_cleanup.sql','utf8');
const approved='connexy-browser-disclosure-approved',unapproved='connexy-browser-disclosure-unapproved';
const proof='00000000-0000-4000-9000-000000000117';
const good='00000000-0000-4000-9000-000000000172',bad='00000000-0000-4000-9000-000000000171';
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
  create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
  create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',auth.uid()::text,'aal','aal2')$$;
  grant usage on schema public,auth to anon,authenticated;`);
 for(const file of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql','115_confidential_job_disclosure.sql'])await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
 await db.exec(`insert into auth.users values('${a}'),('${b}');insert into auth.sessions values('${a}','${a}',now()),('${b}','${b}',now());
  insert into public.connexy_auth_memberships values('${a}','demoa','demoastaff','A','admin',true),('${b}','demob','demobstaff','B','admin',true);
  insert into public.jobs(id,author_id,title) values('original-keep','demoa','既存案件は維持');`);
 return db;
}
async function owner(db){await db.exec("reset role;select set_config('request.jwt.sub','',false)");}
async function login(db,id=b){await owner(db);await db.query("select set_config('request.jwt.sub',$1,false)",[id]);await db.exec('set role authenticated');}
async function read(db,id){return (await db.query('select public.connexy_read_approved_job($1) data',[id])).rows[0].data;}
test('117番の再実行でも2件だけを公開し、B本人の未承諾拒否・承諾済み開示・取消後拒否と118番の片付けを確認',async()=>{
 const db=await setup();try{
  const original=(await db.query('select to_jsonb(j) row from public.jobs j')).rows;
  await db.exec(setupSQL);await db.exec(setupSQL);
  await login(db);const rows=(await db.query('select public.connexy_list_job_summaries() data')).rows[0].data;
  assert.equal(rows.length,2);assert.ok(rows.every(r=>Object.keys(r).length===3));
  assert.equal(JSON.stringify(rows).includes('架空の検証店舗'),false);
  await assert.rejects(read(db,bad),e=>e.code==='42501');
  assert.equal((await read(db,good)).exact_location,'架空の検証店舗・住所（実在しません）');
  await owner(db);await db.exec(`update connexy_private.sb_approvals set status='revoked' where id='${proof}'`);
  await login(db);await assert.rejects(read(db,good),e=>e.code==='42501');
  await owner(db);await assert.rejects(db.exec(setupSQL),/想定と異なり/);await db.exec('rollback');
  await db.exec(cleanupSQL);await db.exec(cleanupSQL);
  assert.deepEqual((await db.query('select to_jsonb(j) row from public.jobs j')).rows,original);
  for(const table of ['connexy_private.job_publications','connexy_private.sb_approvals','connexy_private.contract_offers','public.contract_tasks'])
   assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from auth.sessions')).rows[0].n,2);
 }finally{await db.close();}
});
test('検証IDが別の案件なら117/118番とも停止し、途中で新規作成した検証行も取り消す',async()=>{
 const db=await setup();try{
  await db.query("insert into public.jobs(id,author_id,title) values($1,'demoa','別の既存案件')",[approved]);
  for(const sql of [setupSQL,cleanupSQL]){
   await assert.rejects(db.exec(sql),/想定と異なり/);await db.exec('rollback');
   assert.equal((await db.query('select count(*)::int n from public.jobs where id=$1',[unapproved])).rows[0].n,0);
   assert.equal((await db.query('select title from public.jobs where id=$1',[approved])).rows[0].title,'別の既存案件');
  }
 }finally{await db.close();}
});
test('概要や案件内容が変更されていたら118番で削除せず、両方の検証案件も維持する',async()=>{
 const db=await setup();try{
  await db.exec(setupSQL);
  await db.query('update public.jobs set detailed_description=$1 where id=$2',['想定外の変更',approved]);
  await assert.rejects(db.exec(cleanupSQL),/想定と異なり/);await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int n from public.jobs where id in ($1,$2)',[approved,unapproved])).rows[0].n,2);
 }finally{await db.close();}
});
test('検証用案件に条件提示が追加されていたら118番の削除を拒否する',async()=>{
 const db=await setup();try{
  await db.exec(setupSQL);await login(db,a);
  await db.query("select public.connexy_create_contract_offer(gen_random_uuid(),$1,'demob','demobstaff',$2)",[approved,'想定外の契約提示を保護するための架空条件です。実契約ではありません。']);
  await owner(db);await assert.rejects(db.exec(cleanupSQL),/条件提示・契約があります/);await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int n from connexy_private.contract_offers')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from public.jobs where id in ($1,$2)',[approved,unapproved])).rows[0].n,2);
 }finally{await db.close();}
});
