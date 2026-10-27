-- 130番以降の環境へ一度実行。架空データで報告・初動・履歴を確認する。
-- 外部通知、SBへの送信、証拠ファイルのアップロードは行わない。
begin;
alter table connexy_private.audit_events drop constraint audit_events_action_check;
alter table connexy_private.audit_events add constraint audit_events_action_check check(action in (
 'responsibility.saved','responsibility.deleted','agency_manager.saved','agency_manager.deleted',
 'offer.created','offer.confirmed','offer.declined','offer.withdrawn','offer.deleted',
 'contract.created','contract.updated','contract.deleted','message.sent','message.updated','message.deleted',
 'job.created','job.updated','job.deleted','staff.created','staff.updated','staff.deleted','approval.created','approval.revoked','approval.deleted',
 'job_detail.read','responsibility.read','agency_manager.read','offer.read','message.read','thread.read','audit.read','data.read','staff_export.read',
 'deletion_record.created','deletion_check.saved','deletion_records.read','deletion_record.read','contract_pdf.read',
 'amendment.created','amendment.confirmed','amendment.declined','amendment.withdrawn','contract_versions.read',
 'incident.created','incident.updated','incident.read','incident_contact.saved'));

create table connexy_private.incident_contacts (
 company_id text primary key,
 contact text not null check(length(contact) between 5 and 1000),
 lead_staff_id text not null,
 version integer not null check(version>0),
 updated_at timestamptz not null default statement_timestamp()
);
create table connexy_private.incidents (
 id uuid primary key,
 company_id text not null,
 reporter_uid uuid not null,
 reporter_staff_id text not null,
 category text not null check(category in ('loss','misdelivery','unauthorized','other')),
 discovered_at timestamptz not null,
 summary text not null check(length(summary) between 10 and 2000),
 initial_action text not null check(length(initial_action)<=2000),
 status text not null default 'reported' check(status in ('reported','investigating','contained','resolved')),
 version integer not null default 1,
 created_at timestamptz not null default statement_timestamp(),
 updated_at timestamptz not null default statement_timestamp()
);
create index incident_company_recent on connexy_private.incidents(company_id,created_at desc);
create table connexy_private.incident_events (
 incident_id uuid not null references connexy_private.incidents(id),
 version integer not null,
 actor_staff_id text not null,
 status text not null,
 note text not null,
 evidence_state text not null check(evidence_state in ('unconfirmed','preserved','unavailable')),
 external_state text not null check(external_state in ('unreported','reported')),
 occurred_at timestamptz not null default statement_timestamp(),
 primary key(incident_id,version)
);
alter table connexy_private.incident_contacts enable row level security;
alter table connexy_private.incidents enable row level security;
alter table connexy_private.incident_events enable row level security;
revoke all on connexy_private.incident_contacts,connexy_private.incidents,connexy_private.incident_events from public,anon,authenticated;
create trigger protect_incident_history before update or delete on connexy_private.incident_events for each row execute function connexy_private.protect_audit_events();
create trigger protect_incident_truncate before truncate on connexy_private.incident_events for each statement execute function connexy_private.protect_audit_events();

create function public.connexy_list_incidents()
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; result jsonb; contact_data jsonb;
begin
 select * into i from public.connexy_current_identity();
 if i.company_id is null then raise exception '所属とログインを確認してください。' using errcode='42501'; end if;
 select jsonb_build_object('contact',c.contact,'lead_staff_id',c.lead_staff_id,'version',c.version,'updated_at',c.updated_at)
 into contact_data from connexy_private.incident_contacts c where c.company_id=i.company_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'category',r.category,'status',r.status,'created_at',r.created_at,'version',r.version) order by r.created_at desc,r.id),'[]') into result
 from (select * from connexy_private.incidents where company_id=i.company_id and (i.member_role='admin' or reporter_uid=auth.uid()) order by created_at desc,id limit 50) r;
 perform connexy_private.append_audit(i.company_id,'incident.read','collection',null,null,jsonb_array_length(result));
 return jsonb_build_object('items',result,'contact',contact_data,'can_manage',i.member_role='admin');
end; $$;

