-- ==============================================================================
-- Connexy RLS (Row Level Security) ポリシー設定スクリプト
-- ==============================================================================
-- このスクリプトはSupabaseのSQLエディタで実行して、各テーブルへのアクセス制御を設定します。
-- ※本番環境へデプロイする前に、必ず検証環境でテストしてください。

-- 1. companies（企業）テーブル
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- ⚠️ 【重大】2026-08-25 セキュリティレビューで判明した問題:
-- companiesテーブルには login_id / password カラムが平文で保存されており(src/data/mockDb.ts参照)、
-- RLSは行単位の制御のためカラムを絞り込めない。つまり下記の USING (true) は
-- 「anonキーだけを持つ第三者が select('login_id,password') 等で全企業の平文ログイン情報を取得できる」
-- ことを意味する。詳細と対応方針は todo.md の「🚨 緊急: companiesテーブルのRLSが平文パスワードを
-- anonキーで全公開している」を参照。本番運用前に、password列を含まない公開ビューへの分離、または
-- ログイン検証をSECURITY DEFINER関数(RPC)によるサーバーサイド処理へ移行することを強く推奨する。
-- 企業情報の参照: 誰でも参照可能（プラットフォーム上の公開プロフィールとして扱う場合）
CREATE POLICY "Allow public read access for companies"
  ON public.companies FOR SELECT
  USING (true);

-- ⚠️ 注意: 本アプリのログイン処理(src/data/mockDb.ts login())はSupabase Authを使わず、
-- anonキーでcompanies/staffsテーブルへ直接login_id/passwordを問い合わせる自前実装のため、
-- auth.uid()は常にnullになる。そのため下記のUPDATEポリシーは実質的に誰の更新リクエストも
-- 通さない(auth.uid() = id が常にfalseになる)。実際の認証方式に合わせて再設計が必要。
-- 企業情報の更新: 自身の企業レコードのみ更新可能
-- （ここでは auth.uid() が企業IDと一致するかを確認する想定）
CREATE POLICY "Allow update for own company profile"
  ON public.companies FOR UPDATE
  USING (auth.uid() = id);

-- 2. staffs（スタッフ）テーブル
ALTER TABLE public.staffs ENABLE ROW LEVEL SECURITY;

-- ⚠️ 注意: companiesと同じく auth.uid() 前提のポリシーであり、本アプリの自前ログイン方式では
-- auth.uid()が常にnullのため、下記2ポリシーは実質的に「誰の参照・更新リクエストも通さない」
-- 状態になっている(過剰に厳しく機能しない側)。ここは平文流出こそしないが、実運用前に
-- 実際の認証方式に合わせた再設計が必要な点は他テーブルと同様。
-- スタッフの参照: 所属企業のユーザーのみ参照可能
CREATE POLICY "Allow read for own company staffs"
  ON public.staffs FOR SELECT
  USING (auth.uid() = user_id);

-- スタッフの作成・更新・削除: 所属企業のユーザーのみ可能
CREATE POLICY "Allow all actions for own company staffs"
  ON public.staffs FOR ALL
  USING (auth.uid() = user_id);

-- 3. jobs（案件）テーブル
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- 案件の参照: 案件は全ユーザーが検索・参照可能
CREATE POLICY "Allow public read access for jobs"
  ON public.jobs FOR SELECT
  USING (true);

-- 案件の作成・更新・削除: 案件の作成者（author_id）のみ可能
CREATE POLICY "Allow all actions for job authors"
  ON public.jobs FOR ALL
  USING (auth.uid() = author_id);

-- 4. talents（人材）テーブル
ALTER TABLE public.talents ENABLE ROW LEVEL SECURITY;

-- ⚠️ 注意: companiesと同様 USING (true) で全カラムが公開される。talentsテーブルには
-- 実名(name)が含まれており、アプリのUI上はmaskedNameのみを表示する設計(todo.mdの
-- 「Talentの実名がUI非表示なのにクライアント側データには含まれている」を参照)だが、
-- このRLSのままではanonキーで select('name') すれば実名を直接取得できてしまう。
-- 人材の参照: 誰でも参照可能（マッチング検索用）
CREATE POLICY "Allow public read access for talents"
  ON public.talents FOR SELECT
  USING (true);

-- 人材の作成・更新: 人材を作成したユーザー（所属元企業）のみ可能
CREATE POLICY "Allow all actions for talent owners"
  ON public.talents FOR ALL
  USING (auth.uid() = user_id);

-- 5. contract_tasks（契約タスク・入出金明細）テーブル
ALTER TABLE public.contract_tasks ENABLE ROW LEVEL SECURITY;

-- タスクの参照: 関与する企業（agency_id または 発注側企業）のみ参照可能
CREATE POLICY "Allow read for involved parties"
  ON public.contract_tasks FOR SELECT
  USING (auth.uid() = agency_id OR auth.uid()::text = (SELECT author_id FROM public.jobs WHERE id = public.contract_tasks.job_id)::text);

-- ==============================================================================
-- ※注意: 上記は基本的なRLSのテンプレートです。
-- 実際の要件に合わせて、カラム単位の制限や、より複雑なロールベースアクセス制御を追加してください。
-- ==============================================================================
