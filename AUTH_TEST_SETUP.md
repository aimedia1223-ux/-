# 個人認証と所属会社の実接続テスト

## 現在地

2026-10-20：検証プロジェクトは未作成（利用者確認済み）。接続情報も未設定。
ローカルの模擬テストは実施済み。実接続テスト・SQL実行は未実施。

## 最初に行うこと

1. [Supabase管理画面](https://supabase.com/dashboard)で新しい空のプロジェクトを作る。名前は例としてconnexy-auth-test。プラン・費用表示を確認して作成する。既存の業務用プロジェクトを選ばない。
2. プロジェクトURLを控える。DBパスワードや秘密キーはチャットへ送らない。

以降は検証先が用意できてから実行する。

## 検証環境の準備

1. SQL Editorでsupabase/00_auth_test_schema.sqlを実行する。架空会社A/BとスタッフA/Bだけを作成する。既存会社テーブルがある環境では停止する。
2. supabase/02_auth_identity.sqlを実行する。管理者だけが変更できる所属管理表と本人情報RPCを作成する。
3. Authenticationのユーザー管理で、別々のメールアドレスを持つ検証用ユーザーA/Bを作成する。テスト用パスワードをローカルで設定し、両ユーザーがメール確認済みでログイン可能な状態にする。実在の第三者へ招待メールを送らない。
4. 03_auth_test_memberships.sqlの2つのUUIDを作成したAuthユーザーのIDに置換して実行する。Aは架空会社Aの管理者、Bは架空会社Bの一般担当者になる。
5. .env.auth-test.exampleを.env.auth-test.localへコピーする。検証先URL・anonキーまたはpublishableキー・A/Bのメール/パスワードをローカルで設定する。secretキー/service_roleキーは使わない。
6. 会社IDはauth_test_company_a / auth_test_company_b、スタッフIDはauth_test_staff_a / auth_test_staff_b。AUTH_TEST_CONFIRM_DISPOSABLE=trueにする。

## 実行

connexyフォルダで実行する。Node.js 22以降を使用。

```powershell
npm run verify:auth:config
npm run verify:auth
```

設定確認は通信しない。接続テストではA/Bのログイン・本人情報取得・ログアウトだけを実行する。会社・スタッフ・所属データの作成や変更は行わない。セッションをファイルへ保存しない。

結果はauth-verification.local.jsonに保存する。メール・パスワード・キー・トークン・レスポンス本文は記録しない。接続失敗は成功として扱わない。

## 確認範囲

- 未ログインでは本人情報RPCを呼び出せない。
- A/Bがそれぞれ登録された会社・スタッフの本人情報だけを取得する。
- A/Bが所属管理表を直接取得できない。
- ログアウトすると本人情報を取得できない。

これは本人情報RPCの検証。案件・契約・チャットの会社別RLS、MFA、実ブラウザのログイン画面は対象外。
最小スキーマには案件テーブルなどがないため、この検証先でアプリ全機能の動作確認はできない。

## 手動で追加する拒否テスト

管理者が検証先だけでAの所属activeをfalseにする→Aの本人情報が空になることを確認→trueへ戻す。
会社Aをpendingにする→Aの本人情報が空になることを確認→approvedへ戻す。
スタッフAのuser_idを会社Bに変更する→Aの本人情報が空になることを確認→会社Aへ戻す。
これらの拒否状態では通常の接続テストが失敗するのが期待結果。いずれも未実施。

API仕様：[初期化](https://supabase.com/docs/reference/javascript/initializing)、[RPC](https://supabase.com/docs/reference/javascript/rpc)。
