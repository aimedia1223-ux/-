-- 100/102/105/106適用後。書込権限・契約閲覧権限を開放しない。
-- 原本は承認済み社内保管場所へ。ここには参照番号・SHA256・照合記録だけを登録する。
begin;
do $$ begin
  if exists(select 1 from public.contract_tasks) then
    raise exception '既存の契約・チャット記録があります。削除せず、承諾状況の調査と移行設計を先に行ってください。';
  end if;
end; $$;
create table connexy_private.sb_approvals (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id),
  client_id text not null references public.companies(id),
  agency_id text not null references public.companies(id),
  staff_id text not null,
  approval_number text not null check (length(trim(approval_number)) > 0),
  document_reference text not null check (length(trim(document_reference)) > 0),
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  approved_on date not null,
  work_from date not null,
  work_until date not null check (work_until >= work_from),
  expires_on date not null check (expires_on >= approved_on),
  verified_by text not null check (length(trim(verified_by)) > 0),
  verification_note text not null check (length(trim(verification_note)) > 0),
  verified_at timestamptz not null default statement_timestamp(),
  job_snapshot jsonb not null,
  status text not null default 'verified' check (status in ('verified','revoked')),
  check (client_id <> agency_id),
  foreign key (staff_id,agency_id) references public.staffs(id,user_id)
);
alter table connexy_private.sb_approvals enable row level security;
revoke all on connexy_private.sb_approvals from public,anon,authenticated;
create index on connexy_private.sb_approvals(job_id,agency_id,staff_id);
create unique index sb_one_active_approval on connexy_private.sb_approvals(job_id,agency_id,staff_id)
  where status = 'verified';

-- 対象外の自己申告による回避を防ぐため、分類未確認の案件も全て承諾必須。
-- この段階ではSB以外の免除経路を用意しない。
create function connexy_private.sb_job_dates(event_dates text)
returns date[] language plpgsql immutable set search_path = '' as $$
declare part text; result date[] := '{}';
begin
  if event_dates is null or trim(event_dates) = '' then return null; end if;
  foreach part in array regexp_split_to_array(trim(event_dates), '[,[:space:]]+') loop
    if part !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
    result := array_append(result, part::date);
  end loop;
  return result;
exception when datetime_field_overflow or invalid_datetime_format then return null;
end;
$$;
revoke all on function connexy_private.sb_job_dates(text) from public,anon,authenticated;

create function connexy_private.prepare_sb_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
declare j public.jobs; dates date[]; today date := (statement_timestamp() at time zone 'Asia/Tokyo')::date;
begin
  if TG_OP = 'UPDATE' then
    if old.status <> 'verified' or new.status <> 'revoked'
      or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
      raise exception '承諾記録は変更できません。取消後に新しい原本照合記録を登録してください。';
    end if;
    return new;
  end if;
  select * into j from public.jobs where id = new.job_id for share;
  dates := connexy_private.sb_job_dates(j.event_date);
  if j.id is null or new.client_id <> j.author_id or dates is null
    or new.approved_on > today or new.approved_on > new.work_from
    or new.expires_on < today or new.expires_on < new.work_until
    or exists(select 1 from unnest(dates) d where d < new.work_from or d > new.work_until) then
    raise exception '原本照合の対象・承諾日・期間と案件が一致しません。';
  end if;
  new.job_snapshot := to_jsonb(j);
  new.verified_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function connexy_private.prepare_sb_approval() from public,anon,authenticated;
create trigger prepare_sb_approval before insert or update on connexy_private.sb_approvals
  for each row execute function connexy_private.prepare_sb_approval();

