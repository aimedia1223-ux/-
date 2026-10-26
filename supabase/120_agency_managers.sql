-- 119番適用後。2番の第1段階：二次委託先管理責任者の登録と双方の窓口表示。
-- チャット送信・スタッフへの直接連絡・再委託承諾・アカウント権限は開放しない。
begin;
alter table connexy_private.sb_approvals add constraint sb_approval_agency_unique unique(id,agency_id);
create table connexy_private.agency_managers (
  approval_id uuid primary key,
  agency_id text not null,
  manager_staff_id text not null,
  version integer not null check(version>0),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null,
  foreign key(approval_id,agency_id) references connexy_private.sb_approvals(id,agency_id) on delete cascade,
  foreign key(manager_staff_id,agency_id) references public.staffs(id,user_id)
);
alter table connexy_private.agency_managers enable row level security;
revoke all on connexy_private.agency_managers from public,anon,authenticated;

create function connexy_private.agency_manager_json(target_approval uuid,include_stale boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m connexy_private.agency_managers; valid_manager boolean;
begin
  select * into m from connexy_private.agency_managers where approval_id=target_approval;
  if m.approval_id is null then return null; end if;
  valid_manager:=connexy_private.responsibility_staff_active(m.manager_staff_id,m.agency_id);
  if not include_stale and not valid_manager then return null; end if;
  return jsonb_build_object('manager_staff_id',m.manager_staff_id,
    'manager_name',(select name from public.staffs where id=m.manager_staff_id),
    'is_current',valid_manager,'version',m.version,'updated_at',m.updated_at);
end;
$$;
revoke all on function connexy_private.agency_manager_json(uuid,boolean) from public,anon,authenticated;

create function public.connexy_list_agency_managers()
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; p record; allowed boolean; incoming boolean; assignments jsonb:='[]'; candidates jsonb;
begin
  select * into i from public.connexy_current_identity();
  if i.company_id is null or i.member_role<>'admin' then
    raise exception '有効な管理者所属と追加認証が必要です。' using errcode='42501';
  end if;
  for p in select a.*,j.title, m.approval_id is not null as has_assignment
    from connexy_private.sb_approvals a join public.jobs j on j.id=a.job_id
    left join connexy_private.agency_managers m on m.approval_id=a.id
    where (a.agency_id=i.company_id and a.staff_id=i.staff_id)
      or (a.client_id=i.company_id and j.author_id=i.company_id and m.approval_id is not null)
    order by a.verified_at desc,a.id loop
    allowed:=connexy_private.valid_sb_approval(p.job_id,p.agency_id,p.staff_id) is not distinct from p.id;
    incoming:=p.agency_id=i.company_id;
    if not allowed and not p.has_assignment then continue; end if;
    assignments:=assignments||jsonb_build_array(jsonb_build_object(
      'approval_id',p.id,'side',case when incoming then 'agency' else 'client' end,
      'approved',allowed,'can_edit',incoming and allowed,'has_assignment',p.has_assignment,
      'job_title',case when allowed or not incoming then p.title else '承諾の再確認が必要な登録' end,
      'client_name',case when allowed then (select name from public.companies where id=p.client_id) else null end,
      'agency_name',case when allowed then (select name from public.companies where id=p.agency_id) else null end,
      'primary_contacts',case when allowed then connexy_private.job_responsibility_json(p.job_id,false) else null end,
      'manager',case when allowed or incoming then connexy_private.agency_manager_json(p.id,incoming) else null end
    ));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name,s.id),'[]') into candidates
    from public.staffs s where s.user_id=i.company_id
      and connexy_private.responsibility_staff_active(s.id,s.user_id);
  return jsonb_build_object('items',assignments,'candidates',candidates);
end;
$$;
revoke all on function public.connexy_list_agency_managers() from public,anon;
grant execute on function public.connexy_list_agency_managers() to authenticated;

create function public.connexy_save_agency_manager(target_approval uuid,manager_staff text,expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; a connexy_private.sb_approvals; previous connexy_private.agency_managers; accepted text;
begin
  select * into i from public.connexy_current_identity();
  if i.company_id is null or i.member_role<>'admin' then
    raise exception '承諾対象の二次委託先管理者の追加認証が必要です。' using errcode='42501';
  end if;
  select * into a from connexy_private.sb_approvals where id=target_approval;
  if a.id is null or a.agency_id<>i.company_id or a.staff_id<>i.staff_id then
    raise exception '承諾対象の二次委託先管理者の追加認証が必要です。' using errcode='42501';
  end if;
  perform 1 from public.jobs where id=a.job_id for update;
  if connexy_private.valid_sb_approval(a.job_id,a.agency_id,a.staff_id) is distinct from a.id then
    raise exception '有効な承諾・対象・期間・案件内容を確認できません。' using errcode='42501';
  end if;
  if expected_version is null or expected_version<0 then
    raise exception '現在の登録内容を再取得してください。' using errcode='22023';
  end if;
  select * into previous from connexy_private.agency_managers where approval_id=a.id for update;
  if coalesce(previous.version,0)<>expected_version then
    raise exception '登録内容が更新されています。一覧を再取得してください。' using errcode='40001';
  end if;
  select s.id into accepted from public.staffs s join public.connexy_auth_memberships m
    on m.staff_id=s.id and m.company_id=s.user_id
    where s.id=manager_staff and s.user_id=i.company_id and m.active
    order by m.auth_user_id limit 1 for share of s,m;
  if accepted is null then
    raise exception '自社の有効な担当者を管理責任者に選択してください。' using errcode='22023';
  end if;
  insert into connexy_private.agency_managers(approval_id,agency_id,manager_staff_id,version,updated_by,updated_at)
    values(a.id,i.company_id,manager_staff,expected_version+1,auth.uid(),statement_timestamp())
    on conflict(approval_id) do update set manager_staff_id=excluded.manager_staff_id,version=excluded.version,
      updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  return connexy_private.agency_manager_json(a.id,true);
end;
$$;
revoke all on function public.connexy_save_agency_manager(uuid,text,integer) from public,anon;
grant execute on function public.connexy_save_agency_manager(uuid,text,integer) to authenticated;
-- 登録しても担当者のAuth権限・案件閲覧割当・SB承諾・契約やチャットは変更しない。
commit;
