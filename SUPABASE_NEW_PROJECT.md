# Connexy全体の新規Supabase構築

2026-10-23 / プロジェクト名: aimedia1223-ux's Project
Project URL: https://nmaybickciocmkrmeewi.supabase.co

## 現在地

100番SQLの成功と最初の会社所属の登録結果を利用者から確認済み。
公開用キーをローカル.env.localへ設定し、新プロジェクトのAuth APIへの接続（200）を確認済み。
scripts/check-anonymous-access.mjsにより、匿名の本人情報RPCと7テーブルの取得が権限不足42501で拒否されることを実接続で確認済み。
ログイン後の本人情報取得・会社をまたぐ認可・業務機能の実接続確認は未実施。
旧環境のデータはコピー・削除していない。

## 今行う操作

1. 新しいプロジェクトのSQL Editorで新規クエリを開く。
2. supabase/100_new_project_schema.sqlの全文を貼り付けて実行する。
3. 成功表示を確認する。エラーが出たら、続けて別SQLを実行せず、エラー内容を確認する。

このSQLは会社・スタッフ・案件・人材・契約/チャット・お知らせの6業務テーブルと、個人アカウントの所属管理表・本人情報取得関数を作る。
旧パスワードの列は作らない。所属会社とスタッフの一致を外部キーでも保証する。
既存の同名オブジェクトがあれば、上書きせずトランザクション全体を停止する。

## 前回の検証専用SQLとの違い

| 項目 | 前回 | 今回 |
|---|---|---|
| 対象 | 本人情報取得の最小テスト | Connexy全体の新規構築の土台 |
| 業務テーブル | 会社・スタッフの最小列 | 6テーブルに現行アプリの主要保存項目 |
| パスワード | Authに分離 | 同左。旧login_id/password列なし |
| 所属の整合性 | 取得関数で確認 | 複合外部キーでも不一致を拒否 |
| APIの公開 | 本人情報RPCのみ | 同左。業務APIは権限設計が済むまで閉鎖 |

00_auth_test_schema.sql、01_security_rls.sql、02_auth_identity.sql、03_auth_test_memberships.sql、旧db/reseed_missing_data.sqlは、この100番SQLの前後に実行しない。競合や旧認証の復活を防ぐ。

## その次に必要なもの

- ConnectまたはAPI Keysから取得するpublishableキー（公開用キー）。secret/service_roleキー、DBパスワードは不要。
- A/Bの架空Authユーザー。Authenticationのユーザー管理から作成し、パスワードは手元で管理する。
- Authユーザーとdemoa/demoastaff、demob/demobstaffを対応させる管理者用の登録SQL（Authユーザー作成後に準備）。
- ローカル.env.localのURLとVITE_SUPABASE_PUBLISHABLE_KEYは設定済み。キーを資料やリポジトリに転載しない。
- 検証用設定の会社ID/スタッフIDも上記demoa等に合わせる。

## 残る作業

現時点では全業務テーブルのanon/authenticated権限を取り消している。ログインが成功しても検索・保存・チャットはまだ利用できない。
会社・案件・担当者別のRLS、公開情報と機密情報の分離、SB承認を確認する契約処理、監査ログを順に追加する。
既存アプリに残るオフラインフォールバックや全件取得・パスワード編集欄も改修が必要。
本番利用可能な完成版ではなく、新規構築の第1段階。実情報を投入しない。

参照: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[APIキー](https://supabase.com/docs/guides/getting-started/api-keys)。
