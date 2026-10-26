-- 111番適用後の架空検証プロジェクト専用。ブラウザでA提示→B確定を確認するため一時保存する。
-- 本物のSB承諾ではない。実案件へ転用しない。確認後は114番でこの検証データだけを削除する。
begin;
do $$
declare
  fixture_job constant text := 'connexy-browser-contract-test';
  fixture_approval constant uuid := '00000000-0000-4000-9000-000000000113';
  fixture_title constant text := '【ブラウザ検証専用】A社→B社 契約確定テスト（実契約なし）';
  fixture_description constant text := '架空のブラウザ検証専用です。本物のSB承諾・実契約・稼働ではありません。確認後に削除します。';
  today date := (statement_timestamp() at time zone 'Asia/Tokyo')::date;
  j public.jobs;
begin
  if auth.uid() is not null then raise exception '管理者のSQL Editorで実行してください。'; end if;
  if to_regprocedure('public.connexy_create_contract_offer(uuid,text,text,text,text)') is null then
    raise exception '111番SQLを先に適用してください。';
  end if;
  if not exists(select 1 from public.companies where id='demoa' and name='架空検証会社A' and status='approved')
    or not exists(select 1 from public.companies where id='demob' and name='架空検証会社B' and status='approved')
    or not exists(select 1 from public.staffs where id='demoastaff' and user_id='demoa' and name='架空担当者A')
    or not exists(select 1 from public.staffs where id='demobstaff' and user_id='demob' and name='架空担当者B') then
    raise exception '指定の架空検証会社・スタッフを確認できません。実データで代用せず停止します。';
  end if;
  select * into j from public.jobs where id=fixture_job for update;
  if j.id is not null then
    if j.author_id<>'demoa' or j.title<>fixture_title or j.description<>fixture_description or j.price<>10000
      or not exists(select 1 from connexy_private.sb_approvals a
        where a.id=fixture_approval and a.job_id=fixture_job and a.client_id='demoa' and a.agency_id='demob'
          and a.staff_id='demobstaff' and a.document_reference='CONNEXY_BROWSER_TEST_ONLY_NO_ORIGINAL'
          and a.approval_number='TEST-ONLY-NOT-SB-APPROVAL' and a.document_sha256=repeat('0',64)
          and a.verification_note=fixture_description and a.job_snapshot=to_jsonb(j) and a.status='verified') then
      raise exception '検証IDの内容が想定と異なります。上書きせず停止します。';
    end if;
    if connexy_private.valid_sb_approval(fixture_job,'demob','demobstaff') is distinct from fixture_approval then
      raise exception '以前の検証記録が無効です。114番で片付けてから作り直してください。';
    end if;
    return;
  end if;
  if exists(select 1 from connexy_private.sb_approvals where id=fixture_approval) then
    raise exception '検証承諾IDが別の記録に使われています。停止します。';
  end if;
  insert into public.jobs(id,author_id,title,description,detailed_description,event_date,price,location_name,work_hours,requirements)
    values(fixture_job,'demoa',fixture_title,fixture_description,'架空の検証用入力のみ。実際の業務・発注・支払は発生しません。',
      (today+10)::text,10000,'架空の検証会場（実在しません）','10:00〜18:00（架空）',array['__JOB_CODE__::BROWSER-CONTRACT-TEST']);
  insert into connexy_private.sb_approvals(id,job_id,client_id,agency_id,staff_id,
    approval_number,document_reference,document_sha256,approved_on,work_from,work_until,expires_on,
    verified_by,verification_note,job_snapshot)
  values(fixture_approval,fixture_job,'demoa','demob','demobstaff','TEST-ONLY-NOT-SB-APPROVAL',
    'CONNEXY_BROWSER_TEST_ONLY_NO_ORIGINAL',repeat('0',64),today,today+10,today+10,today+10,
    '架空のブラウザ検証担当',fixture_description,'{}');
end;
$$;
select id,title,event_date,'一時保存した架空データです。確認後は114番で削除してください。' as note
from public.jobs where id='connexy-browser-contract-test';
commit;
