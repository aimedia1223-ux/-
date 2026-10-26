-- 120番適用後。責任者間だけの業務連絡。通常チャット・スタッフへの直接送信は開放しない。
begin;
create table connexy_private.responsible_messages (
 id bigint generated always as identity primary key,
 approval_id uuid not null references connexy_private.sb_approvals(id) on delete cascade,
 primary_version integer not null,
 manager_version integer not null,
 sender_uid uuid not null references auth.users(id),
 sender_side text not null check(sender_side in ('client','agency')),
 request_id uuid not null,
 body text not null check(char_length(btrim(body)) between 1 and 2000 and body ~ '[^[:space:]]'),
 created_at timestamptz not null default statement_timestamp(),
 constraint responsible_message_request_unique unique(approval_id,sender_uid,request_id)
);
create index responsible_messages_scope on connexy_private.responsible_messages(approval_id,primary_version,manager_version,id);
alter table connexy_private.responsible_messages enable row level security;
revoke all on connexy_private.responsible_messages from public,anon,authenticated;
revoke all on sequence connexy_private.responsible_messages_id_seq from public,anon,authenticated;

-- 毎回本人・両責任者・承諾を再確認し、宛先はサーバー側で固定する。
-- 現行の承諾はスタッフ1名に紐付くため、その本人以外への詳細共有は行わない。
create function connexy_private.communication_scope(target_approval uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; a connexy_private.sb_approvals; r connexy_private.job_responsibilities;
 m connexy_private.agency_managers; title text; side text;
begin
 select * into i from public.connexy_current_identity();
 if i.company_id is null or i.member_role<>'admin' then return null; end if;
 perform 1 from public.connexy_auth_memberships where auth_user_id=auth.uid()
   and company_id=i.company_id and staff_id=i.staff_id and member_role='admin' and active for share;
 if not found then return null; end if;
 select * into a from connexy_private.sb_approvals where id=target_approval;
 if a.id is null or i.company_id not in (a.client_id,a.agency_id) then return null; end if;
 select j.title into title from public.jobs j where j.id=a.job_id for share;
 if connexy_private.valid_sb_approval(a.job_id,a.agency_id,a.staff_id) is distinct from a.id then return null; end if;
 select * into r from connexy_private.job_responsibilities where job_id=a.job_id for share;
 select * into m from connexy_private.agency_managers where approval_id=a.id for share;
 if r.job_id is null or m.approval_id is null or m.manager_staff_id<>a.staff_id then return null; end if;
 -- 両側の担当者は有効な管理者所属であること。登録だけで権限を追加しない。
 perform 1 from public.connexy_auth_memberships where company_id=r.company_id
   and staff_id=r.agency_contact_staff_id and member_role='admin' and active for share;
 if not found then return null; end if;
 perform 1 from public.connexy_auth_memberships where company_id=m.agency_id
   and staff_id=m.manager_staff_id and member_role='admin' and active for share;
 if not found then return null; end if;
 if i.company_id=a.client_id and i.staff_id=r.agency_contact_staff_id then side:='client';
 elsif i.company_id=a.agency_id and i.staff_id=m.manager_staff_id then side:='agency';
 else return null; end if;
 return jsonb_build_object('approval_id',a.id,'job_title',title,'side',side,
   'primary_version',r.version,'manager_version',m.version,
   'primary_name',(select name from public.staffs where id=r.agency_contact_staff_id),
   'manager_name',(select name from public.staffs where id=m.manager_staff_id));
end;
$$;
revoke all on function connexy_private.communication_scope(uuid) from public,anon,authenticated;

create function public.connexy_list_responsible_threads()
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; p record; scope jsonb; items jsonb:='[]';
begin
 select * into i from public.connexy_current_identity();
 if i.company_id is null or i.member_role<>'admin' then raise exception '責任者の追加認証が必要です。' using errcode='42501'; end if;
 for p in select a.id from connexy_private.sb_approvals a
   where a.client_id=i.company_id or (a.agency_id=i.company_id and a.staff_id=i.staff_id)
   order by a.id loop
   scope:=connexy_private.communication_scope(p.id);
   if scope is not null then items:=items||jsonb_build_array(scope); end if;
 end loop;
 return items;
end;
$$;

create function public.connexy_read_responsible_messages(target_approval uuid,before_id bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare scope jsonb; messages jsonb;
begin
 scope:=connexy_private.communication_scope(target_approval);
 if scope is null then raise exception '承諾と現在の責任者を確認できません。' using errcode='42501'; end if;
 if before_id is not null and before_id<1 then raise exception '取得位置が不正です。' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id::text,'side',x.sender_side,'body',x.body,'created_at',x.created_at) order by x.id),'[]')
 into messages from (select id,sender_side,body,created_at from connexy_private.responsible_messages
   where approval_id=target_approval and primary_version=(scope->>'primary_version')::integer
     and manager_version=(scope->>'manager_version')::integer and (before_id is null or id<before_id)
   order by id desc limit 50) x;
 return jsonb_build_object('scope',scope,'messages',messages);
end;
$$;

create function public.connexy_send_responsible_message(target_approval uuid,message_body text,request_id uuid,
 expected_primary_version integer,expected_manager_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare scope jsonb; saved connexy_private.responsible_messages;
begin
 scope:=connexy_private.communication_scope(target_approval);
 if scope is null then raise exception '承諾と現在の責任者を確認できません。' using errcode='42501'; end if;
 if expected_primary_version is distinct from (scope->>'primary_version')::integer
   or expected_manager_version is distinct from (scope->>'manager_version')::integer then
   raise exception '責任者が更新されています。再取得してください。' using errcode='40001'; end if;
 if request_id is null or message_body is null or char_length(btrim(message_body)) not between 1 and 2000
   or message_body !~ '[^[:space:]]' then
   raise exception '本文は1～2000文字で入力してください。' using errcode='22023'; end if;
 insert into connexy_private.responsible_messages(approval_id,primary_version,manager_version,sender_uid,sender_side,request_id,body)
   values(target_approval,expected_primary_version,expected_manager_version,auth.uid(),scope->>'side',request_id,btrim(message_body))
   on conflict on constraint responsible_message_request_unique do nothing;
 select * into saved from connexy_private.responsible_messages x
   where x.approval_id=target_approval and x.sender_uid=auth.uid() and x.request_id=connexy_send_responsible_message.request_id;
 if saved.body is distinct from btrim(message_body) or saved.primary_version<>expected_primary_version
   or saved.manager_version<>expected_manager_version then
   raise exception '同じ送信番号の内容が異なります。' using errcode='22023'; end if;
 return jsonb_build_object('id',saved.id::text);
end;
$$;
revoke all on function public.connexy_list_responsible_threads() from public,anon;
revoke all on function public.connexy_read_responsible_messages(uuid,bigint) from public,anon;
revoke all on function public.connexy_send_responsible_message(uuid,text,uuid,integer,integer) from public,anon;
grant execute on function public.connexy_list_responsible_threads(),public.connexy_read_responsible_messages(uuid,bigint),
 public.connexy_send_responsible_message(uuid,text,uuid,integer,integer) to authenticated;
commit;
