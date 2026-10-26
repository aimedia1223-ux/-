-- 122番適用後、一度実行。10番の第1段階：専用操作の監査ログ。
-- 既存データの履歴は復元しない。本文・契約条件・原本・パスワードは記録しない。
begin;
create table connexy_private.audit_events (
 id bigint generated always as identity primary key,
 company_id text not null,
 occurred_at timestamptz not null default statement_timestamp(),
 actor_company_id text,
 actor_uid uuid,
 actor_staff_id text,
 actor_kind text not null check(actor_kind in ('member','server')),
 action text not null check(action in ('responsibility.saved','responsibility.deleted','agency_manager.saved','agency_manager.deleted',
   'offer.created','offer.confirmed','offer.declined','offer.withdrawn','offer.deleted',
   'contract.created','contract.updated','contract.deleted','message.sent','message.updated','message.deleted',
   'job.created','job.updated','job.deleted','staff.created','staff.updated','staff.deleted','approval.created','approval.revoked','approval.deleted',
   'job_detail.read','responsibility.read','agency_manager.read','offer.read','message.read','thread.read','audit.read')),
 target_type text not null check(target_type in ('job','staff','approval','offer','contract','message','collection','audit')),
 target_id text,
 version integer check(version>0),
 item_count integer check(item_count>=0)
);
-- 業務データ・所属・ユーザーの削除に連動してログを失わないようFKを設けない。
create index audit_company_cursor on connexy_private.audit_events(company_id,id desc);
alter table connexy_private.audit_events enable row level security;
revoke all on connexy_private.audit_events from public,anon,authenticated;
revoke all on sequence connexy_private.audit_events_id_seq from public,anon,authenticated;
create function connexy_private.protect_audit_events()
returns trigger language plpgsql set search_path='' as $$
begin raise exception '監査ログの更新・削除・全件消去はできません。' using errcode='42501'; end;
$$;
revoke all on function connexy_private.protect_audit_events() from public,anon,authenticated;
create trigger protect_audit_rows before update or delete on connexy_private.audit_events
 for each row execute function connexy_private.protect_audit_events();
create trigger protect_audit_truncate before truncate on connexy_private.audit_events
 for each statement execute function connexy_private.protect_audit_events();

create function connexy_private.append_audit(target_company text,event_action text,object_type text,object_id text,
 object_version integer default null,result_count integer default null)
returns void language plpgsql security definer set search_path='' as $$
declare i record;
begin
 if target_company is null then raise exception '監査対象会社がありません。'; end if;
 select * into i from public.connexy_current_identity();
 insert into connexy_private.audit_events(company_id,actor_company_id,actor_uid,actor_staff_id,actor_kind,
   action,target_type,target_id,version,item_count)
 values(target_company,i.company_id,case when i.company_id is not null then auth.uid() end,i.staff_id,
   case when i.company_id is null then 'server' else 'member' end,event_action,object_type,object_id,object_version,result_count);
end;
$$;
revoke all on function connexy_private.append_audit(text,text,text,text,integer,integer) from public,anon,authenticated;

