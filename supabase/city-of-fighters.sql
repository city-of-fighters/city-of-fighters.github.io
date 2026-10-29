-- City of Fighters database. Paste into Supabase → SQL Editor, change the password on the last line, Run.
-- Tables are locked; the website only uses the functions below. Emails are only returned with the admin password.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.cof_players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 24),
  email text not null check (char_length(email) between 3 and 120),
  created_at timestamptz not null default now()
);
create unique index if not exists cof_players_name on public.cof_players (lower(name));
create unique index if not exists cof_players_email on public.cof_players (lower(email));

-- One row: settings, seeding order and the whole bracket as JSON.
create table if not exists public.cof_state (id int primary key check (id = 1), data jsonb not null);
create table if not exists public.cof_admin (id int primary key check (id = 1), pass_hash text not null);

alter table public.cof_players enable row level security; -- no policies: no direct access
alter table public.cof_state enable row level security;
alter table public.cof_admin enable row level security;
revoke all on public.cof_players, public.cof_state, public.cof_admin from anon, authenticated;

create or replace function public.cof_default() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'name', 'City of Fighters', 'game', 'Tekken 8', 'regOpen', true, 'streamMatch', null,
    'matches', '[]'::jsonb, 'order', '[]'::jsonb,
    'rules', E'Tekken 8, latest patch. Double elimination.\nEvery match is first to 2 games. Every game is first to 3 rounds.\nWinner of a game must keep their character; loser may switch.\nBe on time: 10 minutes late to a called match is a loss.\nPausing without a reason costs the round. Respect your opponent.')
$$;
insert into public.cof_state values (1, public.cof_default()) on conflict (id) do nothing;

create or replace function public.cof_check(p_pw text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from cof_admin where pass_hash = crypt('CHANGE-ME', pass_hash)) then
    raise exception 'Set a real password in Supabase first (last line of city-of-fighters.sql)';
  end if;
  if not exists (select 1 from cof_admin where pass_hash = crypt(coalesce(p_pw, ''), pass_hash)) then
    perform pg_sleep(1); -- slows down password guessing
    raise exception 'Wrong password';
  end if;
end $$;

create or replace function public.cof_view(p_emails boolean) returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object('data', s.data, 'players', coalesce((
    select jsonb_agg(case when p_emails then jsonb_build_object('id', p.id, 'name', p.name, 'email', p.email)
                          else jsonb_build_object('id', p.id, 'name', p.name) end order by p.created_at)
    from cof_players p), '[]'::jsonb))
  from cof_state s where s.id = 1
$$;

create or replace function public.cof_public() returns jsonb
language sql security definer set search_path = public stable as $$ select cof_view(false) $$;

create or replace function public.cof_register(p_name text, p_email text, p_agree boolean) returns int
language plpgsql security definer set search_path = public as $$
declare d jsonb; pid uuid; n int;
begin
  p_name := trim(coalesce(p_name, '')); p_email := lower(trim(coalesce(p_email, '')));
  select data into d from cof_state where id = 1 for update;
  if not (d->>'regOpen')::boolean or jsonb_array_length(d->'matches') > 0 then raise exception 'Registration is closed'; end if;
  if char_length(p_name) not between 2 and 24 then raise exception 'Gamer tag must be 2–24 characters'; end if;
  if p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(p_email) > 120 then raise exception 'Enter a valid email'; end if;
  if p_agree is not true then raise exception 'You must accept the rules'; end if;
  if exists (select 1 from cof_players where lower(name) = lower(p_name)) then raise exception 'That gamer tag is taken'; end if;
  if exists (select 1 from cof_players where lower(email) = p_email) then raise exception 'That email is already registered'; end if;
  select count(*) into n from cof_players;
  if n >= 256 then raise exception 'The tournament is full'; end if;
  insert into cof_players (name, email) values (p_name, p_email) returning id into pid;
  update cof_state set data = jsonb_set(data, '{order}', (data->'order') || to_jsonb(pid::text)) where id = 1;
  return n + 1;
end $$;

create or replace function public.cof_admin_get(p_pw text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin perform cof_check(p_pw); return cof_view(true); end $$;

-- Saves settings and bracket. The seeding order always keeps exactly the registered players,
-- so a sign-up arriving while the admin page is open is never lost.
create or replace function public.cof_admin_save(p_pw text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare ord jsonb;
begin
  perform cof_check(p_pw);
  if jsonb_typeof(p_data) <> 'object' or jsonb_typeof(p_data->'matches') <> 'array'
     or jsonb_typeof(p_data->'order') <> 'array' or octet_length(p_data::text) > 500000 then
    raise exception 'Bad data';
  end if;
  ord := coalesce((select jsonb_agg(x) from jsonb_array_elements_text(p_data->'order') x
                   where exists (select 1 from cof_players where id::text = x)), '[]'::jsonb)
      || coalesce((select jsonb_agg(id::text order by created_at) from cof_players
                   where not (p_data->'order') ? id::text), '[]'::jsonb);
  update cof_state set data = jsonb_set(p_data, '{order}', ord) where id = 1;
end $$;

create or replace function public.cof_admin_remove(p_pw text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cof_check(p_pw);
  if exists (select 1 from cof_state where id = 1 and jsonb_array_length(data->'matches') > 0) then
    raise exception 'Bracket already started';
  end if;
  delete from cof_players where id = p_id;
  update cof_state set data = jsonb_set(data, '{order}', data->'order' - p_id::text) where id = 1;
end $$;

create or replace function public.cof_admin_reset(p_pw text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cof_check(p_pw);
  delete from cof_players where true;
  update cof_state set data = cof_default() where id = 1;
end $$;

revoke all on function public.cof_default(), public.cof_check(text), public.cof_view(boolean) from public, anon, authenticated;
grant execute on function public.cof_public(), public.cof_register(text, text, boolean), public.cof_admin_get(text),
  public.cof_admin_save(text, jsonb), public.cof_admin_remove(text, uuid), public.cof_admin_reset(text) to anon;

-- Control panel password: change CHANGE-ME in the Supabase SQL Editor only, never save your password in this file (it is public on GitHub).
insert into public.cof_admin values (1, extensions.crypt('CHANGE-ME', extensions.gen_salt('bf')))
  on conflict (id) do update set pass_hash = excluded.pass_hash;
