-- 100_new_project_schema.sqlの後に、新しいSupabaseへ一度実行する。
-- 第11項・閲覧制限の第2段階。書込/契約確定/他社への案件詳細開示は開放しない。
begin;
do $$
begin
  if exists (select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename in
      ('companies','staffs','jobs','talents','contract_tasks','announcements','connexy_auth_memberships')) then
    raise exception '既存ポリシーを検出しました。100番SQLで作成した新規環境を確認してください。';
  end if;
end;
$$;
create schema connexy_private;
revoke all on schema connexy_private from public, anon, authenticated;
grant usage on schema connexy_private to authenticated;

-- 担当案件の割当はSQL管理者/信頼できるサーバーだけが変更する。
-- 会社IDはAuth側の所属との複合外部キーで固定し、自分で権限を追加できない。
alter table public.connexy_auth_memberships add constraint connexy_member_user_company_unique
  unique (auth_user_id, company_id);
create table connexy_private.job_readers (
  job_id text not null references public.jobs(id) on delete cascade,
  auth_user_id uuid not null,
  company_id text not null,
  primary key (job_id, auth_user_id),
  foreign key (auth_user_id, company_id)
    references public.connexy_auth_memberships(auth_user_id, company_id) on delete cascade
);
alter table connexy_private.job_readers enable row level security;
revoke all on connexy_private.job_readers from public, anon, authenticated;

create function connexy_private.current_company_id()
returns text language sql stable security definer set search_path = ''
as $$ select company_id from public.connexy_current_identity(); $$;
create function connexy_private.can_read_staff(target_staff text, target_company text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.connexy_current_identity() i
    where i.company_id = target_company
      and (i.member_role = 'admin' or i.staff_id = target_staff));
$$;
create function connexy_private.can_read_job(target_job text, target_company text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.connexy_current_identity() i
    where i.company_id = target_company and
      (i.member_role = 'admin' or exists (
        select 1 from connexy_private.job_readers r
        where r.job_id = target_job and r.auth_user_id = auth.uid()
          and r.company_id = i.company_id)));
$$;
revoke all on function connexy_private.current_company_id() from public, anon;
revoke all on function connexy_private.can_read_staff(text,text) from public, anon;
revoke all on function connexy_private.can_read_job(text,text) from public, anon;
grant execute on function connexy_private.current_company_id() to authenticated;
grant execute on function connexy_private.can_read_staff(text,text) to authenticated;
grant execute on function connexy_private.can_read_job(text,text) to authenticated;

-- 人材の実名は所属スタッフとIDで対応する場合だけ本人に表示する。
-- 名前一致による権限判定は行わない。未紐付けの行は会社管理者だけに表示。
alter table public.talents add column staff_id text;
alter table public.talents add constraint connexy_talent_staff_company_fk
  foreign key (staff_id,user_id) references public.staffs(id,user_id);

create policy connexy_company_self_read on public.companies
  for select to authenticated
  using (id = (select connexy_private.current_company_id()));
create policy connexy_staff_scoped_read on public.staffs
  for select to authenticated
  using (connexy_private.can_read_staff(id,user_id));
create policy connexy_job_scoped_read on public.jobs
  for select to authenticated
  using (connexy_private.can_read_job(id,author_id));
create policy connexy_talent_scoped_read on public.talents
  for select to authenticated
  using (connexy_private.can_read_staff(staff_id,user_id));
create policy connexy_announcements_member_read on public.announcements
  for select to authenticated
  using ((select connexy_private.current_company_id()) is not null);

-- 契約/チャットはSB承認・参加者の検証がまだ無いためSELECTポリシーを作らない。
-- SELECT権限だけを付け、RLSのデフォルト拒否で全行を非表示にする。
-- これにより一覧は空になり、他の許可済み一覧の読み込みを妨げない。
-- すべてのテーブルでINSERT/UPDATE/DELETE権限を付与しない。
grant select on public.companies, public.staffs, public.jobs, public.talents,
  public.announcements, public.contract_tasks to authenticated;
commit;
