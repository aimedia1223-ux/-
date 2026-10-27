const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const{PGlite}=require('@electric-sql/pglite');const{randomUUID}=require('node:crypto');
test('インシデント報告の会社・担当者分離、初動、原文保持と追記履歴',async t=>{
 const db=new PGlite();const ids={A:'00000000-0000-4000-8000-000000000001',B:'00000000-0000-4000-8000-000000000002',C:'00000000-0000-4000-8000-000000000003',D:'00000000-0000-4000-8000-000000000004'};
 const report=randomUUID(),summary='架空検証：誤送信の疑いがあります。実際の情報ではありません。',discovered='2026-01-01T00:00:00Z';
 const sql=f=>fs.readFileSync('supabase/'+f,'utf8');
 async function owner(s=''){await db.exec("reset role;select set_config('request.jwt.sub','',false)");if(s)await db.exec(s);}
 async function login(who='A',aal='aal2'){await owner();await db.query("select set_config('request.jwt.sub',$1,false),set_config('request.jwt.aal',$2,false)",[ids[who],aal]);await db.exec('set role authenticated');}
 const list=async()=>(await db.query('select public.connexy_list_incidents() data')).rows[0].data;
 const read=async(id=report)=>(await db.query('select public.connexy_read_incident($1) data',[id])).rows[0].data;
 const create=async(id=report,body=summary)=>db.query('select public.connexy_create_incident($1,$2,$3,$4,$5)',[id,'misdelivery',discovered,body,'架空のログを保全する予定です。']);
 const update=async(v=1,status='investigating')=>db.query('select public.connexy_update_incident($1,$2,$3,$4,$5,$6)',[report,v,status,'架空検証：責任者が状況を調査しています。','preserved','reported']);
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',auth.uid()::text,'aal',current_setting('request.jwt.aal',true))$$;
 grant usage on schema public,auth to anon,authenticated;`);
 for(const f of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql','115_confidential_job_disclosure.sql','119_job_responsibilities.sql','120_agency_managers.sql','122_responsible_communications.sql','124_audit_log.sql','125_audited_data_reads.sql','126_deletion_records.sql','127_contract_documents.sql','129_contract_pdf_source.sql','130_contract_amendments.sql','135_incident_reports.sql'])await db.exec(sql(f));
 await owner("insert into public.staffs(id,user_id,name) values('cgeneral','demoa','架空一般C'),('dgeneral','demoa','架空一般D')");
 for(const[w,c,s,r]of[['A','demoa','demoastaff','admin'],['B','demob','demobstaff','admin'],['C','demoa','cgeneral','staff'],['D','demoa','dgeneral','staff']])await owner(`insert into auth.users values('${ids[w]}');insert into auth.sessions values('${ids[w]}','${ids[w]}',now());insert into public.connexy_auth_memberships values('${ids[w]}','${c}','${s}','${w}','${r}',true)`);
 await t.test('匿名・追加認証前・停止所属・期限切れは拒否',async()=>{
  await owner('set role anon');await assert.rejects(list(),e=>e.code==='42501');await assert.rejects(create(),e=>e.code==='42501');
  await login('A','aal1');await assert.rejects(list(),e=>e.code==='42501');
  await owner(`update public.connexy_auth_memberships set active=false where auth_user_id='${ids.A}'`);await login();await assert.rejects(list(),e=>e.code==='42501');
  await owner(`update public.connexy_auth_memberships set active=true where auth_user_id='${ids.A}';update auth.sessions set created_at=now()-interval '9 hours' where user_id='${ids.A}'`);await login();await assert.rejects(create(),e=>e.code==='42501');await owner(`update auth.sessions set created_at=now() where user_id='${ids.A}'`);
 });
 await t.test('一般担当者が疑いを報告、再送は一件、内容差替え不可',async()=>{
  await login('C');await create();await create();const r=await read();assert.equal(r.summary,summary);assert.equal(r.history.length,1);assert.equal(r.reporter_staff_id,'cgeneral');assert.equal(r.history[0].external_state,'unreported');assert.equal((await list()).items.length,1);
  await assert.rejects(create(report,summary+'変更'),e=>e.code==='42501');await assert.rejects(update(),e=>e.code==='42501');
 });
 await t.test('他社・同じ会社の別担当者はID直指定でも閲覧不可、管理者は自社だけ',async()=>{
  for(const w of ['B','D']){await login(w);assert.equal((await list()).items.length,0);await assert.rejects(read(),e=>e.code==='42501');await assert.rejects(update(),e=>e.code==='42501');}
  await login();assert.equal((await list()).items.length,1);assert.equal((await read()).summary,summary);
 });
 await t.test('24時間連絡先は自社管理者と版を検証して保存、未登録でも報告可',async()=>{
  await login();assert.equal((await list()).contact,null);
  await assert.rejects(db.query("select public.connexy_save_incident_contact('架空24時間窓口','demobstaff',0)"),e=>e.code==='22023');
  await db.query("select public.connexy_save_incident_contact('架空の24時間窓口：内線TEST','demoastaff',0)");
  await assert.rejects(db.query("select public.connexy_save_incident_contact('古い設定の保存','demoastaff',0)"),e=>e.code==='40001');
  await login('C');assert.equal((await list()).contact.lead_staff_id,'demoastaff');await assert.rejects(db.query("select public.connexy_save_incident_contact('架空の連絡先','cgeneral',1)"),e=>e.code==='42501');
  await login('B');assert.equal((await list()).contact,null);
 });
 await t.test('管理者の追記・競合拒否・完了後の再調査でも初回と履歴保持',async()=>{
  await login();await update();await assert.rejects(update(),e=>e.code==='40001');await update(2,'resolved');await update(3,'investigating');
  const r=await read();assert.equal(r.version,4);assert.equal(r.summary,summary);assert.deepEqual(r.history.map(h=>h.version),[4,3,2,1]);
  await login('C');assert.equal((await read()).version,4);
 });
 await t.test('入力・未来日時・不正状態を拒否、表・履歴・内部監査への迂回不可',async()=>{
  await login();await assert.rejects(create(randomUUID(),'短い'),e=>e.code==='22023');
  await assert.rejects(db.query("select public.connexy_create_incident($1,'loss',now()+interval '1 day',$2,'')",[randomUUID(),summary]),e=>e.code==='22023');
  await assert.rejects(update(4,'invalid'),e=>e.code==='22023');
  for(const q of ['select * from connexy_private.incidents','delete from connexy_private.incidents','select * from connexy_private.incident_events',"update connexy_private.incident_events set note='改ざん'","select connexy_private.append_audit('demoa','incident.created','collection','偽造')"])
   await assert.rejects(db.query(q),e=>e.code==='42501');
  await owner();for(const q of ["update connexy_private.incident_events set note='改ざん'",'delete from connexy_private.incident_events','truncate connexy_private.incident_events'])await assert.rejects(db.query(q),e=>e.code==='42501');
 });
 await t.test('監査に本文を複製せず、監査失敗は対応変更もロールバック',async()=>{
  await owner();const events=(await db.query("select * from connexy_private.audit_events where action like 'incident.%'")).rows;
  assert.ok(events.some(e=>e.action==='incident.created'));assert.equal(events.filter(e=>e.action==='incident.created').length,1);assert.equal(JSON.stringify(events).includes(summary),false);
  await db.exec(`create function connexy_private.fail_incident_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$;create trigger fail_incident_audit before insert on connexy_private.audit_events for each row execute function connexy_private.fail_incident_audit()`);
  await login();await assert.rejects(update(4),/audit unavailable/);await owner('drop trigger fail_incident_audit on connexy_private.audit_events');await login();assert.equal((await read()).version,4);
 });
 }finally{await db.close();}
});
