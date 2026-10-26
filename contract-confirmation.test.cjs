const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');

test('当事者の条件提示・承諾・契約確定RPC',async t=>{
 const db=new PGlite();
 const ids={A:'00000000-0000-4000-8000-000000000001',B:'00000000-0000-4000-8000-000000000002',C:'00000000-0000-4000-8000-000000000003',D:'00000000-0000-4000-8000-000000000004'};
 const terms='架空検証専用の契約条件です。税込・経費なし・支払日は別途記載した日とします。';
 let sequence=0;
 async function owner(sql=''){await db.exec("reset role;select set_config('request.jwt.sub','',false)");if(sql)return db.exec(sql);}
 async function login(who='A',aal='aal2'){
  await owner();await db.query("select set_config('request.jwt.sub',$1,false),set_config('request.jwt.aal',$2,false)",[ids[who],aal]);await db.exec('set role authenticated');
 }
 async function propose(job,request=randomUUID(),text=terms){return (await db.query('select public.connexy_create_contract_offer($1,$2,$3,$4,$5) as id',[request,job,'demob','demobstaff',text])).rows[0].id;}
 async function respond(id,action='confirm'){return (await db.query('select public.connexy_respond_contract_offer($1,$2) as id',[id,action])).rows[0].id;}
 async function list(){return (await db.query('select public.connexy_list_contract_offers() as data')).rows[0].data;}
 async function scope(){
  const job='contract-job-'+(++sequence),approval=randomUUID();
  await owner(`insert into public.jobs(id,author_id,title,description,event_date,price) values('${job}','demoa','架空契約案件','架空の業務内容',((now() at time zone 'Asia/Tokyo')::date+10)::text,12000);
   insert into connexy_private.sb_approvals(id,job_id,client_id,agency_id,staff_id,approval_number,document_reference,document_sha256,approved_on,work_from,work_until,expires_on,verified_by,verification_note,job_snapshot)
   values('${approval}','${job}','demoa','demob','demobstaff','架空','架空原本参照',repeat('a',64),(now() at time zone 'Asia/Tokyo')::date,(now() at time zone 'Asia/Tokyo')::date+10,(now() at time zone 'Asia/Tokyo')::date+10,(now() at time zone 'Asia/Tokyo')::date+20,'架空照合担当','テスト用・本物のSB承諾ではない','{}');`);
  return {job,approval};
 }
 async function offer(){const s=await scope();await login();return {...s,id:await propose(s.job)};}
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key);
   create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',auth.uid()::text,'aal',current_setting('request.jwt.aal',true))$$;
   grant usage on schema public,auth to anon,authenticated;`);
  for(const file of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql','115_confidential_job_disclosure.sql','119_job_responsibilities.sql','120_agency_managers.sql','122_responsible_communications.sql','124_audit_log.sql']) await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
  await db.exec(`insert into public.staffs(id,user_id,name) values('demoageneral','demoa','架空一般担当者');
   insert into public.companies(id,name,status) values('demod','無関係な会社','approved');
   insert into public.staffs(id,user_id,name) values('demodstaff','demod','D');`);
  for(const [who,company,staff,role] of [['A','demoa','demoastaff','admin'],['B','demob','demobstaff','admin'],['C','demoa','demoageneral','staff'],['D','demod','demodstaff','admin']]){
   await db.exec(`insert into auth.users values('${ids[who]}');insert into auth.sessions values('${ids[who]}','${ids[who]}',now());
    insert into public.connexy_auth_memberships values('${ids[who]}','${company}','${staff}','${who}','${role}',true);`);
  }
  await t.test('匿名・一般担当者・追加認証前は一覧/提示/確定を利用できない',async()=>{
   for(const [who,aal] of [['A','aal1'],['C','aal2']]){
    await login(who,aal);await assert.rejects(list(),/追加認証/);await assert.rejects(propose('unknown'),/追加認証/);await assert.rejects(respond(randomUUID()),/追加認証/);
   }
   await owner('set role anon');await assert.rejects(list(),/permission denied/);
  });
  await t.test('未承諾案件の条件提示と無関係な会社による提示を拒否',async()=>{
   await owner("insert into public.jobs(id,author_id,title,event_date) values('unapproved','demoa','未承諾',((now() at time zone 'Asia/Tokyo')::date+10)::text)");
   await login();await assert.rejects(propose('unapproved'),/事前書面承諾/);
   await login('D');await assert.rejects(propose('unapproved'),/自社案件/);assert.deepEqual(await list(),[]);
  });
  let first;
  await t.test('当事者だけに提示を開示し、同じ送信の再試行で重複作成しない',async()=>{
   first=await scope();await login();const request=randomUUID();first.id=await propose(first.job,request);
   assert.equal(await propose(first.job,request),first.id);
   await assert.rejects(propose(first.job,request,terms+'追記'),/一致しません/);
   assert.equal((await list()).length,1);
   await login('B');const b=await list();assert.equal(b.length,1);assert.equal(b[0].daily_price,12000);assert.equal(b[0].terms,terms);assert.equal(b[0].status,'offered');
   await login('D');assert.deepEqual(await list(),[]);await assert.rejects(respond(first.id),/操作権限/);
   await owner();assert.equal((await db.query('select count(*)::int n from public.contract_tasks')).rows[0].n,0);
  });
  await t.test('発注側は単独確定できず、受注側は提示を取り下げられない',async()=>{
   await login();await assert.rejects(respond(first.id),/操作権限/);
   await login('B');await assert.rejects(respond(first.id,'withdraw'),/操作権限/);
  });
  await t.test('二次委託先管理者の確定で契約と回答を原子的に保存し、再送しても一件だけ',async()=>{
   await login('B');const final=await respond(first.id);assert.equal(await respond(first.id),final);
   const rows=await list();assert.equal(rows[0].status,'confirmed');assert.equal(rows[0].contract_id,final);
   await owner();const saved=(await db.query('select * from public.contract_tasks')).rows;
   assert.equal(saved.length,1);assert.equal(saved[0].client_id,'demoa');assert.equal(saved[0].agency_id,'demob');assert.equal(saved[0].sb_staff_id,'demobstaff');assert.equal(saved[0].sb_approval_id,first.approval);
   assert.equal(saved[0].price,'12000');assert.equal(saved[0].client_contract_text,terms);assert.equal(saved[0].client_contract_approved_by_client,true);assert.equal(saved[0].client_contract_approved_by_agency,true);
   await login();await assert.rejects(propose(first.job),/すでに確定/);
  });
  await t.test('直接の契約書込と非公開提示表の取得・改変は引き続き拒否',async()=>{
   await login();await assert.rejects(db.exec("insert into public.contract_tasks(id,job_id) values('bypass','unapproved')"),/permission denied/);
   await assert.rejects(db.query('select * from connexy_private.contract_offers'),/permission denied/);
   await assert.rejects(db.exec("update connexy_private.contract_offers set status='confirmed'"),/permission denied/);
  });
  await t.test('承諾取消・案件変更・当事者情報変更後は確定せず提示状態を維持',async()=>{
   for(const kind of ['revoke','job','party']){
    const o=await offer();
    if(kind==='revoke')await owner(`update connexy_private.sb_approvals set status='revoked' where id='${o.approval}'`);
    if(kind==='job')await owner(`update public.jobs set price=13000 where id='${o.job}'`);
    if(kind==='party')await owner("update public.staffs set name='変更後' where id='demobstaff'");
    await login('B');await assert.rejects(respond(o.id),/変わりました/);
    if(kind==='party') assert.equal((await list()).find(x=>x.id===o.id).status,'offered');
    else assert.equal((await list()).some(x=>x.id===o.id),false);
    await owner();assert.equal((await db.query('select count(*)::int n from public.contract_tasks where contract_offer_id=$1',[o.id])).rows[0].n,0);
    if(kind==='party')await owner("update public.staffs set name='架空担当者B' where id='demobstaff'");
   }
  });
  await t.test('辞退/取下げは各当事者だけが行え、再送しても確定に変わらない',async()=>{
   for(const [action,who,state] of [['decline','B','declined'],['withdraw','A','withdrawn']]){
    const o=await offer();await login(who);assert.equal(await respond(o.id,action),null);assert.equal(await respond(o.id,action),null);
    await login('B');await assert.rejects(respond(o.id),/すでに確定/);
    assert.equal((await list()).find(x=>x.id===o.id).status,state);
   }
  });
  await t.test('同じ対象への二重提示を防ぎ、取下げ後は新しい条件で提示できる',async()=>{
   const o=await offer();await login();await assert.rejects(propose(o.job),/duplicate key/);
   await respond(o.id,'withdraw');assert.ok(await propose(o.job,randomUUID(),terms+'新条件'));
  });
  await t.test('期限切れの提示は確定できず、辞退・取り下げだけできる',async()=>{
   const o=await offer();await login();await respond(o.id,'withdraw');
   const expired=randomUUID();
   await owner(`insert into connexy_private.contract_offers(id,job_id,client_id,agency_id,staff_id,approval_id,terms,snapshot,work_dates,daily_price,expires_at,created_by)
    select '${expired}',job_id,client_id,agency_id,staff_id,approval_id,terms,snapshot,work_dates,daily_price,now()-interval '1 second',created_by
    from connexy_private.contract_offers where id='${o.id}'`);
   await login('B');await assert.rejects(respond(expired),/回答期限/);assert.equal(await respond(expired,'decline'),null);
  });
  await t.test('契約作成後に回答保存で失敗しても、確定契約だけが残ることはない',async()=>{
   const o=await offer();
   await owner("begin;create or replace function connexy_private.protect_contract_offer() returns trigger language plpgsql as $$begin raise exception 'SIMULATED_RESPONSE_FAILURE';end;$$");
   await login('B');await assert.rejects(respond(o.id),/SIMULATED_RESPONSE_FAILURE/);await db.exec('rollback');
   await owner();assert.equal((await db.query('select count(*)::int n from public.contract_tasks where contract_offer_id=$1',[o.id])).rows[0].n,0);
   assert.equal((await db.query('select status from connexy_private.contract_offers where id=$1',[o.id])).rows[0].status,'offered');
  });
  await t.test('提示条件の上書きをDBでも拒否し、停止所属・8時間超過は操作を拒否',async()=>{
   const o=await offer();await owner();await assert.rejects(db.exec(`update connexy_private.contract_offers set terms='上書き' where id='${o.id}'`),/変更できません/);
   await owner(`update public.connexy_auth_memberships set active=false where auth_user_id='${ids.B}'`);await login('B');await assert.rejects(respond(o.id),/追加認証/);
   await owner(`update public.connexy_auth_memberships set active=true;update auth.sessions set created_at=now()-interval '9 hours' where user_id='${ids.B}'`);await login('B');await assert.rejects(respond(o.id),/追加認証/);
  });
 }finally{await db.close();}
});

