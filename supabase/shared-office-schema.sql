-- アゲテナ：事務所共有モード用 Supabase schema
-- Supabase SQL Editor で実行します。
-- 重要：案件名を扱うため、RLS（行単位セキュリティ）を必ず有効にします。

create extension if not exists pgcrypto;

create table if not exists public.offices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.office_members (
  office_id uuid not null references public.offices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  display_name text not null default '',
  created_at timestamptz not null default now(),
  primary key (office_id, user_id)
);

create table if not exists public.office_cases (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  label text not null default '',
  jurisdiction_id text not null,
  registration_type text not null check (registration_type in ('realEstate', 'commercial')),
  application_method text not null default 'registryData' check (application_method in ('registryData', 'letterPack')),
  registry_office text not null,
  apply_date date not null,
  due_date date,
  data_generated_at timestamptz,
  data_hash text,
  data_source text not null default '',
  status text not null default 'active' check (status in ('active', 'done')),
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- 既存DBへ後から反映する場合に備えた追加列
alter table public.office_cases add column if not exists data_generated_at timestamptz;
alter table public.office_cases add column if not exists data_hash text;
alter table public.office_cases add column if not exists data_source text not null default '';
alter table public.office_cases add column if not exists application_method text not null default 'registryData';
DO $$
begin
  alter table public.office_cases
    add constraint office_cases_application_method_check
    check (application_method in ('registryData', 'letterPack'));
exception when duplicate_object then null;
end $$;
create index if not exists office_cases_office_due_idx on public.office_cases (office_id, due_date, created_at desc);
create index if not exists office_members_user_idx on public.office_members (user_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists office_cases_touch_updated_at on public.office_cases;
create trigger office_cases_touch_updated_at
before update on public.office_cases
for each row execute function public.touch_updated_at();

create or replace function public.is_office_member(target_office_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.office_members m
    where m.office_id = target_office_id
      and m.user_id = (select auth.uid())
  );
$$;

alter table public.offices enable row level security;
alter table public.office_members enable row level security;
alter table public.office_cases enable row level security;

grant select on public.offices to authenticated;
grant select on public.office_members to authenticated;
grant select, insert, update, delete on public.office_cases to authenticated;
grant execute on function public.is_office_member(uuid) to authenticated;

-- 既存ポリシーがある場合の再実行に備えて削除
DROP POLICY IF EXISTS "Members can view their offices" ON public.offices;
DROP POLICY IF EXISTS "Members can view office members" ON public.office_members;
DROP POLICY IF EXISTS "Members can view office cases" ON public.office_cases;
DROP POLICY IF EXISTS "Members can insert office cases" ON public.office_cases;
DROP POLICY IF EXISTS "Members can update office cases" ON public.office_cases;
DROP POLICY IF EXISTS "Members can delete office cases" ON public.office_cases;

create policy "Members can view their offices"
on public.offices for select
to authenticated
using (public.is_office_member(id));

create policy "Members can view office members"
on public.office_members for select
to authenticated
using (public.is_office_member(office_id));

create policy "Members can view office cases"
on public.office_cases for select
to authenticated
using (public.is_office_member(office_id));

create policy "Members can insert office cases"
on public.office_cases for insert
to authenticated
with check (
  public.is_office_member(office_id)
  and created_by = (select auth.uid())
);

create policy "Members can update office cases"
on public.office_cases for update
to authenticated
using (public.is_office_member(office_id))
with check (public.is_office_member(office_id));

create policy "Members can delete office cases"
on public.office_cases for delete
to authenticated
using (public.is_office_member(office_id));

-- ============================================================
-- v1.3.17 追加：作成者・更新者の偽装防止
-- 作成者・作成日時・所属事務所は更新で変えられない。更新者はログイン中の本人で上書きする。
-- ============================================================
create or replace function public.guard_office_case_attribution()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- SQL Editor など、ログインユーザーがいない管理操作では指定値を使う
    new.created_by = coalesce((select auth.uid()), new.created_by);
    new.updated_by = coalesce((select auth.uid()), new.updated_by);
    new.created_at = now();
  else
    new.id = old.id;
    new.office_id = old.office_id;
    new.created_by = old.created_by;
    new.created_at = old.created_at;
    new.updated_by = coalesce((select auth.uid()), new.updated_by);
  end if;
  return new;
end;
$$;

drop trigger if exists office_cases_guard_attribution on public.office_cases;
create trigger office_cases_guard_attribution
before insert or update on public.office_cases
for each row execute function public.guard_office_case_attribution();

-- ============================================================
-- v1.3.17 追加：アクセスログ（事務所共有モード）
-- ・誰が・いつ・どの事務所で ログイン／閲覧／ログアウト／案件の追加・更新・削除 をしたかを残す
-- ・書き込みはDB側の関数とトリガーだけが行う（利用者は直接書けない・消せない）
-- ・見られるのは、その事務所の owner / admin だけ
-- ・案件の追加・更新・削除はDBトリガーが記録するので、アプリを通さない操作も漏れない
-- ・ログイン／閲覧／ログアウトはアプリからの申告（同じ操作は1分に1回まで）。
--   正式なログイン記録は Supabase の Authentication > Logs（Auth監査ログ）を正とする
-- ・案件名は削除時だけ残す（何が消えたか分かるように）。追加・更新は案件IDと変更項目だけ
-- ・1年を過ぎたログは自動で消す
-- ============================================================
create table if not exists public.office_access_logs (
  id bigint generated always as identity primary key,
  office_id uuid not null references public.offices(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('login', 'view', 'logout', 'case_insert', 'case_update', 'case_delete')),
  case_id uuid,
  detail jsonb not null default '{}'::jsonb,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists office_access_logs_office_created_idx on public.office_access_logs (office_id, created_at desc);

alter table public.office_access_logs enable row level security;
revoke all on public.office_access_logs from anon, authenticated;
grant select on public.office_access_logs to authenticated;

create or replace function public.is_office_admin(target_office_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.office_members m
    where m.office_id = target_office_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;
revoke all on function public.is_office_admin(uuid) from public, anon;
grant execute on function public.is_office_admin(uuid) to authenticated;

DROP POLICY IF EXISTS "Admins can view office access logs" ON public.office_access_logs;
create policy "Admins can view office access logs"
on public.office_access_logs for select
to authenticated
using (public.is_office_admin(office_id));

-- 案件の追加・更新・削除をトリガーで自動記録（アプリを経由しないAPI操作も残る）
create or replace function public.log_office_case_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.office_cases;
  changed text[];
begin
  if tg_op = 'DELETE' then
    target := old;
  else
    target := new;
  end if;
  -- 事務所ごと削除したとき（連鎖削除）は記録先がないので残さない
  if not exists (select 1 from public.offices where id = target.office_id) then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}')
      into changed
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value
       and n.key not in ('updated_at', 'updated_by');
  end if;
  insert into public.office_access_logs (office_id, user_id, action, case_id, detail, user_agent)
  values (
    target.office_id,
    (select auth.uid()),
    case tg_op when 'INSERT' then 'case_insert' when 'UPDATE' then 'case_update' else 'case_delete' end,
    target.id,
    jsonb_strip_nulls(jsonb_build_object(
      'label', case when tg_op = 'DELETE' then target.label end,
      'status', target.status,
      'changed', changed
    )),
    left(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'user-agent', ''), 300)
  );
  return null;
end;
$$;
revoke all on function public.log_office_case_change() from public, anon, authenticated;

drop trigger if exists office_cases_access_log on public.office_cases;
create trigger office_cases_access_log
after insert or update or delete on public.office_cases
for each row execute function public.log_office_case_change();

-- ログイン・閲覧・ログアウトはアプリからこの関数を呼んで記録する（所属事務所のみ・動作名は固定）
create or replace function public.log_office_access(target_office_id uuid, access_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if access_action not in ('login', 'view', 'logout') then
    raise exception 'invalid access action';
  end if;
  if not public.is_office_member(target_office_id) then
    raise exception 'not a member of this office';
  end if;
  -- 連打・大量記録の防止：同じ人・同じ事務所・同じ操作は1分に1回まで
  if exists (
    select 1 from public.office_access_logs
     where office_id = target_office_id
       and user_id = (select auth.uid())
       and action = access_action
       and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;
  -- 保存期間：1年を過ぎたログを消す
  delete from public.office_access_logs
   where office_id = target_office_id
     and created_at < now() - interval '1 year';
  insert into public.office_access_logs (office_id, user_id, action, user_agent)
  values (
    target_office_id,
    (select auth.uid()),
    access_action,
    left(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'user-agent', ''), 300)
  );
end;
$$;
revoke all on function public.log_office_access(uuid, text) from public, anon;
grant execute on function public.log_office_access(uuid, text) to authenticated;

-- ログの見方（SQL Editor。新しい順に100件）：
-- select l.created_at at time zone 'Asia/Tokyo' as 日時, m.display_name as 利用者, l.action as 操作,
--        l.detail ->> 'label' as 案件名, l.detail -> 'changed' as 変更項目, l.user_agent
--   from public.office_access_logs l
--   left join public.office_members m on m.office_id = l.office_id and m.user_id = l.user_id
--  order by l.created_at desc
--  limit 100;
--
-- 注意：事務所（offices）の行を削除すると、その事務所のログも一緒に消えます。
-- 閉鎖後も記録を残したい場合は、事務所を削除する前にログを書き出してください。

-- 初期設定例：
-- 1) Supabase Dashboard > Authentication > Users で先生・事務員さんのユーザーを作成
-- 2) 下記を実行して事務所を作る
-- insert into public.offices (name) values ('○○司法書士事務所') returning id;
-- 3) Users画面で各ユーザーのUUIDを確認し、事務所に紐づける
-- insert into public.office_members (office_id, user_id, role, display_name)
-- values ('上で返ってきたoffice id', 'ユーザーUUID', 'owner', '先生の表示名');
