const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');

test('承諾前の公開概要と承諾対象本人への詳細開示',async t=>{
 const db=new PGlite();
 const ids=Object.fromEntries(['A','B','C','D','E'].map((key,n)=>[key,`00000000-0000-4000-8000-00000000000${n+1}`]));
 const secret='SECRET-店舗・担当者・顧客';
 const terms=secret+'を含む架空検証条件です。本物の承諾ではありません。';
 let publicId,proof,offer;
 async function owner(sql='') { await db.exec("reset role;select set_config('request.jwt.sub','',false)"); if(sql)return db.exec(sql); }
 async function login(who='B',aal='aal2') {
  await owner();await db.query("select set_config('request.jwt.sub',$1,false),set_config('request.jwt.aal',$2,false)",[ids[who],aal]);await db.exec('set role authenticated');
 }
 async function summaries(){return (await db.query('select public.connexy_list_job_summaries() data')).rows[0].data;}
 async function detail(id=publicId){return (await db.query('select public.connexy_read_approved_job($1) data',[id])).rows[0].data;}
 async function offers(){return (await db.query('select public.connexy_list_contract_offers() data')).rows[0].data;}
 async function approve(){
  proof=randomUUID();await owner();
  await db.query(`insert into connexy_private.sb_approvals(id,job_id,client_id,agency_id,staff_id,approval_number,document_reference,document_sha256,approved_on,work_from,work_until,expires_on,verified_by,verification_note,job_snapshot)
    values($1,'secret-job','demoa','demob','demobstaff','TEST','NO-ORIGINAL',repeat('0',64),current_date,current_date+10,current_date+10,current_date+20,'TEST','架空検証のみ','{}')`,[proof]);
 }
 try {
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.sub',true),''))::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,jsonb_build_object('session_id',auth.uid()::text,'aal',current_setting('request.jwt.aal',true)))$$;
    grant usage on schema public,auth to anon,authenticated;`);
  for(const file of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql','115_confidential_job_disclosure.sql','119_job_responsibilities.sql','120_agency_managers.sql','122_responsible_communications.sql','124_audit_log.sql']) await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
  await owner(`insert into public.companies(id,name,status) values('demod','別会社','approved');
    insert into public.staffs(id,user_id,name) values('demoageneral','demoa','A一般'),('demodstaff','demod','D'),('demobother','demob','B別担当');`);
  for(const [who,company,staff,role] of [['A','demoa','demoastaff','admin'],['B','demob','demobstaff','admin'],['C','demoa','demoageneral','staff'],['D','demod','demodstaff','admin'],['E','demob','demobother','admin']]){
   await db.exec(`insert into auth.users values('${ids[who]}');insert into auth.sessions values('${ids[who]}','${ids[who]}',now());
    insert into public.connexy_auth_memberships values('${ids[who]}','${company}','${staff}','${who}','${role}',true);`);
  }
  await db.query(`insert into public.jobs(id,author_id,title,description,detailed_description,location_name,exact_location,event_date,work_hours,price,lat,lng,requirements)
    values('secret-job','demoa',$1,$1,$1,$1,$1,(current_date+10)::text,$1,12345,35.123456,139.123456,array[$1])`,[secret]);
  await t.test('既存案件を自動公開せず、匿名・追加認証前は概要も取得不可',async()=>{
   await login();assert.deepEqual(await summaries(),[]);
   await login('B','aal1');await assert.rejects(summaries(),e=>e.code==='42501');await assert.rejects(detail(randomUUID()),e=>e.code==='42501');
   await owner('set role anon');await assert.rejects(summaries(),e=>e.code==='42501');
  });
  await t.test('公開概要は定型の地域・業務区分・不透明IDだけで、生データや座標を含まない',async()=>{
   await owner("insert into connexy_private.job_publications(job_id,region,category,enabled,job_snapshot) values('secret-job','関東','店舗運営支援',true,'{}')");
   publicId=(await db.query('select public_id from connexy_private.job_publications')).rows[0].public_id;
   await login();const rows=await summaries();assert.equal(rows.length,1);
   assert.deepEqual(Object.keys(rows[0]).sort(),['category','public_id','region']);
   for(const value of [secret,'secret-job','demoa','12345','35.123456','139.123456'])assert.equal(JSON.stringify(rows).includes(value),false);
  });
  await t.test('概要IDを知っていても未承諾の詳細・生テーブル・内部関数は取得できない',async()=>{
   await login();await assert.rejects(detail(),e=>e.code==='42501');await assert.rejects(detail(randomUUID()),e=>e.code==='42501');
   assert.deepEqual((await db.query("select * from public.jobs where id='secret-job'")).rows,[]);
   for(const sql of ['select * from connexy_private.job_publications','select connexy_private.connexy_list_contract_offers()',"update connexy_private.job_publications set enabled=true"])
    await assert.rejects(db.query(sql),e=>e.code==='42501');
  });
  await t.test('有効な承諾対象本人のみ詳細を開示し、同じ会社の別管理者にも開示しない',async()=>{
   await approve();await login();const row=await detail();assert.equal(row.title,secret);assert.equal(row.exact_location,secret);
   assert.equal('lat' in row,false);assert.equal('job_snapshot' in row,false);assert.equal('document_reference' in row,false);
   for(const who of ['D','E','C','A']){await login(who);await assert.rejects(detail(),e=>e.code==='42501');}
   await login('C');assert.deepEqual((await db.query("select id from public.jobs where id='secret-job'")).rows,[]);
  });
  await t.test('契約一覧の機密詳細も本人と承諾を再確認し、内部RPCへの迂回不可',async()=>{
   await login('A');offer=(await db.query("select public.connexy_create_contract_offer($1,'secret-job','demob','demobstaff',$2) id",[randomUUID(),terms])).rows[0].id;
   await login('B');assert.equal((await offers()).length,1);
   await login('E');assert.deepEqual(await offers(),[]);
   await login('D');assert.deepEqual(await offers(),[]);
   await owner(`update connexy_private.sb_approvals set status='revoked' where id='${proof}'`);
   await login('B');assert.deepEqual(await offers(),[]);await assert.rejects(detail(),e=>e.code==='42501');
   await login('A');assert.equal((await offers())[0].id,offer);
  });
  await t.test('元案件の変更で公開概要・詳細を停止し、公開概要を再確認しても古い承諾は無効',async()=>{
   await approve();await owner("update public.jobs set price=54321 where id='secret-job'");
   await login();assert.deepEqual(await summaries(),[]);await assert.rejects(detail(),e=>e.code==='42501');
   await owner("update connexy_private.job_publications set enabled=true");
   await login();assert.equal((await summaries()).length,1);await assert.rejects(detail(),e=>e.code==='42501');
   assert.deepEqual(await offers(),[]);
  });
  await t.test('会社限定公開・公開停止は概要と詳細の両方に適用し、自由入力の概要を保存不可',async()=>{
   await owner(`update connexy_private.sb_approvals set status='revoked' where id='${proof}'; update public.jobs set allowed_company_ids=array['demob'] where id='secret-job'; update connexy_private.job_publications set enabled=true`);
   await approve();await login('D');assert.deepEqual(await summaries(),[]);await assert.rejects(detail(),e=>e.code==='42501');
   await login('B');assert.equal((await summaries()).length,1);assert.equal((await detail()).title,secret);
   await owner("update connexy_private.job_publications set enabled=false");await login();assert.deepEqual(await summaries(),[]);await assert.rejects(detail(),e=>e.code==='42501');
   await owner();await assert.rejects(db.exec(`update connexy_private.job_publications set region='${secret}'`),e=>e.code==='23514');
   await db.exec("update connexy_private.job_publications set enabled=true");
  });
  await t.test('所属停止・会社承認取消・セッション期限切れを取得ごとに反映する',async()=>{
   await owner(`update public.connexy_auth_memberships set active=false where auth_user_id='${ids.B}'`);
   await login();await assert.rejects(detail(),e=>e.code==='42501');await assert.rejects(summaries(),e=>e.code==='42501');
   await owner(`update public.connexy_auth_memberships set active=true where auth_user_id='${ids.B}';update public.companies set status='pending' where id='demoa'`);
   await login();assert.deepEqual(await summaries(),[]);await assert.rejects(detail(),e=>e.code==='42501');
   await owner(`update public.companies set status='approved' where id='demoa';update auth.sessions set created_at=now()-interval '9 hours' where user_id='${ids.B}'`);
   await login();await assert.rejects(detail(),e=>e.code==='42501');await assert.rejects(summaries(),e=>e.code==='42501');
  });
  await t.test('116番はAログインなし・Bログインだけで10行成功し、再実行しても既存データと認証条件を保持',async()=>{
   await owner(`delete from auth.sessions where user_id='${ids.A}';update auth.sessions set created_at=now() where user_id='${ids.B}'`);
   const snapshot=async()=>{
    const result={};
    for(const table of ['public.jobs','connexy_private.job_publications','connexy_private.sb_approvals','connexy_private.contract_offers','auth.users','auth.sessions','public.connexy_auth_memberships'])
     result[table]=(await db.query(`select to_jsonb(t) row from ${table} t order by to_jsonb(t)::text`)).rows;
    return result;
   };
   const before=await snapshot();
   await db.exec(`update auth.sessions set created_at=now()-interval '9 hours' where user_id='${ids.B}'`);
   const expired=await snapshot();
   await assert.rejects(db.exec(fs.readFileSync('supabase/116_disclosure_verification.sql','utf8')),/B社管理者でConnexyにログイン/);
   await db.exec('rollback');assert.deepEqual(await snapshot(),expired);
   // テスト環境のセッションを失敗前へ戻す。116番自身は認証データを書き換えない。
   await db.query('update auth.sessions set created_at=$1 where user_id=$2',[before['auth.sessions'].find(x=>x.row.user_id===ids.B).row.created_at,ids.B]);
   for(let n=0;n<2;n++){
    const results=await db.exec(fs.readFileSync('supabase/116_disclosure_verification.sql','utf8'));
    const rows=results.flatMap(r=>r.rows||[]).filter(r=>r.check_name);
    assert.equal(rows.length,10);assert.ok(rows.every(r=>r.result.startsWith('確認OK')));
    assert.deepEqual(await snapshot(),before);
    assert.equal((await db.query('select auth.uid() id')).rows[0].id,null);
   }
  });
 } finally {await db.close();}
});

