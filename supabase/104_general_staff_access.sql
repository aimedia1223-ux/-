-- 一般担当者用の新しいAuthユーザーを作成してから実行する。
-- REPLACE_WITH_GENERAL_USER_UUIDは新ユーザーのUIDへ置換する。
-- A/Bの既存Authユーザーを指定すると既存所属を変更せず停止する。
begin;
do $$
declare
  general_user uuid := 'REPLACE_WITH_GENERAL_USER_UUID'::uuid;
begin
  if not exists(select 1 from auth.users where id = general_user) then
    raise exception '新しいAuthユーザーが存在しません。';
  end if;
  if exists(select 1 from public.connexy_auth_memberships where auth_user_id = general_user
      and (company_id <> 'demoa' or staff_id <> 'demoageneral' or member_role <> 'staff' or not active)) then
    raise exception '既存の所属・役割は上書きしません。一般担当者用の新ユーザーを指定してください。';
  end if;
  if exists(select 1 from public.staffs where id = 'demoageneral'
      and (user_id <> 'demoa' or name <> '架空一般担当者C')) then
    raise exception 'スタッフIDが既存データと衝突しています。';
  end if;
  if not exists(select 1 from public.jobs where id = 'connexy-access-test-a'
      and author_id = 'demoa' and title = '【閲覧テスト】A社専用案件') then
    raise exception '103番SQLのA社テスト案件を先に登録してください。';
  end if;
  if exists(select 1 from public.jobs where id = 'connexy-access-test-a-unassigned'
      and (author_id <> 'demoa' or title <> '【閲覧テスト】A社未割当案件')) then
    raise exception '案件IDが既存データと衝突しています。';
  end if;
  insert into public.staffs(id,user_id,name,masked_name)
    values ('demoageneral','demoa','架空一般担当者C','担当者C') on conflict(id) do nothing;
  insert into public.connexy_auth_memberships
    (auth_user_id,company_id,staff_id,display_name,member_role)
    values (general_user,'demoa','demoageneral','架空一般担当者C','staff') on conflict(auth_user_id) do nothing;
  insert into public.jobs(id,author_id,title,description,price,location_name,lat,lng,event_date,application_deadline,requirements)
    values ('connexy-access-test-a-unassigned','demoa','【閲覧テスト】A社未割当案件',
      '架空案件です。一般担当者Cには割り当てず、表示されないことを確認します。',10000,
      '東京都内（架空の会場）',35.6812,139.7671,
      to_char((current_timestamp at time zone 'Asia/Tokyo')::date + 30,'YYYY-MM-DD'),
      to_char((current_timestamp at time zone 'Asia/Tokyo')::date + 20,'YYYY-MM-DD'),
      array['__JOB_CODE__::TEST-A-UNASSIGNED']) on conflict(id) do nothing;
  -- 閲覧用の割当のみ。契約確定や現場投入の許可を意味しない。
  insert into connexy_private.job_readers(job_id,auth_user_id,company_id)
    values ('connexy-access-test-a',general_user,'demoa') on conflict(job_id,auth_user_id) do nothing;
end;
$$;
select company_id,staff_id,display_name,member_role from public.connexy_auth_memberships
  where staff_id = 'demoageneral';
commit;
