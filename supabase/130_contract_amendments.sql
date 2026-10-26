-- 129番適用後。確定済み原本を上書きせず、追加条件と必須7項目の変更合意を別の版へ保存。
-- 業務・単価・日程・当事者・スタッフは改訂対象外。電子署名/第三者時刻証明は行わない。
begin;
alter table connexy_private.audit_events drop constraint audit_events_action_check;
alter table connexy_private.audit_events add constraint audit_events_action_check check(action in (
 'responsibility.saved','responsibility.deleted','agency_manager.saved','agency_manager.deleted',
 'offer.created','offer.confirmed','offer.declined','offer.withdrawn','offer.deleted',
 'contract.created','contract.updated','contract.deleted','message.sent','message.updated','message.deleted',
 'job.created','job.updated','job.deleted','staff.created','staff.updated','staff.deleted','approval.created','approval.revoked','approval.deleted',
 'job_detail.read','responsibility.read','agency_manager.read','offer.read','message.read','thread.read','audit.read','data.read','staff_export.read',
 'deletion_record.created','deletion_check.saved','deletion_records.read','deletion_record.read','contract_pdf.read',
 'amendment.created','amendment.confirmed','amendment.declined','amendment.withdrawn','contract_versions.read'));

create table connexy_private.contract_amendments (
 id uuid primary key,
 offer_id uuid not null references connexy_private.contract_offers(id) on delete cascade,
 base_version integer not null check(base_version>=1),
 terms text not null check(length(terms) between 20 and 20000),
 details jsonb not null,
 reason text not null check(length(reason) between 5 and 2000),
 proposed_company_id text not null,
 proposed_by uuid not null,
 created_at timestamptz not null default statement_timestamp(),
 expires_at timestamptz not null default statement_timestamp()+interval '7 days',
 status text not null default 'offered' check(status in ('offered','confirmed','declined','withdrawn')),
 responded_by uuid,responded_at timestamptz,
 check((status='offered' and responded_by is null and responded_at is null)
   or (status<>'offered' and responded_by is not null and responded_at is not null))
);
create unique index one_pending_contract_amendment on connexy_private.contract_amendments(offer_id) where status='offered';
create index contract_amendment_history on connexy_private.contract_amendments(offer_id,created_at);
create table connexy_private.contract_versions (
 offer_id uuid not null references connexy_private.contract_offers(id) on delete cascade,
 version integer not null check(version>=2),
 amendment_id uuid not null unique references connexy_private.contract_amendments(id),
 canonical_payload text not null,sha256 text not null,
 created_at timestamptz not null default statement_timestamp(),
 primary key(offer_id,version)
);
alter table connexy_private.contract_amendments enable row level security;
alter table connexy_private.contract_versions enable row level security;
revoke all on connexy_private.contract_amendments,connexy_private.contract_versions from public,anon,authenticated;
create trigger immutable_contract_version before update on connexy_private.contract_versions for each row execute function connexy_private.immutable_contract_content();
create function connexy_private.protect_contract_amendment() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status<>'offered' or new.status not in ('confirmed','declined','withdrawn')
  or (to_jsonb(old)-array['status','responded_by','responded_at']) is distinct from (to_jsonb(new)-array['status','responded_by','responded_at']) then
  raise exception '提示済みの変更内容は上書きできません。取り下げて再提示してください。'; end if;
 return new;
end; $$;
revoke all on function connexy_private.protect_contract_amendment() from public,anon,authenticated;
create trigger protect_contract_amendment before update on connexy_private.contract_amendments for each row execute function connexy_private.protect_contract_amendment();

create function connexy_private.require_contract_version_access(target uuid,writing boolean default false)
returns connexy_private.contract_offers language plpgsql security definer set search_path='' as $$
declare i record; o connexy_private.contract_offers;
begin
 select * into i from public.connexy_current_identity();
 select * into o from connexy_private.contract_offers where id=target;
 if i.company_id is null or i.member_role<>'admin' or o.id is null or o.status<>'confirmed'
  or i.company_id not in (o.client_id,o.agency_id)
  or not exists(select 1 from connexy_private.contract_documents where offer_id=o.id) then
  raise exception '確定契約と当事者管理者の権限を確認できません。' using errcode='42501'; end if;
 if (i.company_id=o.agency_id and i.staff_id<>o.staff_id)
   or ((writing or i.company_id=o.agency_id) and connexy_private.valid_sb_approval(o.job_id,o.agency_id,o.staff_id) is distinct from o.approval_id) then
  raise exception '有効な承諾・対象本人・案件の一致を確認できません。' using errcode='42501'; end if;
 if writing and not exists(select 1 from public.contract_tasks where id=o.contract_id and status='confirmed') then
  raise exception '現在の契約状態では改訂できません。' using errcode='42501'; end if;
 return o;
