const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('追加認証と会社分離・期限のDBアクセス制限',async t=>{
  const db = new PGlite();
  const uid='00000000-0000-4000-8000-000000000001';
  const sid='00000000-0000-4000-8000-000000000011';
  async function owner(sql){await db.exec('reset role');return db.exec(sql);}
  async function read(claim=sid,aal='aal2'){
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.session_id',$2,false)",[uid,claim]);
    await db.query("select set_config('request.jwt.claim.aal',$1,false)",[aal]);
    await db.exec('set role authenticated');
    return (await db.query('select id from public.jobs')).rows;
  }
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz not null);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true),'aal',current_setting('request.jwt.claim.aal',true))$$;
      grant usage on schema auth,public to anon,authenticated;`);
    for(const file of ['100_new_project_schema.sql','102_read_access.sql','105_session_limits.sql','106_mfa_required.sql'])
      await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
    await db.exec(`insert into auth.users values ('${uid}');
      insert into public.connexy_auth_memberships values ('${uid}','demoa','demoastaff','Admin A','admin',true);
      insert into public.jobs(id,author_id,title) values ('ja','demoa','A');
      insert into public.jobs(id,author_id,title) values ('jb','demob','B');
      insert into auth.sessions values ('${sid}','${uid}',now()-interval '7 hours 59 minutes');`);
    await t.test('追加認証前・不正な認証レベルでは案件と本人情報を取得できない',async()=>{
      for(const aal of ['aal1','','invalid']) {
        assert.equal((await read(sid,aal)).length,0);
        assert.equal((await db.query('select * from public.connexy_current_identity()')).rows.length,0);
      }
    });
    await t.test('追加認証後も自社の案件だけ取得できる',async()=>assert.deepEqual((await read()).map(r=>r.id),['ja']));
    await t.test('8時間以上経過すると、トークンが新しくても業務データは取得不可',async()=>{
      await owner(`update auth.sessions set created_at=now()-interval '8 hours' where id='${sid}'`);
      assert.equal((await read()).length,0);
    });
    await t.test('session_idが無い・不正・実在しない場合は拒否する',async()=>{
      for(const value of ['', 'invalid', '00000000-0000-4000-8000-000000000099']) assert.equal((await read(value)).length,0);
    });
    await t.test('再ログインの新しいセッションでは再び取得できる',async()=>{
      await owner(`update auth.sessions set created_at=now() where id='${sid}'`);
      assert.equal((await read()).length,1);
    });
    await t.test('他人のセッションIDを指定しても取得不可',async()=>{
      await owner(`insert into auth.users values ('00000000-0000-4000-8000-000000000002');update auth.sessions set user_id='00000000-0000-4000-8000-000000000002' where id='${sid}'`);
      assert.equal((await read()).length,0);
    });
    await t.test('削除済みセッションのJWTでも業務データは取得不可',async()=>{
      await owner(`delete from auth.sessions where id='${sid}'`);
      assert.equal((await read()).length,0);
    });
  }finally{await db.close();}
});
