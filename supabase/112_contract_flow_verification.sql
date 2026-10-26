-- 111番適用後の架空検証プロジェクト専用。SQL Editorで全文を実行。
-- A/Bの既存の有効なAuthセッションを読み、SQL内だけで当事者の認証条件を設定する。
-- ブラウザのログイン・JWT署名・MFAコードの検証ではなく、専用RPCのDB処理を検証する。
-- Auth管理テーブル・既存の所属・権限は変更しない。架空データも最後に必ず取消す。
begin;
set local statement_timeout = '20s';

create function pg_temp.connexy_contract_probe_identity(actor uuid,session_id uuid,assurance text)
returns void language plpgsql set search_path='' as $$
begin
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',actor::text,'session_id',session_id::text,'aal',assurance,'role','authenticated')::text,true);
end;
$$;

create function pg_temp.connexy_verify_contract_flow()
returns table(check_name text,result text)
language plpgsql set search_path='' as $$
declare
  user_a uuid; user_b uuid; session_a uuid; session_b uuid;
  suffix text := gen_random_uuid()::text;
  job_id text := 'connexy-contract-flow-' || suffix;
  approval_id uuid := gen_random_uuid();
  offer_id uuid := gen_random_uuid();
  final_id text;
  actual_id uuid;
  today date := (statement_timestamp() at time zone 'Asia/Tokyo')::date;
  terms text := '取消前提の架空検証用です。本物のSB承諾や実契約ではありません。税込・経費なしとします。';
  checks jsonb := '[]'; item jsonb; listings jsonb; error_code text; error_message text;