create function public.connexy_save_incident_contact(contact_text text,lead_staff text,expected_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare i record; v integer;
begin
 select * into i from public.connexy_current_identity();
 if i.company_id is null or i.member_role<>'admin' then raise exception '自社管理者のみ登録できます。' using errcode='42501'; end if;
 if contact_text is null or length(btrim(contact_text)) not between 5 and 1000 or expected_version is null or expected_version<0
 or not exists(select 1 from public.connexy_auth_memberships m join public.staffs s on s.id=m.staff_id and s.user_id=m.company_id where m.company_id=i.company_id and m.staff_id=lead_staff and m.member_role='admin' and m.active)
 then raise exception '連絡先と自社管理者のスタッフIDを確認してください。' using errcode='22023'; end if;
 if expected_version=0 then
  insert into connexy_private.incident_contacts(company_id,contact,lead_staff_id,version) values(i.company_id,btrim(contact_text),lead_staff,1) on conflict do nothing returning version into v;
 else
  update connexy_private.incident_contacts set contact=btrim(contact_text),lead_staff_id=lead_staff,version=version+1,updated_at=statement_timestamp() where company_id=i.company_id and version=expected_version returning version into v;
 end if;
 if v is null then raise exception '別の更新があります。' using errcode='40001'; end if;
 perform connexy_private.append_audit(i.company_id,'incident_contact.saved','collection',null,v,null);
end; $$;

create function public.connexy_create_incident(report_id uuid,report_category text,discovered timestamptz,report_summary text,initial_actions text)
returns uuid language plpgsql security definer set search_path='' as $$
declare i record; r connexy_private.incidents; saved uuid;
begin
 select * into i from public.connexy_current_identity();
 if i.company_id is null then raise exception '所属とログインを確認してください。' using errcode='42501'; end if;
 if report_id is null or report_category is null or report_category not in ('loss','misdelivery','unauthorized','other')
 or discovered is null or discovered>statement_timestamp() or discovered<statement_timestamp()-interval '10 years'
 or report_summary is null or length(btrim(report_summary)) not between 10 and 2000 or initial_actions is null or length(initial_actions)>2000
 then raise exception '種別・発見日時・状況を確認してください。' using errcode='22023'; end if;
 insert into connexy_private.incidents(id,company_id,reporter_uid,reporter_staff_id,category,discovered_at,summary,initial_action)
 values(report_id,i.company_id,auth.uid(),i.staff_id,report_category,discovered,btrim(report_summary),initial_actions)
 on conflict do nothing returning id into saved;
 if saved is null then
  select * into r from connexy_private.incidents where id=report_id and company_id=i.company_id and reporter_uid=auth.uid();
  if r.id is null or r.category is distinct from report_category or r.discovered_at is distinct from discovered or r.summary is distinct from btrim(report_summary) or r.initial_action is distinct from initial_actions
  then raise exception '同じ報告番号に異なる内容を登録できません。' using errcode='42501'; end if;
  return report_id;
 end if;
 insert into connexy_private.incident_events(incident_id,version,actor_staff_id,status,note,evidence_state,external_state)
 values(report_id,1,i.staff_id,'reported','初回報告を受け付けました。','unconfirmed','unreported');
 perform connexy_private.append_audit(i.company_id,'incident.created','collection',report_id::text,1,null);
 return report_id;
end; $$;

create function public.connexy_read_incident(target_report uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; r connexy_private.incidents; history jsonb;
begin
 select * into i from public.connexy_current_identity();
 if i.company_id is null then raise exception '所属とログインを確認してください。' using errcode='42501'; end if;
 select * into r from connexy_private.incidents where id=target_report and company_id=i.company_id and (i.member_role='admin' or reporter_uid=auth.uid());
 if r.id is null then raise exception '報告を確認できません。' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.version desc),'[]') into history from
 (select version,actor_staff_id,status,note,evidence_state,external_state,occurred_at from connexy_private.incident_events where incident_id=r.id order by version desc limit 100) e;
 perform connexy_private.append_audit(i.company_id,'incident.read','collection',r.id::text,r.version,1);
 return jsonb_build_object('id',r.id,'category',r.category,'status',r.status,'version',r.version,'discovered_at',r.discovered_at,'summary',r.summary,'initial_action',r.initial_action,'reporter_staff_id',r.reporter_staff_id,'created_at',r.created_at,'updated_at',r.updated_at,'history',history);
end; $$;

create function public.connexy_update_incident(target_report uuid,expected_version integer,next_status text,response_note text,evidence text,external_report text)
returns void language plpgsql security definer set search_path='' as $$
declare i record; r connexy_private.incidents;
begin
 select * into i from public.connexy_current_identity();
 if i.company_id is null or i.member_role<>'admin' then raise exception '自社管理者のみ対応を登録できます。' using errcode='42501'; end if;
 select * into r from connexy_private.incidents where id=target_report and company_id=i.company_id for update;
 if r.id is null then raise exception '報告を確認できません。' using errcode='42501'; end if;
 if expected_version is distinct from r.version then raise exception '別の更新があります。' using errcode='40001'; end if;
 if next_status is null or next_status not in ('reported','investigating','contained','resolved') or response_note is null or length(btrim(response_note)) not between 10 and 2000
 or evidence is null or evidence not in ('unconfirmed','preserved','unavailable') or external_report is null or external_report not in ('unreported','reported')
 then raise exception '状態と対応記録を確認してください。' using errcode='22023'; end if;
 update connexy_private.incidents set status=next_status,version=version+1,updated_at=statement_timestamp() where id=r.id;
 insert into connexy_private.incident_events(incident_id,version,actor_staff_id,status,note,evidence_state,external_state)
 values(r.id,r.version+1,i.staff_id,next_status,btrim(response_note),evidence,external_report);
 perform connexy_private.append_audit(i.company_id,'incident.updated','collection',r.id::text,r.version+1,null);
end; $$;

revoke all on function public.connexy_list_incidents(),public.connexy_save_incident_contact(text,text,integer),public.connexy_create_incident(uuid,text,timestamptz,text,text),public.connexy_read_incident(uuid),public.connexy_update_incident(uuid,integer,text,text,text,text) from public,anon;
grant execute on function public.connexy_list_incidents(),public.connexy_save_incident_contact(text,text,integer),public.connexy_create_incident(uuid,text,timestamptz,text,text),public.connexy_read_incident(uuid),public.connexy_update_incident(uuid,integer,text,text,text,text) to authenticated;
commit;
