-- ============================================================================
-- Connexy: テスト用 案件 150 件の投入
-- ============================================================================
-- 様々な会社(8社)から、様々な場所(20拠点)へ、様々な内容の案件を無作為生成。
-- 応募締切は 2026年9月 / 10月 / 11月 に無作為配分。
--
-- Supabase ダッシュボード → SQL Editor に貼り付けて実行。
-- id は 'seed_j_0001'〜'seed_j_0150'。再実行しても重複しない(on conflict do nothing)。
--
-- ※ 一度消してやり直したい場合はこの行を実行:
--   delete from public.jobs where id like 'seed_j_%';
-- ============================================================================

do $$
declare
  n_total       constant int := 150;

  companies     text[] := array['sigma','alpha','beta','gamma','delta','seals','freer','cocolabo'];

  loc_names     text[] := array[
    '東京都新宿区新宿3丁目','東京都渋谷区宇田川町','東京都豊島区東池袋1丁目','東京都品川区大崎1丁目',
    '東京都千代田区外神田1丁目','東京都台東区上野4丁目','東京都港区新橋2丁目','東京都中央区銀座4丁目',
    '東京都世田谷区北沢2丁目','東京都立川市曙町2丁目','東京都町田市原町田6丁目','東京都武蔵野市吉祥寺本町1丁目',
    '神奈川県横浜市西区南幸1丁目','神奈川県川崎市川崎区駅前本町','埼玉県さいたま市大宮区桜木町1丁目','千葉県千葉市中央区富士見2丁目',
    '愛知県名古屋市中村区名駅1丁目','大阪府大阪市北区梅田1丁目','兵庫県神戸市中央区三宮町1丁目','福岡県福岡市中央区天神2丁目'
  ];
  loc_lat       numeric[] := array[
    35.6905,35.6617,35.7295,35.6197, 35.7022,35.7096,35.6665,35.6717,
    35.6613,35.6979,35.5417,35.7038, 35.4658,35.5316,35.9065,35.6127,
    35.1709,34.7024,34.6937,33.5911
  ];
  loc_lng       numeric[] := array[
    139.7005,139.6982,139.7150,139.7286, 139.7745,139.7740,139.7581,139.7650,
    139.6683,139.4136,139.4467,139.5797, 139.6221,139.6970,139.6238,140.1130,
    136.8815,135.4959,135.1928,130.3985
  ];
  loc_station   text[] := array[
    '新宿','渋谷','池袋','大崎', '秋葉原','上野','新橋','銀座',
    '下北沢','立川','町田','吉祥寺', '横浜','川崎','大宮','千葉',
    '名古屋','梅田','三宮','天神'
  ];

  role_types    text[] := array['キャンペーンクルー','クローザー','ディレクター'];
  channels      text[] := array['量販店','ショップ'];
  carriers      text[] := array['docomo','au/UQmobile','SoftBank/Y!mobile'];
  work_locs     text[] := array['店内','外販（複合施設など）','外販（スーパーなど）','外販（その他）'];
  months        text[] := array['09','10','11'];

  titles        text[] := array[
    '【%1$s】%2$s イベント%3$s大募集',
    '【%1$s駅】%2$s・モバイル%4$s獲得スタッフ',
    '【%1$sエリア】%2$s 店頭プロモーション%3$s',
    '【%1$s】週末の%4$s店頭応援 %3$s',
    '【%1$s】%2$s 新規/MNP獲得 %3$s募集'
  ];
  descs         text[] := array[
    '大手通信キャリアのブースにて、お声がけ・サービス案内・獲得業務をお任せします。未経験の方も歓迎です。',
    'モバイル端末の新規契約・MNP乗り換え相談に特化した業務です。クロージングに自信のある方歓迎。',
    'ブース設営から運営、集客のマイクパフォーマンス(MC)まで。リーダーシップを発揮できる現場です。',
    '週末の来店客数増加に伴う店頭プロモーション応援。チームで獲得目標を目指します。',
    '量販店内の携帯コーナーでの接客・販売サポート。丁寧な接客ができる方を求めています。',
    'イベント会場での通信サービスのご案内とアンケート回収。明るく元気な対応ができる方歓迎。'
  ];

  i             int;
  ci            int;   -- company index
  li            int;   -- location index
  ro            text;
  ch            text;
  ca            text;
  wl            text;
  ttl           text;
  dsc           text;
  mm            text;
  dd            int;
  dl_date       date;
  ev_start      date;
  ev_days       int;
  ev_str        text;
  d             int;
  price_v       int;
  urgent_v      boolean;
  reqs          text[];
  allowed       text[];
