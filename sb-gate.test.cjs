const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

test('SB原本照合記録によるDBゲート',async t=>{
 const db=new PGlite();
 const uid='00000000-0000-4000-8000-000000000001', sid='00000000-0000-4000-8000-000000000011';
 const aid='00000000-0000-4000-8000-000000000021';
 const day="to_char((statement_timestamp() at time zone 'Asia/Tokyo')::date+10,'YYYY-MM-DD')";
 async function owner(sql){await db.exec('reset role');return db.exec(sql);}
 async function login(aal='aal2',user=uid){await owner(`select set_config('request.jwt.sub','${user}',false),set_config('request.jwt.aal','${aal}',false);set role authenticated;`);}
 async function gate(staff='demobstaff',agency='demob'){return (await db.query("select * from public.connexy_check_sb_approval('ja',$1,$2)",[agency,staff])).rows[0];}
 const contract=(extra="",status='confirmed',evals="'{}'")=>`insert into public.contract_tasks(id,job_id,client_id,agency_id,status,date,sb_staff_id,sb_approval_id,evaluations)
 values('ct','ja','demoa','demob','${status}',${day},'demobstaff','${aid}',${evals}) ${extra}`;
 try {
  await db.exec(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key);
   create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id','${sid}','aal',current_setting('request.jwt.aal',true))$$;
   grant usage on schema auth,public to anon,authenticated;`);
  for(const file of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','107_sb_approval_gate.sql']) await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
  await db.exec(`insert into auth.users values('${uid}');insert into auth.sessions values('${sid}','${uid}',now());
   insert into public.connexy_auth_memberships values('${uid}','demoa','demoastaff','A','admin',true);
   insert into public.jobs(id,author_id,title,event_date) values('ja','demoa','架空SBゲート検証',${day}),('jb','demob','他社',${day});`);
  await t.test('未登録は未承諾、AAL1・一般担当者・匿名は照会不可',async()=>{
   await login();assert.equal((await gate()).approved,false);
   await login('aal1');await assert.rejects(gate(),/追加認証/);
   await owner("update public.connexy_auth_memberships set member_role='staff'");
   await login();await assert.rejects(gate(),/追加認証/);
   await owner("update public.connexy_auth_memberships set member_role='admin';set role anon");
   await assert.rejects(gate(),/permission denied/);
  });
  await t.test('偽のJSON承認・保護状態の直接INSERTは原本記録なしでは拒否',async()=>{
   await owner('');
   await assert.rejects(db.exec(contract()),/事前書面承諾/);
   await assert.rejects(db.exec(contract('', 'applying',`'{"jobStates":{"ja":{"status":"confirmed","staffId":"demobstaff","sbSubcontractApproval":{"status":"approved"}}}}'`)),/案件別状態/);
   await assert.rejects(db.exec(contract('', 'applying',`'{"offeredJobId":"ja","offeredStaffId":"demobstaff"}'`)),/オファー/);
  });
  await t.test('原本参照・SHA256・対象と日程を照合し、サーバーで確認時点とスナップショットを固定',async()=>{
   await owner(`insert into connexy_private.sb_approvals(id,job_id,client_id,agency_id,staff_id,approval_number,document_reference,document_sha256,
    approved_on,work_from,work_until,expires_on,verified_by,verification_note,job_snapshot)
    values('${aid}','ja','demoa','demob','demobstaff','架空検証','架空原本参照',repeat('a',64),current_date,current_date,current_date+20,current_date+20,'架空照合担当','テスト専用','{}');`);
   await login();assert.equal((await gate()).approved,true);assert.equal((await gate()).approval_id,aid);
   await owner('');
   const record=(await db.query('select job_snapshot,verified_at from connexy_private.sb_approvals')).rows[0];
   assert.equal(record.job_snapshot.id,'ja');assert.ok(record.verified_at);
  });
  await t.test('承諾があってもアプリの契約書込権限は開放しない',async()=>{
   await login();await assert.rejects(db.exec(contract()),/permission denied/);
   await assert.rejects(db.exec(`update connexy_private.sb_approvals set status='revoked'`),/permission denied/);
   await assert.rejects(db.query("select connexy_private.valid_sb_approval('ja','demob','demobstaff')"),/permission denied/);
  });
  await t.test('無関係な会社・所属停止・二次委託先の会社承認取消では許可しない',async()=>{
   await owner(`insert into public.companies(id,name,status) values('democ','架空C社','approved');
    insert into public.staffs(id,user_id,name) values('democstaff','democ','架空C管理者');
    update public.connexy_auth_memberships set company_id='democ',staff_id='democstaff' where auth_user_id='${uid}'`);
   await login();assert.equal((await gate()).approved,false);
   await owner(`update public.connexy_auth_memberships set company_id='demoa',staff_id='demoastaff',active=false where auth_user_id='${uid}'`);
   await login();await assert.rejects(gate(),/追加認証/);
   await owner(`update public.connexy_auth_memberships set active=true;update public.companies set status='pending' where id='demob'`);
   await login();assert.equal((await gate()).approved,false);
   await owner("update public.companies set status='approved' where id='demob'");
  });
  await t.test('信頼できるDB操作では承諾対象と一致した確定だけ成功',async()=>{
   await owner(contract());
   assert.equal((await db.query("select status from public.contract_tasks where id='ct'")).rows[0].status,'confirmed');
   await db.exec("delete from public.contract_tasks where id='ct'");
   for(const [before,after] of [["'demobstaff'","'demoastaff'"],["'demoa','demob'","'demob','demob'"],[day,"'2099-01-01'"],[`'${aid}'`,'null']])
    await assert.rejects(db.exec(contract().replace(before,after)));
  });
  await t.test('日程不正・未来の承諾・対象外スタッフ・期限切れは登録/照会不可',async()=>{
   await login();assert.equal((await gate('demoastaff')).approved,false);
   assert.equal((await gate('demobstaff','demoa')).approved,false);
   await owner("update public.jobs set event_date='invalid' where id='ja'");
   await login();assert.equal((await gate()).approved,false);
   await owner(`update public.jobs set event_date=${day} where id='ja'`);
   const template=`insert into connexy_private.sb_approvals(job_id,client_id,agency_id,staff_id,approval_number,document_reference,document_sha256,approved_on,work_from,work_until,expires_on,verified_by,verification_note,job_snapshot)
    values('jb','demob','demoa','demoastaff','X','X',repeat('b',64),current_date,current_date,current_date+20,current_date+20,'X','X','{}')`;
   await assert.rejects(db.exec(template.replace('repeat(\'b\',64)',"'invalid'")));
   await assert.rejects(db.exec(template.replace('current_date,current_date,current_date+20','current_date+1,current_date,current_date+20')),/承諾日/);
   await assert.rejects(db.exec(template.replace('current_date+20,current_date+20','current_date+20,current_date-1')),/期間/);
  });
  await t.test('案件内容変更・承諾取消を次の状態更新に反映する',async()=>{
   await owner("update public.jobs set price=100 where id='ja'");await login();assert.equal((await gate()).approved,false);
   await owner('');await assert.rejects(db.exec(contract()),/事前書面承諾/);
   await owner("update public.jobs set price=0 where id='ja'");await login();assert.equal((await gate()).approved,true);
   await owner(`update connexy_private.sb_approvals set status='revoked' where id='${aid}'`);
   await login();assert.equal((await gate()).approved,false);
   await owner('');await assert.rejects(db.exec(contract()),/事前書面承諾/);
   await assert.rejects(db.exec(`update connexy_private.sb_approvals set status='verified' where id='${aid}'`),/変更できません/);
  });
  await t.test('原本照合記録の上書きと旧現場グループの作成を拒否',async()=>{
   await owner('');
   await assert.rejects(db.exec(`update connexy_private.sb_approvals set verification_note='変更' where id='${aid}'`),/変更できません/);
   await assert.rejects(db.exec("insert into public.contract_tasks(id,job_id,client_id,agency_id) values('chat_group_ja','chat','demoa','demob')"),/現場グループ/);
  });
  await t.test('将来INSERT権限を付けても取消済み承諾の確定はトリガーで拒否',async()=>{
   await owner(`begin;grant insert on public.contract_tasks to authenticated;
    create policy temporary_gate_probe on public.contract_tasks for insert to authenticated with check(true);
    set role authenticated;`);
   try { await assert.rejects(db.exec(contract()),/事前書面承諾/); }
   finally { await db.exec('rollback'); }
  });
 }finally{await db.close();}
});

test('既存契約がある環境では削除せず107番全体を停止する',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
  await db.exec(fs.readFileSync('supabase/100_new_project_schema.sql','utf8'));
  await db.exec("insert into public.contract_tasks(id,job_id) values('existing','chat')");
  await assert.rejects(db.exec(fs.readFileSync('supabase/107_sb_approval_gate.sql','utf8')),/既存の契約/);
  await db.exec('rollback');
  assert.equal((await db.query("select id from public.contract_tasks")).rows[0].id,'existing');
  assert.equal((await db.query("select to_regclass('connexy_private.sb_approvals') as relation")).rows[0].relation,null);
 }finally{await db.close();}
});
