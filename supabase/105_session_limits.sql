-- 100/102番SQL適用後の新Supabaseへ実行する。
-- 既存の認証・所属・担当案件を維持し、全業務データの本人情報確認に8時間上限を追加する。
-- Auth管理テーブルへ書き込まない。Authのトークン更新自体を止める設定ではない。
begin;
create function connexy_private.session_is_current()
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  session_claim text := auth.jwt()->>'session_id';
begin
  if session_claim is null or session_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1 from auth.sessions s
    where s.id = session_claim::uuid and s.user_id = auth.uid()
      and s.created_at <= statement_timestamp()
      and s.created_at > statement_timestamp() - interval '8 hours'
  );
end;
$$;
revoke all on function connexy_private.session_is_current() from public, anon, authenticated;

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
    and connexy_private.session_is_current();
$$;
revoke all on function public.connexy_current_identity() from public, anon;
grant execute on function public.connexy_current_identity() to authenticated;
commit;
