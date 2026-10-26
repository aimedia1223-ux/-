-- 運用設計用テンプレート。検証で架空の承諾を実DBに登録するためのSQLではない。
-- 107番適用後、権限のあるDB運用担当者だけが原本と対象範囲を照合して実行する。
-- 現時点では実SB情報を登録しない。保管先・取扱権限・監査運用等の整備が先。
-- REPLACE_の全項目を置換するまで実行不可。パスワード/サービスキーは不要。
begin;
insert into connexy_private.sb_approvals (
  job_id, client_id, agency_id, staff_id, approval_number,
  document_reference, document_sha256, approved_on,
  work_from, work_until, expires_on, verified_by, verification_note, job_snapshot
) values (
  'REPLACE_JOB_ID', 'REPLACE_CLIENT_COMPANY_ID', 'REPLACE_AGENCY_COMPANY_ID', 'REPLACE_STAFF_ID',
  'REPLACE_APPROVAL_NUMBER', 'REPLACE_INTERNAL_DOCUMENT_REFERENCE', 'REPLACE_ORIGINAL_FILE_SHA256_LOWERCASE',
  'REPLACE_APPROVAL_DATE'::date, 'REPLACE_WORK_START'::date, 'REPLACE_WORK_END'::date,
  'REPLACE_EXPIRY_DATE'::date, 'REPLACE_VERIFIER_INTERNAL_REFERENCE',
  'REPLACE_NOTE_OF_WRITTEN_APPROVAL_AND_JOB_PARTIES_STAFF_DATES_SCOPE_CHECK', '{}'
)
returning id,job_id,status;
-- job_snapshot と verified_at はトリガーがDBの現在値で固定する。
commit;

-- 取消が必要な場合は、対象IDを確認し別クエリで次を実行する。
-- update connexy_private.sb_approvals set status='revoked' where id='REPLACE_APPROVAL_RECORD_UUID'::uuid;
-- 原記録は上書きしない。対象変更の場合は取消後に新たな照合記録を作る。
