-- 00_auth_test_schema.sql → 02_auth_identity.sql → Authユーザー作成後に実行。
-- 下記2つを検証用AuthユーザーのUUIDに置換する。パスワードは記入しない。
-- 同じSQL内で全件成功しない場合はトランザクションごと取り消される。
begin;
insert into public.connexy_auth_memberships
  (auth_user_id, company_id, staff_id, display_name, member_role)
values
  ('REPLACE_WITH_AUTH_USER_A_UUID'::uuid, 'auth_test_company_a', 'auth_test_staff_a', '架空担当者A', 'admin'),
  ('REPLACE_WITH_AUTH_USER_B_UUID'::uuid, 'auth_test_company_b', 'auth_test_staff_b', '架空担当者B', 'staff');
commit;
