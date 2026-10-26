const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const{PGlite}=require('@electric-sql/pglite');
test('通常取得とCSV生成は監査を通り、既存の会社・本人・割当範囲を越えない',async t=>{
 const db=new PGlite(),ids={A:'00000000-0000-4000-8000-000000000001',B:'00000000-0000-4000-8000-000000000002',C:'00000000-0000-4000-8000-000000000003'};
 async function owner(sql=''){await db.exec("reset role;select set_config('request.jwt.sub','',false)");if(sql)await db.exec(sql);}
 async function login(w='A',aal='aal2'){await owner();await db.query("select set_config('request.jwt.sub',$1,false),set_config('request.jwt.aal',$2,false)",[ids[w],aal]);await db.exec('set role authenticated');}
 async function read(table,id=null,company=null,size=200,offset=0){return(await db.query('select public.connexy_read_data($1,$2,$3,$4,$5) data',[table,id,company,size,offset])).rows[0].data.rows;}
 async function csv(){return(await db.query('select public.connexy_export_staff_csv() data')).rows[0].data;}
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',auth.uid()::text,'aal',current_setting('request.jwt.aal',true))$$;
 grant usage on schema public,auth to anon,authenticated;`);
 for(const f of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql','115_confidential_job_disclosure.sql','119_job_responsibilities.sql','120_agency_managers.sql','122_responsible_communications.sql','124_audit_log.sql'])await db.exec(fs.readFileSync('supabase/'+f,'utf8'));
 await db.exec("insert into public.staffs(id,user_id,name,masked_name) values('ageneral','demoa','A一般','一般A'),('formula','demoa','=HYPERLINK(悪意)','A\"b,c');insert into public.jobs(id,author_id,title) values('ja','demoa','A割当'),('jua','demoa','A未割当'),('jb','demob','SECRET-B');insert into public.talents(id,user_id,staff_id,name) values('ta','demoa','ageneral','A本人'),('taadmin','demoa','demoastaff','A管理者'),('tb','demob','demobstaff','SECRET-B');insert into public.announcements(id,title,date,content) values('ann','お知らせ','2026-10-25','確認')");
 for(const[w,c,s,r]of[['A','demoa','demoastaff','admin'],['B','demob','demobstaff','admin'],['C','demoa','ageneral','staff']])await db.exec(`insert into auth.users values('${ids[w]}');insert into auth.sessions values('${ids[w]}','${ids[w]}',now());insert into public.connexy_auth_memberships values('${ids[w]}','${c}','${s}','${w}','${r}',true)`);
 await db.exec(`insert into connexy_private.job_readers values('ja','${ids.C}','demoa')`);
 let beforeA,beforeC;await login();beforeA=(await db.query('select id from public.jobs order by id')).rows.map(r=>r.id);await login('C');beforeC=(await db.query('select id from public.jobs order by id')).rows.map(r=>r.id);
 await owner();await db.exec(fs.readFileSync('supabase/125_audited_data_reads.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/126_deletion_records.sql','utf8'));
 await t.test('直接SELECTを拒否し、管理者・一般担当者の以前の閲覧範囲を維持する',async()=>{
 await login();assert.deepEqual((await read('jobs')).map(r=>r.id),beforeA);
 for(const table of ['jobs','staffs','companies','talents','announcements','contract_tasks'])await assert.rejects(db.query(`select id from public.${table}`),e=>e.code==='42501');
 assert.deepEqual((await read('companies')).map(r=>r.id),['demoa']);assert.equal((await read('staffs')).length,3);
 await login('C');assert.deepEqual((await read('jobs')).map(r=>r.id),beforeC);assert.deepEqual((await read('staffs')).map(r=>r.id),['ageneral']);assert.deepEqual((await read('talents')).map(r=>r.id),['ta']);
 await login('B');assert.deepEqual((await read('jobs')).map(r=>r.id),['jb']);assert.deepEqual((await read('staffs')).map(r=>r.id),['demobstaff']);
 });
 await t.test('ID・会社指定でも他社や未割当は取得できず、契約の直接一覧は空を維持する',async()=>{
 await login();assert.deepEqual(await read('jobs','jb'),[]);assert.deepEqual(await read('staffs',null,'demob'),[]);assert.deepEqual(await read('companies','demob'),[]);assert.deepEqual(await read('contract_tasks'),[]);
 await login('C');assert.deepEqual(await read('jobs','jua'),[]);assert.deepEqual(await read('staffs','demoastaff'),[]);assert.equal((await read('announcements')).length,1);
 });
 await t.test('不正な関係名・条件・ページングを拒否し、固定列に後から追加した秘密列も混入しない',async()=>{
 await login();for(const table of ['audit_events','auth.users',"staffs;drop table public.jobs",null])await assert.rejects(read(table),e=>e.code==='22023');
 for(const[size,offset]of[[0,0],[201,0],[1,-1],[null,0],[1,100001]])await assert.rejects(read('jobs',null,null,size,offset),e=>e.code==='22023');
 assert.equal((await read('jobs',null,null,1,0)).length,1);assert.equal((await read('jobs',null,null,1,1)).length,1);
 await owner("alter table public.staffs add column new_secret text default 'SECRET-NEW';");await login();assert.equal(JSON.stringify(await read('staffs')).includes('SECRET-NEW'),false);
 });
 await t.test('匿名・追加認証前・停止所属・期限切れから一般取得とCSVを拒否する',async()=>{
 await owner('set role anon');await assert.rejects(read('jobs'),e=>e.code==='42501');await assert.rejects(csv(),e=>e.code==='42501');
 await login('A','aal1');await assert.rejects(read('jobs'),e=>e.code==='42501');await assert.rejects(csv(),e=>e.code==='42501');
 await owner(`update public.connexy_auth_memberships set active=false where auth_user_id='${ids.A}'`);await login();await assert.rejects(read('jobs'),e=>e.code==='42501');
 await owner(`update public.connexy_auth_memberships set active=true where auth_user_id='${ids.A}';update auth.sessions set created_at=now()-interval '9 hours' where user_id='${ids.A}'`);await login();await assert.rejects(read('jobs'),e=>e.code==='42501');await assert.rejects(csv(),e=>e.code==='42501');
 await owner(`update auth.sessions set created_at=now() where user_id='${ids.A}'`);
 });
 await t.test('CSVは自社管理者だけの固定3列で、数式・引用符を無害化し、本文をログへ複製しない',async()=>{
 await login('C');await assert.rejects(csv(),e=>e.code==='42501');await login();const a=await csv();assert.equal(a.count,3);assert.equal(a.filename,'Connexy_staffs.csv');
 assert.ok(a.csv.includes('"\'=HYPERLINK(悪意)"'));assert.ok(a.csv.includes('"A""b,c"'));assert.ok(!a.csv.includes('demobstaff'));
 await login('B');const b=await csv();assert.equal(b.count,1);assert.ok(!b.csv.includes('demoastaff'));
 await owner();const logs=(await db.query("select * from connexy_private.audit_events where action='staff_export.read' order by id")).rows;
 assert.equal(logs.length,2);assert.deepEqual(logs.map(r=>r.item_count),[3,1]);assert.equal(logs[0].actor_uid,ids.A);assert.equal(JSON.stringify(logs).includes('HYPERLINK'),false);
 });
 await t.test('データ取得は返した各IDを自社にだけ記録し、失敗時は取得も返さない',async()=>{
 await login();await read('jobs');await owner();const logs=(await db.query("select * from connexy_private.audit_events where action='data.read' and target_type='job' and company_id='demoa'")).rows;assert.ok(logs.some(r=>r.target_id==='ja'));assert.ok(!logs.some(r=>r.target_id==='jb'));
 await db.exec(`create function connexy_private.reject_test_audit() returns trigger language plpgsql as $$begin raise exception '監査障害検証';end$$;
 create trigger reject_test_audit before insert on connexy_private.audit_events for each row execute function connexy_private.reject_test_audit()`);
 await login();await assert.rejects(read('jobs'),/監査障害検証/);await assert.rejects(csv(),/監査障害検証/);await owner('drop trigger reject_test_audit on connexy_private.audit_events');
 });
 await t.test('既存の本人認証・承諾付き専用RPCはテーブル権限を閉じた後も利用できる',async()=>{
 await owner();await db.exec(fs.readFileSync('supabase/123_browser_communication_fixture.sql','utf8'));
 await login('B');assert.equal((await db.query('select * from public.connexy_current_identity()')).rows[0].company_id,'demob');
 const scope=(await db.query('select public.connexy_list_responsible_threads() data')).rows[0].data[0];assert.ok(scope);
 await db.query("select public.connexy_read_approved_job('00000000-0000-4000-9000-000000000172')");
 await db.query("select public.connexy_send_responsible_message($1,'架空の確認です',$2,1,1)",[scope.approval_id,'00000000-0000-4000-8000-000000000099']);
 await db.query('select public.connexy_list_audit_events()');await owner();await db.exec(fs.readFileSync('supabase/118_browser_disclosure_cleanup.sql','utf8'));
 });
 }finally{await db.close();}
});
