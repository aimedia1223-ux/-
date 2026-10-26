-- 131番適用済みの検証環境で実行する。
-- 公開確認サイトでも、A/B/Cと133番の専用レビューアカウントの追加認証を省略する。
-- 24時間で自動終了せず、後日132番を実行するまで継続する。
-- パスワード・本人所属・会社分離・セッション期限・SB承諾は維持。
-- 認証アプリ登録は削除しない。実データでの本番利用前には132番で再開する。
begin;
do $$ begin
 if to_regclass('connexy_private.demo_mfa_exceptions') is null then
  raise exception '先に131番の設定が必要です。';
 end if;
end $$;

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
   and (
    (m.auth_user_id='98a829d2-992e-43ee-aa1a-8afde99a59d3' and m.company_id='demoa' and m.staff_id='demoastaff' and c.name='架空検証会社A')
    or (m.auth_user_id='cd9c7b14-ecbb-4382-a75a-89f5f9f3ffbb' and m.company_id='demob' and m.staff_id='demobstaff' and c.name='架空検証会社B')
    or (m.auth_user_id='99ac0e75-7871-42a9-b6ac-b766e7f2a319' and m.company_id='demoa' and m.staff_id='demoageneral' and c.name='架空検証会社A')
    or (m.company_id='review-company-'||m.auth_user_id::text and m.staff_id='review-staff-'||m.auth_user_id::text
     and c.name='架空レビュー会社' and s.name='架空レビュー担当者' and m.member_role='admin')
   )
 );
$$;
revoke all on function public.connexy_mfa_is_required() from public,anon;
grant execute on function public.connexy_mfa_is_required() to authenticated;

insert into connexy_private.demo_mfa_exceptions(auth_user_id,company_id,staff_id,expires_at)
select m.auth_user_id,m.company_id,m.staff_id,'infinity'::timestamptz
from public.connexy_auth_memberships m
join public.companies c on c.id=m.company_id and c.status='approved'
join public.staffs s on s.id=m.staff_id and s.user_id=m.company_id
where m.active and (
 (m.auth_user_id='98a829d2-992e-43ee-aa1a-8afde99a59d3' and m.company_id='demoa' and m.staff_id='demoastaff' and c.name='架空検証会社A')
 or (m.auth_user_id='cd9c7b14-ecbb-4382-a75a-89f5f9f3ffbb' and m.company_id='demob' and m.staff_id='demobstaff' and c.name='架空検証会社B')
 or (m.auth_user_id='99ac0e75-7871-42a9-b6ac-b766e7f2a319' and m.company_id='demoa' and m.staff_id='demoageneral' and c.name='架空検証会社A')
 or (m.company_id='review-company-'||m.auth_user_id::text and m.staff_id='review-staff-'||m.auth_user_id::text
  and c.name='架空レビュー会社' and s.name='架空レビュー担当者' and m.member_role='admin')
)
on conflict(auth_user_id) do update set company_id=excluded.company_id,staff_id=excluded.staff_id,expires_at=excluded.expires_at;
commit;
