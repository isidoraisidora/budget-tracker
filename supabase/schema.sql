create table if not exists public.accounts (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  type text not null check (type in ('cash', 'card')),
  balance numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create table if not exists public.goals (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  target numeric(12, 2) not null check (target > 0),
  saved numeric(12, 2) not null default 0 check (saved >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create table if not exists public.transactions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('expense', 'deposit', 'withdrawal', 'payment', 'saving')),
  amount numeric(12, 2) not null check (amount > 0),
  date date not null,
  category text check (category in ('Food', 'Clothes', 'Coffee', 'Travelling', 'Other')),
  account_id uuid,
  destination_account_id uuid,
  goal_id uuid,
  source_label text,
  comment text,
  account_name_snapshot text,
  destination_account_name_snapshot text,
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create index if not exists accounts_user_id_idx on public.accounts (user_id);
create index if not exists goals_user_id_idx on public.goals (user_id);
create index if not exists transactions_user_date_idx on public.transactions (user_id, date desc);

alter table public.accounts enable row level security;
alter table public.goals enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "Users manage their own accounts" on public.accounts;
create policy "Users manage their own accounts" on public.accounts
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own goals" on public.goals;
create policy "Users manage their own goals" on public.goals
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own transactions" on public.transactions;
create policy "Users manage their own transactions" on public.transactions
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.accounts to authenticated;
grant select, insert, update, delete on public.goals to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;

create or replace function public.save_budget_state(
  p_accounts jsonb,
  p_goals jsonb,
  p_transactions jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  delete from public.transactions where user_id = auth.uid();
  delete from public.accounts where user_id = auth.uid();
  delete from public.goals where user_id = auth.uid();

  insert into public.accounts (id, user_id, name, type, balance)
  select id, auth.uid(), name, type, balance
  from jsonb_to_recordset(coalesce(p_accounts, '[]'::jsonb))
    as input_rows(id uuid, name text, type text, balance numeric);

  insert into public.goals (id, user_id, name, target, saved)
  select id, auth.uid(), name, target, saved
  from jsonb_to_recordset(coalesce(p_goals, '[]'::jsonb))
    as input_rows(id uuid, name text, target numeric, saved numeric);

  insert into public.transactions (
    id, user_id, type, amount, date, category, account_id,
    destination_account_id, goal_id, source_label, comment,
    account_name_snapshot, destination_account_name_snapshot
  )
  select
    id, auth.uid(), type, amount, date, category, account_id,
    destination_account_id, goal_id, source_label, comment,
    account_name_snapshot, destination_account_name_snapshot
  from jsonb_to_recordset(coalesce(p_transactions, '[]'::jsonb))
    as input_rows(
      id uuid, type text, amount numeric, date date, category text,
      account_id uuid, destination_account_id uuid, goal_id uuid,
      source_label text, comment text, account_name_snapshot text,
      destination_account_name_snapshot text
    );
end;
$$;

grant execute on function public.save_budget_state(jsonb, jsonb, jsonb) to authenticated;
