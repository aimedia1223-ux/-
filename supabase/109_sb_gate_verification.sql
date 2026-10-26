-- 107番適用後の架空検証プロジェクトで実行する。
-- 権限の強いSQL Editorでも未承諾の確定をトリガーが拒否するか確認。
-- 各試行は必ずサブトランザクションで取消し、最後もROLLBACKする。
-- 書込権限/RLSの変更、原本照合記録の作成は行わない。
begin;
set local statement_timeout = '20s';

create function pg_temp.connexy_verify_sb_gate()
returns table(check_name text,result text)
language plpgsql set search_path = '' as $$
declare
  job public.jobs;
  dates date[];
  probe_id text;
  base_insert text;
  attempt record;
  actual_code text;
  actual_message text;
begin
  if auth.uid() is not null then
    raise exception 'この検証はAuthユーザーの偽装をせず、管理者のSQL Editorで実行してください。';
  end if;
  select * into job from public.jobs where id='connexy-access-test-a';
  if job.id is null or job.author_id <> 'demoa' or job.title <> '【閲覧テスト】A社専用案件'
    or not exists(select 1 from public.staffs where id='demobstaff' and user_id='demob') then
    raise exception '架空のA社案件・B社スタッフを確認できません。実案件で代用せず停止します。';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger
    where tgrelid='public.contract_tasks'::regclass and tgname='enforce_sb_contract_gate'
      and tgenabled in ('O','A') and not tgisinternal) then
    raise exception '107番の確定防止トリガーが有効になっていません。';
  end if;
  if connexy_private.valid_sb_approval(job.id,'demob','demobstaff') is not null then
    raise exception '検証対象に有効な承諾があります。未承諾の検証条件ではないため停止します。';
  end if;
  dates := connexy_private.sb_job_dates(job.event_date);
  if dates is null or array_length(dates,1) is null then
    raise exception '架空案件の日程を確認できません。';
  end if;
  probe_id := 'connexy-sb-write-probe-' || gen_random_uuid()::text;
  base_insert := format(
    'insert into public.contract_tasks(id,job_id,client_id,agency_id,sb_staff_id,date,status,evaluations) values(%L,%L,%L,%L,%L,%L,',
    probe_id,job.id,'demoa','demob','demobstaff',dates[1]::text);

  for attempt in
    select * from (values
      ('未承諾オファーの直接作成',base_insert || quote_literal('offered') || ',''{}'')', 'SBの事前書面承諾'),
      ('未承諾の契約確定を直接作成',base_insert || quote_literal('confirmed') || ',''{}'')', 'SBの事前書面承諾'),
      ('完了状態の直接作成による迂回',base_insert || quote_literal('completed') || ',''{}'')', 'SBの事前書面承諾'),
      ('偽の承認JSONによる確定',base_insert || quote_literal('applying') || ',' || quote_literal(
        jsonb_build_object('jobStates',jsonb_build_object(job.id,jsonb_build_object(
          'status','confirmed','staffId','demobstaff','sbSubcontractApproval',jsonb_build_object('status','approved'))))::text) || ')', '案件別状態'),
      ('下書きから契約確定への直接変更',base_insert || quote_literal('applying') || ',''{}'');' ||
        format('update public.contract_tasks set status=''confirmed'' where id=%L',probe_id), 'SBの事前書面承諾'),
      ('現場グループの直接作成',format(
        'insert into public.contract_tasks(id,job_id,client_id,agency_id) values(%L,''chat'',''demoa'',''demob'')',
        'chat_group_' || probe_id), '現場グループ')
    ) as cases(label,sql_text,expected_message)
  loop
    begin
      execute attempt.sql_text;
      -- 予想外に成功しても、この例外で試行全体を取り消す。
      raise exception 'PROBE_UNEXPECTED_SUCCESS' using errcode='ZX001';
    exception when others then
      get stacked diagnostics actual_code = returned_sqlstate,actual_message = message_text;
    end;
    if actual_code <> '42501' or position(attempt.expected_message in actual_message) = 0 then
      -- 生レスポンスや入力値を出力せず、どの確認で止まったかだけ示す。
      raise exception '検証未完了：% は想定した承諾ゲートの拒否ではありません。試行は取消済みです。',attempt.label;
    end if;
    check_name := attempt.label;
    result := '確認OK：承諾ゲートで拒否';
    return next;
  end loop;
  if exists(select 1 from public.contract_tasks where id in (probe_id,'chat_group_' || probe_id)) then
    raise exception '検証用データの取消を確認できません。全体を取り消します。';
  end if;
  check_name := '検証用の契約・チャットが残っていない';
  result := '確認OK：各試行を取消済み';
  return next;
end;
$$;

select * from pg_temp.connexy_verify_sb_gate();
rollback;
