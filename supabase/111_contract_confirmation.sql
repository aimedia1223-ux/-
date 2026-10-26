-- 107番適用後。アプリの契約確定は専用RPC経由だけにする。
-- 業務テーブルの直接INSERT/UPDATE/契約チャット閲覧は開放しない。
begin;
create table connexy_private.contract_offers (
  id uuid primary key,
  job_id text not null references public.jobs(id),
  client_id text not null references public.companies(id),
  agency_id text not null references public.companies(id),
  staff_id text not null,
  approval_id uuid not null references connexy_private.sb_approvals(id),
  terms text not null check (length(terms) between 20 and 20000),
  snapshot jsonb not null,
  work_dates date[] not null check (cardinality(work_dates)>0),
  daily_price numeric not null check (daily_price>=0),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default statement_timestamp(),
  status text not null default 'offered' check (status in ('offered','confirmed','declined','withdrawn')),
  responded_by uuid references auth.users(id),
  responded_at timestamptz,
  contract_id text unique references public.contract_tasks(id),
  foreign key (staff_id,agency_id) references public.staffs(id,user_id),
  check (client_id<>agency_id),
  check ((status='offered' and responded_by is null and responded_at is null and contract_id is null)
    or (status='confirmed' and responded_by is not null and responded_at is not null and contract_id is not null)
    or (status in ('declined','withdrawn') and responded_by is not null and responded_at is not null and contract_id is null))
);
alter table connexy_private.contract_offers enable row level security;
revoke all on connexy_private.contract_offers from public,anon,authenticated;
create unique index contract_one_open_offer on connexy_private.contract_offers(job_id,agency_id,staff_id) where status='offered';
create index on connexy_private.contract_offers(client_id,created_at);
create index on connexy_private.contract_offers(agency_id,created_at);
alter table public.contract_tasks add column contract_offer_id uuid unique references connexy_private.contract_offers(id);
create unique index contract_one_finalized_scope on public.contract_tasks(job_id,agency_id,sb_staff_id)
  where contract_offer_id is not null;

create function connexy_private.protect_contract_offer()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.status<>'offered' or new.status not in ('confirmed','declined','withdrawn')
    or (to_jsonb(new)-array['status','responded_by','responded_at','contract_id'])
      is distinct from (to_jsonb(old)-array['status','responded_by','responded_at','contract_id']) then
    raise exception '提示済みの契約条件は変更できません。取り下げ後、新しく提示してください。';
  end if;
  return new;
end;
$$;
revoke all on function connexy_private.protect_contract_offer() from public,anon,authenticated;
create trigger protect_contract_offer before update on connexy_private.contract_offers
  for each row execute function connexy_private.protect_contract_offer();

create function public.connexy_create_contract_offer(
  request_id uuid,target_job text,target_agency text,target_staff text,contract_terms text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  i record; j public.jobs; a uuid; dates date[]; existing connexy_private.contract_offers;
  client_name text; agency_name text; staff_name text; expiry timestamptz;
  today date := (statement_timestamp() at time zone 'Asia/Tokyo')::date;
begin
  select * into i from public.connexy_current_identity();
  if i.company_id is null or i.member_role<>'admin' then
    raise exception '管理者の追加認証が必要です。' using errcode='42501';
  end if;
  if request_id is null or contract_terms is null or length(trim(contract_terms)) not between 20 and 20000 then
    raise exception '契約条件を20〜20000文字で入力してください。' using errcode='22023';
  end if;
  select * into existing from connexy_private.contract_offers where id=request_id for update;
  if existing.id is not null then
    if existing.created_by=auth.uid() and existing.client_id=i.company_id and existing.job_id=target_job
      and existing.agency_id=target_agency and existing.staff_id=target_staff and existing.terms=trim(contract_terms) then
      return existing.id;
    end if;
    raise exception '提示内容または操作権限が一致しません。' using errcode='42501';
  end if;
  select * into j from public.jobs where id=target_job for share;
  if j.id is null or j.author_id<>i.company_id or target_agency=i.company_id then
    raise exception '自社案件の二次委託先だけを指定してください。' using errcode='42501';
  end if;
  a := connexy_private.valid_sb_approval(target_job,target_agency,target_staff);
  if a is null then
    raise exception 'SBの事前書面承諾・対象スタッフ・日程を確認できません。' using errcode='42501';
  end if;
  select array_agg(d order by d) into dates from (select distinct unnest(connexy_private.sb_job_dates(j.event_date)) d) x;
  if dates is null or dates[1]<=today then
    raise exception '明日以降の明確な案件日程が必要です。' using errcode='22023';
  end if;
  if exists(select 1 from public.contract_tasks t where t.job_id=target_job and t.agency_id=target_agency
    and t.sb_staff_id=target_staff and t.contract_offer_id is not null) then
    raise exception 'この案件・二次委託先・スタッフはすでに確定しています。' using errcode='22023';
  end if;
  select name into client_name from public.companies where id=j.author_id and status='approved' for share;
  select name into agency_name from public.companies where id=target_agency and status='approved' for share;
  select name into staff_name from public.staffs where id=target_staff and user_id=target_agency for share;
  if client_name is null or agency_name is null or staff_name is null then
    raise exception '契約当事者とスタッフを確認できません。' using errcode='42501';
  end if;
  expiry := least(statement_timestamp()+interval '7 days',dates[1]::timestamp at time zone 'Asia/Tokyo');
  insert into connexy_private.contract_offers(
    id,job_id,client_id,agency_id,staff_id,approval_id,terms,snapshot,work_dates,daily_price,expires_at,created_by
  ) values(request_id,j.id,j.author_id,target_agency,target_staff,a,trim(contract_terms),
    jsonb_build_object('job',to_jsonb(j),'client_name',client_name,'agency_name',agency_name,'staff_name',staff_name),
    dates,j.price,expiry,auth.uid());
  return request_id;
end;
$$;
revoke all on function public.connexy_create_contract_offer(uuid,text,text,text,text) from public,anon;
grant execute on function public.connexy_create_contract_offer(uuid,text,text,text,text) to authenticated;

create function public.connexy_list_contract_offers()
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; result jsonb;
begin
  select * into i from public.connexy_current_identity();
  if i.company_id is null or i.member_role<>'admin' then
    raise exception '管理者の追加認証が必要です。' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'job_id',o.job_id,'job_title',o.snapshot->'job'->>'title',
    'client_id',o.client_id,'agency_id',o.agency_id,'staff_id',o.staff_id,
    'client_name',o.snapshot->>'client_name','agency_name',o.snapshot->>'agency_name','staff_name',o.snapshot->>'staff_name',
    'description',o.snapshot->'job'->>'description','detailed_description',o.snapshot->'job'->>'detailed_description',
    'requirements',o.snapshot->'job'->'requirements',
    'work_location',coalesce(nullif(o.snapshot->'job'->>'exact_location',''),nullif(o.snapshot->'job'->>'work_location',''),o.snapshot->'job'->>'location_name'),
    'work_hours',o.snapshot->'job'->>'work_hours','work_dates',o.work_dates,
    'daily_price',o.daily_price,'total_price',o.daily_price*cardinality(o.work_dates),
    'terms',o.terms,'status',o.status,'created_at',o.created_at,'expires_at',o.expires_at,
    'responded_at',o.responded_at,'contract_id',o.contract_id
  ) order by o.created_at desc,o.id),'[]'::jsonb) into result
  from (select * from connexy_private.contract_offers
    where client_id=i.company_id or agency_id=i.company_id order by created_at desc,id limit 100) o;
  return result;
