-- Igralci brez Supabase seje.
--
-- Zakaj: skupni projekt ima na auth.users sprožilec check_allowed_email
-- (registracija samo s povabilom), ki anonimne prijave zavrne; če bi ga
-- omilili, bi anonimne seje dobile vlogo `authenticated` v vseh aplikacijah
-- huba. Zato igralec ob pridružitvi dobi skrivni žeton (shrani se v telefon)
-- in vse dela prek RPC funkcij z žetonom (vloga anon). Telefone o spremembah
-- obvešča sprožilec z realtime.send (javni broadcast „kviz:<room_id>“, prazen
-- signal → telefon ponovno prebere stanje s kviz_player_state).

drop policy if exists "kviz_rooms_read" on public.kviz_rooms;
drop policy if exists "kviz_teams_read" on public.kviz_teams;

drop function if exists public.kviz_join(text, text);
drop function if exists public.kviz_create_team(uuid, text);
drop function if exists public.kviz_join_team(uuid, uuid);
drop function if exists public.kviz_answer(uuid, int, text);
drop function if exists public.kviz_scoreboard(uuid);

drop table public.kviz_answers;
drop table public.kviz_players;

drop function if exists public.kviz_in_room(uuid);
drop function if exists public.kviz_my_team(uuid);

alter publication supabase_realtime drop table public.kviz_rooms, public.kviz_teams;

create table public.kviz_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.kviz_rooms (id) on delete cascade,
  team_id uuid references public.kviz_teams (id) on delete set null,
  nickname text not null check (char_length(nickname) between 1 and 30),
  token uuid not null unique default gen_random_uuid(),
  joined_at timestamptz not null default now()
);
create index kviz_players_room_idx on public.kviz_players (room_id);
create index kviz_players_team_idx on public.kviz_players (team_id);

create table public.kviz_answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.kviz_rooms (id) on delete cascade,
  question_id uuid not null references public.kviz_questions (id) on delete cascade,
  team_id uuid not null references public.kviz_teams (id) on delete cascade,
  player_id uuid references public.kviz_players (id) on delete set null,
  nickname text,
  choice_index int,
  text_answer text check (char_length(text_answer) <= 200),
  is_correct boolean,
  points int not null default 0,
  updated_at timestamptz not null default now(),
  unique (room_id, question_id, team_id)
);
create index kviz_answers_team_idx on public.kviz_answers (team_id);
create index kviz_answers_question_idx on public.kviz_answers (question_id);
create index kviz_answers_player_idx on public.kviz_answers (player_id);

alter table public.kviz_players enable row level security;
alter table public.kviz_answers enable row level security;

-- Neposredno branje iger samo za voditelja; igralci gredo prek RPC.
create policy "kviz_rooms_host" on public.kviz_rooms
  for select to authenticated
  using (host_id = (select auth.uid()));

create policy "kviz_teams_host" on public.kviz_teams
  for select to authenticated
  using ((select public.kviz_is_host(room_id)));

create policy "kviz_players_host" on public.kviz_players
  for select to authenticated
  using ((select public.kviz_is_host(room_id)));

create policy "kviz_answers_host" on public.kviz_answers
  for select to authenticated
  using ((select public.kviz_is_host(room_id)));

-- Žeton igralca ni berljiv niti voditelju.
revoke all on public.kviz_players from anon, authenticated;
grant select (id, room_id, team_id, nickname, joined_at) on public.kviz_players to authenticated;

-- ============ Signal za telefone in oder ============

create or replace function public.kviz_ping_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid text;
begin
  if tg_table_name = 'kviz_rooms' then
    rid := coalesce(new.id, old.id)::text;
  else
    rid := (to_jsonb(coalesce(new, old)) ->> 'room_id');
  end if;
  if rid is not null then
    perform realtime.send('{}'::jsonb, 'changed', 'kviz:' || rid, false);
  end if;
  return null;
end;
$$;

create or replace function public.kviz_ping_answers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid;
begin
  for rid in select distinct room_id from changed loop
    perform realtime.send('{}'::jsonb, 'changed', 'kviz:' || rid::text, false);
  end loop;
  return null;
end;
$$;

revoke execute on function public.kviz_ping_row(), public.kviz_ping_answers() from public, anon, authenticated;

