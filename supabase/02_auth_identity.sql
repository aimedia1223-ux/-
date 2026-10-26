-- 検証環境向け。既存テーブルのRLSを完成させる移行ではありません。
begin;
create table public.connexy_auth_memberships (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  company_id text not null,
  staff_id text not null,
  display_name text not null,
  member_role text not null check (member_role in ('admin', 'staff')),
  active boolean not null default true,
  unique (company_id, staff_id)
);
alter table public.connexy_auth_memberships enable row level security;
revoke all on public.connexy_auth_memberships from anon, authenticated;
-- 紐付けは信頼できる管理者だけがSQL/サーバーから登録する。
-- 自己登録・user_metadata・クライアント送信のロールで権限を付与しない。
create function public.connexy_current_identity()
returns table(company_id text, company_name text, staff_id text,
  display_name text, member_role text, status text)
language sql stable security definer set search_path = ''
as $$
  select m.company_id, c.name::text, m.staff_id, m.display_name,
    m.member_role, c.status::text
  from public.connexy_auth_memberships m
  join public.companies c on c.id::text = m.company_id
  join public.staffs s on s.id::text = m.staff_id and s.user_id::text = m.company_id
  where m.auth_user_id = auth.uid() and m.active and c.status::text = 'approved';
$$;
revoke all on function public.connexy_current_identity() from public, anon;
grant execute on function public.connexy_current_identity() to authenticated;
commit;
