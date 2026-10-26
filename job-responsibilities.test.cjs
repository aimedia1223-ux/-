const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {randomUUID}=require('node:crypto');

test('案件責任者の所有会社・役割・所属・承諾・競合制御',async t=>{
 const db=new PGlite();
 const ids=Object.fromEntries(['A','B','C','D','E'].map((key,n)=>[key,`00000000-0000-4000-8000-00000000000${n+1}`]));
 const pub=randomUUID();let snapshot,approval;
 async function owner(sql=''){await db.exec("reset role;select set_config('request.jwt.sub','',false)");if(sql)await db.exec(sql);}
 async function login(who='A',aal='aal2'){await owner();await db.query("select set_config('request.jwt.sub',$1,false),set_config('request.jwt.aal',$2,false)",[ids[who],aal]);await db.exec('set role authenticated');}
 async function get(job='ja'){return (await db.query('select public.connexy_get_job_responsibilities($1) data',[job])).rows[0].data;}
 async function save(version=0,sb='demoastaff',agency='demoastaff',incident='demoastaff',job='ja'){
  return (await db.query('select public.connexy_save_job_responsibilities($1,$2,$3,$4,$5) data',[job,sb,agency,incident,version])).rows[0].data;
 }
 async function detail(){return (await db.query('select public.connexy_read_approved_job($1) data',[pub])).rows[0].data;}
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',auth.uid()::text,'aal',current_setting('request.jwt.aal',true))$$;
   grant usage on schema public,auth to anon,authenticated;`);
  for(const file of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql','115_confidential_job_disclosure.sql','119_job_responsibilities.sql','120_agency_managers.sql','122_responsible_communications.sql','124_audit_log.sql'])await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
  await db.exec(`insert into public.staffs(id,user_id,name) values('ageneral','demoa','A一般担当者'),('ainactive','demoa','A停止担当者'),('aunlinked','demoa','A所属未登録'),('bother','demob','B別担当者');
   insert into public.jobs(id,author_id,title,event_date,price) values('ja','demoa','架空の責任者検証',(current_date+10)::text,10000),('jb','demob','B案件',(current_date+10)::text,10000);`);
  for(const [who,company,staff,role,active] of [['A','demoa','demoastaff','admin',true],['B','demob','demobstaff','admin',true],['C','demoa','ageneral','staff',true],['D','demoa','ainactive','staff',false],['E','demob','bother','admin',true]]){
   await db.exec(`insert into auth.users values('${ids[who]}');insert into auth.sessions values('${ids[who]}','${ids[who]}',now());
    insert into public.connexy_auth_memberships values('${ids[who]}','${company}','${staff}','${who}','${role}',${active});`);
  }
  await db.query("insert into connexy_private.job_publications(public_id,job_id,region,category,enabled,job_snapshot) values($1,'ja','関東','店舗運営支援',true,'{}')",[pub]);
  snapshot=(await db.query("select to_jsonb(j) data from public.jobs j where id='ja'")).rows[0].data;
  await t.test('匿名・MFA前・一般担当者・他社管理者・存在しない案件からの取得と保存を拒否',async()=>{
   await owner('set role anon');await assert.rejects(get(),e=>e.code==='42501');await assert.rejects(save(),e=>e.code==='42501');
   for(const [who,aal] of [['A','aal1'],['C','aal2'],['B','aal2'],['D','aal2']]){
    await login(who,aal);await assert.rejects(get(),e=>e.code==='42501');await assert.rejects(save(),e=>e.code==='42501');
   }
   await login();await assert.rejects(get('unknown'),e=>e.code==='42501');await assert.rejects(save(0,undefined,undefined,undefined,'unknown'),e=>e.code==='42501');
  });
  await t.test('未登録状態は自社の有効な所属担当者だけを候補とし、他社/停止/未所属を含まない',async()=>{
   await login();const state=await get();assert.equal(state.contacts,null);
   assert.deepEqual(state.candidates.map(c=>c.id).sort(),['ageneral','demoastaff']);
   assert.ok(state.candidates.every(c=>Object.keys(c).sort().join(',')==='id,name'));
  });
  await t.test('他社・停止・未所属・空の担当者や不正な版番号を拒否して未登録を維持する',async()=>{
   for(const staff of ['demobstaff','ainactive','aunlinked','',null])await assert.rejects(save(0,staff),e=>e.code==='22023');
   await assert.rejects(save(-1),e=>e.code==='22023');assert.equal((await get()).contacts,null);
  });
  await t.test('自社管理者が兼任を保存でき、会社/更新者/時刻をサーバーで決める',async()=>{
   const row=await save(0,'demoastaff','ageneral','ageneral');assert.equal(row.version,1);assert.equal(row.is_current,true);
   assert.equal(row.agency_contact_name,'A一般担当者');assert.ok(!JSON.stringify(row).includes(ids.A));
   assert.deepEqual((await get()).contacts,row);
   await owner();const saved=(await db.query('select * from connexy_private.job_responsibilities')).rows[0];
   assert.equal(saved.company_id,'demoa');assert.equal(saved.updated_by,ids.A);assert.ok(saved.updated_at);
   assert.deepEqual((await db.query("select to_jsonb(j) data from public.jobs j where id='ja'")).rows[0].data,snapshot);
   // 責任者への指定だけで案件閲覧権限を増やさない。
   await login('C');assert.deepEqual((await db.query("select id from public.jobs where id='ja'")).rows,[]);
  });
  await t.test('責任者の直接取得・直接書込・内部関数の実行は管理者でも拒否',async()=>{
   await login();for(const sql of ['select * from connexy_private.job_responsibilities',"update connexy_private.job_responsibilities set version=99", "select connexy_private.job_responsibility_json('ja',true)","select connexy_private.responsibility_staff_active('ageneral','demoa')"])
    await assert.rejects(db.query(sql),e=>e.code==='42501');
  });
  await t.test('責任者名は概要に含めず、未承諾や別担当者の詳細取得も拒否する',async()=>{
   await login('B');const rows=(await db.query('select public.connexy_list_job_summaries() data')).rows[0].data;
   assert.equal(rows.length,1);assert.equal(Object.keys(rows[0]).length,3);assert.equal(JSON.stringify(rows).includes('一般担当者'),false);
   await assert.rejects(detail(),e=>e.code==='42501');
   await owner();approval=randomUUID();await db.query(`insert into connexy_private.sb_approvals(id,job_id,client_id,agency_id,staff_id,approval_number,document_reference,document_sha256,approved_on,work_from,work_until,expires_on,verified_by,verification_note,job_snapshot)
    values($1,'ja','demoa','demob','demobstaff','TEST','原本なし',repeat('0',64),current_date,current_date+10,current_date+10,current_date+20,'架空検証','本物の承諾ではありません','{}')`,[approval]);
   await login('E');await assert.rejects(detail(),e=>e.code==='42501');
   await login('B');assert.equal((await detail()).contacts.agency_contact_name,'A一般担当者');
  });
  await t.test('担当者の所属停止で他社への責任者名を隠し、自社へ再設定を促す',async()=>{
   await owner(`update public.connexy_auth_memberships set active=false where auth_user_id='${ids.C}'`);
   await login('B');assert.equal((await detail()).contacts,null);
   await login();const state=await get();assert.equal(state.contacts.is_current,false);assert.ok(!state.candidates.some(c=>c.id==='ageneral'));
   await assert.rejects(save(1,'demoastaff','ageneral','demoastaff'),e=>e.code==='22023');
   const row=await save(1);assert.equal(row.version,2);assert.equal(row.is_current,true);
   await login('B');assert.equal((await detail()).contacts.version,2);
  });
  await t.test('古い版での上書きを拒否し、責任者変更でも既存の承諾は有効なまま',async()=>{
   await login();await assert.rejects(save(1),e=>e.code==='40001');assert.equal((await get()).contacts.version,2);
   const gate=(await db.query("select * from public.connexy_check_sb_approval('ja','demob','demobstaff')")).rows[0];
   assert.equal(gate.approved,true);assert.equal(gate.approval_id,approval);
   await owner();assert.deepEqual((await db.query("select to_jsonb(j) data from public.jobs j where id='ja'")).rows[0].data,snapshot);
  });
  await t.test('承諾取消・所属停止・ログイン期限切れを次の取得/保存に反映',async()=>{
   await owner(`update connexy_private.sb_approvals set status='revoked' where id='${approval}'`);
   await login('B');await assert.rejects(detail(),e=>e.code==='42501');
   await owner(`update public.connexy_auth_memberships set active=false where auth_user_id='${ids.A}'`);
   await login();await assert.rejects(get(),e=>e.code==='42501');await assert.rejects(save(2),e=>e.code==='42501');
   await owner(`update public.connexy_auth_memberships set active=true where auth_user_id='${ids.A}';update auth.sessions set created_at=now()-interval '9 hours' where user_id='${ids.A}'`);
   await login();await assert.rejects(get(),e=>e.code==='42501');await assert.rejects(save(2),e=>e.code==='42501');
  });
 }finally{await db.close();}
});

