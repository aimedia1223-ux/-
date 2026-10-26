-- 新規・空の検証プロジェクトだけに実行。本人情報RPC検証用の最小構成。
-- このスキーマでは一般アプリ機能（案件・チャットなど）は動きません。
begin;
do $$
begin
  if to_regclass('public.companies') is not null or to_regclass('public.staffs') is not null then
    raise exception '既存テーブルを検出。空の検証プロジェクトでのみ実行してください。';
  end if;
end;
$$;
create table public.companies (
  id text primary key,
  name text not null,
  status text not null check (status in ('approved', 'pending', 'rejected'))
);
create table public.staffs (
  id text primary key,
  user_id text not null references public.companies(id)
);
alter table public.companies enable row level security;
alter table public.staffs enable row level security;
revoke all on public.companies, public.staffs from anon, authenticated;
insert into public.companies values
  ('auth_test_company_a', '架空検証会社A', 'approved'),
  ('auth_test_company_b', '架空検証会社B', 'approved');
insert into public.staffs values
  ('auth_test_staff_a', 'auth_test_company_a'),
  ('auth_test_staff_b', 'auth_test_company_b');
commit;
