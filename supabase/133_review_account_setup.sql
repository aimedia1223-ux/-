-- 共有相手の専用Authユーザーを用意した後、UIDだけを下へ記入して実行する。
-- パスワード・メールアドレスはこのSQLへ記載しない。承諾・契約・他社データへの権限は追加しない。
-- 専用の架空会社に管理者として所属し、画面確認用の自社案件1件を作る。
-- 既存のA/B/C等へ紐付いたUIDは拒否する。MFA必須設定は変更しない。
begin;
do $$
declare
  review_auth_uid uuid := null; -- ここだけ、作成した共有相手本人のUIDへ変更
  company_key text;
  staff_key text;
  job_key text;
begin
  if review_auth_uid is null then raise exception '共有相手のAuthユーザーUIDを記入してください。パスワードは不要です。'; end if;
  if not exists(select 1 from auth.users where id=review_auth_uid) then raise exception '指定したAuthユーザーが存在しません。'; end if;
  company_key:='review-company-'||review_auth_uid::text;
  staff_key:='review-staff-'||review_auth_uid::text;
  job_key:='review-job-'||review_auth_uid::text;
  if exists(select 1 from public.connexy_auth_memberships where auth_user_id=review_auth_uid
    and (company_id<>company_key or staff_id<>staff_key or member_role<>'admin' or not active)) then
    raise exception '既存の所属・役割を変更せず停止しました。未使用の専用Authユーザーを指定してください。';
  end if;
  if exists(select 1 from public.companies where id=company_key and (name<>'架空レビュー会社' or status<>'approved' or role<>'contractor'))
    or exists(select 1 from public.staffs where id=staff_key and (user_id<>company_key or name<>'架空レビュー担当者'))
    or exists(select 1 from public.jobs where id=job_key and (author_id<>company_key or title<>'【画面確認専用】架空の店舗支援案件')) then
    raise exception '同じIDの想定外データを検出しました。上書きせず停止します。';
  end if;
  insert into public.companies(id,name,role,status) values(company_key,'架空レビュー会社','contractor','approved') on conflict(id) do nothing;
  insert into public.staffs(id,user_id,name,masked_name,base_location,skills)
    values(staff_key,company_key,'架空レビュー担当者','レビュー担当者','架空の拠点',array['画面確認']) on conflict(id) do nothing;
  insert into public.connexy_auth_memberships(auth_user_id,company_id,staff_id,display_name,member_role,active)
    values(review_auth_uid,company_key,staff_key,'架空レビュー担当者','admin',true) on conflict(auth_user_id) do nothing;
  insert into public.jobs(id,author_id,title,description,price,location_name,event_date,work_hours)
    values(job_key,company_key,'【画面確認専用】架空の店舗支援案件',
      '機能・デザイン確認専用の架空データです。実際の募集・発注・契約・支払・稼働は行いません。',
      10000,'架空の会場（実在しません）',(current_date+14)::text,'10:00〜18:00（架空）') on conflict(id) do nothing;
end;
$$;
select company_id,display_name,member_role from public.connexy_auth_memberships
where company_id='review-company-'||auth_user_id::text order by company_id;
commit;
