-- 検証専用A/B/Cだけ、実行から24時間追加認証を省略する。
-- パスワード・所属・会社分離・セッション期限・SB承諾は維持する。
-- 認証アプリの登録を削除しない。即時再開は132番を実行する。
-- フロントエンド側の省略はローカル開発時のみ。本番公開前に132番を実行する。
begin;
create table if not exists connexy_private.demo_mfa_exceptions (
 auth_user_id uuid primary key,
 company_id text not null,
 staff_id text not null,
 expires_at timestamptz not null
);
alter table connexy_private.demo_mfa_exceptions enable row level security;
revoke all on connexy_private.demo_mfa_exceptions from public, anon, authenticated;

insert into connexy_private.demo_mfa_exceptions(auth_user_id,company_id,staff_id,expires_at)
values
 ('98a829d2-992e-43ee-aa1a-8afde99a59d3','demoa','demoastaff',statement_timestamp()+interval '24 hours'),
 ('cd9c7b14-ecbb-4382-a75a-89f5f9f3ffbb','demob','demobstaff',statement_timestamp()+interval '24 hours'),
 ('99ac0e75-7871-42a9-b6ac-b766e7f2a319','demoa','demoageneral',statement_timestamp()+interval '24 hours')
on conflict(auth_user_id) do update set company_id=excluded.company_id,staff_id=excluded.staff_id,expires_at=excluded.expires_at;

create or replace function public.connexy_mfa_is_required()
returns boolean language sql stable security definer set search_path=''
as $$
 select not exists (
  select 1 from connexy_private.demo_mfa_exceptions e
  join public.connexy_auth_memberships m on m.auth_user_id=e.auth_user_id
   and m.company_id=e.company_id and m.staff_id=e.staff_id and m.active
  join public.companies c on c.id=m.company_id and c.status='approved'
  join public.staffs s on s.id=m.staff_id and s.user_id=m.company_id
  where e.auth_user_id=auth.uid() and e.expires_at>statement_timestamp()
   and (auth.jwt()->>'aal')='aal1' and connexy_private.session_is_current()
   and ((e.company_id='demoa' and c.name='架空検証会社A')
     or (e.company_id='demob' and c.name='架空検証会社B'))
 );
$$;
revoke all on function public.connexy_mfa_is_required() from public,anon;
grant execute on function public.connexy_mfa_is_required() to authenticated;

create or replace function public.connexy_current_identity()
returns table(company_id text,company_name text,staff_id text,display_name text,member_role text,status text)
language sql stable security definer set search_path=''
as $$
 select m.company_id,c.name,m.staff_id,m.display_name,m.member_role,c.status
 from public.connexy_auth_memberships m
 join public.companies c on c.id=m.company_id
 join public.staffs s on s.id=m.staff_id and s.user_id=m.company_id
 where m.auth_user_id=auth.uid() and m.active and c.status='approved'
  and connexy_private.session_is_current()
  and ((auth.jwt()->>'aal')='aal2' or not public.connexy_mfa_is_required());
$$;
revoke all on function public.connexy_current_identity() from public,anon;
grant execute on function public.connexy_current_identity() to authenticated;
commit;
