const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const{PGlite}=require('@electric-sql/pglite');const{createHash,randomUUID}=require('node:crypto');
test('削除実施記録は実削除ログ・自社・本人に固定し、外部消去を証明済みにしない',async t=>{
 const db=new PGlite(),ids={A:'00000000-0000-4000-8000-000000000001',B:'00000000-0000-4000-8000-000000000002',C:'00000000-0000-4000-8000-000000000003'};
 let eventA,eventB,recordId;const hash='0'.repeat(64);
 async function owner(sql=''){await db.exec("reset role;select set_config('request.jwt.sub','',false)");if(sql)await db.exec(sql);}
 async function login(w='B',aal='aal2'){await owner();await db.query("select set_config('request.jwt.sub',$1,false),set_config('request.jwt.aal',$2,false)",[ids[w],aal]);await db.exec('set role authenticated');}
 async function list(){return(await db.query('select public.connexy_list_deletion_records() data')).rows[0].data;}
 async function create(event=eventB){return(await db.query('select public.connexy_create_deletion_record($1) id',[event])).rows[0].id;}
 async function save(category='backups',status='reported',version=1,reference='TEST_EVIDENCE_001',sha=hash,id=recordId){return db.query('select public.connexy_save_deletion_check($1,$2,$3,$4,$5,$6)',[id,category,status,reference,sha,version]);}
 async function output(id=recordId){return(await db.query('select public.connexy_export_deletion_record($1) data',[id])).rows[0].data;}
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',auth.uid()::text,'aal',current_setting('request.jwt.aal',true))$$;
 grant usage on schema public,auth to anon,authenticated;`);
 for(const f of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql','115_confidential_job_disclosure.sql','119_job_responsibilities.sql','120_agency_managers.sql','122_responsible_communications.sql','124_audit_log.sql','125_audited_data_reads.sql','126_deletion_records.sql'])await db.exec(fs.readFileSync('supabase/'+f,'utf8'));
 await db.exec("insert into public.staffs(id,user_id,name) values('ageneral','demoa','A一般')");
 for(const[w,c,s,r]of[['A','demoa','demoastaff','admin'],['B','demob','demobstaff','admin'],['C','demoa','ageneral','staff']])await db.exec(`insert into auth.users values('${ids[w]}');insert into auth.sessions values('${ids[w]}','${ids[w]}',now());insert into public.connexy_auth_memberships values('${ids[w]}','${c}','${s}','${w}','${r}',true)`);
 await db.exec(fs.readFileSync('supabase/123_browser_communication_fixture.sql','utf8'));await db.exec(fs.readFileSync('supabase/118_browser_disclosure_cleanup.sql','utf8'));
 eventB=(await db.query("select id::text id from connexy_private.audit_events where action='approval.deleted' and company_id='demob'")).rows[0].id;
 eventA=(await db.query("select id::text id from connexy_private.audit_events where action='approval.deleted' and company_id='demoa'")).rows[0].id;
 await t.test('候補は自社の削除ログだけで、存在しないID・他社・削除以外のログから作成できない',async()=>{
 await login();const state=await list();assert.deepEqual(state.records,[]);assert.ok(state.candidates.some(e=>e.id===eventB));assert.ok(!state.candidates.some(e=>e.id===eventA));
 await assert.rejects(create(eventA),e=>e.code==='42501');await assert.rejects(create('999999999'),e=>e.code==='42501');
 await owner();const readEvent=(await db.query("select id::text id from connexy_private.audit_events where action='deletion_records.read' and company_id='demob' limit 1")).rows[0].id;
 await login();await assert.rejects(create(readEvent),e=>e.code==='42501');
 });
 await t.test('作成は同じ削除ログにつき1件だけで、5項目は未確認から開始し削除ログを改変しない',async()=>{
 recordId=await create();assert.equal(await create(),recordId);const state=await list();assert.equal(state.records.length,1);assert.ok(!state.candidates.some(e=>e.id===eventB));
 const r=state.records[0];assert.equal(r.deletion_event_id,eventB);assert.equal(r.scope,'application_target_only');assert.equal(r.external_verification,'unverified');assert.equal(r.checks.length,5);assert.ok(r.checks.every(c=>c.status==='pending'&&c.version===1));
 await owner();assert.equal((await db.query("select count(*)::int n from connexy_private.audit_events where action='deletion_record.created'")).rows[0].n,1);
 assert.equal((await db.query('select created_by from connexy_private.deletion_records')).rows[0].created_by,ids.B);
 });
 await t.test('匿名・MFA前・一般・他社は作成/更新/出力を拒否し、他社の記録を一覧へ返さない',async()=>{
 await login('A');assert.deepEqual((await list()).records,[]);await assert.rejects(output(),e=>e.code==='42501');await assert.rejects(save(),e=>e.code==='42501');
 for(const[w,aal]of[['B','aal1'],['C','aal2']]){await login(w,aal);await assert.rejects(list(),e=>e.code==='42501');await assert.rejects(create(),e=>e.code==='42501');await assert.rejects(save(),e=>e.code==='42501');await assert.rejects(output(),e=>e.code==='42501');}
 await owner('set role anon');await assert.rejects(list(),e=>e.code==='42501');await assert.rejects(output(),e=>e.code==='42501');
 });
 await t.test('内部管理番号・ハッシュが必要で、完了/検証済み状態や任意項目を受け付けない',async()=>{
 await login();for(const[category,status,reference,sha]of[['other','reported','REF',hash],['backups','verified','REF',hash],['backups','complete','REF',hash],['backups','reported',null,hash],['backups','reported','https://secret',hash],['backups','reported','REF','broken'],['backups','pending','REF',hash]])
 await assert.rejects(save(category,status,1,reference,sha),e=>e.code==='22023');
 await assert.rejects(save('backups','reported',1,'REF',hash,randomUUID()),e=>e.code==='42501');
 });
 await t.test('証跡の申告は版と本人を記録し、競合を拒否し、全項目申告しても外部未検証を維持',async()=>{
 await save();await assert.rejects(save(),e=>e.code==='40001');
 for(const category of ['return','external_files','downloads','subcontractor'])await save(category);
 const record=(await list()).records[0];assert.ok(record.checks.every(c=>c.status==='reported'&&c.version===2));assert.equal(record.external_verification,'unverified');
 await owner();assert.ok((await db.query('select updated_by from connexy_private.deletion_checks')).rows.every(r=>r.updated_by===ids.B));
 assert.equal((await db.query("select count(*)::int n from connexy_private.audit_events where action='deletion_check.saved'")).rows[0].n,5);
 await login();await save('backups','pending',2,null,null);const c=(await list()).records[0].checks.find(c=>c.category==='backups');assert.equal(c.version,3);assert.equal(c.evidence_sha256,null);
 });
 await t.test('JSON出力は指定対象と未検証表示を含み、SHA256は正確で、電子署名を偽らない',async()=>{
 const file=await output();const payload=JSON.parse(file.canonical_payload);assert.equal(payload.record.id,recordId);assert.equal(payload.record.deletion_event_id,eventB);assert.equal(payload.signature,'none');
 assert.equal(payload.record.external_verification,'unverified');assert.match(payload.notice,/完全削除の証明書ではありません/);
 assert.equal(file.sha256,createHash('sha256').update(file.canonical_payload,'utf8').digest('hex'));assert.equal(file.filename,`Connexy_deletion_record_${recordId}.json`);
 assert.equal(file.canonical_payload.includes(ids.B),false);
 });
 await t.test('直接の表/内部関数へのアクセスと記録の上書き・削除・TRUNCATEを拒否',async()=>{
 for(const sql of ['select * from connexy_private.deletion_records','select * from connexy_private.deletion_checks',`select connexy_private.deletion_record_json('${recordId}')`,"update connexy_private.deletion_checks set status='reported'",'delete from connexy_private.deletion_records'])await assert.rejects(db.query(sql),e=>e.code==='42501');
 await owner();for(const sql of ["update connexy_private.deletion_records set snapshot='{}'",'delete from connexy_private.deletion_records','truncate connexy_private.deletion_records cascade'])await assert.rejects(db.query(sql),e=>e.code==='42501');
 });
 await t.test('監査書込失敗時は確認状況も変更せず、停止所属・期限切れを毎回拒否',async()=>{
 await db.exec(`create function connexy_private.reject_record_audit() returns trigger language plpgsql as $$begin raise exception '監査障害';end$$;
 create trigger reject_record_audit before insert on connexy_private.audit_events for each row execute function connexy_private.reject_record_audit()`);
 await login();await assert.rejects(save('backups','reported',3),/監査障害/);await owner('drop trigger reject_record_audit on connexy_private.audit_events');
 assert.equal((await db.query("select status from connexy_private.deletion_checks where category='backups'")).rows[0].status,'pending');
 await owner(`update public.connexy_auth_memberships set active=false where auth_user_id='${ids.B}'`);await login();await assert.rejects(list(),e=>e.code==='42501');await assert.rejects(output(),e=>e.code==='42501');
 await owner(`update public.connexy_auth_memberships set active=true where auth_user_id='${ids.B}';update auth.sessions set created_at=now()-interval '9 hours' where user_id='${ids.B}'`);await login();await assert.rejects(list(),e=>e.code==='42501');await assert.rejects(output(),e=>e.code==='42501');
 });
 }finally{await db.close();}
});
