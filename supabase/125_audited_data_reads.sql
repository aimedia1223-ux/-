-- 124番適用後、一度実行。通常一覧の直接SELECTを閉じ、既存範囲を監査付きRPCへ移す。
begin;
alter table connexy_private.audit_events drop constraint audit_events_action_check;
alter table connexy_private.audit_events add constraint audit_events_action_check check(action in (
 'responsibility.saved','responsibility.deleted','agency_manager.saved','agency_manager.deleted',
 'offer.created','offer.confirmed','offer.declined','offer.withdrawn','offer.deleted',
 'contract.created','contract.updated','contract.deleted','message.sent','message.updated','message.deleted',
 'job.created','job.updated','job.deleted','staff.created','staff.updated','staff.deleted','approval.created','approval.revoked','approval.deleted',
 'job_detail.read','responsibility.read','agency_manager.read','offer.read','message.read','thread.read','audit.read','data.read','staff_export.read'));

create function public.connexy_read_data(target_table text,target_id text default null,target_company text default null,
 page_size integer default 200,page_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; projection text; predicate text; company_column text; result jsonb; entry jsonb; kind text;
begin
 select * into i from public.connexy_current_identity();
 if i.company_id is null then raise exception '有効な所属と追加認証が必要です。' using errcode='42501'; end if;
 if target_table is null or target_table not in ('companies','staffs','jobs','talents','contract_tasks','announcements')
   or page_size is null or page_size not between 1 and 200 or page_offset is null or page_offset not between 0 and 100000 then
   raise exception '取得条件が不正です。' using errcode='22023'; end if;
 case target_table
 when 'companies' then
   projection:='id,name,role,status,invoice_number,representative_name,email,website,address,pr_text,company_type,gender,contract_template,contract_pdf';
   predicate:='s.id=connexy_private.current_company_id()';company_column:='id';kind:='collection';
 when 'staffs' then
   projection:='id,user_id,name,masked_name,base_location,nearest_station,preferred_area,price,skills,carriers,experience,pr_text,completed_trainings,has_certificate';
   predicate:='connexy_private.can_read_staff(s.id,s.user_id)';company_column:='user_id';kind:='staff';
 when 'jobs' then
   projection:='id,author_id,title,description,lat,lng,price,location_name,work_hours,requirements,detailed_description,role_type,sales_channel,carrier,event_date,application_deadline,work_location,is_urgent,allowed_company_ids,exact_location';
   predicate:='connexy_private.can_read_job(s.id,s.author_id)';company_column:='author_id';kind:='job';
 when 'talents' then
   projection:='id,user_id,name,description,lat,lng,price,skills,pr_text,experience,preferred_area,location_name,company_name,masked_name,base_location,nearest_station,carriers,available_dates,completed_trainings,has_certificate';
   predicate:='connexy_private.can_read_staff(s.staff_id,s.user_id)';company_column:='user_id';kind:='collection';
 when 'contract_tasks' then
   -- 従来のRLSは全行拒否。契約詳細は引き続き既存の承諾確認付き専用RPCだけ。
   projection:='id';predicate:='false';company_column:='client_id';kind:='contract';
 when 'announcements' then
   projection:='id,date,title,content,is_important';predicate:='connexy_private.current_company_id() is not null';company_column:=null;kind:='collection';
 end case;
 -- 関係名・列・条件は上記の定数からのみ選ぶ。利用者の値はすべてバインドする。
 execute format('select coalesce(jsonb_agg(to_jsonb(t) order by t.id),''[]''::jsonb) from
   (select %s from public.%I s where %s and ($1 is null or s.id=$1) and (%s)
    order by s.id limit $3 offset $4) t',projection,target_table,predicate,
    case when company_column is null then '$2 is null' else format('($2 is null or s.%I=$2)',company_column) end)
 into result using target_id,target_company,page_size,page_offset;
 if jsonb_array_length(result)=0 then
   perform connexy_private.append_audit(i.company_id,'data.read','collection',target_table,null,0);
 else
   for entry in select value from jsonb_array_elements(result) loop
     perform connexy_private.append_audit(i.company_id,'data.read',kind,
       case when kind='collection' then target_table||':'||(entry->>'id') else entry->>'id' end,null,1);
   end loop;
 end if;
 return jsonb_build_object('rows',result,'scope',jsonb_build_array(auth.uid(),i.company_id,i.staff_id,i.member_role));
end; $$;

create function public.connexy_export_staff_csv()
returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; s record; csv text:='スタッフID,氏名,表示名'; rows_count integer:=0; cells text[]; value text; line text[];
begin
 select * into i from public.connexy_current_identity();
 if i.company_id is null or i.member_role<>'admin' then raise exception '自社管理者の追加認証が必要です。' using errcode='42501'; end if;
 -- 出力範囲・列は固定。本人以外の会社や列の自己申告は受け付けない。
 for s in select id,name,masked_name from public.staffs where user_id=i.company_id order by id limit 10001 loop
   rows_count:=rows_count+1;
   if rows_count>10000 then raise exception '出力件数が上限を超えています。' using errcode='22023'; end if;
   cells:=array[s.id,s.name,s.masked_name];line:='{}';
   foreach value in array cells loop
     value:=coalesce(value,'');
     -- 表計算ソフトの数式として解釈させない。引用符・改行・カンマを正しくエスケープ。
     if value ~ '^[[:space:]]*[=+@-]' or value ~ '^[\t\r\n]' then value:=''''||value; end if;
     line:=array_append(line,'"'||replace(value,'"','""')||'"');
   end loop;
   csv:=csv||E'\r\n'||array_to_string(line,',');
 end loop;
 perform connexy_private.append_audit(i.company_id,'staff_export.read','collection','staffs',null,rows_count);
 return jsonb_build_object('csv',csv,'filename','Connexy_staffs.csv','count',rows_count);
end; $$;
revoke all on function public.connexy_read_data(text,text,text,integer,integer),public.connexy_export_staff_csv() from public,anon;
grant execute on function public.connexy_read_data(text,text,text,integer,integer),public.connexy_export_staff_csv() to authenticated;
revoke select on public.companies,public.staffs,public.jobs,public.talents,public.contract_tasks,public.announcements from authenticated;
-- 本人所属を読むSECURITY DEFINER関数と既存の専用RPCは引き続き利用可能。
commit;