end; $$;
revoke all on function connexy_private.require_contract_version_access(uuid,boolean) from public,anon,authenticated;

create function connexy_private.contract_version_data(target uuid,requested integer default null)
returns table(version integer,canonical_payload text,sha256 text) language sql set search_path='' as $$
 select x.version,x.canonical_payload,x.sha256 from (
  select 1 version,d.canonical_payload,d.sha256 from connexy_private.contract_documents d where d.offer_id=target
  union all select v.version,v.canonical_payload,v.sha256 from connexy_private.contract_versions v where v.offer_id=target
 ) x where requested is null or x.version=requested order by x.version desc limit 1;
$$;
revoke all on function connexy_private.contract_version_data(uuid,integer) from public,anon,authenticated;

create function connexy_private.validate_amendment_details(input jsonb,last_day date)
returns jsonb language plpgsql set search_path='' as $$
declare d jsonb:=input;k text;dt date;
begin
 if d is null or jsonb_typeof(d)<>'object' then raise exception '必須条件を入力してください。' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(d))<>7 or not (d ?& array['tax','expenses','payment_due','inspection_due','termination','intellectual_property','liability']) then
  raise exception '変更対象は必須7項目だけです。' using errcode='22023'; end if;
 foreach k in array array['tax','expenses','termination','intellectual_property','liability'] loop
  if jsonb_typeof(d->k)<>'string' or length(trim(d->>k)) not between 2 and 2000 then raise exception '各条件を2〜2000文字で入力してください。' using errcode='22023'; end if;
  d:=jsonb_set(d,array[k],to_jsonb(trim(d->>k)));
 end loop;
 foreach k in array array['payment_due','inspection_due'] loop
  if jsonb_typeof(d->k)<>'string' or (d->>k)!~'^\d{4}-\d{2}-\d{2}$' then raise exception '具体的な日付が必要です。' using errcode='22023'; end if;
  begin dt:=(d->>k)::date; exception when others then raise exception '有効な日付が必要です。' using errcode='22023'; end;
  if dt::text<>d->>k or dt<last_day then raise exception '日付は最終業務日以降にしてください。' using errcode='22023'; end if;
 end loop;
 return d;
end; $$;
revoke all on function connexy_private.validate_amendment_details(jsonb,date) from public,anon,authenticated;

