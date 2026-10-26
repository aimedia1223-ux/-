-- 100・102・105適用後に実行。全アカウントに追加認証を必須化する。
-- 実行後はパスワードだけのセッションから業務データを取得できない。
-- Authの認証アプリ登録・コード検証は引き続き可能。
begin;
create or replace function public.connexy_current_identity()
returns table(company_id text, company_name text, staff_id text,
  display_name text, member_role text, status text)
language sql stable security definer set search_path = ''
as $$
  select m.company_id, c.name, m.staff_id, m.display_name, m.member_role, c.status
  from public.connexy_auth_memberships m
  join public.companies c on c.id = m.company_id
  join public.staffs s on s.id = m.staff_id and s.user_id = m.company_id
  where m.auth_user_id = auth.uid() and m.active and c.status = 'approved'
    and connexy_private.session_is_current()
    and (auth.jwt()->>'aal') = 'aal2';
$$;
revoke all on function public.connexy_current_identity() from public, anon;
grant execute on function public.connexy_current_identity() to authenticated;
commit;
