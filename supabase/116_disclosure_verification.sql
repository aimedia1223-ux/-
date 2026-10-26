-- 115番適用後の架空検証プロジェクト専用。全文をSQL Editorで実行する。
-- B社の有効な既存セッションだけを読み、SQL内だけに認証条件を設定してDB処理を検証する。
-- A社の同時ログインは不要。契約提示はSQL管理者が取消前提の架空行として準備し、A社の提示RPCは再検証しない。
-- 実際のブラウザログイン・署名付きJWT・MFAコードの検証とは区別する。
-- 架空データは最後に全て取り消す。実会社や承諾原本で代用しない。
-- 前回の116番が途中停止したトランザクションを取り消してから開始する。
rollback;
begin;
set local statement_timeout='20s';

create function pg_temp.disclosure_probe_identity(actor uuid,session_id uuid,assurance text)
returns void language plpgsql set search_path='' as $$
begin
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',actor::text,'session_id',session_id::text,'aal',assurance,'role','authenticated')::text,true);
end;
$$;
create function pg_temp.disclosure_expect_denied(public_id uuid)
returns void language plpgsql set search_path='' as $$
begin
  begin
    perform public.connexy_read_approved_job(public_id);
    raise exception '詳細が不適切に開示されました。' using errcode='ZX001';
  exception when insufficient_privilege then null;
  end;
end;
$$;

create function pg_temp.verify_confidential_disclosure()
returns table(check_name text,result text) language plpgsql set search_path='' as $$
declare
  user_a uuid; user_b uuid; session_b uuid;
  job_id text := 'connexy-disclosure-probe-'||gen_random_uuid()::text;
  publication_id uuid := gen_random_uuid(); proof_id uuid := gen_random_uuid(); second_proof uuid := gen_random_uuid();
  offer_id uuid := gen_random_uuid(); today date := (statement_timestamp() at time zone 'Asia/Tokyo')::date;
  hidden text := '架空の非公開店舗・担当者・住所（実在しません）';
  checks jsonb := '[]'; item jsonb; data jsonb; row_data jsonb;
