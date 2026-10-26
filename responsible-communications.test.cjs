const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');const {randomUUID}=require('node:crypto');
test('責任者間の送受信は本人・承諾・双方の登録に固定される',async t=>{
 const db=new PGlite(),ids=Object.fromEntries(['A','B','C','D','E'].map((k,n)=>[k,`00000000-0000-4000-8000-00000000000${n+1}`]));
 const proof='00000000-0000-4000-9000-000000000117';
 async function owner(sql=''){await db.exec("reset role;select set_config('request.jwt.sub','',false)");if(sql)await db.exec(sql);}
 async function login(who='A',aal='aal2'){await owner();await db.query("select set_config('request.jwt.sub',$1,false),set_config('request.jwt.aal',$2,false)",[ids[who],aal]);await db.exec('set role authenticated');}
 async function list(){return(await db.query('select public.connexy_list_responsible_threads() data')).rows[0].data;}
 async function read(p=proof,before=null){return(await db.query('select public.connexy_read_responsible_messages($1,$2) data',[p,before])).rows[0].data;}
 async function send(body='架空の連絡です。',nonce=randomUUID(),pv=1,mv=1,p=proof){return(await db.query('select public.connexy_send_responsible_message($1,$2,$3,$4,$5) data',[p,body,nonce,pv,mv])).rows[0].data;}
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',auth.uid()::text,'aal',current_setting('request.jwt.aal',true))$$;
 grant usage on schema public,auth to anon,authenticated;`);
 for(const f of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql','115_confidential_job_disclosure.sql','119_job_responsibilities.sql','120_agency_managers.sql','122_responsible_communications.sql','124_audit_log.sql'])await db.exec(fs.readFileSync('supabase/'+f,'utf8'));
 await db.exec("insert into public.staffs(id,user_id,name) values('ageneral','demoa','A一般'),('aother','demoa','A別管理者'),('bother','demob','B別管理者')");
 for(const [who,c,s,r] of [['A','demoa','demoastaff','admin'],['B','demob','demobstaff','admin'],['C','demoa','ageneral','staff'],['D','demoa','aother','admin'],['E','demob','bother','admin']])await db.exec(`insert into auth.users values('${ids[who]}');insert into auth.sessions values('${ids[who]}','${ids[who]}',now());insert into public.connexy_auth_memberships values('${ids[who]}','${c}','${s}','${who}','${r}',true)`);
 await db.exec(fs.readFileSync('supabase/121_browser_agency_manager_fixture.sql','utf8'));
 await t.test('二次責任者の登録前は一次からも送受信できない',async()=>{
 await login();assert.deepEqual(await list(),[]);await assert.rejects(read(),e=>e.code==='42501');await assert.rejects(send(),e=>e.code==='42501');
 await login('B');await db.query("select public.connexy_save_agency_manager($1,'demobstaff',0)",[proof]);
 });
 await t.test('匿名・MFA前・一般スタッフ・両会社の窓口でない管理者は取得送信を拒否',async()=>{
 await owner('set role anon');await assert.rejects(list(),e=>e.code==='42501');await assert.rejects(read(),e=>e.code==='42501');await assert.rejects(send(),e=>e.code==='42501');
 for(const [who,aal] of [['A','aal1'],['C','aal2'],['D','aal2'],['E','aal2']]){await login(who,aal);
 if(who==='C'||aal==='aal1')await assert.rejects(list(),e=>e.code==='42501');else assert.deepEqual(await list(),[]);
 await assert.rejects(read(),e=>e.code==='42501');await assert.rejects(send(),e=>e.code==='42501');}
 });
 await t.test('A窓口からB責任者へ送り、Bの再取得と返信をAが確認できる',async()=>{
 await login();const threads=await list();assert.equal(threads.length,1);assert.equal(threads[0].side,'client');
 assert.equal(threads[0].manager_name,'架空担当者B');const a=await send('架空：窓口への連絡です。');assert.match(a.id,/^\d+$/);
 await login('B');let data=await read();assert.equal(data.messages[0].body,'架空：窓口への連絡です。');assert.equal(data.messages[0].side,'client');
 await send('架空：管理責任者が受け取りました。');await login();data=await read();assert.equal(data.messages.length,2);assert.equal(data.messages[1].side,'agency');
 assert.equal(JSON.stringify(data).includes(ids.B),false);
 });
 await t.test('同じ送信番号の再送は1件に留まり、本文差し替えや空欄・長文・不明IDを拒否',async()=>{
 const nonce=randomUUID();const a=await send('再送検証',nonce);assert.equal((await send('再送検証',nonce)).id,a.id);
 await assert.rejects(send('内容差し替え',nonce),e=>e.code==='22023');
 for(const body of ['',null,'   ','\n\t','長'.repeat(2001)])await assert.rejects(send(body),e=>e.code==='22023');
 await assert.rejects(send('x',null),e=>e.code==='22023');await assert.rejects(read(randomUUID()),e=>e.code==='42501');
 await assert.rejects(send('x',randomUUID(),1,1,randomUUID()),e=>e.code==='42501');
 assert.equal((await read()).messages.length,3);
 });
 await t.test('50件ずつ時系列で取得し、直接の表/列/更新/削除/内部関数アクセスは拒否',async()=>{
 for(let n=0;n<52;n++)await send('ページ検証'+n);
 const latest=await read();assert.equal(latest.messages.length,50);const older=await read(proof,latest.messages[0].id);assert.equal(older.messages.length,5);
 assert.ok(BigInt(older.messages.at(-1).id)<BigInt(latest.messages[0].id));
 for(const sql of ['select * from connexy_private.responsible_messages',"insert into connexy_private.responsible_messages(body) values('直接')",'update connexy_private.responsible_messages set body=\'改変\'','delete from connexy_private.responsible_messages',`select connexy_private.communication_scope('${proof}')`])await assert.rejects(db.query(sql),e=>e.code==='42501');
 await assert.rejects(read(proof,-1),e=>e.code==='22023');
 });
 await t.test('責任者変更で古い本人・古い画面・新責任者への履歴引継を拒否',async()=>{
 await login();await db.query("select public.connexy_save_job_responsibilities('connexy-browser-disclosure-approved','demoastaff','aother','demoastaff',1)");
 assert.deepEqual(await list(),[]);await assert.rejects(read(),e=>e.code==='42501');await assert.rejects(send(),e=>e.code==='42501');
 await login('D');assert.equal((await list()).length,1);assert.deepEqual((await read()).messages,[]);
 await assert.rejects(send('古い画面'),e=>e.code==='40001');await send('新窓口',randomUUID(),2,1);
 await login('B');assert.equal((await read()).messages.length,1);
 await db.query("select public.connexy_save_agency_manager($1,'bother',1)",[proof]);
 for(const who of ['D','B','E']){await login(who);assert.deepEqual(await list(),[]);await assert.rejects(read(),e=>e.code==='42501');await assert.rejects(send(),e=>e.code==='42501');}
 await login('B');await db.query("select public.connexy_save_agency_manager($1,'demobstaff',2)",[proof]);
 assert.deepEqual((await read()).messages,[]);await assert.rejects(send('古い版',randomUUID(),2,1),e=>e.code==='40001');
 });
 await t.test('所属停止・承諾取消・案件変更・期限切れ・会社停止・セッション期限切れを毎回再確認',async()=>{
 await owner();const job=(await db.query("select to_jsonb(j) data from public.jobs j where id='connexy-browser-disclosure-approved'")).rows[0].data;
 for(const change of [
 `update public.connexy_auth_memberships set active=false where auth_user_id='${ids.D}'`,
 `update connexy_private.sb_approvals set status='revoked' where id='${proof}'`,
 "update public.jobs set price=999 where id='connexy-browser-disclosure-approved'",
 // 時間経過後の既存記録をローカルDBに再現するためだけのfixture。実行用SQLには含めない。
 `alter table connexy_private.sb_approvals disable trigger prepare_sb_approval;update connexy_private.sb_approvals set approved_on=current_date-20,expires_on=current_date-1 where id='${proof}';alter table connexy_private.sb_approvals enable trigger prepare_sb_approval`,
 "update public.companies set status='pending' where id='demoa'"]){
 await owner('begin');await db.exec(change);await login('B');assert.deepEqual(await list(),[]);
 await db.exec('savepoint denied');await assert.rejects(read(),e=>e.code==='42501');await db.exec('rollback to denied');
 await assert.rejects(send('拒否',randomUUID(),2,3),e=>e.code==='42501');await db.exec('rollback to denied');await owner('rollback');}
 assert.equal(Number((await db.query("select price from public.jobs where id='connexy-browser-disclosure-approved'")).rows[0].price),job.price);
 await owner(`update public.connexy_auth_memberships set member_role='staff' where auth_user_id='${ids.B}'`);
 await login('D');assert.deepEqual(await list(),[]);await assert.rejects(read(),e=>e.code==='42501');await assert.rejects(send('役割停止',randomUUID(),2,3),e=>e.code==='42501');
 await owner(`update public.connexy_auth_memberships set member_role='admin' where auth_user_id='${ids.B}'`);
 await owner(`update auth.sessions set created_at=now()-interval '9 hours' where user_id='${ids.B}'`);await login('B');await assert.rejects(list(),e=>e.code==='42501');await assert.rejects(read(),e=>e.code==='42501');
 await owner(`update auth.sessions set created_at=now() where user_id='${ids.B}'`);
 });
 await t.test('118番の片付けは専用検証連絡も連動削除し、認証・通常チャットは変更しない',async()=>{
 await owner();assert.ok((await db.query('select count(*)::int n from connexy_private.responsible_messages')).rows[0].n>0);
 assert.equal((await db.query('select count(*)::int n from public.contract_tasks')).rows[0].n,0);
 await db.exec(fs.readFileSync('supabase/118_browser_disclosure_cleanup.sql','utf8'));
 assert.equal((await db.query('select count(*)::int n from connexy_private.responsible_messages')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from public.connexy_auth_memberships')).rows[0].n,5);
 await login('B');assert.deepEqual(await list(),[]);
 });
 await t.test('123番は両責任者を架空案件にだけ準備し、再実行でも連絡を保持し、118番で片付ける',async()=>{
 await owner();const authBefore=(await db.query('select to_jsonb(m) data from public.connexy_auth_memberships m order by auth_user_id')).rows;
 const sql=fs.readFileSync('supabase/123_browser_communication_fixture.sql','utf8');await db.exec(sql);await db.exec(sql);
 await login();assert.equal((await list()).length,1);await send('ブラウザ検証用の架空連絡');
 await owner();await db.exec(sql);await login('B');assert.equal((await read()).messages[0].body,'ブラウザ検証用の架空連絡');
 await owner();await db.exec(fs.readFileSync('supabase/118_browser_disclosure_cleanup.sql','utf8'));
 assert.deepEqual((await db.query('select to_jsonb(m) data from public.connexy_auth_memberships m order by auth_user_id')).rows,authBefore);
 assert.equal((await db.query('select count(*)::int n from connexy_private.responsible_messages')).rows[0].n,0);
 // 既存の二次責任者が別人なら上書きしない。
 await db.exec(sql);await db.exec("update connexy_private.agency_managers set manager_staff_id='bother'");
 await assert.rejects(db.exec(sql),/二次責任者が想定と異なり/);await db.exec('rollback');
 assert.equal((await db.query('select manager_staff_id from connexy_private.agency_managers')).rows[0].manager_staff_id,'bother');
 });
 }finally{await db.close();}
});

