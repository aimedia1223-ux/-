const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');const {randomUUID}=require('node:crypto');
test('二次委託先の管理責任者と双方の連絡窓口の権限制御',async t=>{
 const db=new PGlite();const ids=Object.fromEntries(['A','B','C','E'].map((key,n)=>[key,`00000000-0000-4000-8000-00000000000${n+1}`]));
 const proof=randomUUID(),pub=randomUUID();let snapshot;
 async function owner(sql=''){await db.exec("reset role;select set_config('request.jwt.sub','',false)");if(sql)await db.exec(sql);}
 async function login(who='B',aal='aal2'){await owner();await db.query("select set_config('request.jwt.sub',$1,false),set_config('request.jwt.aal',$2,false)",[ids[who],aal]);await db.exec('set role authenticated');}
 async function list(){return (await db.query('select public.connexy_list_agency_managers() data')).rows[0].data;}
 async function save(version=0,manager='demobstaff',approval=proof){return (await db.query('select public.connexy_save_agency_manager($1,$2,$3) data',[approval,manager,version])).rows[0].data;}
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',auth.uid()::text,'aal',current_setting('request.jwt.aal',true))$$;
   grant usage on schema public,auth to anon,authenticated;`);
  for(const file of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql','115_confidential_job_disclosure.sql','119_job_responsibilities.sql','120_agency_managers.sql','122_responsible_communications.sql','124_audit_log.sql'])await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
  await db.exec("insert into public.staffs(id,user_id,name) values('ageneral','demoa','A一般'),('bmanager','demob','B別管理者');insert into public.jobs(id,author_id,title,event_date,price) values('ja','demoa','SECRET-一次の案件',(current_date+10)::text,10000)");
  for(const [who,company,staff,role] of [['A','demoa','demoastaff','admin'],['B','demob','demobstaff','admin'],['C','demoa','ageneral','staff'],['E','demob','bmanager','admin']])
   await db.exec(`insert into auth.users values('${ids[who]}');insert into auth.sessions values('${ids[who]}','${ids[who]}',now());insert into public.connexy_auth_memberships values('${ids[who]}','${company}','${staff}','${who}','${role}',true);`);
  snapshot=(await db.query("select to_jsonb(j) data from public.jobs j where id='ja'")).rows[0].data;
  await db.query("insert into connexy_private.job_publications(public_id,job_id,region,category,enabled,job_snapshot) values($1,'ja','関東','店舗運営支援',true,'{}')",[pub]);
  await t.test('未承諾時は案件が表示されず、匿名・MFA前・一般担当者は一覧/登録を拒否',async()=>{
   await login();assert.deepEqual((await list()).items,[]);await assert.rejects(save(),e=>e.code==='42501');
   await owner('set role anon');await assert.rejects(list(),e=>e.code==='42501');await assert.rejects(save(),e=>e.code==='42501');
   for(const [who,aal] of [['B','aal1'],['C','aal2']]){await login(who,aal);await assert.rejects(list(),e=>e.code==='42501');await assert.rejects(save(),e=>e.code==='42501');}
  });
  await owner();await db.query(`insert into connexy_private.sb_approvals(id,job_id,client_id,agency_id,staff_id,approval_number,document_reference,document_sha256,approved_on,work_from,work_until,expires_on,verified_by,verification_note,job_snapshot)
   values($1,'ja','demoa','demob','demobstaff','TEST','本物の原本なし',repeat('0',64),current_date,current_date+10,current_date+10,current_date+20,'架空検証','本物の承諾ではありません','{}')`,[proof]);
  await login('A');await db.query("select public.connexy_save_job_responsibilities('ja','demoastaff','demoastaff','demoastaff',0)");
  await t.test('承諾対象の本人に未登録の案件と一次窓口を表示し、候補は自社だけ',async()=>{
   await login();const state=await list();assert.equal(state.items.length,1);assert.equal(state.items[0].can_edit,true);
   assert.equal(state.items[0].has_assignment,false);assert.equal(state.items[0].primary_contacts.agency_contact_name,'架空担当者A');
   assert.deepEqual(state.candidates.map(c=>c.id).sort(),['bmanager','demobstaff']);
  });
  await t.test('一次委託先による代理登録・同じ二次会社の対象外管理者・未知の承諾IDを拒否',async()=>{
   await login('A');await assert.rejects(save(),e=>e.code==='42501');
   await login('E');assert.deepEqual((await list()).items,[]);await assert.rejects(save(),e=>e.code==='42501');
   await login();await assert.rejects(save(0,'demobstaff',randomUUID()),e=>e.code==='42501');
  });
  await t.test('他社・存在しない担当者・不正な版を拒否し、直接テーブルや内部関数へもアクセスできない',async()=>{
   for(const staff of ['demoastaff','unknown','',null])await assert.rejects(save(0,staff),e=>e.code==='22023');
   await assert.rejects(save(-1),e=>e.code==='22023');
   for(const sql of ['select * from connexy_private.agency_managers',"update connexy_private.agency_managers set version=99",`select connexy_private.agency_manager_json('${proof}',true)`])await assert.rejects(db.query(sql),e=>e.code==='42501');
  });
  await t.test('二次の管理者が登録すると保存済み一覧へ残り、一次側も有効な責任者と双方の窓口を取得',async()=>{
   const manager=await save(0,'bmanager');assert.equal(manager.version,1);assert.equal(manager.manager_name,'B別管理者');
   let state=await list();assert.equal(state.items[0].has_assignment,true);assert.equal(state.items[0].manager.version,1);
   assert.equal(JSON.stringify(state).includes(ids.B),false);
   await login('A');state=await list();assert.equal(state.items[0].side,'client');assert.equal(state.items[0].can_edit,false);
   assert.equal(state.items[0].manager.manager_name,'B別管理者');assert.equal(state.items[0].primary_contacts.agency_contact_name,'架空担当者A');
  });
  await t.test('責任者へ指定してもAuth権限や案件閲覧権限を追加せず、承諾・案件・契約を変更しない',async()=>{
   await login('E');assert.deepEqual((await list()).items,[]);assert.deepEqual((await db.query("select id from public.jobs where id='ja'")).rows,[]);
   await assert.rejects(db.query('select public.connexy_read_approved_job($1)',[pub]),e=>e.code==='42501');
   await owner();assert.deepEqual((await db.query("select to_jsonb(j) data from public.jobs j where id='ja'")).rows[0].data,snapshot);
   assert.equal((await db.query('select count(*)::int n from public.contract_tasks')).rows[0].n,0);
   assert.equal((await db.query('select count(*)::int n from connexy_private.job_readers')).rows[0].n,0);
   assert.equal((await db.query('select status from connexy_private.sb_approvals where id=$1',[proof])).rows[0].status,'verified');
  });
  await t.test('指定した責任者の所属停止で一次へ実名を返さず、二次には再設定を促す',async()=>{
   await owner(`update public.connexy_auth_memberships set active=false where auth_user_id='${ids.E}'`);
   await login('A');assert.equal((await list()).items[0].manager,null);
   await login();let state=await list();assert.equal(state.items[0].manager.is_current,false);assert.ok(!state.candidates.some(c=>c.id==='bmanager'));
   await assert.rejects(save(1,'bmanager'),e=>e.code==='22023');const next=await save(1);assert.equal(next.version,2);
   await assert.rejects(save(1),e=>e.code==='40001');assert.equal((await list()).items[0].manager.version,2);
  });
  await t.test('承諾取消後は二次へ一次の案件名・窓口を返さず、一次にも二次責任者の実名を返さない',async()=>{
   await owner(`update connexy_private.sb_approvals set status='revoked' where id='${proof}'`);
   await login();const state=await list();assert.equal(state.items[0].approved,false);assert.equal(state.items[0].can_edit,false);
   assert.equal(state.items[0].client_name,null);assert.equal(state.items[0].primary_contacts,null);assert.equal(JSON.stringify(state).includes('SECRET-一次'),false);
   assert.equal(state.items[0].manager.manager_name,'架空担当者B');await assert.rejects(save(2),e=>e.code==='42501');
   await login('A');assert.equal((await list()).items[0].manager,null);
  });
  await t.test('有効な再承諾が別のIDなら古い登録を引き継がず、案件変更でも登録を拒否する',async()=>{
   const nextProof=randomUUID();await owner();await db.query(`insert into connexy_private.sb_approvals(id,job_id,client_id,agency_id,staff_id,approval_number,document_reference,document_sha256,approved_on,work_from,work_until,expires_on,verified_by,verification_note,job_snapshot)
    select $1,job_id,client_id,agency_id,staff_id,approval_number,document_reference,document_sha256,approved_on,work_from,work_until,expires_on,verified_by,verification_note,'{}' from connexy_private.sb_approvals where id=$2`,[nextProof,proof]);
   await login();let state=await list();assert.equal(state.items.find(item=>item.approval_id===nextProof).has_assignment,false);
   await owner("update public.jobs set price=20000 where id='ja'");await login();await assert.rejects(save(0,'demobstaff',nextProof),e=>e.code==='42501');
   assert.ok(!(await list()).items.some(item=>item.approval_id===nextProof));
  });
  await t.test('所属停止・8時間超過のログインから一覧取得と登録を拒否する',async()=>{
   await owner(`update public.connexy_auth_memberships set active=false where auth_user_id='${ids.B}'`);
   await login();await assert.rejects(list(),e=>e.code==='42501');await assert.rejects(save(2),e=>e.code==='42501');
   await owner(`update public.connexy_auth_memberships set active=true where auth_user_id='${ids.B}';update auth.sessions set created_at=now()-interval '9 hours' where user_id='${ids.B}'`);
   await login();await assert.rejects(list(),e=>e.code==='42501');await assert.rejects(save(2),e=>e.code==='42501');
  });
 }finally{await db.close();}
});

