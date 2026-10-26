-- 100/102番SQLが適用済みの新プロジェクトのSQL Editorで実行する。
-- 架空データ2件の追加のみ。権限・実案件・SB承認情報は変更しない。
begin;
do $$
begin
  if exists (
    select 1 from public.jobs where
      (id = 'connexy-access-test-a' and (author_id <> 'demoa' or title <> '【閲覧テスト】A社専用案件')) or
      (id = 'connexy-access-test-b' and (author_id <> 'demob' or title <> '【閲覧テスト】B社専用案件'))
  ) then
    raise exception 'テスト案件IDが別の案件に使われています。上書きせず停止します。';
  end if;
end;
$$;
insert into public.jobs
  (id, author_id, title, description, detailed_description, price,
   location_name, lat, lng, work_hours, event_date, application_deadline, requirements)
values
  ('connexy-access-test-a', 'demoa', '【閲覧テスト】A社専用案件',
   '架空データ：会社別の閲覧制限を確認するための案件です。',
   'A社の管理担当者だけが読めることを確認します。実際の募集・稼働はありません。',
   10000, '東京都内（架空の会場A）', 35.6812, 139.7671, '10:00〜18:00（架空）',
   to_char((current_timestamp at time zone 'Asia/Tokyo')::date + 30, 'YYYY-MM-DD'),
   to_char((current_timestamp at time zone 'Asia/Tokyo')::date + 20, 'YYYY-MM-DD'),
   array['__JOB_CODE__::TEST-A']),
  ('connexy-access-test-b', 'demob', '【閲覧テスト】B社専用案件',
   '架空データ：会社別の閲覧制限を確認するための案件です。',
   'B社の管理担当者だけが読めることを確認します。実際の募集・稼働はありません。',
   10000, '東京都内（架空の会場B）', 35.6812, 139.7671, '10:00〜18:00（架空）',
   to_char((current_timestamp at time zone 'Asia/Tokyo')::date + 30, 'YYYY-MM-DD'),
   to_char((current_timestamp at time zone 'Asia/Tokyo')::date + 20, 'YYYY-MM-DD'),
   array['__JOB_CODE__::TEST-B'])
on conflict (id) do nothing;

-- SQL EditorはDB管理者のため、ここでは2件表示されるのが正常。
-- 閲覧制限はConnexyへA/Bそれぞれでログインして確認する。
select id, author_id, title from public.jobs
where id in ('connexy-access-test-a','connexy-access-test-b') order by id;
commit;
