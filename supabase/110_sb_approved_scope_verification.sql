-- 架空検証専用。107番適用済みの同じプロジェクトのSQL Editorで全文実行。
-- 本物のSB承諾を登録するSQLではない。架空の案件・承諾・契約は全て取消す。
-- アプリの書込権限・RLS・既存データを変更せず、信頼されたDB操作の正常系を検証。
begin;
set local statement_timeout = '20s';

create function pg_temp.connexy_verify_sb_approved_scope()
returns table(check_name text,result text)
language plpgsql set search_path = '' as $$
declare
  suffix text := gen_random_uuid()::text;
  job_id text := 'connexy-sb-scope-job-' || suffix;
  contract_id text := 'connexy-sb-scope-contract-' || suffix;
  approval_id uuid := gen_random_uuid();
  today date := (statement_timestamp() at time zone 'Asia/Tokyo')::date;
  work_day date := today + 10;
  checks jsonb := '[]';
  item jsonb;
  attempt record;
  actual_code text;
  actual_message text;
begin
  if auth.uid() is not null then
    raise exception '管理者のSQL Editorで実行してください。Authユーザーの偽装は行いません。';
  end if;
  if not exists(select 1 from public.companies where id='demoa' and name='架空検証会社A' and status='approved')
    or not exists(select 1 from public.companies where id='demob' and name='架空検証会社B' and status='approved')
    or not exists(select 1 from public.staffs where id='demoastaff' and user_id='demoa')
    or not exists(select 1 from public.staffs where id='demobstaff' and user_id='demob') then
    raise exception '架空検証会社A/Bとスタッフを確認できません。実データで代用せず停止します。';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger
    where tgrelid='public.contract_tasks'::regclass and tgname='enforce_sb_contract_gate'
      and tgenabled in ('O','A') and not tgisinternal) then
    raise exception '107番の確定防止トリガーが有効になっていません。';
  end if;

  -- このブロックの最後に必ず例外を起こし、正常系で作ったデータも全て取り消す。
  begin
    insert into public.jobs(id,author_id,title,description,event_date)
      values(job_id,'demoa','【取消前提の架空検証】SB承諾対象の一致',
        '検証用。本物の承諾・募集・契約・現場投入ではありません。',work_day::text);
    insert into connexy_private.sb_approvals(
      id,job_id,client_id,agency_id,staff_id,approval_number,document_reference,document_sha256,
      approved_on,work_from,work_until,expires_on,verified_by,verification_note,job_snapshot
    ) values(
      approval_id,job_id,'demoa','demob','demobstaff','架空検証のみ・取消前提',
      '原本なし・本物のSB承諾ではありません',repeat('0',64),
      today,work_day,work_day,today+20,'架空の検証担当',
      'SQL検証専用。実SB承諾ではなく、この記録はサブトランザクション内で必ず取り消します。','{}'
    );
    if connexy_private.valid_sb_approval(job_id,'demob','demobstaff') is distinct from approval_id then
      raise exception '対象が一致する原本照合記録の正常系を確認できません。';
    end if;
    checks := checks || jsonb_build_array('案件・会社・スタッフ・日程が一致する照合記録を認識');

    insert into public.contract_tasks(id,job_id,client_id,agency_id,sb_staff_id,sb_approval_id,date,status)
      values(contract_id,job_id,'demoa','demob','demobstaff',approval_id,work_day::text,'offered');
    if not exists(select 1 from public.contract_tasks t where t.id=contract_id and t.status='offered') then
      raise exception '承諾対象のオファー保存を確認できません。';
    end if;
    checks := checks || jsonb_build_array('承諾対象のオファーを一時的に保存できる');

    update public.contract_tasks t set status='confirmed' where t.id=contract_id;
    if not exists(select 1 from public.contract_tasks t where t.id=contract_id and t.status='confirmed') then
      raise exception '承諾対象の契約確定を確認できません。';
    end if;
    checks := checks || jsonb_build_array('承諾対象と一致する契約確定を一時的に保存できる');

    for attempt in
      select * from (values
        ('異なる二次委託先への変更を拒否',format(
          'update public.contract_tasks set agency_id=''demoa'',sb_staff_id=''demoastaff'' where id=%L',contract_id),'SBの事前書面承諾'),
        ('異なるスタッフへの変更を拒否',format(
          'update public.contract_tasks set sb_staff_id=''demoastaff'' where id=%L',contract_id),'SBの事前書面承諾'),
        ('承諾された案件日程と異なる日への変更を拒否',format(
          'update public.contract_tasks set date=%L where id=%L',(work_day+1)::text,contract_id),'SBの事前書面承諾'),
        ('別の承諾IDへの差し替えを拒否',format(
          'update public.contract_tasks set sb_approval_id=%L::uuid where id=%L',gen_random_uuid()::text,contract_id),'SBの事前書面承諾'),
        ('案件内容変更後の状態更新を拒否',format(
          'update public.jobs set price=100 where id=%L;update public.contract_tasks set status=''report_pending'' where id=%L',job_id,contract_id),'SBの事前書面承諾'),
        ('承諾取消後の状態更新を拒否',format(
          'update connexy_private.sb_approvals set status=''revoked'' where id=%L::uuid;update public.contract_tasks set status=''report_pending'' where id=%L',approval_id::text,contract_id),'SBの事前書面承諾'),
        ('JSON内だけ別スタッフを確定する変更を拒否',format(
          'update public.contract_tasks set evaluations=%L::jsonb where id=%L',
          jsonb_build_object('jobStates',jsonb_build_object(job_id,jsonb_build_object('status','confirmed','staffId','demoastaff')))::text,contract_id),'案件別状態')
      ) as cases(label,sql_text,expected_message)
    loop
      begin
        execute attempt.sql_text;
        raise exception 'PROBE_UNEXPECTED_SUCCESS' using errcode='ZX001';
      exception when others then
        get stacked diagnostics actual_code=returned_sqlstate,actual_message=message_text;
      end;
      if actual_code <> '42501' or position(attempt.expected_message in actual_message)=0 then
        raise exception '検証未完了：% は想定した承諾ゲートの拒否ではありません。',attempt.label;
      end if;
      checks := checks || jsonb_build_array(attempt.label);
    end loop;
    raise exception 'PROBE_ROLLBACK_ALL_FIXTURES' using errcode='ZX002';
  exception when sqlstate 'ZX002' then
    null;
  end;

  if jsonb_array_length(checks) <> 10 then
    raise exception '全確認項目の完了を確認できません。';
  end if;
  if exists(select 1 from public.jobs j where j.id=job_id)
    or exists(select 1 from public.contract_tasks t where t.id=contract_id)
    or exists(select 1 from connexy_private.sb_approvals a where a.id=approval_id) then
    raise exception '架空検証データの取消を確認できません。全体を取り消します。';
  end if;
  for item in select value from jsonb_array_elements(checks) loop
    check_name := item #>> '{}';
    result := '確認OK（取消前提の架空検証）';
    return next;
  end loop;
  check_name := '架空の案件・承諾・契約が全て取り消されている';
  result := '確認OK：検証データを残していません';
  return next;
end;
$$;

select * from pg_temp.connexy_verify_sb_approved_scope();
rollback;
