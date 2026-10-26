-- 126番まで適用後。13番の第1段階：必須契約条件と確定内容の保存。
-- PDF・電子署名・支払期限の法令判定はまだ実装しない。実データは登録しない。
begin;
create table connexy_private.contract_details (
 offer_id uuid primary key references connexy_private.contract_offers(id) on delete cascade,
 details jsonb not null
);
create table connexy_private.contract_documents (
 offer_id uuid primary key references connexy_private.contract_offers(id) on delete cascade,
 contract_id text not null unique,
 canonical_payload text not null,
 sha256 text not null,
 created_at timestamptz not null default statement_timestamp()
);
alter table connexy_private.contract_details enable row level security;
alter table connexy_private.contract_documents enable row level security;
revoke all on connexy_private.contract_details,connexy_private.contract_documents from public,anon,authenticated;
create function connexy_private.immutable_contract_content() returns trigger language plpgsql set search_path='' as $$
begin raise exception '提示・確定済みの契約内容は上書きできません。'; end; $$;
revoke all on function connexy_private.immutable_contract_content() from public,anon,authenticated;
create trigger immutable_contract_details before update on connexy_private.contract_details for each row execute function connexy_private.immutable_contract_content();
create trigger immutable_contract_document before update on connexy_private.contract_documents for each row execute function connexy_private.immutable_contract_content();

alter function public.connexy_create_contract_offer(uuid,text,text,text,text) rename to base_create_offer_127;
alter function public.base_create_offer_127(uuid,text,text,text,text) set schema connexy_private;
revoke all on function connexy_private.base_create_offer_127(uuid,text,text,text,text) from public,anon,authenticated;
create function public.connexy_create_contract_offer(request_id uuid,target_job text,target_agency text,target_staff text,contract_terms text,contract_details jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare i record; k text; d jsonb:=contract_details; offer uuid; last_day date; payment date; inspection date; existing jsonb;
begin
 select * into i from public.connexy_current_identity();
 if i.company_id is null or i.member_role<>'admin' then raise exception '管理者の追加認証が必要です。' using errcode='42501'; end if;
 if d is null or jsonb_typeof(d)<>'object' then raise exception '必須契約条件を入力してください。' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(d))<>7 or not (d ?& array['tax','expenses','payment_due','inspection_due','termination','intellectual_property','liability']) then
  raise exception '必須契約条件が一致しません。' using errcode='22023'; end if;
 foreach k in array array['tax','expenses','termination','intellectual_property','liability'] loop
  if jsonb_typeof(d->k)<>'string' or length(trim(d->>k)) not between 2 and 2000 then
   raise exception '契約条件の各項目は2〜2000文字で入力してください。' using errcode='22023'; end if;
  d:=jsonb_set(d,array[k],to_jsonb(trim(d->>k)));
 end loop;
 foreach k in array array['payment_due','inspection_due'] loop
  if jsonb_typeof(d->k)<>'string' or (d->>k)!~'^\d{4}-\d{2}-\d{2}$' then raise exception '具体的な日付を入力してください。' using errcode='22023'; end if;
 end loop;
 begin payment:=(d->>'payment_due')::date; inspection:=(d->>'inspection_due')::date;
 exception when others then raise exception '有効な日付を入力してください。' using errcode='22023'; end;
 if payment::text<>d->>'payment_due' or inspection::text<>d->>'inspection_due' then raise exception '有効な日付を入力してください。' using errcode='22023'; end if;
 -- 元の提示関数が自社・当事者・有効な承諾・案件・日程を確認し、同じトランザクション内で保存する。
 offer:=connexy_private.base_create_offer_127(request_id,target_job,target_agency,target_staff,contract_terms);
 select max(x) into last_day from connexy_private.contract_offers o cross join lateral unnest(o.work_dates) x where o.id=offer;
 if payment<last_day or inspection<last_day then raise exception '支払日・検査期限は最終業務日以降にしてください。' using errcode='22023'; end if;
 select details into existing from connexy_private.contract_details where offer_id=offer;
 if existing is not null then
  if existing<>d then raise exception '再送の契約条件が一致しません。' using errcode='22023'; end if;
  return offer;
 end if;
 -- 旧形式の提示へ後から条件を追加して同意内容を変えることはできない。
 if exists(select 1 from connexy_private.contract_offers where id=offer and created_at<>statement_timestamp()) then
  raise exception '旧形式の提示は取り下げて再提示してください。' using errcode='22023'; end if;
 insert into connexy_private.contract_details values(offer,d);
 return offer;
end; $$;
revoke all on function public.connexy_create_contract_offer(uuid,text,text,text,text,jsonb) from public,anon;
grant execute on function public.connexy_create_contract_offer(uuid,text,text,text,text,jsonb) to authenticated;

