-- 125番適用後、一度実行。削除ログに基づく実施記録。データ削除や外部消去の自動証明は行わない。
begin;
alter table connexy_private.audit_events drop constraint audit_events_action_check;
alter table connexy_private.audit_events add constraint audit_events_action_check check(action in (
 'responsibility.saved','responsibility.deleted','agency_manager.saved','agency_manager.deleted',
 'offer.created','offer.confirmed','offer.declined','offer.withdrawn','offer.deleted',
 'contract.created','contract.updated','contract.deleted','message.sent','message.updated','message.deleted',
 'job.created','job.updated','job.deleted','staff.created','staff.updated','staff.deleted','approval.created','approval.revoked','approval.deleted',
 'job_detail.read','responsibility.read','agency_manager.read','offer.read','message.read','thread.read','audit.read','data.read','staff_export.read',
 'deletion_record.created','deletion_check.saved','deletion_records.read','deletion_record.read'));
create table connexy_private.deletion_records(
 id uuid primary key default gen_random_uuid(),
 company_id text not null,
 deletion_event_id bigint not null references connexy_private.audit_events(id),
 created_by uuid not null,
 created_at timestamptz not null default statement_timestamp(),
 snapshot jsonb not null,
 constraint deletion_record_event_unique unique(company_id,deletion_event_id)
);
create table connexy_private.deletion_checks(
 record_id uuid not null references connexy_private.deletion_records(id),
 category text not null check(category in ('return','external_files','downloads','backups','subcontractor')),
 status text not null default 'pending' check(status in ('pending','reported')),
 evidence_reference text,
 evidence_sha256 text,
 version integer not null default 1 check(version>0),
 updated_by uuid,
 updated_at timestamptz,
 primary key(record_id,category),
 check((status='pending' and evidence_reference is null and evidence_sha256 is null)
   or (status='reported' and evidence_reference ~ '^[A-Z0-9][A-Z0-9_-]{2,79}$' and evidence_sha256 ~ '^[0-9a-f]{64}$'
       and evidence_reference is not null and evidence_sha256 is not null))
);
alter table connexy_private.deletion_records enable row level security;
alter table connexy_private.deletion_checks enable row level security;
revoke all on connexy_private.deletion_records,connexy_private.deletion_checks from public,anon,authenticated;
create trigger protect_deletion_record_rows before update or delete on connexy_private.deletion_records
 for each row execute function connexy_private.protect_audit_events();
create trigger protect_deletion_record_truncate before truncate on connexy_private.deletion_records
 for each statement execute function connexy_private.protect_audit_events();

create function connexy_private.deletion_record_json(target_record uuid)
returns jsonb language sql security definer set search_path='' as $$
 select r.snapshot||jsonb_build_object('checks',coalesce((
  select jsonb_agg(jsonb_build_object('category',c.category,'status',c.status,'evidence_reference',c.evidence_reference,
    'evidence_sha256',c.evidence_sha256,'version',c.version,'updated_at',c.updated_at) order by c.category)
  from connexy_private.deletion_checks c where c.record_id=r.id),'[]'))
 from connexy_private.deletion_records r where r.id=target_record;
$$;
revoke all on function connexy_private.deletion_record_json(uuid) from public,anon,authenticated;

create function public.connexy_create_deletion_record(target_event bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare i record; e connexy_private.audit_events; record_id uuid:=gen_random_uuid(); existing_id uuid; created timestamptz:=statement_timestamp();
begin
 select * into i from public.connexy_current_identity();
 if i.company_id is null or i.member_role<>'admin' then raise exception '自社管理者の追加認証が必要です。' using errcode='42501'; end if;
 select * into e from connexy_private.audit_events where id=target_event and company_id=i.company_id and action like '%.deleted';
 if e.id is null then raise exception '自社の削除ログを確認できません。' using errcode='42501'; end if;
 insert into connexy_private.deletion_records(id,company_id,deletion_event_id,created_by,created_at,snapshot)
 values(record_id,i.company_id,e.id,auth.uid(),created,jsonb_build_object(
   'id',record_id,'deletion_event_id',e.id::text,'action',e.action,'target_type',e.target_type,'target_id',e.target_id,
   'deleted_at',e.occurred_at,'related_message_count',case when e.action='approval.deleted' then e.item_count end,
   'created_at',created,'recorded_by_staff_id',i.staff_id,'scope','application_target_only',
   'external_verification','unverified'))
 on conflict on constraint deletion_record_event_unique do nothing returning id into existing_id;
 if existing_id is null then
   select id into existing_id from connexy_private.deletion_records where company_id=i.company_id and deletion_event_id=e.id;
   return existing_id;
 end if;
 insert into connexy_private.deletion_checks(record_id,category)
 select existing_id,unnest(array['return','external_files','downloads','backups','subcontractor']);
 perform connexy_private.append_audit(i.company_id,'deletion_record.created','collection',existing_id::text,null,1);
 return existing_id;
end; $$;

create function public.connexy_list_deletion_records()
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; records jsonb; candidates jsonb;
begin
 select * into i from public.connexy_current_identity();
 if i.company_id is null or i.member_role<>'admin' then raise exception '自社管理者の追加認証が必要です。' using errcode='42501'; end if;
 select coalesce(jsonb_agg(connexy_private.deletion_record_json(x.id) order by x.created_at desc,x.id),'[]') into records
 from (select id,created_at from connexy_private.deletion_records where company_id=i.company_id order by created_at desc,id limit 100) x;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id::text,'action',x.action,'target_type',x.target_type,'target_id',x.target_id,'occurred_at',x.occurred_at) order by x.id desc),'[]') into candidates
 from (select e.* from connexy_private.audit_events e where e.company_id=i.company_id and e.action like '%.deleted'
   and not exists(select 1 from connexy_private.deletion_records r where r.company_id=i.company_id and r.deletion_event_id=e.id)
   order by e.id desc limit 100) x;
 perform connexy_private.append_audit(i.company_id,'deletion_records.read','collection',null,null,jsonb_array_length(records));
 return jsonb_build_object('records',records,'candidates',candidates);
