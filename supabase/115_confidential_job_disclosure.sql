-- 111番まで適用後。実データの登録・公開を承認するSQLではない。
-- 公開概要はSQL管理者が明示登録する。既存案件は自動公開しない。
begin;
create table connexy_private.job_publications (
  public_id uuid primary key default gen_random_uuid(),
  job_id text not null unique references public.jobs(id) on delete cascade,
  region text not null check(region in ('北海道','東北','関東','中部','近畿','中国','四国','九州・沖縄')),
  category text not null check(category in ('通信サービスの販売支援','店舗運営支援','イベント運営支援','その他の業務支援')),
  enabled boolean not null default false,
  job_snapshot jsonb not null
);
alter table connexy_private.job_publications enable row level security;
revoke all on connexy_private.job_publications from public,anon,authenticated;

-- 自由記述のタイトル/所在地等から概要を自動生成しない。
-- 登録後に元案件が変われば、管理者が再確認して更新するまで一覧からも非公開。
create function connexy_private.prepare_job_publication()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='UPDATE' and (new.public_id<>old.public_id or new.job_id<>old.job_id) then
    raise exception '公開対象IDは変更できません。';
  end if;
  select to_jsonb(j) into new.job_snapshot from public.jobs j where j.id=new.job_id for share;
  if new.job_snapshot is null then raise exception '案件を確認できません。'; end if;
  return new;
end;
$$;
revoke all on function connexy_private.prepare_job_publication() from public,anon,authenticated;
create trigger prepare_job_publication before insert or update on connexy_private.job_publications
  for each row execute function connexy_private.prepare_job_publication();

create function public.connexy_list_job_summaries()
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; result jsonb;
begin
  select * into i from public.connexy_current_identity();
  if i.company_id is null then
    raise exception '有効な所属と追加認証が必要です。' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'public_id',p.public_id,'region',p.region,'category',p.category
  ) order by p.public_id),'[]'::jsonb) into result
  from connexy_private.job_publications p join public.jobs j on j.id=p.job_id
  join public.companies c on c.id=j.author_id and c.status='approved'
  where p.enabled and p.job_snapshot=to_jsonb(j) and j.author_id<>i.company_id
    -- 既存の会社限定公開条件もサーバーで守る。
    and (coalesce(cardinality(j.allowed_company_ids),0)=0 or i.company_id=any(j.allowed_company_ids));
  return result;
end;
$$;
revoke all on function public.connexy_list_job_summaries() from public,anon;
grant execute on function public.connexy_list_job_summaries() to authenticated;

create function public.connexy_read_approved_job(target_public_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; j public.jobs;
begin
  select * into i from public.connexy_current_identity();
  if i.company_id is null then
    raise exception '詳細を開示できません。所属・追加認証・承諾対象を確認してください。' using errcode='42501';
  end if;
  select jobs.* into j from connexy_private.job_publications p
    join public.jobs jobs on jobs.id=p.job_id
    where p.public_id=target_public_id and p.enabled and p.job_snapshot=to_jsonb(jobs)
      and (coalesce(cardinality(jobs.allowed_company_ids),0)=0 or i.company_id=any(jobs.allowed_company_ids))
    for share of jobs,p;
  -- 会社の一致だけでは不可。ログイン本人のスタッフIDまで一致させる。
  if j.id is null or connexy_private.valid_sb_approval(j.id,i.company_id,i.staff_id) is null then
    raise exception '詳細を開示できません。所属・追加認証・承諾対象を確認してください。' using errcode='42501';
  end if;
  -- 新しい列が増えても自動で開示されないよう、開示項目を固定する。
  return jsonb_build_object('title',j.title,'description',j.description,
    'detailed_description',j.detailed_description,'location_name',j.location_name,
    'exact_location',j.exact_location,'work_hours',j.work_hours,'event_date',j.event_date,
    'price',j.price,'company_name',(select c.name from public.companies c where c.id=j.author_id));
end;
$$;
revoke all on function public.connexy_read_approved_job(uuid) from public,anon;
grant execute on function public.connexy_read_approved_job(uuid) to authenticated;

-- 契約一覧に含まれる固定済み案件詳細も、二次委託先の取得時に承諾を再確認する。
-- 元の専用関数を非公開へ移し、公開経路をこのラッパーだけにする。
alter function public.connexy_list_contract_offers() set schema connexy_private;
revoke all on function connexy_private.connexy_list_contract_offers() from public,anon,authenticated;
create function public.connexy_list_contract_offers()
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; result jsonb;
begin
  select * into i from public.connexy_current_identity();
  if i.company_id is null or i.member_role<>'admin' then
    raise exception '管理者の追加認証が必要です。' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(entry.value order by entry.ordinality),'[]'::jsonb) into result
    from jsonb_array_elements(connexy_private.connexy_list_contract_offers()) with ordinality entry(value,ordinality)
    where entry.value->>'client_id'=i.company_id or (
      entry.value->>'agency_id'=i.company_id and entry.value->>'staff_id'=i.staff_id
      and connexy_private.valid_sb_approval(entry.value->>'job_id',i.company_id,i.staff_id) is not null);
  return result;
end;
$$;
revoke all on function public.connexy_list_contract_offers() from public,anon;
grant execute on function public.connexy_list_contract_offers() to authenticated;
-- public.jobsのRLS・他社の会社/スタッフ/契約テーブルの取得権限は拡張しない。
commit;
