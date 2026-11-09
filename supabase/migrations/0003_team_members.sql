-- Člani ekipe brez telefona: kdorkoli iz ekipe lahko na svojem telefonu
-- dopiše imena soigralcev (samo za prikaz; odgovarja ekipa kot celota).

alter table public.kviz_teams
  add column members text[] not null default '{}'
  check (cardinality(members) <= 15);

create or replace function public.kviz_add_member(p_token uuid, p_name text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pl public.kviz_players;
  nm text := left(trim(coalesce(p_name, '')), 30);
  t public.kviz_teams;
begin
  pl := public.kviz_player_by_token(p_token);
  if pl.team_id is null then
    raise exception 'Najprej izberi ekipo.';
  end if;
  if nm = '' then
    raise exception 'Vpiši ime.';
  end if;
  select * into t from public.kviz_teams where id = pl.team_id for update;
  if exists (select 1 from unnest(t.members) m where lower(m) = lower(nm))
     or exists (select 1 from public.kviz_players p where p.team_id = t.id and lower(p.nickname) = lower(nm)) then
    raise exception 'To ime je že v ekipi.';
  end if;
  if cardinality(t.members) >= 15 then
    raise exception 'Ekipa ima že preveč članov.';
  end if;
  update public.kviz_teams set members = members || nm where id = t.id;
end;
$$;

create or replace function public.kviz_remove_member(p_token uuid, p_name text)
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
  if pl.team_id is null then
    raise exception 'Najprej izberi ekipo.';
  end if;
  update public.kviz_teams set members = array_remove(members, p_name) where id = pl.team_id;
end;
$$;

-- Stanje za telefon: ekipe vključujejo še `members`.
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
                             from public.kviz_players p where p.team_id = t.id), '[]'::jsonb),
        'members', to_jsonb(t.members)
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

-- Voditelj: odstrani dopisano ime (z odra).
create or replace function public.kviz_host_remove_member(p_team uuid, p_name text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rid uuid;
begin
  select room_id into rid from public.kviz_teams where id = p_team;
  if rid is null or not public.kviz_is_host(rid) then
    raise exception 'Ekipa ne obstaja.';
  end if;
  update public.kviz_teams set members = array_remove(members, p_name) where id = p_team;
end;
$$;

revoke execute on function
  public.kviz_add_member(uuid, text), public.kviz_remove_member(uuid, text),
  public.kviz_host_remove_member(uuid, text)
from public;
grant execute on function public.kviz_add_member(uuid, text), public.kviz_remove_member(uuid, text)
  to anon, authenticated;
revoke execute on function public.kviz_host_remove_member(uuid, text) from anon;
grant execute on function public.kviz_host_remove_member(uuid, text) to authenticated;