end; $$;

create function public.connexy_save_deletion_check(target_record uuid,target_category text,check_status text,
 evidence_reference text,evidence_sha256 text,expected_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare i record; r connexy_private.deletion_records; c connexy_private.deletion_checks;
begin
 select * into i from public.connexy_current_identity();
 if i.company_id is null or i.member_role<>'admin' then raise exception '自社管理者の追加認証が必要です。' using errcode='42501'; end if;
 select * into r from connexy_private.deletion_records where id=target_record and company_id=i.company_id for share;
 if r.id is null then raise exception '自社の削除実施記録を確認できません。' using errcode='42501'; end if;
 if target_category is null or target_category not in ('return','external_files','downloads','backups','subcontractor')
   or check_status is null or check_status not in ('pending','reported') or expected_version is null or expected_version<1 then
   raise exception '確認項目・状態・版を確認してください。' using errcode='22023'; end if;
 if (check_status='reported' and (evidence_reference is null or evidence_reference !~ '^[A-Z0-9][A-Z0-9_-]{2,79}$'
   or evidence_sha256 is null or evidence_sha256 !~ '^[0-9a-f]{64}$'))
   or (check_status='pending' and (evidence_reference is not null or evidence_sha256 is not null)) then
   raise exception '内部管理番号とSHA256を確認してください。未確認の場合は空にしてください。' using errcode='22023'; end if;
 select * into c from connexy_private.deletion_checks where record_id=r.id and category=target_category for update;
 if c.version is distinct from expected_version then raise exception '更新されています。一覧を取得し直してください。' using errcode='40001'; end if;
 update connexy_private.deletion_checks set status=check_status,
   evidence_reference=connexy_save_deletion_check.evidence_reference,evidence_sha256=connexy_save_deletion_check.evidence_sha256,
   version=c.version+1,updated_by=auth.uid(),updated_at=statement_timestamp()
   where record_id=r.id and category=target_category;
 perform connexy_private.append_audit(i.company_id,'deletion_check.saved','collection',r.id::text||':'||target_category,c.version+1,null);
end; $$;

create function public.connexy_export_deletion_record(target_record uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; r connexy_private.deletion_records; payload text;
begin
 select * into i from public.connexy_current_identity();
 if i.company_id is null or i.member_role<>'admin' then raise exception '自社管理者の追加認証が必要です。' using errcode='42501'; end if;
 select * into r from connexy_private.deletion_records where id=target_record and company_id=i.company_id for share;
 if r.id is null then raise exception '自社の削除実施記録を確認できません。' using errcode='42501'; end if;
 perform 1 from connexy_private.deletion_checks where record_id=r.id for share;
 payload:=jsonb_build_object('record_type','application_deletion_execution_record','record',connexy_private.deletion_record_json(r.id),
   'notice','指定されたアプリ内対象の削除ログを記録したものです。外部保存・バックアップ・端末・再委託先の消去は未検証であり、完全削除の証明書ではありません。',
   'exported_at',statement_timestamp(),'signature','none')::text;
 perform connexy_private.append_audit(i.company_id,'deletion_record.read','collection',r.id::text,null,1);
 return jsonb_build_object('canonical_payload',payload,'sha256',encode(sha256(convert_to(payload,'UTF8')),'hex'),
   'filename','Connexy_deletion_record_'||r.id::text||'.json');
end; $$;
revoke all on function public.connexy_create_deletion_record(bigint),public.connexy_list_deletion_records(),
 public.connexy_save_deletion_check(uuid,text,text,text,text,integer),public.connexy_export_deletion_record(uuid) from public,anon;
grant execute on function public.connexy_create_deletion_record(bigint),public.connexy_list_deletion_records(),
 public.connexy_save_deletion_check(uuid,text,text,text,text,integer),public.connexy_export_deletion_record(uuid) to authenticated;
commit;