-- 行ロックにより承諾取消・案件変更と状態確定を直列化する。
create function connexy_private.valid_sb_approval(target_job text,target_agency text,target_staff text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare j public.jobs; a connexy_private.sb_approvals; dates date[];
  today date := (statement_timestamp() at time zone 'Asia/Tokyo')::date;
begin
  select * into j from public.jobs where id = target_job for share;
  if j.id is null or not exists(select 1 from public.companies c where c.id=j.author_id and c.status='approved')
    or not exists(select 1 from public.companies c where c.id=target_agency and c.status='approved') then return null; end if;
  dates := connexy_private.sb_job_dates(j.event_date);
  if dates is null then return null; end if;
  select p.* into a from connexy_private.sb_approvals p
    where p.job_id = j.id and p.client_id = j.author_id and p.agency_id = target_agency
      and p.staff_id = target_staff and p.status = 'verified'
      and p.approved_on <= today and p.expires_on >= today
      and p.verified_at <= statement_timestamp() and p.job_snapshot = to_jsonb(j)
      and not exists(select 1 from unnest(dates) d where d < p.work_from or d > p.work_until or d > p.expires_on)
    order by p.verified_at desc,p.id limit 1 for share;
  return a.id;
end;
$$;
revoke all on function connexy_private.valid_sb_approval(text,text,text) from public,anon,authenticated;

create function public.connexy_check_sb_approval(target_job text,target_agency text,target_staff text)
returns table(approved boolean,approval_id uuid,reason text)
language plpgsql security definer set search_path = '' as $$
declare i record; owner_id text; found_id uuid;
begin
  select * into i from public.connexy_current_identity();
  if i.company_id is null or i.member_role <> 'admin' then
    raise exception '管理者の追加認証が必要です。' using errcode = '42501';
  end if;
  select author_id into owner_id from public.jobs where id = target_job;
  if i.company_id = owner_id or i.company_id = target_agency then
    found_id := connexy_private.valid_sb_approval(target_job,target_agency,target_staff);
  end if;
  return query select found_id is not null,found_id,
    case when found_id is null then '承諾未確認・期限切れ・対象不一致のため確定できません。' else '原本照合記録と対象が一致しています。' end;
end;
$$;
revoke all on function public.connexy_check_sb_approval(text,text,text) from public,anon;
grant execute on function public.connexy_check_sb_approval(text,text,text) to authenticated;

alter table public.contract_tasks add column sb_staff_id text;
alter table public.contract_tasks add column sb_approval_id uuid references connexy_private.sb_approvals(id);
alter table public.contract_tasks add constraint sb_contract_staff_company_fk
  foreign key (sb_staff_id,agency_id) references public.staffs(id,user_id);

create function connexy_private.enforce_sb_contract_gate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare entry record; resolved uuid; j public.jobs; dates date[]; contract_dates date[]; identity record;
  protected boolean;
begin
  if current_setting('role',true) in ('anon','authenticated') or auth.uid() is not null then
    select * into identity from public.connexy_current_identity();
    if identity.company_id is null or identity.member_role <> 'admin'
      or identity.company_id not in (coalesce(new.client_id,''),coalesce(new.agency_id,'')) then
      raise exception '当事者管理者の追加認証が必要です。' using errcode = '42501';
    end if;
  end if;
  -- 旧グループ形式は案件/参加者の正規化まで新規作成・変更を開放しない。
  if new.id like 'chat_group_%' or new.id = 'chat_au_group' then
    raise exception '現場グループ作成は承諾と参加者の検証が完了するまで停止中です。' using errcode = '42501';
  end if;
  if jsonb_typeof(new.evaluations) <> 'object'
    or (new.evaluations ? 'jobStates' and jsonb_typeof(new.evaluations->'jobStates') <> 'object') then
    raise exception '案件状態の形式が不正です。';
  end if;
  -- 旧JSONを含むチャット単位での確定は認めない。実契約は案件IDへ固定する。
  protected := new.status in ('offered','confirmed','report_pending','completed','disputed');
  if protected then
    select * into j from public.jobs where id = new.job_id for share;
    if j.id is null or new.client_id is distinct from j.author_id then
      raise exception '案件と一次委託先を確認できません。' using errcode = '42501';
    end if;
    resolved := connexy_private.valid_sb_approval(new.job_id,new.agency_id,new.sb_staff_id);
    dates := connexy_private.sb_job_dates(j.event_date);
    contract_dates := connexy_private.sb_job_dates(new.date);
    if resolved is null or new.sb_approval_id is distinct from resolved or contract_dates is null
      or not (contract_dates <@ dates) then
      raise exception 'SBの事前書面承諾・対象スタッフ・日程を確認できないため確定できません。' using errcode = '42501';
    end if;
  end if;
  for entry in select key,value from jsonb_each(coalesce(new.evaluations->'jobStates','{}')) loop
    if entry.value->>'status' not in ('applying','rejected','declined','cancelled')
      or entry.value->>'status' is null then
      -- ブラウザ自己申告のsbSubcontractApprovalは根拠に使わない。
      -- JSON内だけに進行状態を作る抜け道は閉じ、正規の実契約と一致する場合だけ許可。
      if not protected or entry.key <> new.job_id
        or entry.value->>'staffId' is distinct from new.sb_staff_id
        or entry.value->>'status' is distinct from new.status then
        raise exception '案件別状態の確定は承諾済みの実契約と一致させてください。' using errcode = '42501';
      end if;
    end if;
  end loop;
  if not protected and (
    new.client_contract_approved_by_client or new.client_contract_approved_by_agency
    or new.agency_contract_approved_by_client or new.agency_contract_approved_by_agency
    or new.evaluations ? 'offeredJobId' or new.evaluations ? 'offeredStaffId'
    or new.evaluations ? 'sbSubcontractApproval') then
    raise exception '承諾未確認のオファー・契約承認は保存できません。' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function connexy_private.enforce_sb_contract_gate() from public,anon,authenticated;
create trigger enforce_sb_contract_gate before insert or update on public.contract_tasks
  for each row execute function connexy_private.enforce_sb_contract_gate();
commit;
