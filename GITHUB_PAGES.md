# GitHub Pages公開設定（2026-10-23）

対象: aimedia1223-ux/-、mainブランチ、アプリはリポジトリ直下。

## 変更前後

| 項目 | 変更前 | 変更後 |
|---|---|---|
| Node.js | 20 | 24 |
| 認証テスト | 未実行 | 公開前にtest:authを実行 |
| Supabase設定 | 旧anonキーのみ | 新publishableキーと従来anonキーに対応 |
| 設定不足 | 設定がなくてもビルド可能 | URL・公開用キー不足で公開を停止 |
| 公開パス | 相対パス | GitHub Pagesから取得したbase_pathをビルドへ反映 |
| デモ認証 | 暗黙 | 公開時は明示的に無効 |

## リポジトリ設定

Settings → Pages → SourceはGitHub Actions。
Settings → Secrets and variables → Actions → Variablesに以下を設定する。

- VITE_SUPABASE_URL：新しいSupabaseのProject URL
- VITE_SUPABASE_PUBLISHABLE_KEY：公開用publishableキー

ブラウザ用の公開設定だけを利用し、DBパスワード・service_role・secretキーを設定しない。
.env.local、検証パスワード、開発用DBスクリプト、node_modules、distはGitへ送らない。
特定アカウントを紐付ける101_first_demo_membership.sqlも公開対象から除外する。

## 公開の流れ

mainへpushすると.github/workflows/deploy.ymlが実行される。
依存関係導入 → 認証テスト → 接続設定確認 → 本番ビルド → Pagesへ公開。
ActionsのDeploy static content to Pagesが成功したら、Settings → PagesにあるURLを開く。
想定URLはhttps://aimedia1223-ux.github.io/-/（実際の公開結果を確認するまで未確定）。

## 現段階の範囲

ログイン画面を公開する設定。業務データのRLS移行は未完了で、案件やチャットの本番利用準備が済んだ意味ではない。
旧GitHubアップロード先の別作業コピーではなく、このChatGPTプロジェクト配下の最新変更を送る。

参照：[ViteのGitHub Pages手順](https://vite.dev/guide/static-deploy.html)、[GitHubのカスタムワークフロー](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
