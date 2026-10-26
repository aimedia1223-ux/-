-- 115番適用後の架空検証プロジェクト専用。既存案件は変更しない。
-- ブラウザで拒否と開示を確認するため、架空案件2件・概要2件・架空承諾1件を一時保存する。確認後は118番で片付ける。
begin;
do $$
declare
  create_fixture constant boolean := true;
  fixture_proof constant uuid := '00000000-0000-4000-9000-000000000117';
  fixture_note constant text := '架空の開示検証専用です。本物のSB承諾・実案件・契約・稼働ではありません。確認後に118番で削除します。';
  cfg record; j public.jobs; expected jsonb; existed boolean;
  today date := (statement_timestamp() at time zone 'Asia/Tokyo')::date;
  work_day date;
begin
  if auth.uid() is not null then raise exception '管理者のSQL Editorで実行してください。'; end if;
  if to_regprocedure('public.connexy_read_approved_job(uuid)') is null then raise exception '115番SQLを先に適用してください。'; end if;
  if create_fixture and (
    not exists(select 1 from public.companies where id='demoa' and name='架空検証会社A' and status='approved')
    or not exists(select 1 from public.companies where id='demob' and name='架空検証会社B' and status='approved')
    or not exists(select 1 from public.staffs where id='demobstaff' and user_id='demob' and name='架空担当者B')) then
    raise exception '指定の架空検証会社・担当者を確認できません。実データで代用しないでください。';
  end if;
  if exists(select 1 from connexy_private.sb_approvals where id=fixture_proof and job_id<>'connexy-browser-disclosure-approved') then
    raise exception '固定の検証承諾IDが別の対象に使われています。変更・削除せず停止します。';
  end if;
  for cfg in select * from (values
    ('connexy-browser-disclosure-unapproved','00000000-0000-4000-9000-000000000171'::uuid,false,'関東','店舗運営支援','未承諾'),
    ('connexy-browser-disclosure-approved','00000000-0000-4000-9000-000000000172'::uuid,true,'中部','イベント運営支援','承諾あり')
  ) v(job_id,public_id,approved,region,category,label) loop
    select * into j from public.jobs where id=cfg.job_id for update;
    existed := j.id is not null;
    if not existed and not create_fixture then
      if exists(select 1 from connexy_private.job_publications p where p.public_id=cfg.public_id or p.job_id=cfg.job_id)
        or exists(select 1 from connexy_private.sb_approvals a where a.job_id=cfg.job_id or (cfg.approved and a.id=fixture_proof))
        or exists(select 1 from connexy_private.contract_offers o where o.job_id=cfg.job_id)
        or exists(select 1 from public.contract_tasks t where t.job_id=cfg.job_id) then
        raise exception '検証データの対応関係が不明です。削除せず停止します。';
      end if;
      continue;
    end if;
    work_day := case when existed then (j.created_at at time zone 'Asia/Tokyo')::date+10 else today+10 end;
    expected := jsonb_build_object('id',cfg.job_id,'author_id','demoa',
      'title','【ブラウザ開示検証専用】'||cfg.label||'の架空店舗（実在しません）',
      'description',fixture_note,'detailed_description',fixture_note,
      'price',10000,'location_name','架空の検証会場（実在しません）',
      'exact_location','架空の検証店舗・住所（実在しません）',
      'work_hours','10:00〜18:00（架空）','event_date',work_day::text,
      'requirements',jsonb_build_array('__JOB_CODE__::DISCLOSURE-BROWSER-TEST'),
      'is_urgent',false,'allowed_company_ids',jsonb_build_array('demob'),
      'created_at',case when existed then j.created_at else statement_timestamp() end);
    expected := to_jsonb(jsonb_populate_record(null::public.jobs,expected));
    if existed and to_jsonb(j) is distinct from expected then
      raise exception '検証IDの案件が想定と異なります。上書き・削除せず停止します。';
    end if;
    if not existed then
      insert into public.jobs select r.* from jsonb_populate_record(null::public.jobs,expected) r;
      select * into j from public.jobs where id=cfg.job_id;
      if exists(select 1 from connexy_private.job_publications p where p.public_id=cfg.public_id) then
        raise exception '公開IDが別の対象に使われています。変更せず停止します。';
      end if;
      insert into connexy_private.job_publications(public_id,job_id,region,category,enabled,job_snapshot)
        values(cfg.public_id,cfg.job_id,cfg.region,cfg.category,true,'{}');
      if cfg.approved then
        if exists(select 1 from connexy_private.sb_approvals where id=fixture_proof) then
          raise exception '検証承諾IDが使われています。停止します。';
        end if;
        insert into connexy_private.sb_approvals(id,job_id,client_id,agency_id,staff_id,
          approval_number,document_reference,document_sha256,approved_on,work_from,work_until,expires_on,
          verified_by,verification_note,job_snapshot)
          values(fixture_proof,cfg.job_id,'demoa','demob','demobstaff','TEST-ONLY-NOT-SB-APPROVAL',
            'CONNEXY_DISCLOSURE_BROWSER_TEST_ONLY_NO_ORIGINAL',repeat('0',64),today,work_day,work_day,work_day,
            '架空の開示検証担当',fixture_note,'{}');
      end if;
    end if;
    if not exists(select 1 from connexy_private.job_publications p
      where p.public_id=cfg.public_id and p.job_id=cfg.job_id and p.region=cfg.region and p.category=cfg.category
        and p.job_snapshot=to_jsonb(j) and (not create_fixture or p.enabled)) then
      raise exception '公開概要が想定と異なります。変更・削除せず停止します。';
    end if;
    if exists(select 1 from connexy_private.sb_approvals a where a.job_id=cfg.job_id and
      (not cfg.approved or a.id<>fixture_proof)) then
      raise exception '想定外の承諾が含まれています。変更・削除せず停止します。';
    end if;
    if cfg.approved and not exists(select 1 from connexy_private.sb_approvals a
      where a.id=fixture_proof and a.job_id=cfg.job_id and a.client_id='demoa' and a.agency_id='demob'
        and a.staff_id='demobstaff' and a.approval_number='TEST-ONLY-NOT-SB-APPROVAL'
        and a.document_reference='CONNEXY_DISCLOSURE_BROWSER_TEST_ONLY_NO_ORIGINAL'
        and a.document_sha256=repeat('0',64) and a.verified_by='架空の開示検証担当' and a.verification_note=fixture_note
        and a.approved_on=(j.created_at at time zone 'Asia/Tokyo')::date
        and a.work_from=work_day and a.work_until=work_day and a.expires_on=work_day
        and a.job_snapshot=to_jsonb(j) and (not create_fixture or a.status='verified')) then
      raise exception '検証承諾が想定と異なります。変更・削除せず停止します。';
    end if;
    if create_fixture and cfg.approved
      and connexy_private.valid_sb_approval(cfg.job_id,'demob','demobstaff') is distinct from fixture_proof then
      raise exception '以前の検証記録が無効です。118番で片付けてから作り直してください。';
    end if;
    if exists(select 1 from connexy_private.contract_offers o where o.job_id=cfg.job_id)
      or exists(select 1 from public.contract_tasks t where t.job_id=cfg.job_id) then
      raise exception '検証案件に条件提示・契約があります。変更・削除せず停止します。';
    end if;
  end loop;
  if not create_fixture then
    delete from connexy_private.job_publications where job_id in ('connexy-browser-disclosure-unapproved','connexy-browser-disclosure-approved');
    delete from connexy_private.sb_approvals where id=fixture_proof;
    delete from public.jobs where id in ('connexy-browser-disclosure-unapproved','connexy-browser-disclosure-approved');
  end if;
end;
$$;
select '架空のブラウザ検証データを準備しました。B社で公開概要を更新してください。確認後は118番で削除します。' as result;
commit;