create function public.connexy_propose_contract_amendment(request_id uuid,target_offer uuid,expected_version integer,contract_terms text,contract_details jsonb,change_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare i record;o connexy_private.contract_offers;existing connexy_private.contract_amendments;d jsonb;last_day date;current_doc record;party text;
begin
 perform 1 from connexy_private.contract_offers where id=target_offer for update;
 o:=connexy_private.require_contract_version_access(target_offer,true);
 select * into i from public.connexy_current_identity();
 if request_id is null or expected_version is null or expected_version<1 or contract_terms is null or length(trim(contract_terms)) not between 20 and 20000
  or change_reason is null or length(trim(change_reason)) not between 5 and 2000 then raise exception '変更理由・追加条件・現在の版を確認してください。' using errcode='22023'; end if;
 select max(x) into last_day from unnest(o.work_dates) x;
 d:=connexy_private.validate_amendment_details(contract_details,last_day);
 select * into existing from connexy_private.contract_amendments where id=request_id;
 if existing.id is not null then
  if existing.offer_id=target_offer and existing.proposed_by=auth.uid() and existing.proposed_company_id=i.company_id and existing.base_version=expected_version
   and existing.terms=trim(contract_terms) and existing.details=d and existing.reason=trim(change_reason) then return existing.id; end if;
  raise exception '再送の変更内容が一致しません。' using errcode='42501';
 end if;
 select * into current_doc from connexy_private.contract_version_data(target_offer);
 if current_doc.version<>expected_version then raise exception '契約の版が更新されています。再取得してください。' using errcode='40001'; end if;
 if (current_doc.canonical_payload::jsonb->>'additional_terms')=trim(contract_terms) and current_doc.canonical_payload::jsonb->'contract_details'=d then
  raise exception '変更された条件がありません。' using errcode='22023'; end if;
 insert into connexy_private.contract_amendments(id,offer_id,base_version,terms,details,reason,proposed_company_id,proposed_by)
 values(request_id,target_offer,expected_version,trim(contract_terms),d,trim(change_reason),i.company_id,auth.uid());
 foreach party in array array[o.client_id,o.agency_id] loop perform connexy_private.append_audit(party,'amendment.created','offer',request_id::text,expected_version,1);end loop;
 return request_id;
end; $$;
revoke all on function public.connexy_propose_contract_amendment(uuid,uuid,integer,text,jsonb,text) from public,anon;
grant execute on function public.connexy_propose_contract_amendment(uuid,uuid,integer,text,jsonb,text) to authenticated;

create function public.connexy_respond_contract_amendment(target_amendment uuid,action text)
returns integer language plpgsql security definer set search_path='' as $$
declare i record;o connexy_private.contract_offers;a connexy_private.contract_amendments;oid uuid;current_doc record;p jsonb;body text;stamp timestamptz:=statement_timestamp();party text;new_version integer;
begin
 select offer_id into oid from connexy_private.contract_amendments where id=target_amendment;
 perform 1 from connexy_private.contract_offers where id=oid for update;
 o:=connexy_private.require_contract_version_access(oid,true);
 select * into i from public.connexy_current_identity();
 select * into a from connexy_private.contract_amendments where id=target_amendment for update;
 if action is null or action not in ('confirm','decline','withdraw') then raise exception '操作を選択してください。' using errcode='22023';end if;
 if (action='withdraw' and a.proposed_company_id<>i.company_id) or (action in ('confirm','decline') and a.proposed_company_id=i.company_id) then
  raise exception '提案側と相手方の操作が一致しません。' using errcode='42501';end if;
 if action='confirm' and a.status='confirmed' then return a.base_version+1;end if;
 if (action='decline' and a.status='declined') or (action='withdraw' and a.status='withdrawn') then return null;end if;
 if a.status<>'offered' then raise exception 'この変更提示の回答は確定済みです。' using errcode='22023';end if;
 if action='confirm' then
  if stamp>=a.expires_at then raise exception '変更提示の回答期限を過ぎています。' using errcode='22023';end if;
  select * into current_doc from connexy_private.contract_version_data(oid);
  if current_doc.version<>a.base_version then raise exception '元の版が更新されています。' using errcode='40001';end if;
  new_version:=a.base_version+1;
  p:=current_doc.canonical_payload::jsonb||jsonb_build_object('version',new_version,'presented_at',a.created_at,'confirmed_at',stamp,
   'additional_terms',a.terms,'contract_details',a.details,'previous_version_sha256',current_doc.sha256,'amendment_id',a.id,'change_reason',a.reason,'proposed_company_id',a.proposed_company_id);
  body:=p::text;
  insert into connexy_private.contract_versions(offer_id,version,amendment_id,canonical_payload,sha256)
   values(oid,new_version,a.id,body,encode(sha256(convert_to(body,'UTF8')),'hex'));
 end if;
 update connexy_private.contract_amendments set status=case action when 'confirm' then 'confirmed' when 'decline' then 'declined' else 'withdrawn' end,
  responded_by=auth.uid(),responded_at=stamp where id=a.id;
 foreach party in array array[o.client_id,o.agency_id] loop
  perform connexy_private.append_audit(party,'amendment.'||case action when 'confirm' then 'confirmed' when 'decline' then 'declined' else 'withdrawn' end,'offer',a.id::text,coalesce(new_version,a.base_version),1);
 end loop;
 return new_version;
end; $$;
revoke all on function public.connexy_respond_contract_amendment(uuid,text) from public,anon;
grant execute on function public.connexy_respond_contract_amendment(uuid,text) to authenticated;

create function public.connexy_get_contract_history(target_offer uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o connexy_private.contract_offers;i record;versions jsonb;amendments jsonb;
begin
 perform 1 from connexy_private.contract_offers where id=target_offer for share;
 o:=connexy_private.require_contract_version_access(target_offer);
 select * into i from public.connexy_current_identity();
 select coalesce(jsonb_agg(jsonb_build_object('version',x.version,'terms',x.p->>'additional_terms','details',x.p->'contract_details','confirmed_at',x.p->>'confirmed_at','sha256',x.sha256,'change_reason',x.p->>'change_reason') order by x.version desc),'[]'::jsonb) into versions from (
  select 1 version,d.canonical_payload::jsonb p,d.sha256 from connexy_private.contract_documents d where d.offer_id=target_offer
  union all select v.version,v.canonical_payload::jsonb,v.sha256 from connexy_private.contract_versions v where v.offer_id=target_offer
 ) x;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'base_version',a.base_version,'terms',a.terms,'details',a.details,'reason',a.reason,'proposed_company_id',a.proposed_company_id,'status',a.status,'created_at',a.created_at,'expires_at',a.expires_at,'responded_at',a.responded_at) order by a.created_at desc,a.id),'[]'::jsonb)
 into amendments from (select * from connexy_private.contract_amendments where offer_id=target_offer order by created_at desc,id limit 100) a;
 perform connexy_private.append_audit(i.company_id,'contract_versions.read','offer',target_offer::text,null,jsonb_array_length(versions));
 return jsonb_build_object('offer_id',o.id,'contract_id',o.contract_id,'client_id',o.client_id,'agency_id',o.agency_id,'work_dates',o.work_dates,
  'versions',versions,'amendments',amendments,'can_propose',coalesce(connexy_private.valid_sb_approval(o.job_id,o.agency_id,o.staff_id)=o.approval_id,false) and exists(select 1 from public.contract_tasks where id=o.contract_id and status='confirmed'));
