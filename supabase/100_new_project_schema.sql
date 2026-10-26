-- Connexy 新規プロジェクト用・第1段階（2026-10-23）
-- 対象: nmaybickciocmkrmeewi。SQL Editor上部で対象プロジェクトを確認する。
-- 既存DB移行用ではない。会社・スタッフなどが存在すれば全体を停止する。
-- 6つの業務テーブルを作るが、この段階のAPIアクセスは本人情報RPCだけ。
-- 案件検索・チャット・契約操作は次の権限移行まで利用できない。
begin;
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in
      ('companies','staffs','jobs','talents','contract_tasks','announcements','connexy_auth_memberships')
  ) then
    raise exception 'Connexy用の既存オブジェクトを検出しました。上書きせず停止します。';
  end if;
end;
$$;

create table public.companies (
  id text primary key,
  name text not null,
  role text not null default 'contractor' check (role in ('contractor','worker','admin')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  invoice_number text,
  representative_name text,
  email text,
  website text,
  address text,
  pr_text text,
  company_type text check (company_type in ('client','agency','both')),
  gender text,
  contract_template text,
  contract_pdf text,
  created_at timestamptz not null default now()
);
create table public.staffs (
  id text primary key,
  user_id text not null references public.companies(id),
  name text not null,
  masked_name text,
  base_location text,
  nearest_station text,
  preferred_area text,
  price numeric not null default 0 check (price >= 0),
  skills text[] not null default '{}',
  carriers text[] not null default '{}',
  experience text,
  pr_text text,
  completed_trainings text[] not null default '{}',
  has_certificate boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
-- login_id/password列を設けない。認証はauth.usersだけを利用する。
create table public.jobs (
  id text primary key,
  author_id text not null references public.companies(id),
  title text not null,
  description text not null default '',
  lat double precision,
  lng double precision,
  price numeric not null default 0 check (price >= 0),
  location_name text,
  work_hours text,
  requirements text[] not null default '{}',
  detailed_description text,
  role_type text,
  sales_channel text,
  carrier text,
  event_date text,
  application_deadline text,
  work_location text,
  is_urgent boolean not null default false,
  allowed_company_ids text[] not null default '{}',
  exact_location text,
  created_at timestamptz not null default now()
);
create table public.talents (
  id text primary key,
  user_id text not null references public.companies(id),
  name text not null,
  description text not null default '',
  lat double precision,
  lng double precision,
  price numeric not null default 0 check (price >= 0),
  skills text[] not null default '{}',
  pr_text text,
  experience text,
  preferred_area text,
  location_name text,
  company_name text,
  masked_name text,
  base_location text,
  nearest_station text,
  carriers text[] not null default '{}',
  available_dates text,
  completed_trainings text[] not null default '{}',
  has_certificate boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.contract_tasks (
  id text primary key,
  -- 現行アプリはチャットに'chat'を保存するためjobs外部キーを設定しない。
  job_id text not null,
  job_title text not null default '',
  worker_name text,
  company_name text,
  client_name text,
  client_id text references public.companies(id),
  agency_id text references public.companies(id),
  price numeric not null default 0 check (price >= 0),
  date text,
  status text not null default 'applying' check (status in
    ('applying','offered','confirmed','report_pending','completed','disputed','rejected','declined','cancelled')),
  disputed_reason text,
  evaluations jsonb not null default '{}',
  client_contract_text text,
  agency_contract_text text,
  client_contract_pdf text,
  agency_contract_pdf text,
  client_contract_approved_by_client boolean not null default false,
  client_contract_approved_by_agency boolean not null default false,
  agency_contract_approved_by_client boolean not null default false,
  agency_contract_approved_by_agency boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.announcements (
  id text primary key,
  date text not null,
  title text not null,
  content text not null,
  is_important boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.connexy_auth_memberships (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  company_id text not null,
  staff_id text not null,
  display_name text not null,
  member_role text not null check (member_role in ('admin','staff')),
  active boolean not null default true,
  unique (company_id, staff_id),
  foreign key (staff_id, company_id) references public.staffs(id, user_id)
);
create index on public.staffs(user_id);
create index on public.jobs(author_id);
create index on public.talents(user_id);
create index on public.contract_tasks(client_id);
create index on public.contract_tasks(agency_id);

alter table public.companies enable row level security;
alter table public.staffs enable row level security;
alter table public.jobs enable row level security;
alter table public.talents enable row level security;
alter table public.contract_tasks enable row level security;
alter table public.announcements enable row level security;
alter table public.connexy_auth_memberships enable row level security;
revoke all on public.companies, public.staffs, public.jobs, public.talents,
  public.contract_tasks, public.announcements, public.connexy_auth_memberships
  from public, anon, authenticated;

create function public.connexy_current_identity()
returns table(company_id text, company_name text, staff_id text,
  display_name text, member_role text, status text)
language sql stable security definer set search_path = ''
as $$
  select m.company_id, c.name, m.staff_id, m.display_name, m.member_role, c.status
  from public.connexy_auth_memberships m
  join public.companies c on c.id = m.company_id
  join public.staffs s on s.id = m.staff_id and s.user_id = m.company_id
  where m.auth_user_id = auth.uid() and m.active and c.status = 'approved';
$$;
revoke all on function public.connexy_current_identity() from public, anon;
grant execute on function public.connexy_current_identity() to authenticated;

-- 架空データのみ。ログイン用Authユーザー・所属紐付けは後で登録する。
-- 会社IDは現行チャットID解析と衝突しないようアンダースコアを含めない。
insert into public.companies(id,name,status) values
  ('demoa','架空検証会社A','approved'), ('demob','架空検証会社B','approved');
insert into public.staffs(id,user_id,name,masked_name) values
  ('demoastaff','demoa','架空担当者A','担当者A'),
  ('demobstaff','demob','架空担当者B','担当者B');
commit;
