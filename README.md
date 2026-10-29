# Connexy

A React + TypeScript + Vite web app, using Supabase for the backend. External map and address lookup features are disabled in the current review flow.

## 現在の共有版（記録更新：2026-10-29）

[機能・デザイン確認サイト](https://aimedia1223-ux.github.io/-/) — 架空データによる検証専用です。

- インシデント報告：135番SQLを適用済み。2026-10-27に公開画面で架空の連絡先・報告の保存、対応追記、画面を開き直した後の再表示、第一報ひな形を確認しました。
- 架空募集100件：2026-10-29に136番SQLの実行結果でA社50件・B社50件を確認。管理は自社分、探すの公開概要は他社分を表示します。既存案件は残し、承諾・契約は作成しません。再実行時の重複防止と既存案件の保護をテスト済みです。
- 初回報告と対応履歴を保持します。社外への自動通知はなく、外部への連絡・証拠保全の実施は別途必要です。
- 検証対象アカウントの追加認証は134番で一時解除中です。再開には132番を使用します。
- 共有相手用アカウントの作成、電子署名・第三者時刻証明、支払条件の法令対応、外部保存・バックアップ等の消去確認は保留中です。

詳しくは [報告機能の変更・確認記録](INCIDENT_REPORT_CHANGELOG.md) と [共有サイトの確認ガイド](REVIEW_SITE_GUIDE.md) を参照してください。

## Getting Started

Install dependencies:

```bash
npm install
```

Create a `.env` file in the project root with the following variables:

```bash
VITE_SUPABASE_URL=your-supabase-project-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_GOOGLE_MAPS_API_KEY=your-google-maps-api-key
VITE_GOOGLE_MAP_ID=your-google-map-id
```

Start the dev server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` — start the Vite dev server with HMR
- `npm run build` — type-check with `tsc` and build for production
- `npm run lint` — run ESLint
- `npm run preview` — preview the production build locally
