-- 115番適用後。16番：案件所有会社の連絡窓口・事故対応責任者。
-- 既存案件・SB承諾・契約・本人の権限は変更しない。既存案件への自動登録もしない。
begin;
alter table public.jobs add constraint connexy_job_owner_unique unique(id,author_id);
create table connexy_private.job_responsibilities (
  job_id text primary key,
  company_id text not null references public.companies(id),
  sb_contact_staff_id text not null,
  agency_contact_staff_id text not null,
  incident_contact_staff_id text not null,
  version integer not null check(version>0),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null,
  foreign key(job_id,company_id) references public.jobs(id,author_id) on delete cascade,
  foreign key(sb_contact_staff_id,company_id) references public.staffs(id,user_id),
  foreign key(agency_contact_staff_id,company_id) references public.staffs(id,user_id),
  foreign key(incident_contact_staff_id,company_id) references public.staffs(id,user_id)
);
alter table connexy_private.job_responsibilities enable row level security;
revoke all on connexy_private.job_responsibilities from public,anon,authenticated;

create function connexy_private.responsibility_staff_active(target_staff text,target_company text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staffs s join public.connexy_auth_memberships m
    on m.staff_id=s.id and m.company_id=s.user_id
    where s.id=target_staff and s.user_id=target_company and m.active);
$$;
revoke all on function connexy_private.responsibility_staff_active(text,text) from public,anon,authenticated;

create function connexy_private.job_responsibility_json(target_job text,include_stale boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r connexy_private.job_responsibilities; current_contacts boolean;
begin
  select * into r from connexy_private.job_responsibilities where job_id=target_job;
  if r.job_id is null then return null; end if;
  current_contacts := connexy_private.responsibility_staff_active(r.sb_contact_staff_id,r.company_id)
    and connexy_private.responsibility_staff_active(r.agency_contact_staff_id,r.company_id)
    and connexy_private.responsibility_staff_active(r.incident_contact_staff_id,r.company_id);
  if not include_stale and not current_contacts then return null; end if;
  return jsonb_build_object('version',r.version,'updated_at',r.updated_at,'is_current',current_contacts,
    'sb_contact_staff_id',r.sb_contact_staff_id,'sb_contact_name',(select name from public.staffs where id=r.sb_contact_staff_id),
    'agency_contact_staff_id',r.agency_contact_staff_id,'agency_contact_name',(select name from public.staffs where id=r.agency_contact_staff_id),
    'incident_contact_staff_id',r.incident_contact_staff_id,'incident_contact_name',(select name from public.staffs where id=r.incident_contact_staff_id));
end;
$$;
revoke all on function connexy_private.job_responsibility_json(text,boolean) from public,anon,authenticated;

create function public.connexy_get_job_responsibilities(target_job text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; owner_id text; candidates jsonb;
begin
  select * into i from public.connexy_current_identity();
  select author_id into owner_id from public.jobs where id=target_job;
  if i.company_id is null or i.member_role<>'admin' or owner_id is distinct from i.company_id then
    raise exception '自社案件の管理者の追加認証が必要です。' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name,s.id),'[]') into candidates
    from public.staffs s where s.user_id=i.company_id
      and connexy_private.responsibility_staff_active(s.id,s.user_id);
  return jsonb_build_object('contacts',connexy_private.job_responsibility_json(target_job,true),'candidates',candidates);
end;
$$;
revoke all on function public.connexy_get_job_responsibilities(text) from public,anon;
grant execute on function public.connexy_get_job_responsibilities(text) to authenticated;

create function public.connexy_save_job_responsibilities(
  target_job text,sb_contact text,agency_contact text,incident_contact text,expected_version integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; owner_id text; previous connexy_private.job_responsibilities; member text; accepted text;
begin
  select * into i from public.connexy_current_identity();
  if i.company_id is null or i.member_role<>'admin' then
    raise exception '自社案件の管理者の追加認証が必要です。' using errcode='42501';
  end if;
  select author_id into owner_id from public.jobs where id=target_job for update;
  if owner_id is distinct from i.company_id then
    raise exception '自社案件の管理者の追加認証が必要です。' using errcode='42501';
  end if;
  if expected_version is null or expected_version<0 then
    raise exception '現在の登録内容を再取得してください。' using errcode='22023';
  end if;
  select * into previous from connexy_private.job_responsibilities where job_id=target_job for update;
  if coalesce(previous.version,0)<>expected_version then
    raise exception '別の更新が保存されています。再取得してから確認してください。' using errcode='40001';
  end if;
  foreach member in array array[sb_contact,agency_contact,incident_contact] loop
    accepted:=null;
    select s.id into accepted from public.staffs s join public.connexy_auth_memberships m
      on m.staff_id=s.id and m.company_id=s.user_id
      where s.id=member and s.user_id=i.company_id and m.active
      order by m.auth_user_id limit 1 for share of s,m;
    if accepted is null then
      raise exception '3つの役割に自社の有効な担当者を指定してください。' using errcode='22023';
    end if;
  end loop;
  -- 同じ人の兼任を許可する。担当者の指定でアカウント権限や案件割当を追加しない。
  insert into connexy_private.job_responsibilities(job_id,company_id,sb_contact_staff_id,agency_contact_staff_id,
    incident_contact_staff_id,version,updated_by,updated_at)
    values(target_job,i.company_id,sb_contact,agency_contact,incident_contact,expected_version+1,auth.uid(),statement_timestamp())
    on conflict(job_id) do update set sb_contact_staff_id=excluded.sb_contact_staff_id,
      agency_contact_staff_id=excluded.agency_contact_staff_id,incident_contact_staff_id=excluded.incident_contact_staff_id,
      version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  return connexy_private.job_responsibility_json(target_job,true);
end;
$$;
revoke all on function public.connexy_save_job_responsibilities(text,text,text,text,integer) from public,anon;
grant execute on function public.connexy_save_job_responsibilities(text,text,text,text,integer) to authenticated;

-- 6番の詳細取得と同じ本人・承諾チェックの後だけ、連絡窓口を添える。
create or replace function public.connexy_read_approved_job(target_public_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; j public.jobs;
begin
  select * into i from public.connexy_current_identity();
  if i.company_id is null then
    raise exception '詳細を開示できません。所属・追加認証・承諾対象を確認してください。' using errcode='42501';
  end if;
  select jobs.* into j from connexy_private.job_publications p join public.jobs jobs on jobs.id=p.job_id
    where p.public_id=target_public_id and p.enabled and p.job_snapshot=to_jsonb(jobs)
      and (coalesce(cardinality(jobs.allowed_company_ids),0)=0 or i.company_id=any(jobs.allowed_company_ids))
    for share of jobs,p;
  if j.id is null or connexy_private.valid_sb_approval(j.id,i.company_id,i.staff_id) is null then
    raise exception '詳細を開示できません。所属・追加認証・承諾対象を確認してください。' using errcode='42501';
  end if;
  return jsonb_build_object('title',j.title,'description',j.description,'detailed_description',j.detailed_description,
    'location_name',j.location_name,'exact_location',j.exact_location,'work_hours',j.work_hours,
    'event_date',j.event_date,'price',j.price,'company_name',(select c.name from public.companies c where c.id=j.author_id),
    'contacts',connexy_private.job_responsibility_json(j.id,false));
end;
$$;
revoke all on function public.connexy_read_approved_job(uuid) from public,anon;
grant execute on function public.connexy_read_approved_job(uuid) to authenticated;
commit;