end;
$$;
revoke all on function public.connexy_list_contract_offers() from public,anon;
grant execute on function public.connexy_list_contract_offers() to authenticated;

create function public.connexy_respond_contract_offer(target_offer uuid,action text)
returns text language plpgsql security definer set search_path='' as $$
declare
  i record; o connexy_private.contract_offers; j public.jobs; a uuid; final_id text;
  current_client text; current_agency text; current_staff text;
begin
  select * into i from public.connexy_current_identity();
  if i.company_id is null or i.member_role<>'admin' then
    raise exception '管理者の追加認証が必要です。' using errcode='42501';
  end if;
  if action is null or action not in ('confirm','decline','withdraw') then
    raise exception '操作を指定してください。' using errcode='22023';
  end if;
  select * into o from connexy_private.contract_offers where id=target_offer for update;
  if o.id is null or (action in ('confirm','decline') and i.company_id<>o.agency_id)
    or (action='withdraw' and i.company_id<>o.client_id) then
    raise exception '対象を確認できないか、操作権限がありません。' using errcode='42501';
  end if;
  if action='confirm' and o.status='confirmed' then return o.contract_id; end if;
  if (action='decline' and o.status='declined') or (action='withdraw' and o.status='withdrawn') then return null; end if;
  if o.status<>'offered' then
    raise exception 'この提示への回答はすでに確定しています。' using errcode='22023';
  end if;
  if action in ('decline','withdraw') then
    update connexy_private.contract_offers set status=case when action='decline' then 'declined' else 'withdrawn' end,
      responded_by=auth.uid(),responded_at=statement_timestamp() where id=o.id;
    return null;
  end if;
  if statement_timestamp()>=o.expires_at then
    raise exception '回答期限を過ぎています。取り下げ後に再提示してください。' using errcode='22023';
  end if;
  select * into j from public.jobs where id=o.job_id for share;
  a := connexy_private.valid_sb_approval(o.job_id,o.agency_id,o.staff_id);
  if a is null or a<>o.approval_id or to_jsonb(j) is distinct from o.snapshot->'job' then
    raise exception 'SBの承諾または案件内容が変わりました。確定できません。' using errcode='42501';
  end if;
  select name into current_client from public.companies where id=o.client_id and status='approved' for share;
  select name into current_agency from public.companies where id=o.agency_id and status='approved' for share;
  select name into current_staff from public.staffs where id=o.staff_id and user_id=o.agency_id for share;
  if current_client is distinct from o.snapshot->>'client_name' or current_agency is distinct from o.snapshot->>'agency_name'
    or current_staff is distinct from o.snapshot->>'staff_name' then
    raise exception '契約当事者またはスタッフ情報が変わりました。再提示してください。' using errcode='42501';
  end if;
  final_id := 'ct_' || o.id::text;
  insert into public.contract_tasks(
    id,job_id,job_title,worker_name,company_name,client_name,client_id,agency_id,
    price,date,status,sb_staff_id,sb_approval_id,contract_offer_id,client_contract_text,
    client_contract_approved_by_client,client_contract_approved_by_agency
  ) values(final_id,o.job_id,j.title,current_staff,current_agency,current_client,o.client_id,o.agency_id,
    o.daily_price,array_to_string(o.work_dates,', '),'confirmed',o.staff_id,a,o.id,o.terms,true,true);
  update connexy_private.contract_offers set status='confirmed',responded_by=auth.uid(),responded_at=statement_timestamp(),contract_id=final_id
    where id=o.id;
  return final_id;
end;
$$;
revoke all on function public.connexy_respond_contract_offer(uuid,text) from public,anon;
grant execute on function public.connexy_respond_contract_offer(uuid,text) to authenticated;
commit;
