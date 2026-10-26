const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const setupSQL=fs.readFileSync('supabase/121_browser_agency_manager_fixture.sql','utf8'),cleanupSQL=fs.readFileSync('supabase/118_browser_disclosure_cleanup.sql','utf8');
async function owner(db){await db.exec("reset role;select set_config('request.jwt.sub','',false)");}
async function login(db,id=b){await owner(db);await db.query("select set_config('request.jwt.sub',$1,false)",[id]);await db.exec('set role authenticated');}
async function setup(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',auth.uid()::text,'aal','aal2')$$;
 grant usage on schema public,auth to anon,authenticated;`);
 for(const file of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql','115_confidential_job_disclosure.sql','119_job_responsibilities.sql','120_agency_managers.sql','122_responsible_communications.sql','124_audit_log.sql'])await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
 await db.exec(`insert into auth.users values('${a}'),('${b}');insert into auth.sessions values('${b}','${b}',now());
  insert into public.connexy_auth_memberships values('${a}','demoa','demoastaff','A','admin',true),('${b}','demob','demobstaff','B','admin',true);
  insert into public.jobs(id,author_id,title) values('original-keep','demob','B社の既存案件');
  insert into connexy_private.job_responsibilities values('original-keep','demob','demobstaff','demobstaff','demobstaff',1,'${b}',now());`);
 return db;
}
async function snapshot(db){const data={};for(const table of ['public.jobs','connexy_private.job_responsibilities','connexy_private.agency_managers','auth.users','auth.sessions','public.connexy_auth_memberships'])data[table]=(await db.query(`select to_jsonb(t) data from ${table} t order by to_jsonb(t)::text`)).rows;return data;}
test('121番はAログイン不要で冪等に準備し、Bが双方の窓口を取得・管理責任者を保存しても118番で元の登録を維持して片付けられる',async()=>{
 const db=await setup();try{
  const before=await snapshot(db);await db.exec(setupSQL);await db.exec(setupSQL);
  await login(db);let data=(await db.query('select public.connexy_list_agency_managers() data')).rows[0].data;
  assert.equal(data.items.length,1);assert.equal(data.items[0].has_assignment,false);assert.equal(data.items[0].primary_contacts.agency_contact_name,'架空担当者A');
  const proof=data.items[0].approval_id;
  await db.query("select public.connexy_save_agency_manager($1,'demobstaff',0)",[proof]);
  data=(await db.query('select public.connexy_list_agency_managers() data')).rows[0].data;
  assert.equal(data.items[0].manager.manager_name,'架空担当者B');assert.equal(data.items[0].has_assignment,true);
  await owner(db);await db.exec(setupSQL);assert.equal((await db.query('select version from connexy_private.agency_managers')).rows[0].version,1);
  await db.exec(cleanupSQL);await db.exec(cleanupSQL);assert.deepEqual(await snapshot(db),before);
  for(const table of ['connexy_private.job_publications','connexy_private.sb_approvals','connexy_private.agency_managers'])assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n,0);
 }finally{await db.close();}
});
test('121番は一次窓口が変更されていたら上書きせず停止する',async()=>{
 const db=await setup();try{
  await db.exec(setupSQL);await db.exec("insert into public.staffs(id,user_id,name) values('aother','demoa','A別担当');update connexy_private.job_responsibilities set sb_contact_staff_id='aother' where job_id='connexy-browser-disclosure-approved'");
  const before=await snapshot(db);await assert.rejects(db.exec(setupSQL),/一次窓口が想定と異なり/);await db.exec('rollback');assert.deepEqual(await snapshot(db),before);
 }finally{await db.close();}
});

