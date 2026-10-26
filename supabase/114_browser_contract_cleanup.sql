-- 113番で明示的に作成した使い捨てのブラウザ検証データだけを削除する。
-- 本物の契約・承諾の取消/削除に使わない。照合が合わなければ全体を停止する。
begin;
do $$
declare
  fixture_job constant text := 'connexy-browser-contract-test';
  fixture_approval constant uuid := '00000000-0000-4000-9000-000000000113';
  fixture_description constant text := '架空のブラウザ検証専用です。本物のSB承諾・実契約・稼働ではありません。確認後に削除します。';
  fixture_terms constant text := 'ブラウザ検証専用です。本物のSB承諾・実契約・支払・稼働ではありません。税込10000円、経費なしの架空条件として確認後に削除します。';
  j public.jobs;
begin
  if auth.uid() is not null then raise exception '管理者のSQL Editorで実行してください。'; end if;
  select * into j from public.jobs where id=fixture_job for update;
  if j.id is null then
    if exists(select 1 from connexy_private.sb_approvals where id=fixture_approval)
      or exists(select 1 from connexy_private.contract_offers where job_id=fixture_job)
      or exists(select 1 from public.contract_tasks where job_id=fixture_job) then
      raise exception '検証データの対応関係を確認できません。削除せず停止します。';
    end if;
    return;
  end if;
  if j.author_id<>'demoa' or j.title<>'【ブラウザ検証専用】A社→B社 契約確定テスト（実契約なし）'
    or j.description<>fixture_description or j.price<>10000
    or not exists(select 1 from connexy_private.sb_approvals a
      where a.id=fixture_approval and a.job_id=fixture_job and a.client_id='demoa' and a.agency_id='demob'
        and a.staff_id='demobstaff' and a.document_reference='CONNEXY_BROWSER_TEST_ONLY_NO_ORIGINAL'
        and a.approval_number='TEST-ONLY-NOT-SB-APPROVAL' and a.document_sha256=repeat('0',64)
        and a.verification_note=fixture_description and a.job_snapshot=to_jsonb(j))
    or exists(select 1 from connexy_private.sb_approvals where job_id=fixture_job and id<>fixture_approval) then
    raise exception '想定した使い捨て検証データと一致しません。削除せず停止します。';
  end if;
  perform 1 from connexy_private.contract_offers where job_id=fixture_job for update;
  if exists(select 1 from connexy_private.contract_offers o where o.job_id=fixture_job and
    (o.client_id<>'demoa' or o.agency_id<>'demob' or o.staff_id<>'demobstaff'
      or o.approval_id<>fixture_approval or o.terms<>fixture_terms or o.daily_price<>10000
      or o.snapshot->'job' is distinct from to_jsonb(j)))
    or exists(select 1 from public.contract_tasks t where t.job_id=fixture_job and
      (t.client_id is distinct from 'demoa' or t.agency_id is distinct from 'demob'
        or t.sb_staff_id is distinct from 'demobstaff' or t.sb_approval_id is distinct from fixture_approval
        or t.client_contract_text is distinct from fixture_terms or t.price<>10000
        or not exists(select 1 from connexy_private.contract_offers o
          where o.id=t.contract_offer_id and o.job_id=fixture_job and o.contract_id=t.id))) then
    raise exception '予期しない条件提示・契約が含まれています。削除せず停止します。';
  end if;
  -- 相互参照を解いてから、この使い捨てデータだけを削除する。保護トリガーは無効化しない。
  update public.contract_tasks set contract_offer_id=null,status='cancelled',evaluations='{}',
    client_contract_approved_by_client=false,client_contract_approved_by_agency=false,
    agency_contract_approved_by_client=false,agency_contract_approved_by_agency=false
    where job_id=fixture_job;
  delete from connexy_private.contract_offers where job_id=fixture_job;
  delete from public.contract_tasks where job_id=fixture_job;
  delete from connexy_private.sb_approvals where id=fixture_approval;
  delete from public.jobs where id=fixture_job;
end;
$$;
select 'ブラウザ検証用の案件・承諾・提示・契約だけを削除しました。' as result;
commit;