-- 変更と監査記録は同じトランザクション。記録に失敗した変更は確定しない。
create function connexy_private.audit_business_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb; event_action text; kind text; object_id text; companies text[]; company text; v integer; rows_count integer;
begin
 if TG_OP='DELETE' then r:=to_jsonb(old); else r:=to_jsonb(new); end if;
 case TG_TABLE_NAME
 when 'job_responsibilities' then
   event_action:=case when TG_OP='DELETE' then 'responsibility.deleted' else 'responsibility.saved' end;
   kind:='job';object_id:=r->>'job_id';companies:=array[r->>'company_id'];v:=(r->>'version')::integer;
 when 'agency_managers' then
   event_action:=case when TG_OP='DELETE' then 'agency_manager.deleted' else 'agency_manager.saved' end;
   kind:='approval';object_id:=r->>'approval_id';companies:=array[r->>'agency_id'];v:=(r->>'version')::integer;
 when 'contract_offers' then
   event_action:=case when TG_OP='DELETE' then 'offer.deleted' when TG_OP='INSERT' then 'offer.created' else 'offer.'||(r->>'status') end;
   kind:='offer';object_id:=r->>'id';companies:=array[r->>'client_id',r->>'agency_id'];
 when 'contract_tasks' then
   event_action:=case when TG_OP='DELETE' then 'contract.deleted' when TG_OP='INSERT' then 'contract.created' else 'contract.updated' end;
   kind:='contract';object_id:=r->>'id';companies:=array[r->>'client_id',r->>'agency_id'];
 when 'responsible_messages' then
   event_action:=case when TG_OP='DELETE' then 'message.deleted' when TG_OP='UPDATE' then 'message.updated' else 'message.sent' end;
   kind:='message';object_id:=r->>'id';
   -- 通常の削除は親承諾が残る。親削除の連動削除はapproval.deletedにより両社へ記録する。
   select array[a.client_id,a.agency_id] into companies from connexy_private.sb_approvals a where a.id=(r->>'approval_id')::uuid;
 when 'jobs' then
   event_action:=case when TG_OP='DELETE' then 'job.deleted' when TG_OP='INSERT' then 'job.created' else 'job.updated' end;
   kind:='job';object_id:=r->>'id';companies:=array[r->>'author_id'];
 when 'staffs' then
   event_action:=case when TG_OP='DELETE' then 'staff.deleted' when TG_OP='INSERT' then 'staff.created' else 'staff.updated' end;
   kind:='staff';object_id:=r->>'id';companies:=array[r->>'user_id'];
 when 'sb_approvals' then
   event_action:=case when TG_OP='DELETE' then 'approval.deleted' when TG_OP='INSERT' then 'approval.created' else 'approval.revoked' end;
   kind:='approval';object_id:=r->>'id';companies:=array[r->>'client_id',r->>'agency_id'];
   if TG_OP='DELETE' then select count(*)::integer into rows_count from connexy_private.responsible_messages where approval_id=(r->>'id')::uuid; end if;
 else raise exception '監査対象が不正です。';
 end case;
 for company in select distinct x from unnest(companies) x where x is not null loop
   perform connexy_private.append_audit(company,event_action,kind,object_id,v,rows_count);
 end loop;
 if TG_OP='DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function connexy_private.audit_business_change() from public,anon,authenticated;
create trigger audit_job_responsibilities after insert or update or delete on connexy_private.job_responsibilities
 for each row execute function connexy_private.audit_business_change();
create trigger audit_agency_managers after insert or update or delete on connexy_private.agency_managers
 for each row execute function connexy_private.audit_business_change();
create trigger audit_contract_offers after insert or update or delete on connexy_private.contract_offers
 for each row execute function connexy_private.audit_business_change();
create trigger audit_contract_tasks after insert or update or delete on public.contract_tasks
 for each row execute function connexy_private.audit_business_change();
create trigger audit_responsible_messages after insert or update or delete on connexy_private.responsible_messages
 for each row execute function connexy_private.audit_business_change();
create trigger audit_jobs after insert or update or delete on public.jobs for each row execute function connexy_private.audit_business_change();
create trigger audit_staffs after insert or update or delete on public.staffs for each row execute function connexy_private.audit_business_change();
create trigger audit_sb_approvals after insert or update on connexy_private.sb_approvals
 for each row execute function connexy_private.audit_business_change();
-- 削除される連絡件数を連動削除前に数える。親の削除失敗時はこの記録もロールバックされる。
create trigger audit_sb_approval_deleted before delete on connexy_private.sb_approvals
 for each row execute function connexy_private.audit_business_change();

