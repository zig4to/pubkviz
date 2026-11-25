-- Točkovanje klasičnega kviza (listki): voditelj na strani /oder/KODA/tocke
-- sam ustvari ekipe in za vsako vprašanje označi pravilno / narobe.
-- Ocene živijo v kviz_answers (is_correct, points = točke vprašanja), zato
-- kviz_scoreboard sešteje točke kot pri telefonskem kvizu. Sprožilci
-- kviz_ping_* že obstajajo → oder in drugi zasloni se osvežijo sami.
-- Samo za sobe z mode = 'classic' (pri telefonskem bi kviz_grade ob
-- razkritju ročne ocene prepisal).

create or replace function public.kviz_host_add_team(p_room uuid, p_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  nm text := left(trim(coalesce(p_name, '')), 40);
  new_id uuid;
begin
  if not public.kviz_is_host(p_room) then
    raise exception 'Soba ne obstaja.';
  end if;
  if (select mode from public.kviz_rooms where id = p_room) <> 'classic' then
    raise exception 'Ročno točkovanje je samo za klasični kviz.';
  end if;
  if nm = '' then
    raise exception 'Vpiši ime ekipe.';
  end if;
  if exists (select 1 from public.kviz_teams where room_id = p_room and lower(name) = lower(nm)) then
    raise exception 'Ekipa s tem imenom že obstaja.';
  end if;
  if (select count(*) from public.kviz_teams where room_id = p_room) >= 60 then
    raise exception 'Preveč ekip.';
  end if;
  insert into public.kviz_teams (room_id, name) values (p_room, nm) returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.kviz_host_rename_team(p_team uuid, p_name text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.kviz_teams;
  nm text := left(trim(coalesce(p_name, '')), 40);
begin
  select * into t from public.kviz_teams where id = p_team;
  if t.id is null or not public.kviz_is_host(t.room_id) then
    raise exception 'Ekipa ne obstaja.';
  end if;
  if nm = '' then
    raise exception 'Vpiši ime ekipe.';
  end if;
  if exists (select 1 from public.kviz_teams
             where room_id = t.room_id and id <> t.id and lower(name) = lower(nm)) then
    raise exception 'Ekipa s tem imenom že obstaja.';
  end if;
  update public.kviz_teams set name = nm where id = t.id;
end;
$$;

create or replace function public.kviz_host_delete_team(p_team uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.kviz_teams;
begin
  select * into t from public.kviz_teams where id = p_team;
  if t.id is null or not public.kviz_is_host(t.room_id) then
    raise exception 'Ekipa ne obstaja.';
  end if;
  delete from public.kviz_teams where id = t.id;
end;
$$;

-- Delne točke: vprašanje z deli (kviz_questions.parts = oznake delov, npr.
-- miks: izvajalec 1, naslov 1, izvajalec 2, naslov 2) se točkuje po delih,
-- vsak del je vreden points / število delov (miks: 2 / 4 = ½).
alter table public.kviz_questions
  add column parts text[] not null default '{}' check (cardinality(parts) <= 8);
alter table public.kviz_answers
  alter column points type numeric(6, 2),
  add column parts boolean[];

-- Miksi v „Garaža pub kviz“: ½ točke za vsakega izvajalca in vsak naslov.
update public.kviz_questions q
set parts = array['Izvajalec 1', 'Naslov 1', 'Izvajalec 2', 'Naslov 2']
from public.kviz_categories c
where c.id = q.category_id and c.name = 'Ugani miks skladb';

-- p_correct: true = pravilno (vse točke vprašanja), false = narobe (0),
-- null = še neocenjeno. Pri vprašanju z deli p_parts (po en element na del,
-- null = neocenjen del) določi točke, p_correct se izračuna.
create or replace function public.kviz_host_mark(p_team uuid, p_question uuid, p_correct boolean, p_parts boolean[] default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.kviz_teams;
  r public.kviz_rooms;
  q public.kviz_questions;
  n int;
  pts numeric;
begin
  select * into t from public.kviz_teams where id = p_team;
  if t.id is null or not public.kviz_is_host(t.room_id) then
    raise exception 'Ekipa ne obstaja.';
  end if;
  select * into r from public.kviz_rooms where id = t.room_id;
  if r.mode <> 'classic' then
    raise exception 'Ročno točkovanje je samo za klasični kviz.';
  end if;
  if not (p_question = any (r.question_ids)) then
    raise exception 'Vprašanje ni v tej igri.';
  end if;
  select * into q from public.kviz_questions where id = p_question;
  n := cardinality(q.parts);

  if n > 0 then
    if p_parts is null then
      -- Celotno vprašanje naenkrat: vsi deli pravilni / narobe / neocenjeni.
      p_parts := array_fill(p_correct, array[n]);
    end if;
    if cardinality(p_parts) <> n then
      raise exception 'Napačno število delov.';
    end if;
    pts := round(q.points::numeric * (select count(*) from unnest(p_parts) x where x) / n, 2);
    p_correct := case
      when (select bool_and(x) from unnest(p_parts) x) is true then true
      when (select count(*) from unnest(p_parts) x where x is not null) = n then false
      when (select count(*) from unnest(p_parts) x where x is not null) = 0 then null
      else false
    end;
  else
    p_parts := null;
    pts := case when p_correct then q.points else 0 end;
  end if;

  insert into public.kviz_answers (room_id, question_id, team_id, is_correct, points, parts, updated_at)
  values (r.id, p_question, t.id, p_correct, pts, p_parts, now())
  on conflict (room_id, question_id, team_id) do update
    set is_correct = excluded.is_correct, points = excluded.points, parts = excluded.parts, updated_at = now();
end;
$$;

revoke execute on function
  public.kviz_host_add_team(uuid, text), public.kviz_host_rename_team(uuid, text),
  public.kviz_host_delete_team(uuid), public.kviz_host_mark(uuid, uuid, boolean, boolean[])
from public, anon;
grant execute on function
  public.kviz_host_add_team(uuid, text), public.kviz_host_rename_team(uuid, text),
  public.kviz_host_delete_team(uuid), public.kviz_host_mark(uuid, uuid, boolean, boolean[])
to authenticated;

-- ============ Izžrebane ekipe (shranjene za vse kvize) ============
-- Žrebanje (/zrebanje) ob vsakem žrebu prijavljenega voditelja zamenja
-- njegov shranjeni nabor ekip. Nabor ostane, dokler ga v adminu ne izbriše,
-- in ga lahko z enim klikom uvozi v katerokoli klasično sobo.

create table public.kviz_saved_teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  position int not null default 0,
  name text not null check (char_length(name) between 1 and 40),
  members text[] not null default '{}' check (cardinality(members) <= 50),
  created_at timestamptz not null default now()
);
create index kviz_saved_teams_owner_idx on public.kviz_saved_teams (owner_id, position);

alter table public.kviz_saved_teams enable row level security;

create policy "kviz_saved_teams_own" on public.kviz_saved_teams
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (select public.kviz_is_real_user()));

-- Zamenja ves nabor naenkrat. p_teams = [{name, members:[…]}, …]
create or replace function public.kviz_save_teams(p_teams jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.kviz_is_real_user() then
    raise exception 'Za shranjevanje ekip se prijavi.';
  end if;
  if jsonb_typeof(p_teams) <> 'array' or jsonb_array_length(p_teams) > 60 then
    raise exception 'Neveljaven seznam ekip.';
  end if;
  delete from public.kviz_saved_teams where owner_id = auth.uid();
  insert into public.kviz_saved_teams (owner_id, position, name, members)
  select auth.uid(), (e.ord - 1)::int,
    left(trim(e.value ->> 'name'), 40),
    coalesce((select array_agg(left(trim(m), 30)) from jsonb_array_elements_text(e.value -> 'members') m
              where trim(m) <> ''), '{}')
  from jsonb_array_elements(p_teams) with ordinality as e(value, ord)
  where trim(coalesce(e.value ->> 'name', '')) <> '';
end;
$$;

-- Uvozi shranjene ekipe v klasično sobo (obstoječa imena preskoči).
create or replace function public.kviz_host_import_teams(p_room uuid)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n int;
begin
  if not public.kviz_is_host(p_room) then
    raise exception 'Soba ne obstaja.';
  end if;
  if (select mode from public.kviz_rooms where id = p_room) <> 'classic' then
    raise exception 'Ročno točkovanje je samo za klasični kviz.';
  end if;
  -- clock_timestamp(): ekipe se na zaslonih razvrstijo po created_at, zato
  -- vsaka vrstica dobi svoj čas v vrstnem redu žreba.
  insert into public.kviz_teams (room_id, name, members, created_at)
  select p_room, x.name, x.members[1:15], clock_timestamp()
  from (
    select distinct on (lower(s.name)) s.name, s.members, s.position
    from public.kviz_saved_teams s
    where s.owner_id = auth.uid()
      and not exists (select 1 from public.kviz_teams t where t.room_id = p_room and lower(t.name) = lower(s.name))
    order by lower(s.name), s.position
  ) x
  order by x.position;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.kviz_save_teams(jsonb), public.kviz_host_import_teams(uuid) from public, anon;
grant execute on function public.kviz_save_teams(jsonb), public.kviz_host_import_teams(uuid) to authenticated;
