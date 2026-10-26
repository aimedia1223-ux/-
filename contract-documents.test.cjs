const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const{PGlite}=require('@electric-sql/pglite');const{randomUUID,createHash}=require('node:crypto');
test('必須契約条件と確定文書の保存',async t=>{
 const db=new PGlite();const ids={A:randomUUID(),B:randomUUID(),C:randomUUID(),D:randomUUID()};let seq=0,first;
 const terms='架空検証専用です。実際の契約・支払・稼働は行いません。';
 const details={tax:'税込単価',expenses:'経費なし',payment_due:'2099-12-30',inspection_due:'2099-12-29',termination:'別途協議',intellectual_property:'成果物なし',liability:'別途協議'};
 async function owner(sql=''){await db.exec("reset role;select set_config('request.jwt.sub','',false)");if(sql)await db.exec(sql);}
 async function login(w='A',aal='aal2'){await owner();await db.query("select set_config('request.jwt.sub',$1,false),set_config('request.jwt.aal',$2,false)",[ids[w],aal]);await db.exec('set role authenticated');}
 async function propose(job,id=randomUUID(),d=details){return(await db.query('select public.connexy_create_contract_offer($1,$2,$3,$4,$5,$6) id',[id,job,'demob','demobstaff',terms,d])).rows[0].id;}
 async function respond(id,action='confirm'){return(await db.query('select public.connexy_respond_contract_offer($1,$2) id',[id,action])).rows[0].id;}
 async function list(){return(await db.query('select public.connexy_list_contract_offers() data')).rows[0].data;}
 async function output(id){return(await db.query('select public.connexy_export_contract_document($1) data',[id])).rows[0].data;}
 async function scope(){const job='doc-job-'+(++seq),proof=randomUUID();await owner(`insert into public.jobs(id,author_id,title,description,event_date,price) values('${job}','demoa','架空契約案件','架空業務',((now() at time zone 'Asia/Tokyo')::date+10)::text,10000);
 insert into connexy_private.sb_approvals(id,job_id,client_id,agency_id,staff_id,approval_number,document_reference,document_sha256,approved_on,work_from,work_until,expires_on,verified_by,verification_note,job_snapshot)
 values('${proof}','${job}','demoa','demob','demobstaff','FAKE-001','架空原本参照',repeat('a',64),(now() at time zone 'Asia/Tokyo')::date,(now() at time zone 'Asia/Tokyo')::date+10,(now() at time zone 'Asia/Tokyo')::date+10,(now() at time zone 'Asia/Tokyo')::date+20,'架空担当','検証専用・本物の承諾ではない','{}');`);await login();return{job,proof};}
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',auth.uid()::text,'aal',current_setting('request.jwt.aal',true))$$;grant usage on schema public,auth to anon,authenticated;`);
 for(const f of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql','111_contract_confirmation.sql','115_confidential_job_disclosure.sql','119_job_responsibilities.sql','120_agency_managers.sql','122_responsible_communications.sql','124_audit_log.sql','125_audited_data_reads.sql','126_deletion_records.sql','127_contract_documents.sql','129_contract_pdf_source.sql'])await db.exec(fs.readFileSync('supabase/'+f,'utf8'));
 await db.exec("insert into public.staffs(id,user_id,name) values('bgeneral','demob','B一般');insert into public.companies(id,name,status) values('demod','無関係会社','approved');insert into public.staffs(id,user_id,name) values('dstaff','demod','D')");
 for(const[w,c,s,r]of[['A','demoa','demoastaff','admin'],['B','demob','demobstaff','admin'],['C','demob','bgeneral','staff'],['D','demod','dstaff','admin']])await db.exec(`insert into auth.users values('${ids[w]}');insert into auth.sessions values('${ids[w]}','${ids[w]}',now());insert into public.connexy_auth_memberships values('${ids[w]}','${c}','${s}','${w}','${r}',true)`);
 await t.test('不正・欠落・余分な項目・無効日付・業務日前の期限を拒否し提示も残さない',async()=>{
  const s=await scope();for(const d of [null,{}, {...details,tax:''},{...details,extra:'fake'},{...details,payment_due:'2026-02-30'},{...details,payment_due:'2020-01-01'},{...details,inspection_due:'2099-2-01'}])await assert.rejects(propose(s.job,randomUUID(),d),e=>e.code==='22023');
  await owner();assert.equal((await db.query('select count(*)::int n from connexy_private.contract_offers')).rows[0].n,0);
 });
 await t.test('旧5引数の抜け道を閉じ、必須条件を固定して同じ送信を一件に保つ',async()=>{
  first=await scope();first.id=randomUUID();await assert.rejects(db.query('select public.connexy_create_contract_offer($1,$2,$3,$4,$5)',[first.id,first.job,'demob','demobstaff',terms]));
  assert.equal(await propose(first.job,first.id),first.id);assert.equal(await propose(first.job,first.id),first.id);
  await assert.rejects(propose(first.job,first.id,{...details,tax:'税別単価'}),e=>e.code==='22023');
  assert.deepEqual((await list())[0].contract_details,details);await login('B');assert.deepEqual((await list())[0].contract_details,details);
 });
 await t.test('A社単独・他社・一般・追加認証前の確定や文書取得を拒否',async()=>{
  for(const[w,aal]of[['A','aal2'],['D','aal2'],['C','aal2'],['B','aal1']]){await login(w,aal);await assert.rejects(respond(first.id),e=>e.code==='42501');await assert.rejects(output(first.id),e=>e.code==='42501');}
  await owner('set role anon');await assert.rejects(output(first.id),e=>e.code==='42501');
 });
 await t.test('B社確定時に同一トランザクションで版1の内容を保存し、再送でも同じ文書',async()=>{
  await login('B');const final=await respond(first.id);const a=await output(first.id);assert.equal(await respond(first.id),final);assert.deepEqual(await output(first.id),a);
  const p=JSON.parse(a.canonical_payload);assert.deepEqual(p.contract_details,details);assert.equal(p.contract_id,final);assert.equal(p.version,1);assert.equal(p.signature,'none');assert.equal(p.approval_number,'FAKE-001');assert.ok(p.presented_at&&p.confirmed_at);assert.equal(p.daily_price,10000);assert.equal(p.total_price,10000);
  assert.equal(a.sha256,createHash('sha256').update(a.canonical_payload,'utf8').digest('hex'));assert.equal((await list())[0].document_version,1);
  await login();assert.deepEqual(await output(first.id),a);await login('D');assert.deepEqual(await list(),[]);await assert.rejects(output(first.id),e=>e.code==='42501');
 });
 await t.test('PDF用取得も同じ確定内容と権限を使い、取得監査を記録する',async()=>{
  const read=async()=> (await db.query('select public.connexy_read_contract_pdf_source($1) data',[first.id])).rows[0].data;
  await login('B');assert.deepEqual(await read(),await output(first.id));
  for(const[w,aal]of[['D','aal2'],['C','aal2'],['B','aal1']]){await login(w,aal);await assert.rejects(read(),e=>e.code==='42501');}
  await owner('set role anon');await assert.rejects(read(),e=>e.code==='42501');
  await owner();const entries=(await db.query("select * from connexy_private.audit_events where action='contract_pdf.read'")).rows;assert.equal(entries.length,1);assert.equal(entries[0].company_id,'demob');assert.equal(entries[0].target_id,first.id);assert.equal(entries[0].version,1);
 });
 await t.test('直接参照・内部関数を拒否し、所有者でも確定文書と条件の上書きを拒否',async()=>{
  await login();for(const q of ['select * from connexy_private.contract_details','select * from connexy_private.contract_documents',`select connexy_private.base_respond_offer_127('${first.id}','confirm')`])await assert.rejects(db.query(q),e=>e.code==='42501');
  await owner();await assert.rejects(db.exec("update connexy_private.contract_documents set canonical_payload='fake'"),/上書き/);await assert.rejects(db.exec("update connexy_private.contract_details set details='{}'"),/上書き/);
 });
 await t.test('承諾取消後のB社の文書取得・再確定を拒否',async()=>{
  await owner(`update connexy_private.sb_approvals set status='revoked' where id='${first.proof}'`);await login('B');await assert.rejects(output(first.id),e=>e.code==='42501');await assert.rejects(respond(first.id),e=>e.code==='42501');await assert.rejects(db.query('select public.connexy_read_contract_pdf_source($1)',[first.id]),e=>e.code==='42501');
 });
 await t.test('文書保存に失敗したら契約作成と確定もロールバック',async()=>{
  const s=await scope();s.id=await propose(s.job);await owner(`create function connexy_private.reject_doc() returns trigger language plpgsql as $$begin raise exception 'DOCUMENT_FAILURE';end$$;create trigger reject_doc before insert on connexy_private.contract_documents for each row execute function connexy_private.reject_doc()`);
  await login('B');await assert.rejects(respond(s.id),/DOCUMENT_FAILURE/);await owner('drop trigger reject_doc on connexy_private.contract_documents');
  assert.equal((await db.query('select status from connexy_private.contract_offers where id=$1',[s.id])).rows[0].status,'offered');assert.equal((await db.query('select count(*)::int n from public.contract_tasks where contract_offer_id=$1',[s.id])).rows[0].n,0);
 });
 await t.test('128番の準備・新形式の確定・114番の片付けを再実行できる',async()=>{
  await owner();const fixture=fs.readFileSync('supabase/128_browser_contract_document_fixture.sql','utf8');await db.exec(fixture);await db.exec(fixture);
  const job='connexy-browser-contract-test',id=randomUUID(),fakeTerms='ブラウザ検証専用です。本物のSB承諾・実契約・支払・稼働ではありません。税込10000円、経費なしの架空条件として確認後に削除します。';
  await login();await db.query('select public.connexy_create_contract_offer($1,$2,$3,$4,$5,$6)',[id,job,'demob','demobstaff',fakeTerms,details]);await login('B');await respond(id);assert.equal(JSON.parse((await output(id)).canonical_payload).version,1);
  await owner();const cleanup=fs.readFileSync('supabase/114_browser_contract_cleanup.sql','utf8');await db.exec(cleanup);await db.exec(cleanup);
  assert.equal((await db.query('select count(*)::int n from connexy_private.contract_documents where offer_id=$1',[id])).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from connexy_private.contract_details where offer_id=$1',[id])).rows[0].n,0);
 });
 await t.test('旧提示へ条件を後付けできず、旧提示は取り下げ可能',async()=>{
  const s=await scope(),id=randomUUID();await owner();await db.query('select connexy_private.base_create_offer_127($1,$2,$3,$4,$5)',[id,s.job,'demob','demobstaff',terms]).catch(()=>{});
  // 元関数も本人認証が必要なため、テスト用に権限を付けずownerのJWTで実行する。
  await db.query("select set_config('request.jwt.sub',$1,false),set_config('request.jwt.aal','aal2',false)",[ids.A]);await db.query('select connexy_private.base_create_offer_127($1,$2,$3,$4,$5)',[id,s.job,'demob','demobstaff',terms]);
  await login();await assert.rejects(propose(s.job,id),e=>e.code==='22023');await login('B');await assert.rejects(respond(id),e=>e.code==='22023');await login();await respond(id,'withdraw');
 });
 }finally{await db.close();}
});