end; $$;
revoke all on function public.connexy_get_contract_history(uuid) from public,anon;
grant execute on function public.connexy_get_contract_history(uuid) to authenticated;

create function public.connexy_export_contract_version(target_offer uuid,target_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o connexy_private.contract_offers;d record;i record;
begin
 o:=connexy_private.require_contract_version_access(target_offer);
 if target_version is null or target_version<1 then raise exception '版を選択してください。' using errcode='22023';end if;
 select * into d from connexy_private.contract_version_data(target_offer,target_version);
 if d.version is null then raise exception '指定した版はありません。' using errcode='22023';end if;
 select * into i from public.connexy_current_identity();
 perform connexy_private.append_audit(i.company_id,'offer.read','contract',o.contract_id,target_version,1);
 return jsonb_build_object('canonical_payload',d.canonical_payload,'sha256',d.sha256,'filename','Connexy_contract_'||target_offer::text||'_v'||target_version::text||'.json');
end; $$;
revoke all on function public.connexy_export_contract_version(uuid,integer) from public,anon;
grant execute on function public.connexy_export_contract_version(uuid,integer) to authenticated;
create function public.connexy_read_contract_version_pdf(target_offer uuid,target_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;i record;
begin
 result:=public.connexy_export_contract_version(target_offer,target_version);
 select * into i from public.connexy_current_identity();
 perform connexy_private.append_audit(i.company_id,'contract_pdf.read','offer',target_offer::text,target_version,1);
 return result;
end; $$;
revoke all on function public.connexy_read_contract_version_pdf(uuid,integer) from public,anon;
grant execute on function public.connexy_read_contract_version_pdf(uuid,integer) to authenticated;

alter function public.connexy_list_contract_offers() rename to base_list_offers_130;
alter function public.base_list_offers_130() set schema connexy_private;
revoke all on function connexy_private.base_list_offers_130() from public,anon,authenticated;
create function public.connexy_list_contract_offers() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 select coalesce(jsonb_agg(e.value||case when d.version is null then '{}'::jsonb else jsonb_build_object(
  'terms',d.canonical_payload::jsonb->>'additional_terms','contract_details',d.canonical_payload::jsonb->'contract_details',
  'document_version',d.version,'latest_version_confirmed_at',d.canonical_payload::jsonb->>'confirmed_at') end order by e.ordinality),'[]'::jsonb) into result
 from jsonb_array_elements(connexy_private.base_list_offers_130()) with ordinality e(value,ordinality)
 left join lateral connexy_private.contract_version_data((e.value->>'id')::uuid) d on true;
 return result;
end; $$;
revoke all on function public.connexy_list_contract_offers() from public,anon;
grant execute on function public.connexy_list_contract_offers() to authenticated;
commit;
