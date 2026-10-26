const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('検証用MFA一時例外は本人・会社・期限を限定し、132番で再開できる',async()=>{
 const db=new PGlite();
 const a='98a829d2-992e-43ee-aa1a-8afde99a59d3',b='00000000-0000-4000-8000-000000000002',sid='00000000-0000-4000-8000-000000000011';
 const sql=f=>fs.readFileSync('supabase/'+f,'utf8');
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true),'aal',current_setting('request.jwt.claim.aal',true))$$;
 grant usage on schema auth,public to anon,authenticated;`);
 for(const f of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql','131_temporary_demo_mfa_pause.sql'])await db.exec(sql(f));
 await db.exec(`insert into auth.users values ('${a}'),('${b}');
 update public.companies set name='架空検証会社A' where id='demoa';
 insert into public.connexy_auth_memberships values ('${a}','demoa','demoastaff','A','admin',true),('${b}','demob','demobstaff','Other','admin',true);
 insert into auth.sessions values ('${sid}','${a}',now());`);
 async function identity(uid=a,aal='aal1'){
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.session_id',$2,false),set_config('request.jwt.claim.aal',$3,false)",[uid,sid,aal]);
  await db.exec('set role authenticated');return (await db.query('select * from public.connexy_current_identity()')).rows;
 }
 async function owner(s){await db.exec('reset role');await db.exec(s);}
 assert.equal((await identity()).length,1);
 assert.equal((await identity(a,'invalid')).length,0);
 await assert.rejects(db.query('select * from connexy_private.demo_mfa_exceptions'));
 await owner(`update auth.sessions set user_id='${b}' where id='${sid}'`);
 assert.equal((await identity(b)).length,0);
 assert.equal((await identity(b,'aal2')).length,1);
 await owner(`update auth.sessions set user_id='${a}' where id='${sid}';update public.companies set name='Real company' where id='demoa'`);
 assert.equal((await identity()).length,0);
 await owner(`update public.companies set name='架空検証会社A' where id='demoa';update connexy_private.demo_mfa_exceptions set expires_at=now()-interval '1 minute'`);
 assert.equal((await identity()).length,0);
 await owner(sql('131_temporary_demo_mfa_pause.sql'));
 assert.equal((await identity()).length,1);
 await owner(`update auth.sessions set created_at=now()-interval '9 hours'`);
 assert.equal((await identity()).length,0);
 await owner(`update auth.sessions set created_at=now();update public.connexy_auth_memberships set active=false where auth_user_id='${a}'`);
 assert.equal((await identity()).length,0);
 await owner(`update public.connexy_auth_memberships set active=true where auth_user_id='${a}'`);
 await owner(sql('134_review_mfa_pause.sql'));
 assert.equal((await identity()).length,1);
 assert.equal((await db.query('select public.connexy_mfa_is_required() required')).rows[0].required,false);
 await owner(`update public.companies set name='Real company' where id='demoa'`);
 assert.equal((await identity()).length,0);
 await owner(`update public.companies set name='架空検証会社A' where id='demoa'`);
 const review='00000000-0000-4000-8000-000000000081';
 await owner(`insert into auth.users values ('${review}')`);
 await owner(sql('133_review_account_setup.sql').replace('review_auth_uid uuid := null',`review_auth_uid uuid := '${review}'`));
 await owner(`update auth.sessions set user_id='${review}' where id='${sid}'`);
 assert.equal((await identity(review)).length,0); // 準備だけでは省略対象にしない
 await owner(sql('134_review_mfa_pause.sql'));
 assert.equal((await identity(review)).length,1);
 assert.deepEqual((await db.query('select id from public.jobs')).rows.map(r=>r.id),['review-job-'+review]);
 await assert.rejects(db.query('update connexy_private.demo_mfa_exceptions set expires_at=\'infinity\''));
 await owner(`update public.connexy_auth_memberships set active=false where auth_user_id='${review}'`);
 assert.equal((await identity(review)).length,0);
 await owner(`update public.connexy_auth_memberships set active=true where auth_user_id='${review}';update auth.sessions set user_id='${b}' where id='${sid}'`);
 assert.equal((await identity(b)).length,0); // 同じ架空B社でも対象外の本人は拒否
 await owner(`update auth.sessions set user_id='${a}' where id='${sid}'`);
 await owner(sql('132_resume_demo_mfa.sql'));
 assert.equal((await identity()).length,0);
 assert.equal((await identity(a,'aal2')).length,1);
 }finally{await db.close();}
});
