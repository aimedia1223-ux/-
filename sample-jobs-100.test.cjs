const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const{PGlite}=require('@electric-sql/pglite');
test('100件の架空募集は既存案件を保ち、再実行で増殖せず、概要と詳細の制限を守る',async()=>{
 const db=new PGlite(),sql=f=>fs.readFileSync('supabase/'+f,'utf8');
 const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
 async function owner(){await db.exec("reset role;select set_config('request.jwt.sub','',false)");}
 async function login(uid){await owner();await db.query("select set_config('request.jwt.sub',$1,false)",[uid]);await db.exec('set role authenticated');}
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',auth.uid()::text,'aal','aal2')$$;
 grant usage on schema public,auth to anon,authenticated;`);
 for(const f of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql','115_confidential_job_disclosure.sql','119_job_responsibilities.sql','120_agency_managers.sql','122_responsible_communications.sql','124_audit_log.sql','125_audited_data_reads.sql'])await db.exec(sql(f));
 await db.exec(`insert into auth.users values('${a}'),('${b}');insert into auth.sessions values('${a}','${a}',now()),('${b}','${b}',now());insert into public.connexy_auth_memberships values('${a}','demoa','demoastaff','A','admin',true),('${b}','demob','demobstaff','B','admin',true);`);
 const before=(await db.query('select to_jsonb(j) data from public.jobs j order by id')).rows;
 await db.exec(sql('136_sample_jobs_100.sql'));
 assert.equal((await db.query("select count(*)::int n from public.jobs where id like 'connexy-sample-100-%'")).rows[0].n,100);
 assert.equal((await db.query("select count(*)::int n from connexy_private.job_publications where job_id like 'connexy-sample-100-%' and enabled")).rows[0].n,100);
 assert.equal((await db.query('select count(*)::int n from connexy_private.sb_approvals')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from public.contract_tasks')).rows[0].n,0);
 const snapshot=(await db.query("select to_jsonb(j) data from public.jobs j where id like 'connexy-sample-100-%' order by id")).rows;
 await db.exec(sql('136_sample_jobs_100.sql'));assert.deepEqual((await db.query("select to_jsonb(j) data from public.jobs j where id like 'connexy-sample-100-%' order by id")).rows,snapshot);
 assert.deepEqual((await db.query("select to_jsonb(j) data from public.jobs j where id not like 'connexy-sample-100-%' order by id")).rows,before);
 for(const uid of [a,b]){
  await login(uid);const summaries=(await db.query('select public.connexy_list_job_summaries() data')).rows[0].data;assert.equal(summaries.length,50);assert.deepEqual(Object.keys(summaries[0]).sort(),['category','public_id','region']);
  await assert.rejects(db.query('select public.connexy_read_approved_job($1)',[summaries[0].public_id]),e=>e.code==='42501');
  await assert.rejects(db.exec(sql('136_sample_jobs_100.sql')));await db.exec('rollback');
 }
 await owner();await db.exec("update public.jobs set title='変更後の架空案件' where id='connexy-sample-100-001'");
 await assert.rejects(db.exec(sql('136_sample_jobs_100.sql')),/想定外/);await db.exec('rollback');
 assert.equal((await db.query("select title from public.jobs where id='connexy-sample-100-001'")).rows[0].title,'変更後の架空案件');
 }finally{await db.close();}
});
