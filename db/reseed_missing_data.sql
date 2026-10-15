-- ============================================================================
-- Connexy: 復元したバックアップ(2026-06-05 時点)に欠けているデータの再投入
-- ============================================================================
-- 背景: 無料プランの Supabase プロジェクトが一度削除され、古いバックアップから
-- 復元したため、後から追加した3社(seals / freer / cocolabo)とそのスタッフ、
-- および `announcements` テーブルが存在しない。
--
-- Supabase ダッシュボード → SQL Editor に貼り付けて実行してください。
-- すべて冪等(何度実行しても安全)に書いています。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. staffs テーブルに login_id / password / role 列を追加
--    (コードは row.login_id / row.password / row.role をフォールバックとして読む。
--     無いと localStorage 生成のログインしか使えず、admin ロールも付かない)
-- ----------------------------------------------------------------------------
alter table public.staffs add column if not exists login_id text;
alter table public.staffs add column if not exists password  text;
alter table public.staffs add column if not exists role      text;


-- ----------------------------------------------------------------------------
-- 2. 欠けている3社
-- ----------------------------------------------------------------------------
insert into public.companies (id, name, login_id, password, role) values
  ('seals',    '株式会社SEALs',              'seals',    'pass', 'contractor'),
  ('freer',    '株式会社FreeR VisioN',        'freer',    'pass', 'contractor'),
  ('cocolabo', 'ココラボ・ソリューションズ',   'cocolabo', 'pass', 'contractor')
on conflict (id) do nothing;


-- ----------------------------------------------------------------------------
-- 3. その3社のスタッフ(ログインID: <会社>_s1 / _s2 / _s3、パスワード: pass)
--    skills / carriers / completed_trainings は text[] 型
-- ----------------------------------------------------------------------------
insert into public.staffs
  (id, user_id, name, masked_name, base_location, nearest_station, price, skills, carriers, completed_trainings, login_id, password, role)
values
  -- SEALs
  ('s_seals_admin',    'seals',    '岡田 哲弥', '岡さん', '東京都品川区',   '五反田駅', 16000, ARRAY['イベント運営','キャンペーンMC'], ARRAY['docomo','au/UQmobile'], ARRAY[]::text[], 'seals_s1', 'pass', 'admin'),
  ('s_seals_staff1',   'seals',    '中嶋 晴希', '中さん', '神奈川県川崎市', '川崎駅',   13000, ARRAY['モバイル販売'],                 ARRAY['SoftBank/Y!mobile'],    ARRAY[]::text[], 'seals_s2', 'pass', 'staff'),
  ('s_seals_staff2',   'seals',    '野田 悠斗', '野さん', '東京都世田谷区', '下北沢駅', 13000, ARRAY['イベント運営'],                 ARRAY['docomo'],               ARRAY[]::text[], 'seals_s3', 'pass', 'staff'),
  -- FreeR VisioN
  ('s_freer_admin',    'freer',    '林 克樹',   '林さん', '東京都港区',     '表参道駅', 16000, ARRAY['モバイル販売','クローザー'],     ARRAY['docomo','au/UQmobile'], ARRAY[]::text[], 'freer_s1', 'pass', 'admin'),
  ('s_freer_staff1',   'freer',    '大西 涼太', '大さん', '東京都目黒区',   '中目黒駅', 13000, ARRAY['モバイル販売'],                 ARRAY['au/UQmobile'],          ARRAY[]::text[], 'freer_s2', 'pass', 'staff'),
  ('s_freer_staff2',   'freer',    '佐々木 遼', '佐さん', '神奈川県横浜市', '横浜駅',   13000, ARRAY['ブース獲得'],                   ARRAY['SoftBank/Y!mobile'],    ARRAY[]::text[], 'freer_s3', 'pass', 'staff'),
  -- ココラボ・ソリューションズ
  ('s_cocolabo_admin',  'cocolabo', '伊内 美伊', '伊さん', '大阪府大阪市',   '梅田駅',   16000, ARRAY['ディレクター','イベントMC'],     ARRAY['docomo','au/UQmobile'], ARRAY[]::text[], 'cocolabo_s1', 'pass', 'admin'),
  ('s_cocolabo_staff1', 'cocolabo', '川口 彩香', '川さん', '兵庫県神戸市',   '三ノ宮駅', 13000, ARRAY['モバイル販売'],                 ARRAY['docomo'],               ARRAY[]::text[], 'cocolabo_s2', 'pass', 'staff'),
  ('s_cocolabo_staff2', 'cocolabo', '西田 桃子', '西さん', '京都府京都市',   '京都駅',   13000, ARRAY['イベント運営'],                 ARRAY['SoftBank/Y!mobile'],    ARRAY[]::text[], 'cocolabo_s3', 'pass', 'staff')
