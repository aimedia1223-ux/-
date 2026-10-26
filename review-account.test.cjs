const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('共有相手の専用架空データだけを準備し、既存所属・他社を変更しない',async t=>{
 const db=new PGlite();const uid='00000000-0000-4000-8000-000000000081',old='00000000-0000-4000-8000-000000000082',sid='00000000-0000-4000-8000-000000000083';
 const source=fs.readFileSync('supabase/133_review_account_setup.sql','utf8');
 const prepared=u=>source.replace('review_auth_uid uuid := null',`review_auth_uid uuid := '${u}'`);
 async function failed(sql){await assert.rejects(db.exec(sql));await db.exec('rollback');}
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true),'aal',current_setting('request.jwt.claim.aal',true))$$;
   grant usage on schema auth,public to anon,authenticated;`);
  for(const f of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql'])await db.exec(fs.readFileSync('supabase/'+f,'utf8'));
  await db.exec(`insert into auth.users values('${uid}'),('${old}');insert into public.connexy_auth_memberships values('${old}','demoa','demoastaff','Original','admin',true);`);
  await t.test('UID未入力・存在しないAuthユーザーでは何も作らない',async()=>{
   await failed(source);await failed(prepared('00000000-0000-4000-8000-000000000099'));
   assert.equal((await db.query("select count(*)::int n from public.companies where id like 'review-company-%'")).rows[0].n,0);
  });
  await t.test('既存A社アカウントの所属は上書きしない',async()=>{
   await failed(prepared(old));assert.equal((await db.query('select company_id from public.connexy_auth_memberships where auth_user_id=$1',[old])).rows[0].company_id,'demoa');
  });
  await t.test('専用会社・スタッフ・案件を一件ずつ作り、再実行で増えない',async()=>{
   await db.exec(prepared(uid));await db.exec(prepared(uid));
   for(const [table,column,prefix] of [['companies','id','review-company-'],['staffs','id','review-staff-'],['jobs','id','review-job-']])assert.equal((await db.query(`select count(*)::int n from public.${table} where ${column}=$1`,[prefix+uid])).rows[0].n,1);
  });
  await t.test('追加認証は必要なままで、共有相手は自社だけ閲覧できる',async()=>{
   await db.exec(`insert into auth.sessions values('${sid}','${uid}',now());select set_config('request.jwt.claim.sub','${uid}',false),set_config('request.jwt.claim.session_id','${sid}',false),set_config('request.jwt.claim.aal','aal1',false);set role authenticated;`);
   assert.equal((await db.query('select * from public.connexy_current_identity()')).rows.length,0);
   await db.exec("select set_config('request.jwt.claim.aal','aal2',false)");
   assert.equal((await db.query('select company_id from public.connexy_current_identity()')).rows[0].company_id,'review-company-'+uid);
   assert.deepEqual((await db.query('select id from public.jobs')).rows.map(x=>x.id),['review-job-'+uid]);
   assert.deepEqual((await db.query('select id from public.staffs')).rows.map(x=>x.id),['review-staff-'+uid]);
   await assert.rejects(db.exec("insert into public.jobs(id,author_id,title) values ('bad','demoa','Not allowed')"));await db.exec('reset role');
  });
  await t.test('予約IDの内容や所属が変わっていれば上書きせず停止する',async()=>{
   await db.query('update public.jobs set title=$1 where id=$2',['Changed','review-job-'+uid]);await failed(prepared(uid));
   assert.equal((await db.query('select title from public.jobs where id=$1',['review-job-'+uid])).rows[0].title,'Changed');
  });
 }finally{await db.close();}
});
