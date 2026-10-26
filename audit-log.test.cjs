const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const{PGlite}=require('@electric-sql/pglite');const{randomUUID}=require('node:crypto');
test('監査記録はサーバーで生成され、変更と原子的で、自社管理者だけが取得できる',async t=>{
 const db=new PGlite();const ids={A:'00000000-0000-4000-8000-000000000001',B:'00000000-0000-4000-8000-000000000002',C:'00000000-0000-4000-8000-000000000003'};
 const proof='00000000-0000-4000-9000-000000000117',pub='00000000-0000-4000-9000-000000000172';
 let offer;const secret='SECRET-監査に残してはいけない機密本文';
 async function owner(sql=''){await db.exec("reset role;select set_config('request.jwt.sub','',false)");if(sql)await db.exec(sql);}
 async function login(who='A',aal='aal2'){await owner();await db.query("select set_config('request.jwt.sub',$1,false),set_config('request.jwt.aal',$2,false)",[ids[who],aal]);await db.exec('set role authenticated');}
 async function page(group='all',before=null){return(await db.query('select public.connexy_list_audit_events($1,$2) data',[before,group])).rows[0].data;}
 async function send(nonce=randomUUID()){return db.query('select public.connexy_send_responsible_message($1,$2,$3,1,1)',[proof,secret,nonce]);}
 async function rows(){return(await db.query('select * from connexy_private.audit_events order by id')).rows;}
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',auth.uid()::text,'aal',current_setting('request.jwt.aal',true))$$;
 grant usage on schema public,auth to anon,authenticated;`);
 for(const f of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql','115_confidential_job_disclosure.sql','119_job_responsibilities.sql','120_agency_managers.sql','122_responsible_communications.sql'])await db.exec(fs.readFileSync('supabase/'+f,'utf8'));
 await db.exec("insert into public.staffs(id,user_id,name) values('ageneral','demoa','A一般')");
 for(const[w,c,s,r]of[['A','demoa','demoastaff','admin'],['B','demob','demobstaff','admin'],['C','demoa','ageneral','staff']])await db.exec(`insert into auth.users values('${ids[w]}');insert into auth.sessions values('${ids[w]}','${ids[w]}',now());insert into public.connexy_auth_memberships values('${ids[w]}','${c}','${s}','${w}','${r}',true)`);
 await db.exec(fs.readFileSync('supabase/124_audit_log.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/125_audited_data_reads.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/126_deletion_records.sql','utf8'));
 await t.test('過去のデータに架空の履歴を作らず、サーバーによる準備はサーバー管理操作として記録',async()=>{
 assert.deepEqual(await rows(),[]);await db.exec(fs.readFileSync('supabase/123_browser_communication_fixture.sql','utf8'));
 const events=await rows();assert.ok(events.length>0);assert.ok(events.every(e=>e.actor_kind==='server'&&e.actor_uid===null));
 assert.ok(events.some(e=>e.action==='agency_manager.saved'&&e.company_id==='demob'));
 });
 await t.test('MFA前・匿名・一般担当者・停止所属・期限切れセッションは取得できず、条件改変も拒否',async()=>{
 for(const[w,aal]of[['A','aal1'],['C','aal2']]){await login(w,aal);await assert.rejects(page(),e=>e.code==='42501');}
 await owner('set role anon');await assert.rejects(page(),e=>e.code==='42501');
 await owner(`update public.connexy_auth_memberships set active=false where auth_user_id='${ids.A}'`);await login();await assert.rejects(page(),e=>e.code==='42501');
 await owner(`update public.connexy_auth_memberships set active=true where auth_user_id='${ids.A}';update auth.sessions set created_at=now()-interval '9 hours' where user_id='${ids.A}'`);
 await login();await assert.rejects(page(),e=>e.code==='42501');await owner(`update auth.sessions set created_at=now() where user_id='${ids.A}'`);
 await login();await assert.rejects(page('任意SQL'),e=>e.code==='22023');await assert.rejects(page('all',-1),e=>e.code==='22023');
 });
 await t.test('一次責任者保存・連絡送信は本人IDと版を記録し、再送で送信履歴を水増ししない',async()=>{
 await login();await db.query("select public.connexy_save_job_responsibilities('connexy-browser-disclosure-approved','demoastaff','demoastaff','demoastaff',1)");
 const nonce=randomUUID();await db.query('select public.connexy_send_responsible_message($1,$2,$3,2,1)',[proof,secret,nonce]);
 await db.query('select public.connexy_send_responsible_message($1,$2,$3,2,1)',[proof,secret,nonce]);
 await owner();const events=await rows();const saved=events.find(e=>e.action==='responsibility.saved'&&e.actor_kind==='member');
 assert.equal(saved.actor_uid,ids.A);assert.equal(saved.actor_staff_id,'demoastaff');assert.equal(saved.version,2);
 assert.equal(events.filter(e=>e.action==='message.sent'&&e.company_id==='demoa').length,1);
 assert.equal(events.filter(e=>e.action==='message.sent'&&e.company_id==='demob').length,1);
 assert.equal(JSON.stringify(events).includes(secret),false);
 });
 await t.test('本人・承諾を守った詳細取得と一覧だけが記録され、非公開関数へ迂回できない',async()=>{
 await login('B');await db.query('select public.connexy_read_approved_job($1)',[pub]);
 await db.query('select public.connexy_read_responsible_messages($1)',[proof]);await db.query('select public.connexy_list_agency_managers()');await db.query('select public.connexy_list_responsible_threads()');
 for(const sql of [`select connexy_private.audit_base_read_job('${pub}')`,`select connexy_private.audit_base_read_messages('${proof}',null)`,"select connexy_private.audit_base_list_managers()","select connexy_private.audit_base_list_threads()","select connexy_private.audit_base_list_offers()","select connexy_private.connexy_list_contract_offers()","select connexy_private.audit_base_read_responsibility('connexy-browser-disclosure-approved')"])
 await assert.rejects(db.query(sql),e=>e.code==='42501');
 await owner();let events=await rows();assert.ok(events.some(e=>e.action==='job_detail.read'&&e.company_id==='demob'&&e.actor_uid===ids.B));
 assert.ok(events.some(e=>e.action==='message.read'&&e.item_count===1));
 const count=events.length;await login('C');await assert.rejects(db.query('select public.connexy_read_approved_job($1)',[pub]),e=>e.code==='42501');await owner();assert.equal((await rows()).length,count);
 });
 await t.test('契約提示・辞退・確定・取得を記録し、契約条件は複製しない',async()=>{
 await owner('begin');
 await login();offer=randomUUID();await db.query('select public.connexy_create_contract_offer($1,$2,$3,$4,$5)',[offer,'connexy-browser-disclosure-approved','demob','demobstaff',secret.repeat(2)]);
 await db.query('select public.connexy_list_contract_offers()');await login('B');await db.query('select public.connexy_respond_contract_offer($1,$2)',[offer,'decline']);
 const final=randomUUID();await login();await db.query('select public.connexy_create_contract_offer($1,$2,$3,$4,$5)',[final,'connexy-browser-disclosure-approved','demob','demobstaff',secret.repeat(2)]);
 await login('B');await db.query('select public.connexy_respond_contract_offer($1,$2)',[final,'confirm']);await db.query('select public.connexy_respond_contract_offer($1,$2)',[final,'confirm']);
 await owner();const events=await rows();assert.ok(events.some(e=>e.action==='offer.declined'));assert.ok(events.some(e=>e.action==='offer.read'));
 assert.equal(events.filter(e=>e.action==='offer.confirmed'&&e.company_id==='demoa').length,1);
 assert.equal(events.filter(e=>e.action==='contract.created'&&e.company_id==='demoa').length,1);assert.equal(JSON.stringify(events).includes(secret),false);
 // この契約試験だけをロールバックし、別の連絡用fixtureを片付けられる状態へ戻す。
 await owner('rollback');
 });
 await t.test('同じ取引でも自社分のみ。相手側のUID・担当者ID・氏名を取得できない',async()=>{
 await login('B');const p=await page();assert.ok(p.items.every(e=>!Object.hasOwn(e,'company_id')&&!Object.hasOwn(e,'actor_uid')));
 const counterparty=p.items.find(e=>e.action==='message.sent');assert.equal(counterparty.actor_kind,'counterparty');assert.equal(counterparty.actor_staff_id,null);assert.equal(counterparty.actor_name,null);
 assert.equal(JSON.stringify(p).includes(ids.A),false);assert.ok(!p.items.some(e=>e.action==='responsibility.saved'));
 await login();const own=(await page()).items.find(e=>e.action==='message.sent');assert.equal(own.actor_name,'架空担当者A');assert.equal(own.actor_staff_id,'demoastaff');
 });
 await t.test('表・内部追記関数へのアクセスと偽造、更新・削除・TRUNCATEを拒否',async()=>{
 await login();for(const sql of ['select * from connexy_private.audit_events',"insert into connexy_private.audit_events(company_id) values('demoa')",'update connexy_private.audit_events set actor_uid=null','delete from connexy_private.audit_events','truncate connexy_private.audit_events',"select connexy_private.append_audit('demoa','message.sent','message','偽造')"])
 await assert.rejects(db.query(sql),e=>e.code==='42501');
 await owner();for(const sql of ['update connexy_private.audit_events set actor_uid=null','delete from connexy_private.audit_events','truncate connexy_private.audit_events cascade'])await assert.rejects(db.query(sql),e=>e.code==='42501');
 });
 await t.test('処理失敗とロールバックでは、業務変更だけ・監査だけが残らない',async()=>{
 await owner();const before=(await rows()).length;
 await db.exec('begin');await login();await db.query("select public.connexy_save_job_responsibilities('connexy-browser-disclosure-approved','demoastaff','demoastaff','demoastaff',2)");await owner('rollback');
 assert.equal((await rows()).length,before);assert.equal((await db.query("select version from connexy_private.job_responsibilities where job_id='connexy-browser-disclosure-approved'")).rows[0].version,2);
 await db.exec(`create function connexy_private.fail_audit_insert() returns trigger language plpgsql as $$begin raise exception '検証用障害';end$$;
 create trigger fail_audit before insert on connexy_private.audit_events for each row execute function connexy_private.fail_audit_insert()`);
 await login();await assert.rejects(db.query("select public.connexy_save_job_responsibilities('connexy-browser-disclosure-approved','demoastaff','demoastaff','demoastaff',2)"),/検証用障害/);
 await owner('drop trigger fail_audit on connexy_private.audit_events');assert.equal((await rows()).length,before);
 assert.equal((await db.query("select version from connexy_private.job_responsibilities where job_id='connexy-browser-disclosure-approved'")).rows[0].version,2);
 });
 await t.test('50件のカーソルで重複せず取得でき、フィルタは取得/変更/削除を分ける',async()=>{
 await login();for(let n=0;n<55;n++)await db.query('select public.connexy_list_responsible_threads()');
 const first=await page(),second=await page('all',first.next_before_id);assert.equal(first.items.length,50);assert.equal(first.has_more,true);
 assert.ok(second.items.every(e=>BigInt(e.id)<BigInt(first.items.at(-1).id)));assert.equal(new Set([...first.items,...second.items].map(e=>e.id)).size,first.items.length+second.items.length);
 assert.ok((await page('read')).items.every(e=>e.action.endsWith('.read')));assert.ok((await page('change')).items.every(e=>!e.action.endsWith('.read')&&!e.action.endsWith('.deleted')));
 });
 await t.test('118番削除後もログが残り、承諾削除時の関連連絡件数と各削除を記録する',async()=>{
 await owner();const before=(await rows()).length;await db.exec(fs.readFileSync('supabase/118_browser_disclosure_cleanup.sql','utf8'));
 const events=await rows();assert.ok(events.length>before);const deletion=events.find(e=>e.action==='approval.deleted'&&e.company_id==='demoa');assert.equal(deletion.item_count,1);
 assert.ok(events.some(e=>e.action==='job.deleted'));assert.ok(events.some(e=>e.action==='agency_manager.deleted'));
 assert.equal((await db.query('select count(*)::int n from connexy_private.responsible_messages')).rows[0].n,0);
 await login('B');const deleted=await page('delete');assert.ok(deleted.items.length>0);assert.ok(deleted.items.every(e=>e.action.endsWith('.deleted')));
 assert.equal(JSON.stringify(deleted).includes(secret),false);
 });
 }finally{await db.close();}
});