on conflict (id) do nothing;


-- ----------------------------------------------------------------------------
-- 4. announcements テーブル(運営からのお知らせ)
--    無くてもアプリは既定表示で動くが、作ると全ユーザーで同期される
-- ----------------------------------------------------------------------------
create table if not exists public.announcements (
  id           text primary key,
  date         text not null,
  title        text not null,
  content      text not null,
  is_important boolean not null default false,
  created_at   timestamptz not null default now()
);

-- 他テーブルと同じく anon キーで読み書きできるようにする(app は anon キーのみ使用)
alter table public.announcements enable row level security;
drop policy if exists announcements_anon_all on public.announcements;
create policy announcements_anon_all on public.announcements
  for all to anon, authenticated using (true) with check (true);

insert into public.announcements (id, date, title, content, is_important) values
  ('ann-1', '2026/06/13',
   'プライバシーマーク（Pマーク）取得に向けた個人情報取扱方針の改定について',
   E'平素はConnexyをご利用いただき誠にありがとうございます。Connexyでは、ユーザーの皆様に安全かつ信頼性の高いお仕事管理環境を提供するため、将来的なプライバシーマーク（Pマーク）の取得に向けたシステム監査および個人情報取扱方針の改定を実施いたします。\n\n【主な変更点】\n1. GPSによる位置情報取得時の同意取得フローの厳格化\n2. チャット内の不要な個人情報（電話番号、メールアドレス等）の自動マスキング（伏字化）処理の導入\n3. データベースにおけるRow Level Security（行レベルセキュリティ）ポリシーの適用強化\n\n本改定に伴うユーザー様への操作上の影響はございません。今後とも個人情報の厳重な管理体制を維持し、プライバシー保護に努めてまいりますので、ご理解とご協力のほどよろしくお願い申し上げます。',
   true),
  ('ann-2', '2026/06/10',
   '【重要】システムメンテナンスに伴う一時利用停止のお知らせ（6月18日深夜）',
   E'サーバー性能向上およびインフラ増強のため、下記の日程でシステムメンテナンスを実施いたします。\n\n【メンテナンス日時】\n2026年6月18日（木） 午前1:00 〜 午前5:00\n※作業の進捗状況により、時間が前後する場合がございます。\n\n【影響範囲】\nメンテナンス時間帯は、アプリへのログイン、求人の検索、チャットの送受信、打刻など全ての機能がご利用いただけません。\nご利用の皆様にはご不便をおかけいたしますが、ご理解とご協力を賜りますようお願い申し上げます。',
   true),
  ('ann-3', '2026/06/05',
   'マッチング手数料（10%）の明細表示機能リリースのお知らせ',
   E'いつもConnexyをご利用いただきありがとうございます。\nこの度、売上・振込予定額の透明性を高めるため、ダッシュボード詳細にてマッチング手数料（10%）および早期出金手数料（7.5%）の具体的な差し引き額を明記するアップデートを反映いたしました。売上予定額と実際の受取予定額がひと目でわかるようになりますので、ぜひご活用ください。',
   false)
on conflict (id) do nothing;


-- ----------------------------------------------------------------------------
-- 5. 旧ステータス値 working → confirmed(STATUS_MODEL.md §7.1)
--    アプリは読み出し時に正規化するが、データも揃えておく
-- ----------------------------------------------------------------------------
update public.contract_tasks set status = 'confirmed' where status = 'working';

-- evaluations JSON 内の jobStates.*.status も同様に
update public.contract_tasks
set evaluations = (
  select jsonb_set(
    evaluations,
    '{jobStates}',
    (
      select coalesce(jsonb_object_agg(k, case when v->>'status' = 'working'
                                                then jsonb_set(v, '{status}', '"confirmed"')
                                                else v end), '{}'::jsonb)
      from jsonb_each(evaluations->'jobStates') as e(k, v)
    )
  )
)
where evaluations ? 'jobStates'
  and exists (
    select 1 from jsonb_each(evaluations->'jobStates') as e(k, v)
    where v->>'status' = 'working'
  );


-- ----------------------------------------------------------------------------
-- 確認
-- ----------------------------------------------------------------------------
-- select id, name from public.companies order by id;
-- select user_id, count(*) from public.staffs group by user_id order by user_id;
-- select id, title, is_important from public.announcements order by date desc;
-- select status, count(*) from public.contract_tasks group by status;