begin
  if auth.uid() is not null then raise exception '管理者のSQL Editorで実行してください。'; end if;
  if to_regprocedure('public.connexy_create_contract_offer(uuid,text,text,text,text)') is null then
    raise exception '111番SQLが未適用です。';
  end if;
  if not exists(select 1 from public.companies where id='demoa' and name='架空検証会社A' and status='approved')
    or not exists(select 1 from public.companies where id='demob' and name='架空検証会社B' and status='approved') then
    raise exception '架空検証会社A/Bを確認できません。実会社で代用せず停止します。';
  end if;
  select auth_user_id into user_a from public.connexy_auth_memberships
    where company_id='demoa' and staff_id='demoastaff' and member_role='admin' and active;
  select auth_user_id into user_b from public.connexy_auth_memberships
    where company_id='demob' and staff_id='demobstaff' and member_role='admin' and active;
  if user_a is null or user_b is null then raise exception 'A/B管理者の所属設定を確認してください。'; end if;
  select id into session_a from auth.sessions where user_id=user_a
    and created_at>statement_timestamp()-interval '8 hours' and created_at<=statement_timestamp()
    order by created_at desc,id limit 1;
  select id into session_b from auth.sessions where user_id=user_b
    and created_at>statement_timestamp()-interval '8 hours' and created_at<=statement_timestamp()
    order by created_at desc,id limit 1;
  if session_a is null then raise exception 'A管理者のログイン期限が切れています。ConnexyでAにログインしてから再実行してください。'; end if;
  if session_b is null then raise exception 'B管理者のログイン期限が切れています。ConnexyでBにログインしてから再実行してください。'; end if;

  begin
    insert into public.jobs(id,author_id,title,description,event_date,price)
      values(job_id,'demoa','【取消前提の架空検証】A提示からB確定',terms,(today+10)::text,10000);
    insert into connexy_private.sb_approvals(
      id,job_id,client_id,agency_id,staff_id,approval_number,document_reference,document_sha256,
      approved_on,work_from,work_until,expires_on,verified_by,verification_note,job_snapshot
    ) values(approval_id,job_id,'demoa','demob','demobstaff','架空検証のみ・取消前提',
      '原本なし・本物のSB承諾ではない',repeat('0',64),today,today+10,today+10,today+20,'架空検証担当',terms,'{}');

    perform pg_temp.connexy_contract_probe_identity(user_a,session_a,'aal2');
    actual_id := public.connexy_create_contract_offer(offer_id,job_id,'demob','demobstaff',terms);
    if actual_id is distinct from offer_id then raise exception 'A社の条件提示を確認できません。'; end if;
    checks := checks || jsonb_build_array('A社管理者が承諾対象へ契約条件を提示できる');
    if public.connexy_create_contract_offer(offer_id,job_id,'demob','demobstaff',terms) is distinct from offer_id
      or (select count(*) from connexy_private.contract_offers o where o.id=offer_id)<>1 then
      raise exception '提示の再送で重複防止を確認できません。';
    end if;
    checks := checks || jsonb_build_array('条件提示を再送しても一件だけになる');

    begin
      perform public.connexy_respond_contract_offer(offer_id,'confirm');
      raise exception 'UNEXPECTED_SUCCESS' using errcode='ZX001';
    exception when others then
      get stacked diagnostics error_code=returned_sqlstate,error_message=message_text;
    end;
    if error_code<>'42501' or position('操作権限' in error_message)=0 then
      raise exception 'A社単独の確定を拒否できていません。検証を取り消します。';
    end if;
    checks := checks || jsonb_build_array('A社だけで契約確定する操作は拒否される');

    perform pg_temp.connexy_contract_probe_identity(user_b,session_b,'aal2');
    listings := public.connexy_list_contract_offers();
    if not exists(select 1 from jsonb_array_elements(listings) x
      where x->>'id'=offer_id::text and x->>'status'='offered' and x->>'terms'=terms) then
      raise exception 'B社側で提示内容を確認できません。';
    end if;
    checks := checks || jsonb_build_array('B社管理者が提示された同じ契約条件を取得できる');
    begin
      perform public.connexy_respond_contract_offer(offer_id,'withdraw');
      raise exception 'UNEXPECTED_SUCCESS' using errcode='ZX001';
    exception when others then
      get stacked diagnostics error_code=returned_sqlstate,error_message=message_text;
    end;
    if error_code<>'42501' or position('操作権限' in error_message)=0 then
      raise exception 'B社によるA社提示の取り下げを拒否できていません。';
    end if;
    checks := checks || jsonb_build_array('B社がA社の提示を取り下げる操作は拒否される');

    perform pg_temp.connexy_contract_probe_identity(user_b,session_b,'aal1');
    begin
      perform public.connexy_respond_contract_offer(offer_id,'confirm');
      raise exception 'UNEXPECTED_SUCCESS' using errcode='ZX001';
    exception when others then
      get stacked diagnostics error_code=returned_sqlstate,error_message=message_text;
    end;
    if error_code<>'42501' or position('追加認証' in error_message)=0 then
      raise exception '追加認証前の確定を拒否できていません。';
    end if;
    checks := checks || jsonb_build_array('追加認証前の条件ではB社の確定も拒否される');

    perform pg_temp.connexy_contract_probe_identity(user_b,session_b,'aal2');
    final_id := public.connexy_respond_contract_offer(offer_id,'confirm');
    if final_id is null or not exists(select 1 from public.contract_tasks t
      where t.id=final_id and t.contract_offer_id=offer_id and t.status='confirmed'
        and t.client_id='demoa' and t.agency_id='demob' and t.sb_staff_id='demobstaff'
        and t.sb_approval_id=approval_id and t.price=10000 and t.client_contract_text=terms)
      or not exists(select 1 from connexy_private.contract_offers o
        where o.id=offer_id and o.status='confirmed' and o.responded_by=user_b and o.contract_id=final_id) then
      raise exception 'B社の確定と契約保存を確認できません。';
    end if;
    checks := checks || jsonb_build_array('B社管理者の確定で提示と契約が同時に確定される');
    if public.connexy_respond_contract_offer(offer_id,'confirm') is distinct from final_id
      or (select count(*) from public.contract_tasks t where t.contract_offer_id=offer_id)<>1 then
      raise exception '確定の再送で重複防止を確認できません。';
    end if;
    checks := checks || jsonb_build_array('確定を再送しても同じ契約一件だけになる');

    perform pg_temp.connexy_contract_probe_identity(user_a,session_a,'aal2');
    listings := public.connexy_list_contract_offers();
    if not exists(select 1 from jsonb_array_elements(listings) x
      where x->>'id'=offer_id::text and x->>'status'='confirmed' and x->>'contract_id'=final_id) then
      raise exception 'A社側で契約確定の結果を確認できません。';
    end if;
    checks := checks || jsonb_build_array('A社管理者も同じ契約番号と確定結果を取得できる');
    raise exception 'ROLLBACK_PROBE' using errcode='ZX002';
  exception when sqlstate 'ZX002' then null;
  end;

  if jsonb_array_length(checks)<>9 or auth.uid() is not null
    or exists(select 1 from public.jobs j where j.id=job_id)
    or exists(select 1 from connexy_private.sb_approvals a where a.id=approval_id)
    or exists(select 1 from connexy_private.contract_offers o where o.id=offer_id)
    or exists(select 1 from public.contract_tasks t where t.contract_offer_id=offer_id) then
    raise exception '検証完了またはデータと認証条件の取消を確認できません。全体を取り消します。';
  end if;
  for item in select value from jsonb_array_elements(checks) loop
    check_name := item #>> '{}';result := '確認OK（取消前提のDB処理検証）';return next;
  end loop;
  check_name := '架空の案件・承諾・提示・契約とSQL内の認証条件を全て取消';
  result := '確認OK：検証データを残していません';return next;
end;
$$;

select * from pg_temp.connexy_verify_contract_flow();
rollback;