alter function public.connexy_list_contract_offers() rename to base_list_offers_127;
alter function public.base_list_offers_127() set schema connexy_private;
revoke all on function connexy_private.base_list_offers_127() from public,anon,authenticated;
create function public.connexy_list_contract_offers() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 select coalesce(jsonb_agg(e.value||jsonb_build_object('contract_details',d.details,'document_version',case when c.offer_id is not null then 1 else null end) order by e.ordinality),'[]'::jsonb)
 into result from jsonb_array_elements(connexy_private.base_list_offers_127()) with ordinality e(value,ordinality)
 left join connexy_private.contract_details d on d.offer_id=(e.value->>'id')::uuid
 left join connexy_private.contract_documents c on c.offer_id=d.offer_id;
 return result;
end; $$;
revoke all on function public.connexy_list_contract_offers() from public,anon;
grant execute on function public.connexy_list_contract_offers() to authenticated;

alter function public.connexy_respond_contract_offer(uuid,text) rename to base_respond_offer_127;
alter function public.base_respond_offer_127(uuid,text) set schema connexy_private;
revoke all on function connexy_private.base_respond_offer_127(uuid,text) from public,anon,authenticated;
create function public.connexy_respond_contract_offer(target_offer uuid,action text) returns text language plpgsql security definer set search_path='' as $$
declare i record; o connexy_private.contract_offers; details jsonb; final_id text; payload text;
begin
 select * into i from public.connexy_current_identity();
 if i.company_id is null or i.member_role<>'admin' then raise exception '管理者の追加認証が必要です。' using errcode='42501'; end if;
 select * into o from connexy_private.contract_offers where id=target_offer for update;
 if action='confirm' then
  if o.agency_id is distinct from i.company_id or o.staff_id is distinct from i.staff_id
   or connexy_private.valid_sb_approval(o.job_id,o.agency_id,o.staff_id) is distinct from o.approval_id then
   raise exception '承諾対象本人の管理者権限が必要です。' using errcode='42501'; end if;
  select d.details into details from connexy_private.contract_details d where d.offer_id=target_offer;
  if details is null then raise exception '必須項目がない旧形式の提示は取り下げて再提示してください。' using errcode='22023'; end if;
 end if;
 final_id:=connexy_private.base_respond_offer_127(target_offer,action);
 if action='confirm' and not exists(select 1 from connexy_private.contract_documents where offer_id=target_offer) then
  select * into o from connexy_private.contract_offers where id=target_offer;
  payload:=jsonb_build_object('record_type','confirmed_contract','version',1,'offer_id',o.id,'contract_id',final_id,
   'presented_at',o.created_at,'confirmed_at',o.responded_at,'client_id',o.client_id,'agency_id',o.agency_id,'staff_id',o.staff_id,
   'snapshot',o.snapshot,'work_dates',o.work_dates,'daily_price',o.daily_price,'total_price',o.daily_price*cardinality(o.work_dates),
   'additional_terms',o.terms,'contract_details',details,'approval_id',o.approval_id,
   'approval_number',(select a.approval_number from connexy_private.sb_approvals a where a.id=o.approval_id),
   'signature','none')::text;
  insert into connexy_private.contract_documents(offer_id,contract_id,canonical_payload,sha256)
   values(target_offer,final_id,payload,encode(sha256(convert_to(payload,'UTF8')),'hex'));
 end if;
 return final_id;
end; $$;
revoke all on function public.connexy_respond_contract_offer(uuid,text) from public,anon;
grant execute on function public.connexy_respond_contract_offer(uuid,text) to authenticated;

create function public.connexy_export_contract_document(target_offer uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; permitted jsonb; d connexy_private.contract_documents;
begin
 -- 最新の承諾と本人・会社・役割を再確認する既存の開示経路を必ず通す。
 select value into permitted from jsonb_array_elements(public.connexy_list_contract_offers()) where value->>'id'=target_offer::text;
 if permitted is null or permitted->>'status'<>'confirmed' then raise exception '確定内容への権限を確認できません。' using errcode='42501'; end if;
 select * into d from connexy_private.contract_documents where offer_id=target_offer;
 if d.offer_id is null then raise exception '旧形式の契約には保存文書がありません。' using errcode='22023'; end if;
 select * into i from public.connexy_current_identity();
 perform connexy_private.append_audit(i.company_id,'offer.read','contract',d.contract_id,1,1);
 return jsonb_build_object('canonical_payload',d.canonical_payload,'sha256',d.sha256,'filename','Connexy_contract_'||target_offer::text||'_v1.json');
end; $$;
revoke all on function public.connexy_export_contract_document(uuid) from public,anon;
grant execute on function public.connexy_export_contract_document(uuid) to authenticated;
commit;