begin
  if auth.uid() is not null then raise exception '管理者のSQL Editorで実行してください。'; end if;
  if to_regprocedure('public.connexy_read_approved_job(uuid)') is null then raise exception '115番SQLが未適用です。'; end if;
  if not exists(select 1 from public.companies where id='demoa' and name='架空検証会社A' and status='approved')
    or not exists(select 1 from public.companies where id='demob' and name='架空検証会社B' and status='approved') then
    raise exception '架空検証会社A/Bを確認できません。実会社で代用しないでください。';
  end if;
  select auth_user_id into user_a from public.connexy_auth_memberships
    where company_id='demoa' and staff_id='demoastaff' and member_role='admin' and active;
  select auth_user_id into user_b from public.connexy_auth_memberships
    where company_id='demob' and staff_id='demobstaff' and member_role='admin' and active;
  select id into session_b from auth.sessions where user_id=user_b
    and created_at>statement_timestamp()-interval '8 hours' and created_at<=statement_timestamp()
    order by created_at desc,id limit 1;
  if user_a is null then raise exception 'A社管理者の所属設定を確認してください。A社でのログインは不要です。'; end if;
  if user_b is null or session_b is null then raise exception 'B社管理者でConnexyにログインしてから再実行してください。'; end if;

  begin
    insert into public.jobs(id,author_id,title,description,detailed_description,location_name,exact_location,work_hours,event_date,price)
      values(job_id,'demoa',hidden,hidden,hidden,hidden,hidden,hidden,(today+10)::text,10000);
    insert into connexy_private.job_publications(public_id,job_id,region,category,enabled,job_snapshot)
      values(publication_id,job_id,'関東','店舗運営支援',true,'{}');
    perform pg_temp.disclosure_probe_identity(user_b,session_b,'aal2');
    data := public.connexy_list_job_summaries();
    select x into row_data from jsonb_array_elements(data) x where x->>'public_id'=publication_id::text;
    if row_data is null or row_data - array['public_id','region','category'] <> '{}'::jsonb
      or row_data->>'region'<>'関東' or row_data->>'category'<>'店舗運営支援'
      or row_data::text like '%'||hidden||'%' or row_data::text like '%'||job_id||'%' then
      raise exception '公開概要の項目制限を確認できません。';
    end if;
    checks := checks||jsonb_build_array('承諾前の概要は地域・業務区分・公開IDだけ');
    perform pg_temp.disclosure_expect_denied(publication_id);
    perform pg_temp.disclosure_expect_denied(gen_random_uuid());
    checks := checks||jsonb_build_array('未承諾・存在しない公開IDの詳細を拒否');

    perform pg_temp.disclosure_probe_identity(user_b,session_b,'aal1');
    begin
      perform public.connexy_list_job_summaries();
      raise exception '追加認証前に概要を開示しました。' using errcode='ZX001';
    exception when insufficient_privilege then null; end;
    perform pg_temp.disclosure_expect_denied(publication_id);
    checks := checks||jsonb_build_array('追加認証前は概要・詳細の両方を拒否');

    insert into connexy_private.sb_approvals(id,job_id,client_id,agency_id,staff_id,approval_number,document_reference,document_sha256,
      approved_on,work_from,work_until,expires_on,verified_by,verification_note,job_snapshot)
      values(proof_id,job_id,'demoa','demob','demobstaff','架空・取消前提','原本なし・検証専用',repeat('0',64),
        today,today+10,today+10,today+20,'架空検証担当','本物のSB承諾ではありません','{}');
    perform pg_temp.disclosure_probe_identity(user_b,session_b,'aal2');
    data := public.connexy_read_approved_job(publication_id);
    if data->>'title' is distinct from hidden or data->>'exact_location' is distinct from hidden
      or data->>'company_name' is distinct from '架空検証会社A'
      or data ?| array['lat','lng','job_snapshot','document_reference','document_sha256'] then
      raise exception '承諾対象本人への開示を確認できません。';
    end if;
    checks := checks||jsonb_build_array('有効な承諾対象本人だけに案件詳細を開示');
    -- 他人のUIDとB社セッションを混ぜても本人として認めない。
    perform pg_temp.disclosure_probe_identity(user_a,session_b,'aal2');
    perform pg_temp.disclosure_expect_denied(publication_id);
    checks := checks||jsonb_build_array('他人のUIDとセッションの組合せによる詳細取得を拒否');

    -- SQL管理者だけが作れる検証用の提示。利用者の作成権限・実契約を追加しない。
    insert into connexy_private.contract_offers(id,job_id,client_id,agency_id,staff_id,approval_id,
      terms,snapshot,work_dates,daily_price,expires_at,created_by)
      select offer_id,j.id,'demoa','demob','demobstaff',proof_id,
        hidden||'：取消前提の検証用条件です。実契約ではありません。',
        jsonb_build_object('job',to_jsonb(j),'client_name','架空検証会社A','agency_name','架空検証会社B',
          'staff_name',(select s.name from public.staffs s where s.id='demobstaff' and s.user_id='demob')),
        array[today+10],10000,statement_timestamp()+interval '1 day',user_a
      from public.jobs j where j.id=job_id;
    perform pg_temp.disclosure_probe_identity(user_b,session_b,'aal2');
    if not exists(select 1 from jsonb_array_elements(public.connexy_list_contract_offers()) x where x->>'id'=offer_id::text) then
      raise exception '承諾対象本人の契約提示を確認できません。';
    end if;
    update connexy_private.sb_approvals set status='revoked' where id=proof_id;
    perform pg_temp.disclosure_expect_denied(publication_id);
    if exists(select 1 from jsonb_array_elements(public.connexy_list_contract_offers()) x where x->>'id'=offer_id::text) then
      raise exception '承諾取消後の契約詳細が開示されました。';
    end if;
    checks := checks||jsonb_build_array('承諾取消後は案件詳細・契約詳細の再取得を拒否');

    insert into connexy_private.sb_approvals(id,job_id,client_id,agency_id,staff_id,approval_number,document_reference,document_sha256,
      approved_on,work_from,work_until,expires_on,verified_by,verification_note,job_snapshot)
      values(second_proof,job_id,'demoa','demob','demobstaff','架空・再照合','原本なし・検証専用',repeat('0',64),
        today,today+10,today+10,today+20,'架空検証担当','本物のSB承諾ではありません','{}');
    update public.jobs set price=20000 where id=job_id;
    if exists(select 1 from jsonb_array_elements(public.connexy_list_job_summaries()) x where x->>'public_id'=publication_id::text) then
      raise exception '変更後の案件概要が公開されました。';
    end if;
    perform pg_temp.disclosure_expect_denied(publication_id);
    update connexy_private.job_publications set enabled=true where public_id=publication_id;
    perform pg_temp.disclosure_expect_denied(publication_id);
    checks := checks||jsonb_build_array('案件変更後は公開停止し、概要の再確認で古い承諾を有効にしない');

    update connexy_private.job_publications set enabled=false where public_id=publication_id;
    if exists(select 1 from jsonb_array_elements(public.connexy_list_job_summaries()) x where x->>'public_id'=publication_id::text) then
      raise exception '公開停止後の概要が取得できました。';
    end if;
    perform pg_temp.disclosure_expect_denied(publication_id);
    checks := checks||jsonb_build_array('公開停止後は概要・詳細を非開示');
    if has_table_privilege('authenticated','connexy_private.job_publications','SELECT,INSERT,UPDATE,DELETE')
      or has_function_privilege('authenticated','connexy_private.connexy_list_contract_offers()','EXECUTE')
      or has_function_privilege('anon','public.connexy_list_job_summaries()','EXECUTE') then
      raise exception '内部表・旧関数・匿名アクセスの権限が広すぎます。';
    end if;
    checks := checks||jsonb_build_array('内部表・旧関数・匿名の概要取得権限を閉じている');
    raise exception 'ROLLBACK_PROBE' using errcode='ZX002';
  exception when sqlstate 'ZX002' then null;
  end;
  if jsonb_array_length(checks)<>9 or auth.uid() is not null
    or exists(select 1 from public.jobs j where j.id=job_id)
    or exists(select 1 from connexy_private.job_publications p where p.public_id=publication_id)
    or exists(select 1 from connexy_private.sb_approvals p where p.id in (proof_id,second_proof))
    or exists(select 1 from connexy_private.contract_offers o where o.id=offer_id) then
    raise exception '検証または架空データ・認証条件の取消を確認できません。';
  end if;
  for item in select value from jsonb_array_elements(checks) loop
    check_name:=item#>>'{}';result:='確認OK（取消前提のDB処理検証）';return next;
  end loop;
  check_name:='架空の案件・概要・承諾・提示とSQL内の認証条件を全て取消';
  result:='確認OK：検証データを残していません';return next;
end;
$$;
select * from pg_temp.verify_confidential_disclosure();
rollback;