create trigger kviz_rooms_ping after insert or update or delete on public.kviz_rooms
  for each row execute function public.kviz_ping_row();
create trigger kviz_teams_ping after insert or update or delete on public.kviz_teams
  for each row execute function public.kviz_ping_row();
create trigger kviz_players_ping after insert or update or delete on public.kviz_players
  for each row execute function public.kviz_ping_row();
-- Ocenjevanje posodobi vse odgovore naenkrat → en signal na stavek.
create trigger kviz_answers_ping_ins after insert on public.kviz_answers
  referencing new table as changed
  for each statement execute function public.kviz_ping_answers();
create trigger kviz_answers_ping_upd after update on public.kviz_answers
  referencing new table as changed
  for each statement execute function public.kviz_ping_answers();

-- ============ Igralec (prek žetona) ============

-- Pridruži se s kodo; z obstoječim žetonom iste sobe samo posodobi vzdevek.
create or replace function public.kviz_join(p_code text, p_nickname text, p_token uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rid uuid;
  pl public.kviz_players;
  nick text := left(trim(coalesce(p_nickname, '')), 30);
begin
  if nick = '' then
    raise exception 'Vpiši vzdevek.';
  end if;
  select id into rid from public.kviz_rooms
  where code = upper(trim(coalesce(p_code, ''))) and state <> 'finished';
  if rid is null then
    raise exception 'Soba s to kodo ne obstaja ali je že končana.';
  end if;

  if p_token is not null then
    update public.kviz_players set nickname = nick
    where token = p_token and room_id = rid
    returning * into pl;
  end if;
  if pl.id is null then
    insert into public.kviz_players (room_id, nickname) values (rid, nick) returning * into pl;
  end if;
  return jsonb_build_object('token', pl.token, 'room_id', rid);
end;
$$;

create or replace function public.kviz_player_by_token(p_token uuid)
returns public.kviz_players
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pl public.kviz_players;
begin
  select * into pl from public.kviz_players where token = p_token;
  if pl.id is null then
    raise exception 'Nisi več v tej sobi.';
  end if;
  return pl;
end;
$$;

-- Celotno stanje za telefon v enem klicu.
create or replace function public.kviz_player_state(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pl public.kviz_players;
  r public.kviz_rooms;
  qid uuid;
begin
  pl := public.kviz_player_by_token(p_token);
  select * into r from public.kviz_rooms where id = pl.room_id;
  qid := r.question_ids[r.q_index + 1];

  return jsonb_build_object(
    'room', jsonb_build_object(
      'id', r.id, 'code', r.code, 'title', r.title, 'state', r.state,
      'current', r."current", 'reveal', r.reveal
    ),
    'me', jsonb_build_object('id', pl.id, 'nickname', pl.nickname, 'team_id', pl.team_id),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name,
        'players', coalesce((select jsonb_agg(p.nickname order by p.joined_at)
                             from public.kviz_players p where p.team_id = t.id), '[]'::jsonb)
      ) order by t.created_at)
      from public.kviz_teams t where t.room_id = r.id
    ), '[]'::jsonb),
    'answer', (
      select jsonb_build_object(
        'choice_index', a.choice_index, 'text_answer', a.text_answer, 'nickname', a.nickname,
        'is_correct', case when r.state = 'question' then null else a.is_correct end,
        'points', case when r.state = 'question' then null else a.points end
      )
      from public.kviz_answers a
      where a.room_id = r.id and a.question_id = qid and a.team_id = pl.team_id
        and r.state in ('question', 'reveal')
    ),
    'scoreboard', coalesce((
      select jsonb_agg(jsonb_build_object('team_id', s.id, 'name', s.name, 'score', s.score)
                       order by s.score desc, s.created_at)
      from (
        select t.id, t.name, t.created_at,
          coalesce((select sum(a.points) from public.kviz_answers a where a.team_id = t.id), 0)::int as score
        from public.kviz_teams t where t.room_id = r.id
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.kviz_create_team(p_token uuid, p_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pl public.kviz_players;
  tid uuid;
  nm text := left(trim(coalesce(p_name, '')), 40);
begin
  pl := public.kviz_player_by_token(p_token);
  if nm = '' then
    raise exception 'Vpiši ime ekipe.';
  end if;
  if exists (select 1 from public.kviz_teams where room_id = pl.room_id and lower(name) = lower(nm)) then
    raise exception 'Ekipa s tem imenom že obstaja.';
  end if;
  insert into public.kviz_teams (room_id, name) values (pl.room_id, nm) returning id into tid;
  update public.kviz_players set team_id = tid where id = pl.id;
  return tid;
end;
$$;

create or replace function public.kviz_join_team(p_token uuid, p_team uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pl public.kviz_players;
begin
  pl := public.kviz_player_by_token(p_token);
  if not exists (select 1 from public.kviz_teams where id = p_team and room_id = pl.room_id) then
    raise exception 'Ekipa ne obstaja.';
  end if;
  update public.kviz_players set team_id = p_team where id = pl.id;
end;
$$;

-- Oddaj (ali spremeni) odgovor ekipe na trenutno vprašanje.
create or replace function public.kviz_answer(p_token uuid, p_choice int default null, p_text text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pl public.kviz_players;
  r public.kviz_rooms;
  q public.kviz_questions;
  txt text := left(trim(coalesce(p_text, '')), 200);
begin
  pl := public.kviz_player_by_token(p_token);
  if pl.team_id is null then
    raise exception 'Najprej izberi ekipo.';
  end if;
  select * into r from public.kviz_rooms where id = pl.room_id;
  if r.state <> 'question' then
    raise exception 'Odgovarjanje je zaprto.';
  end if;
  select * into q from public.kviz_questions where id = r.question_ids[r.q_index + 1];

  if q.type = 'choice' then
    if p_choice is null or p_choice < 0 or p_choice >= cardinality(q.options) then
      raise exception 'Neveljaven odgovor.';
    end if;
    txt := null;
  else
    if txt = '' then
      raise exception 'Vpiši odgovor.';
    end if;
    p_choice := null;
  end if;

  insert into public.kviz_answers (room_id, question_id, team_id, player_id, nickname, choice_index, text_answer)
  values (r.id, q.id, pl.team_id, pl.id, pl.nickname, p_choice, txt)
  on conflict (room_id, question_id, team_id) do update
    set player_id = excluded.player_id, nickname = excluded.nickname,
        choice_index = excluded.choice_index, text_answer = excluded.text_answer,
        updated_at = now();
end;
$$;

-- ============ Voditelj ============

create or replace function public.kviz_scoreboard(p_room uuid)
returns table (team_id uuid, name text, score int, players int)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.name,
    coalesce((select sum(a.points) from public.kviz_answers a where a.team_id = t.id), 0)::int,
    (select count(*) from public.kviz_players p where p.team_id = t.id)::int
  from public.kviz_teams t
  where t.room_id = p_room and public.kviz_is_host(p_room)
  order by 3 desc, t.created_at
$$;

-- Voditelj: odstrani igralca (npr. podvojen telefon).
create or replace function public.kviz_kick(p_player uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rid uuid;
begin
  select room_id into rid from public.kviz_players where id = p_player;
  if rid is null or not public.kviz_is_host(rid) then
    raise exception 'Igralec ne obstaja.';
  end if;
  delete from public.kviz_players where id = p_player;
end;
$$;

revoke execute on function
  public.kviz_join(text, text, uuid), public.kviz_player_by_token(uuid), public.kviz_player_state(uuid),
  public.kviz_create_team(uuid, text), public.kviz_join_team(uuid, uuid),
  public.kviz_answer(uuid, int, text), public.kviz_scoreboard(uuid), public.kviz_kick(uuid)
from public;

revoke execute on function public.kviz_player_by_token(uuid) from anon, authenticated;

-- Igralske funkcije so namenoma javne (vloga anon): zaščita je skrivni žeton.
grant execute on function
  public.kviz_join(text, text, uuid), public.kviz_player_state(uuid),
  public.kviz_create_team(uuid, text), public.kviz_join_team(uuid, uuid),
  public.kviz_answer(uuid, int, text)
to anon, authenticated;

revoke execute on function public.kviz_scoreboard(uuid), public.kviz_kick(uuid) from anon;
grant execute on function public.kviz_scoreboard(uuid), public.kviz_kick(uuid) to authenticated;