-- 既存の本人/承諾判定を変更せず、成功した専用RPCの取得だけを記録。
alter function public.connexy_read_approved_job(uuid) rename to audit_base_read_job;
alter function public.audit_base_read_job(uuid) set schema connexy_private;
revoke all on function connexy_private.audit_base_read_job(uuid) from public,anon,authenticated;
create function public.connexy_read_approved_job(target_public_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; i record;
begin
 result:=connexy_private.audit_base_read_job(target_public_id);
 select * into i from public.connexy_current_identity();
 perform connexy_private.append_audit(i.company_id,'job_detail.read','job',target_public_id::text,null,1);
 return result;
end; $$;

alter function public.connexy_get_job_responsibilities(text) rename to audit_base_read_responsibility;
alter function public.audit_base_read_responsibility(text) set schema connexy_private;
revoke all on function connexy_private.audit_base_read_responsibility(text) from public,anon,authenticated;
create function public.connexy_get_job_responsibilities(target_job text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; i record;
begin
 result:=connexy_private.audit_base_read_responsibility(target_job);
 select * into i from public.connexy_current_identity();
 perform connexy_private.append_audit(i.company_id,'responsibility.read','job',target_job);
 return result;
end; $$;

alter function public.connexy_list_agency_managers() rename to audit_base_list_managers;
alter function public.audit_base_list_managers() set schema connexy_private;
revoke all on function connexy_private.audit_base_list_managers() from public,anon,authenticated;
create function public.connexy_list_agency_managers()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; i record;
begin
 result:=connexy_private.audit_base_list_managers();
 select * into i from public.connexy_current_identity();
 perform connexy_private.append_audit(i.company_id,'agency_manager.read','collection',null,null,jsonb_array_length(result->'items'));
 return result;
end; $$;

alter function public.connexy_list_contract_offers() rename to audit_base_list_offers;
alter function public.audit_base_list_offers() set schema connexy_private;
revoke all on function connexy_private.audit_base_list_offers() from public,anon,authenticated;
create function public.connexy_list_contract_offers()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; i record; entry jsonb;
begin
 result:=connexy_private.audit_base_list_offers();
 select * into i from public.connexy_current_identity();
 if jsonb_array_length(result)=0 then perform connexy_private.append_audit(i.company_id,'offer.read','collection',null,null,0); end if;
 for entry in select value from jsonb_array_elements(result) loop
   perform connexy_private.append_audit(i.company_id,'offer.read','offer',entry->>'id',null,1);
 end loop;
 return result;
end; $$;

alter function public.connexy_read_responsible_messages(uuid,bigint) rename to audit_base_read_messages;
alter function public.audit_base_read_messages(uuid,bigint) set schema connexy_private;
revoke all on function connexy_private.audit_base_read_messages(uuid,bigint) from public,anon,authenticated;
create function public.connexy_read_responsible_messages(target_approval uuid,before_id bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; i record;
begin
 result:=connexy_private.audit_base_read_messages(target_approval,before_id);
 select * into i from public.connexy_current_identity();
 perform connexy_private.append_audit(i.company_id,'message.read','approval',target_approval::text,null,jsonb_array_length(result->'messages'));
 return result;
end; $$;

alter function public.connexy_list_responsible_threads() rename to audit_base_list_threads;
alter function public.audit_base_list_threads() set schema connexy_private;
revoke all on function connexy_private.audit_base_list_threads() from public,anon,authenticated;
create function public.connexy_list_responsible_threads()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; i record;
begin
 result:=connexy_private.audit_base_list_threads();
 select * into i from public.connexy_current_identity();
 perform connexy_private.append_audit(i.company_id,'thread.read','collection',null,null,jsonb_array_length(result));
 return result;
end; $$;

create function public.connexy_list_audit_events(before_id bigint default null,event_group text default 'all')
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; result jsonb; more boolean; cursor_id text;
begin
 select * into i from public.connexy_current_identity();
 if i.company_id is null or i.member_role<>'admin' then raise exception '自社管理者の追加認証が必要です。' using errcode='42501'; end if;
 if (before_id is not null and before_id<1) or event_group is null or event_group not in ('all','read','change','delete') then
   raise exception '取得条件が不正です。' using errcode='22023'; end if;
 perform connexy_private.append_audit(i.company_id,'audit.read','audit',null);
 with candidates as (
   select e.* from connexy_private.audit_events e where e.company_id=i.company_id and (before_id is null or e.id<before_id)
   and (event_group='all' or (event_group='read' and e.action like '%.read')
     or (event_group='delete' and e.action like '%.deleted')
     or (event_group='change' and e.action not like '%.read' and e.action not like '%.deleted'))
   order by e.id desc limit 51
 ), page as (select * from candidates order by id desc limit 50)
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id::text,'occurred_at',p.occurred_at,'action',p.action,
   'actor_kind',case when p.actor_kind='server' then 'server' when p.actor_company_id=i.company_id then 'own' else 'counterparty' end,
   'actor_staff_id',case when p.actor_company_id=i.company_id then p.actor_staff_id end,
   'actor_name',case when p.actor_company_id=i.company_id then (select s.name from public.staffs s where s.id=p.actor_staff_id and s.user_id=i.company_id) end,
   'target_type',p.target_type,'target_id',p.target_id,'version',p.version,'item_count',p.item_count) order by p.id desc),'[]'),
   (select count(*)>50 from candidates),min(p.id)::text into result,more,cursor_id from page p;
 return jsonb_build_object('items',result,'has_more',more,'next_before_id',case when more then cursor_id end);
end; $$;

revoke all on function public.connexy_read_approved_job(uuid),public.connexy_get_job_responsibilities(text),
 public.connexy_list_agency_managers(),public.connexy_list_contract_offers(),public.connexy_read_responsible_messages(uuid,bigint),
 public.connexy_list_responsible_threads(),public.connexy_list_audit_events(bigint,text) from public,anon;
grant execute on function public.connexy_read_approved_job(uuid),public.connexy_get_job_responsibilities(text),
 public.connexy_list_agency_managers(),public.connexy_list_contract_offers(),public.connexy_read_responsible_messages(uuid,bigint),
 public.connexy_list_responsible_threads(),public.connexy_list_audit_events(bigint,text) to authenticated;
commit;
