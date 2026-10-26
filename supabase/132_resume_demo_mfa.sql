-- 131番の一時例外を終了。全員の業務データ取得に追加認証が再び必要になる。
-- 認証アプリの登録・パスワード・契約データは変更しない。
begin;
delete from connexy_private.demo_mfa_exceptions;
commit;