begin
  for i in 1..n_total loop
    -- 会社・場所は均等に回しつつ少しずらす
    ci := 1 + ((i * 3) % array_length(companies, 1));
    li := 1 + ((i * 7) % array_length(loc_names, 1));

    ro := role_types[1 + floor(random() * array_length(role_types,1))::int];
    ch := channels[1 + floor(random() * array_length(channels,1))::int];
    ca := carriers[1 + floor(random() * array_length(carriers,1))::int];
    wl := work_locs[1 + floor(random() * array_length(work_locs,1))::int];

    ttl := format(
      titles[1 + floor(random() * array_length(titles,1))::int],
      loc_station[li], ca, ro, ch, wl
    );
    dsc := descs[1 + floor(random() * array_length(descs,1))::int];

    -- 締切: 9/10/11月を無作為に、日は 1〜28
    mm := months[1 + floor(random() * array_length(months,1))::int];
    dd := 1 + floor(random() * 28)::int;
    dl_date := ('2026-' || mm || '-' || lpad(dd::text, 2, '0'))::date;

    -- 稼働日: 締切の 5〜30日後から 1〜3日連続
    ev_start := dl_date + (5 + floor(random() * 26)::int);
    ev_days  := 1 + floor(random() * 3)::int;
    ev_str := '';
    for d in 0..(ev_days - 1) loop
      ev_str := ev_str || case when d = 0 then '' else ', ' end
                       || to_char(ev_start + d, 'YYYY-MM-DD');
    end loop;

    price_v  := 12000 + floor(random() * 14)::int * 1000;   -- 12,000〜25,000
    urgent_v := random() < 0.12;

    reqs := array['__JOB_CODE__::JOB-S' || lpad(i::text, 5, '0')];
    -- 約1/4に交通費・宿泊費の設定を付ける
    if random() < 0.25 then
      reqs := reqs || ('__EXPENSES__::' || json_build_object(
        'transportType', 'pay_separate',
        'transportValue', 1000 + floor(random() * 3)::int * 500,
        'accommodationType', case when random() < 0.4 then 'flat' else 'none' end,
        'accommodationValue', 8000
      )::text);
    end if;

    -- 約1割を「限定公開(特定社のみ応募可)」に
    allowed := null;
    if random() < 0.1 then
      allowed := array[ companies[1 + floor(random() * array_length(companies,1))::int] ];
    end if;

    insert into public.jobs (
      id, title, description, lat, lng, author_id, price, location_name,
      work_hours, requirements, detailed_description, role_type, sales_channel,
      carrier, event_date, application_deadline, work_location, is_urgent, allowed_company_ids
    ) values (
      'seed_j_' || lpad(i::text, 4, '0'),
      ttl,
      dsc,
      loc_lat[li],
      loc_lng[li],
      companies[ci],
      price_v,
      loc_names[li],
      case when random() < 0.5 then '10:00 - 19:00' else '11:00 - 20:00' end,
      reqs,
      dsc || E'\n\n【服装】オフィスカジュアル（貸与ユニフォームあり）\n【交通費】上記条件に準ずる\n【備考】研修動画の事前視聴をお願いする場合があります。',
      ro,
      ch,
      ca,
      ev_str,
      to_char(dl_date, 'YYYY-MM-DD'),
      wl,
      urgent_v,
      allowed
    )
    on conflict (id) do nothing;
  end loop;
end $$;

-- 確認
-- select substr(application_deadline,1,7) as 締切月, count(*) from public.jobs
--   where id like 'seed_j_%' group by 1 order by 1;
-- select author_id, count(*) from public.jobs where id like 'seed_j_%' group by 1 order by 1;
