-- Dodatna vprašanja za izenačenje („kdor je bližji, zmaga“), ločeno od
-- kategorij in vprašanj kviza: ne štejejo v točke, oder jih pokaže pred
-- končnimi rezultati, če imata dve ali več ekip enako število točk.
-- Voditelj samo izbere, katera ekipa je bila bližje → kviz_teams.tiebreak
-- (vrstni red znotraj izenačene skupine: 1 = zmagovalec izenačenja; null =
-- še neodločeno). Razvrstitev: točke padajoče, nato tiebreak naraščajoče
-- (null zadnji). Vprašanja se porabljajo po vrsti (position).

create table public.kviz_tiebreakers (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.kviz_quizzes (id) on delete cascade,
  position int not null default 0,
  prompt text not null check (char_length(prompt) between 1 and 500),
  answer text not null check (char_length(answer) between 1 and 200),
  explanation text check (char_length(explanation) <= 300),
  created_at timestamptz not null default now()
);

create index kviz_tiebreakers_quiz_idx on public.kviz_tiebreakers (quiz_id, position);

alter table public.kviz_tiebreakers enable row level security;

create policy "kviz_tiebreakers_own" on public.kviz_tiebreakers
  for all to authenticated
  using ((select public.kviz_owns_quiz(quiz_id)))
  with check ((select public.kviz_owns_quiz(quiz_id)));

alter table public.kviz_teams add column tiebreak int;

-- Voditelj: ekipa je zmagala izenačenje → dobi naslednje mesto v svoji
-- izenačeni skupini (najmanjši še prosti tiebreak med ekipami z enakimi točkami).
create or replace function public.kviz_host_tiebreak_win(p_team uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.kviz_teams;
  r public.kviz_rooms;
  score numeric;
  next_rank int;
begin
  select * into t from public.kviz_teams where id = p_team for update;
  if t.id is null or not public.kviz_is_host(t.room_id) then
    raise exception 'Ekipa ne obstaja.';
  end if;
  select * into r from public.kviz_rooms where id = t.room_id;
  if r.mode <> 'classic' then
    raise exception 'Izenačenje je samo za klasični kviz.';
  end if;
  if t.tiebreak is not null then
    return;
  end if;

  score := coalesce((select sum(a.points) from public.kviz_answers a where a.team_id = t.id), 0);
  select coalesce(max(o.tiebreak), 0) + 1 into next_rank
  from public.kviz_teams o
  where o.room_id = t.room_id
    and o.tiebreak is not null
    and coalesce((select sum(a.points) from public.kviz_answers a where a.team_id = o.id), 0) = score;

  update public.kviz_teams set tiebreak = next_rank where id = t.id;
end;
$$;

-- Voditelj: ponastavi vse odločitve izenačenj v sobi.
create or replace function public.kviz_host_tiebreak_reset(p_room uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.kviz_is_host(p_room) then
    raise exception 'Soba ne obstaja.';
  end if;
  update public.kviz_teams set tiebreak = null where room_id = p_room;
end;
$$;

revoke execute on function public.kviz_host_tiebreak_win(uuid), public.kviz_host_tiebreak_reset(uuid)
  from public, anon;
grant execute on function public.kviz_host_tiebreak_win(uuid), public.kviz_host_tiebreak_reset(uuid)
  to authenticated;
