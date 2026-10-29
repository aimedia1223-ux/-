-- 架空検証環境専用。A社50件＋B社50件。既存案件・権限・承諾・契約は変更しない。
-- Supabase SQL Editorで全文を実行。再実行しても同じ100件を増やさない。
begin;
do $$
declare
 n integer; company_key text; job_key text; pub_key uuid;
 regions text[]:=array['北海道','東北','関東','中部','近畿','中国','四国','九州・沖縄'];
 categories text[]:=array['通信サービスの販売支援','店舗運営支援','イベント運営支援','その他の業務支援'];
 tasks text[]:=array['通信サービスの案内補助','店舗の受付・案内支援','展示イベントの運営補助','資料整理・運営支援'];
 hours text[]:=array['09:00〜17:00（架空）','10:00〜18:00（架空）','11:00〜19:00（架空）','12:00〜20:00（架空）'];
 j public.jobs; p connexy_private.job_publications; expected jsonb;
 base_day date; created timestamptz; region_name text; category_name text; idx integer;
 note constant text:='機能・デザイン確認専用の架空募集です。実際の店舗・募集・発注・SB承諾・契約・支払・稼働ではありません。';
begin
 if auth.uid() is not null then raise exception '管理者のSQL Editorで実行してください。'; end if;
 if not exists(select 1 from public.companies where id='demoa' and name='架空検証会社A' and status='approved')
 or not exists(select 1 from public.companies where id='demob' and name='架空検証会社B' and status='approved')
 then raise exception '架空検証会社A・Bを確認できません。実在会社で代用せず停止します。'; end if;
 for n in 1..100 loop
  company_key:=case when n<=50 then 'demoa' else 'demob' end;
  job_key:='connexy-sample-100-'||lpad(n::text,3,'0');
  pub_key:=('00000000-0000-4000-8136-'||lpad(n::text,12,'0'))::uuid;
  idx:=((n-1)%4)+1;
  region_name:=regions[((n-1)%8)+1]; category_name:=categories[idx];
  select * into j from public.jobs where id=job_key for update;
  created:=coalesce(j.created_at,statement_timestamp());
  base_day:=(created at time zone 'Asia/Tokyo')::date;
  -- 実行日が変わっても、既存のサンプルの開催日・金額等を勝手に更新しない。
  expected:=jsonb_build_object('id',job_key,'author_id',company_key,
   'title','【架空募集 '||lpad(n::text,3,'0')||'】'||region_name||'・'||tasks[idx],
   'description',note,'detailed_description',note||' 業務例：'||tasks[idx]||'。条件・交通費・支払日は画面確認用で未確定です。',
   'price',10000+((n-1)%16)*1000,'location_name',region_name||'の架空会場'||lpad(n::text,3,'0')||'（実在しません）',
   'work_hours',hours[idx],'requirements',jsonb_build_array('__JOB_CODE__::SAMPLE-'||lpad(n::text,3,'0'),'架空データによる操作確認専用'),
   'event_date',(base_day+14+(n-1)%45)::text,'application_deadline',(base_day+7+(n-1)%7)::text,
   'is_urgent',n%10=0,'allowed_company_ids','[]'::jsonb,'created_at',created);
  if j.id is not null then
   if to_jsonb(j) is distinct from to_jsonb(jsonb_populate_record(null::public.jobs,expected)) then
    raise exception 'サンプルID % に想定外の内容があります。上書きせず全体を取り消します。',job_key;
   end if;
  else
   insert into public.jobs select (jsonb_populate_record(null::public.jobs,expected)).*;
  end if;
  select * into p from connexy_private.job_publications where public_id=pub_key or job_id=job_key;
  if p.public_id is not null then
   if p.public_id<>pub_key or p.job_id<>job_key or p.region<>region_name or p.category<>category_name or not p.enabled
    or p.job_snapshot is distinct from (select to_jsonb(x) from public.jobs x where x.id=job_key)
   then raise exception 'サンプルの公開概要が変更されています。上書きせず全体を取り消します。'; end if;
  else
   insert into connexy_private.job_publications(public_id,job_id,region,category,enabled,job_snapshot)
   values(pub_key,job_key,region_name,category_name,true,'{}');
  end if;
 end loop;
end; $$;
select j.author_id as company_id,count(*) as sample_job_count
from public.jobs j where j.id ~ '^connexy-sample-100-[0-9]{3}$' group by j.author_id order by j.author_id;
commit;
