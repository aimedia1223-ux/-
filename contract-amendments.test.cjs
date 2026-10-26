const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const{PGlite}=require('@electric-sql/pglite');const{randomUUID,createHash}=require('node:crypto');
test('契約変更は相手方の合意で新しい版になり旧版を保つ',async t=>{
 const db=new PGlite(),ids={A:randomUUID(),B:randomUUID(),C:randomUUID(),D:randomUUID(),E:randomUUID()};let seq=0,first,proposal,v1;
 const terms='架空検証専用です。実際の契約・支払・稼働はありません。';
 const details={tax:'税込単価',expenses:'経費なし',payment_due:'2099-12-30',inspection_due:'2099-12-29',termination:'別途協議',intellectual_property:'成果物なし',liability:'別途協議'};
 const next={...details,expenses:'架空の交通費精算条件へ変更'};
 async function owner(sql=''){await db.exec("reset role;select set_config('request.jwt.sub','',false)");if(sql)await db.exec(sql);}
 async function login(w='A',aal='aal2'){await owner();await db.query("select set_config('request.jwt.sub',$1,false),set_config('request.jwt.aal',$2,false)",[ids[w],aal]);await db.exec('set role authenticated');}
 async function history(id=first.offer){return(await db.query('select public.connexy_get_contract_history($1) data',[id])).rows[0].data;}
 async function propose({id=randomUUID(),offer=first.offer,base=1,d=next,text=terms,reason='架空の経費条件の変更を検証します。'}={}){return(await db.query('select public.connexy_propose_contract_amendment($1,$2,$3,$4,$5,$6) id',[id,offer,base,text,d,reason])).rows[0].id;}
 async function respond(id=proposal,action='confirm'){return(await db.query('select public.connexy_respond_contract_amendment($1,$2) n',[id,action])).rows[0].n;}
 async function output(version=1,offer=first.offer,pdf=false){return(await db.query(`select public.${pdf?'connexy_read_contract_version_pdf':'connexy_export_contract_version'}($1,$2) data`,[offer,version])).rows[0].data;}
 async function createContract(){const job='amend-job-'+(++seq),proof=randomUUID(),offer=randomUUID();await owner(`insert into public.jobs(id,author_id,title,description,event_date,price) values('${job}','demoa','架空改訂検証','架空の業務内容',((now() at time zone 'Asia/Tokyo')::date+10)::text,10000);
 insert into connexy_private.sb_approvals(id,job_id,client_id,agency_id,staff_id,approval_number,document_reference,document_sha256,approved_on,work_from,work_until,expires_on,verified_by,verification_note,job_snapshot)
 values('${proof}','${job}','demoa','demob','demobstaff','FAKE-ONLY','架空の原本参照',repeat('a',64),(now() at time zone 'Asia/Tokyo')::date,(now() at time zone 'Asia/Tokyo')::date+10,(now() at time zone 'Asia/Tokyo')::date+10,(now() at time zone 'Asia/Tokyo')::date+20,'架空担当','検証専用・実承諾ではありません','{}');`);
 await login();await db.query('select public.connexy_create_contract_offer($1,$2,$3,$4,$5,$6)',[offer,job,'demob','demobstaff',terms,details]);await login('B');await db.query("select public.connexy_respond_contract_offer($1,'confirm')",[offer]);await login();return{job,proof,offer};}
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',auth.uid()::text,'aal',current_setting('request.jwt.aal',true))$$;grant usage on schema public,auth to anon,authenticated;`);
 for(const f of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql','115_confidential_job_disclosure.sql','119_job_responsibilities.sql','120_agency_managers.sql','122_responsible_communications.sql','124_audit_log.sql','125_audited_data_reads.sql','126_deletion_records.sql','127_contract_documents.sql','129_contract_pdf_source.sql','130_contract_amendments.sql'])await db.exec(fs.readFileSync('supabase/'+f,'utf8'));
 await db.exec("insert into public.staffs(id,user_id,name) values('bgeneral','demob','B一般'),('badmin2','demob','別のB管理者');insert into public.companies(id,name,status) values('demod','無関係会社','approved');insert into public.staffs(id,user_id,name) values('dstaff','demod','D')");
 for(const[w,c,s,r]of[['A','demoa','demoastaff','admin'],['B','demob','demobstaff','admin'],['C','demob','bgeneral','staff'],['D','demod','dstaff','admin'],['E','demob','badmin2','admin']])await db.exec(`insert into auth.users values('${ids[w]}');insert into auth.sessions values('${ids[w]}','${ids[w]}',now());insert into public.connexy_auth_memberships values('${ids[w]}','${c}','${s}','${w}','${r}',true)`);
 first=await createContract();v1=await output();
 await t.test('一般・他社・対象外のB管理者・MFA前・匿名は履歴/提示/版取得を拒否',async()=>{
  for(const[w,aal]of[['C','aal2'],['D','aal2'],['E','aal2'],['B','aal1']]){await login(w,aal);await assert.rejects(history(),e=>e.code==='42501');await assert.rejects(propose(),e=>e.code==='42501');await assert.rejects(output(),e=>e.code==='42501');}
  await owner('set role anon');await assert.rejects(history(),e=>e.code==='42501');
 });
 await t.test('変更なし・欠落/余分な条件・日付・古い版・未知の契約を拒否',async()=>{
  await login();await assert.rejects(propose({d:details}),e=>e.code==='22023');
  for(const d of [{},{...next,tax:null},{...next,price:12000},{...next,payment_due:'2026-02-30'},{...next,inspection_due:'2020-01-01'}])await assert.rejects(propose({d}),e=>e.code==='22023');
  await assert.rejects(propose({base:2}),e=>e.code==='40001');await assert.rejects(propose({reason:'短い'}),e=>e.code==='22023');await assert.rejects(propose({offer:randomUUID()}),e=>e.code==='42501');
 });
 await t.test('A提示だけでは版1を維持し、同じ送信は重複せず内容違いの再送を拒否',async()=>{
  proposal=await propose();assert.equal(await propose({id:proposal}),proposal);await assert.rejects(propose({id:proposal,reason:'別の変更理由です。'}),e=>e.code==='42501');await assert.rejects(propose(),e=>e.code==='23505');
  const h=await history();assert.equal(h.versions.length,1);assert.deepEqual(h.versions[0].details,details);assert.deepEqual(h.amendments[0].details,next);assert.equal(h.amendments[0].status,'offered');assert.equal(JSON.stringify(h).includes(ids.A),false);
  await assert.rejects(respond(),e=>e.code==='42501');await login('B');await assert.rejects(respond(proposal,'withdraw'),e=>e.code==='42501');
 });
 await t.test('B同意で版2を一度だけ追加し、旧版バイト列・両社・日程・金額・原本条件を保持',async()=>{
  assert.equal(await respond(),2);assert.equal(await respond(),2);assert.deepEqual(await output(1),v1);const v2=await output(2),p1=JSON.parse(v1.canonical_payload),p2=JSON.parse(v2.canonical_payload);
  assert.equal(p2.previous_version_sha256,v1.sha256);assert.equal(p2.amendment_id,proposal);assert.equal(p2.signature,'none');assert.equal(p2.version,2);assert.deepEqual(p2.contract_details,next);
  for(const k of ['snapshot','work_dates','daily_price','total_price','approval_id','approval_number','client_id','agency_id','staff_id','contract_id'])assert.deepEqual(p2[k],p1[k]);
  assert.equal(v2.sha256,createHash('sha256').update(v2.canonical_payload).digest('hex'));assert.equal(v2.filename,`Connexy_contract_${first.offer}_v2.json`);assert.deepEqual(await output(2,first.offer,true),v2);
  await login();const list=(await db.query('select public.connexy_list_contract_offers() data')).rows[0].data;assert.equal(list[0].document_version,2);assert.deepEqual(list[0].contract_details,next);assert.equal((await history()).versions.length,2);
  await owner();assert.deepEqual((await db.query('select details from connexy_private.contract_details where offer_id=$1',[first.offer])).rows[0].details,details);
 });
 await t.test('Bから版2を元に提示でき、同一会社の単独確定を拒否しA同意で版3へ',async()=>{
  await login('B');proposal=await propose({base:2,d:{...next,liability:'双方の責任条件の架空変更'}});await assert.rejects(respond(),e=>e.code==='42501');await login();assert.equal(await respond(),3);assert.equal((await history()).versions[0].version,3);
  await assert.rejects(propose({base:2}),e=>e.code==='40001');await assert.rejects(output(99),e=>e.code==='22023');
 });
 await t.test('辞退・取り下げは新しい版を作らず履歴に保持し、確定への転用を拒否',async()=>{
  for(const action of ['decline','withdraw']){await login();const id=await propose({base:3});await login(action==='decline'?'B':'A');assert.equal(await respond(id,action),null);assert.equal(await respond(id,action),null);await login('B');await assert.rejects(respond(id),e=>e.code==='22023');assert.equal((await history()).versions[0].version,3);}
 });
 await t.test('期限切れは確定できず、直接参照・内容改変・内部関数の使用を拒否',async()=>{
  await login();const id=await propose({base:3});await owner('alter table connexy_private.contract_amendments disable trigger protect_contract_amendment');await db.query("update connexy_private.contract_amendments set expires_at=now()-interval '1 second' where id=$1",[id]);await owner('alter table connexy_private.contract_amendments enable trigger protect_contract_amendment');await login('B');await assert.rejects(respond(id),e=>e.code==='22023');
  await respond(id,'decline');for(const q of ['select * from connexy_private.contract_versions','select * from connexy_private.contract_amendments',`select * from connexy_private.contract_version_data('${first.offer}')`])await assert.rejects(db.query(q),e=>e.code==='42501');
  await owner();await assert.rejects(db.exec("update connexy_private.contract_versions set canonical_payload='{}'"),/上書き/);await assert.rejects(db.exec("update connexy_private.contract_amendments set reason='変更理由の上書き'"),/上書き/);
 });
 await t.test('文書または監査の保存障害で変更合意だけが残らない',async()=>{
  for(const table of ['contract_versions','audit_events']){await login();const id=await propose({base:3});await owner(`create function connexy_private.reject_amend_save() returns trigger language plpgsql as $$begin raise exception 'SAVE_FAILURE';end$$;create trigger reject_amend_save before insert on connexy_private.${table} for each row execute function connexy_private.reject_amend_save()`);await login('B');await assert.rejects(respond(id),/SAVE_FAILURE/);await owner(`drop trigger reject_amend_save on connexy_private.${table};drop function connexy_private.reject_amend_save()`);await login();const h=await history();assert.equal(h.versions[0].version,3);assert.equal(h.amendments.find(a=>a.id===id).status,'offered');await respond(id,'withdraw');}
 });
 await t.test('検証用片付けは改訂履歴・版2を含めても範囲内だけ削除する',async()=>{
  await owner();await db.exec(fs.readFileSync('supabase/128_browser_contract_document_fixture.sql','utf8'));
  const offer=randomUUID(),text='ブラウザ検証専用です。本物のSB承諾・実契約・支払・稼働ではありません。税込10000円、経費なしの架空条件として確認後に削除します。';
  await login();await db.query('select public.connexy_create_contract_offer($1,$2,$3,$4,$5,$6)',[offer,'connexy-browser-contract-test','demob','demobstaff',text,details]);await login('B');await db.query("select public.connexy_respond_contract_offer($1,'confirm')",[offer]);await login();const id=await propose({offer,text});await login('B');await respond(id);
  await owner();await db.exec(fs.readFileSync('supabase/114_browser_contract_cleanup.sql','utf8'));assert.equal((await db.query('select count(*)::int n from connexy_private.contract_versions where offer_id=$1',[offer])).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from connexy_private.contract_amendments where offer_id=$1',[offer])).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from connexy_private.contract_versions where offer_id=$1',[first.offer])).rows[0].n,2);
 });
 await t.test('案件変更・承諾取消・所属停止・セッション期限を再確認する',async()=>{
  const s=await createContract();await owner(`update public.jobs set price=11000 where id='${s.job}'`);await login();await assert.rejects(propose({offer:s.offer}),e=>e.code==='42501');
  await owner(`update connexy_private.sb_approvals set status='revoked' where id='${first.proof}'`);await login('B');await assert.rejects(history(),e=>e.code==='42501');await assert.rejects(output(2),e=>e.code==='42501');
  await login();assert.equal((await history()).can_propose,false);await assert.rejects(propose({base:3}),e=>e.code==='42501');assert.equal(JSON.parse((await output(1)).canonical_payload).version,1);
  await owner(`update public.connexy_auth_memberships set active=false where auth_user_id='${ids.A}'`);await login();await assert.rejects(history(),e=>e.code==='42501');await owner(`update public.connexy_auth_memberships set active=true where auth_user_id='${ids.A}';update auth.sessions set created_at=now()-interval '9 hours' where user_id='${ids.A}'`);await login();await assert.rejects(history(),e=>e.code==='42501');
 });
 }finally{await db.close();}
});
