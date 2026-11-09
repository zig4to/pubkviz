-- Kviz: pub kviz. Admin (prijavljen uporabnik) ureja kvize → kategorije →
-- vprašanja. Voditelj odpre sobo s kodo, igralci (anonimne seje) se pridružijo
-- in igrajo v ekipah. Vsa logika igre teče v security definer funkcijah, zato
-- igralci nikoli ne vidijo pravilnih odgovorov pred razkritjem.

-- ============ Urejevalnik ============

create table public.kviz_quizzes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'Nov kviz' check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.kviz_categories (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.kviz_quizzes (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.kviz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.kviz_quizzes (id) on delete cascade,
  category_id uuid not null references public.kviz_categories (id) on delete cascade,
  position int not null default 0,
  type text not null default 'choice' check (type in ('choice', 'text')),
  prompt text not null check (char_length(prompt) between 1 and 500),
  image_path text check (char_length(image_path) <= 300),
  options text[] not null default '{}',
  correct_index int,
  accepted_answers text[] not null default '{}',
  points int not null default 1 check (points between 0 and 10),
  created_at timestamptz not null default now(),
  check (
    (type = 'choice' and cardinality(options) between 2 and 4
      and correct_index is not null and correct_index >= 0 and correct_index < cardinality(options))
    or (type = 'text' and cardinality(accepted_answers) >= 1)
  )
);

create index kviz_quizzes_owner_idx on public.kviz_quizzes (owner_id);
create index kviz_categories_quiz_idx on public.kviz_categories (quiz_id, position);
create index kviz_questions_quiz_idx on public.kviz_questions (quiz_id);
create index kviz_questions_category_idx on public.kviz_questions (category_id, position);

-- Anonimne seje (igralci) imajo vlogo `authenticated` — kvize lahko ureja
-- samo pravi (neanonimen) uporabnik.
create or replace function public.kviz_is_real_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

create or replace function public.kviz_owns_quiz(p_quiz uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.kviz_quizzes q
    where q.id = p_quiz and q.owner_id = (select auth.uid())
  )
$$;

alter table public.kviz_quizzes enable row level security;
alter table public.kviz_categories enable row level security;
alter table public.kviz_questions enable row level security;

create policy "kviz_quizzes_own" on public.kviz_quizzes
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (select public.kviz_is_real_user()));

create policy "kviz_categories_own" on public.kviz_categories
  for all to authenticated
  using ((select public.kviz_owns_quiz(quiz_id)))
  with check ((select public.kviz_owns_quiz(quiz_id)));

create policy "kviz_questions_own" on public.kviz_questions
  for all to authenticated
  using ((select public.kviz_owns_quiz(quiz_id)))
  with check (
    (select public.kviz_owns_quiz(quiz_id))
    and exists (select 1 from public.kviz_categories c where c.id = category_id and c.quiz_id = kviz_questions.quiz_id)
  );

-- ============ Igra ============

create table public.kviz_rooms (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.kviz_quizzes (id) on delete cascade,
  host_id uuid not null references auth.users (id) on delete cascade,
  code text not null unique,
  title text not null,
  state text not null default 'lobby'
    check (state in ('lobby', 'question', 'reveal', 'scoreboard', 'finished')),
  question_ids uuid[] not null,
  q_index int not null default -1,
  -- Očiščen posnetek trenutnega vprašanja (brez pravilnega odgovora).
  "current" jsonb,
  -- Pravilni odgovor + porazdelitev; nastavi se šele ob razkritju.
  reveal jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.kviz_teams (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.kviz_rooms (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);
create unique index kviz_teams_room_name_uq on public.kviz_teams (room_id, lower(name));

create table public.kviz_players (
  room_id uuid not null references public.kviz_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  team_id uuid references public.kviz_teams (id) on delete set null,
  nickname text not null check (char_length(nickname) between 1 and 30),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index kviz_players_user_idx on public.kviz_players (user_id);
create index kviz_players_team_idx on public.kviz_players (team_id);

create table public.kviz_answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.kviz_rooms (id) on delete cascade,
  question_id uuid not null references public.kviz_questions (id) on delete cascade,
  team_id uuid not null references public.kviz_teams (id) on delete cascade,
  player_id uuid references auth.users (id) on delete set null,
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
create index kviz_rooms_host_idx on public.kviz_rooms (host_id);
create index kviz_rooms_quiz_idx on public.kviz_rooms (quiz_id);

-- Pomočniki za RLS (definer, da se politike ne rekurzirajo).
create or replace function public.kviz_is_host(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.kviz_rooms r
    where r.id = p_room and r.host_id = (select auth.uid())
  )
$$;

create or replace function public.kviz_in_room(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.kviz_players p
    where p.room_id = p_room and p.user_id = (select auth.uid())
  )
$$;

create or replace function public.kviz_my_team(p_room uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.team_id from public.kviz_players p
  where p.room_id = p_room and p.user_id = (select auth.uid())
$$;

alter table public.kviz_rooms enable row level security;
alter table public.kviz_teams enable row level security;
alter table public.kviz_players enable row level security;
alter table public.kviz_answers enable row level security;

-- Samo branje; vse spremembe gredo prek funkcij spodaj.
create policy "kviz_rooms_read" on public.kviz_rooms
  for select to authenticated
  using (host_id = (select auth.uid()) or (select public.kviz_in_room(id)));

create policy "kviz_teams_read" on public.kviz_teams
  for select to authenticated
  using ((select public.kviz_is_host(room_id)) or (select public.kviz_in_room(room_id)));

create policy "kviz_players_read" on public.kviz_players
  for select to authenticated
  using ((select public.kviz_is_host(room_id)) or (select public.kviz_in_room(room_id)));

-- Igralec vidi samo odgovore svoje ekipe, voditelj vse.
create policy "kviz_answers_read" on public.kviz_answers
  for select to authenticated
  using ((select public.kviz_is_host(room_id)) or team_id = (select public.kviz_my_team(room_id)));

-- ============ Funkcije igre ============

-- Primerjava vpisanih odgovorov: male črke, brez šumnikov, ločil in presledkov.
create or replace function public.kviz_norm(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    translate(lower(trim(coalesce(p, ''))), 'čćšžđáàâäãéèêëíìîïóòôöõúùûüñ', 'ccszdaaaaaeeeeiiiiooooouuuun'),
    '[^a-z0-9]', '', 'g'
  )
$$;

-- Posnetek vprašanja za javni prikaz (brez correct_index / accepted_answers).
create or replace function public.kviz_snapshot(p_room public.kviz_rooms, p_index int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q public.kviz_questions;
  c public.kviz_categories;
  next_cat uuid;
  cat_ids uuid[];
  cat_pos int;
  cat_q_index int;
  cat_q_total int;
begin
  select * into q from public.kviz_questions where id = p_room.question_ids[p_index + 1];
  if q.id is null then
    return null;
  end if;
  select * into c from public.kviz_categories where id = q.category_id;

  -- Zaporedne kategorije v vrstnem redu sobe.
  select array_agg(cid order by first_idx) into cat_ids from (
    select qq.category_id as cid, min(t.ord) as first_idx
    from unnest(p_room.question_ids) with ordinality as t(qid, ord)
    join public.kviz_questions qq on qq.id = t.qid
    group by qq.category_id
  ) s;
  cat_pos := array_position(cat_ids, q.category_id);

  select count(*) filter (where t.ord <= p_index + 1), count(*)
    into cat_q_index, cat_q_total
  from unnest(p_room.question_ids) with ordinality as t(qid, ord)
  join public.kviz_questions qq on qq.id = t.qid
  where qq.category_id = q.category_id;

  select qq.category_id into next_cat from public.kviz_questions qq
  where qq.id = p_room.question_ids[p_index + 2];

  return jsonb_build_object(
    'question_id', q.id,
    'index', p_index,
    'total', cardinality(p_room.question_ids),
    'category', c.name,
    'category_index', cat_pos,
    'category_total', cardinality(cat_ids),
    'category_question', cat_q_index,
    'category_questions', cat_q_total,
    'type', q.type,
    'prompt', q.prompt,
    'image_path', q.image_path,
    'options', to_jsonb(case when q.type = 'choice' then q.options else '{}'::text[] end),
    'points', q.points,
    'last_in_category', next_cat is distinct from q.category_id
  );
end;
$$;

create or replace function public.kviz_new_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  loop
    v_code := '';
    for i in 1..5 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.kviz_rooms r where r.code = v_code);
  end loop;
  return v_code;
end;
$$;

-- Voditelj: odpre novo sobo za kviz, vrne kodo.
create or replace function public.kviz_open_room(p_quiz uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  qz public.kviz_quizzes;
  ids uuid[];
  new_code text;
begin
  if not public.kviz_is_real_user() then
    raise exception 'Za vodenje kviza se prijavi.';
  end if;
  select * into qz from public.kviz_quizzes where id = p_quiz and owner_id = auth.uid();
  if qz.id is null then
    raise exception 'Kviz ne obstaja.';
  end if;

  select array_agg(q.id order by c.position, c.created_at, q.position, q.created_at) into ids
  from public.kviz_questions q
  join public.kviz_categories c on c.id = q.category_id
  where q.quiz_id = p_quiz;

  if ids is null then
    raise exception 'Kviz nima vprašanj.';
  end if;

  new_code := public.kviz_new_code();
  insert into public.kviz_rooms (quiz_id, host_id, code, title, question_ids)
  values (p_quiz, auth.uid(), new_code, qz.title, ids);
  return new_code;
end;
$$;

-- Oceni odgovore trenutnega vprašanja in vrne objekt za razkritje.
create or replace function public.kviz_grade(p_room public.kviz_rooms)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  q public.kviz_questions;
  counts int[];
begin
  select * into q from public.kviz_questions where id = p_room.question_ids[p_room.q_index + 1];

  if q.type = 'choice' then
    update public.kviz_answers a
      set is_correct = (a.choice_index = q.correct_index),
          points = case when a.choice_index = q.correct_index then q.points else 0 end
    where a.room_id = p_room.id and a.question_id = q.id;

    select array_agg(coalesce(n, 0) order by i) into counts
    from generate_series(0, cardinality(q.options) - 1) i
    left join (
      select choice_index, count(*)::int n from public.kviz_answers
      where room_id = p_room.id and question_id = q.id
      group by choice_index
    ) s on s.choice_index = i;

    return jsonb_build_object('correct_index', q.correct_index, 'counts', to_jsonb(counts));
  else
    update public.kviz_answers a
      set is_correct = exists (
            select 1 from unnest(q.accepted_answers) acc
            where public.kviz_norm(acc) = public.kviz_norm(a.text_answer) and public.kviz_norm(acc) <> ''
          )
    where a.room_id = p_room.id and a.question_id = q.id;
    update public.kviz_answers a
      set points = case when a.is_correct then q.points else 0 end
    where a.room_id = p_room.id and a.question_id = q.id;

    return jsonb_build_object('accepted_answers', to_jsonb(q.accepted_answers));
  end if;
end;
$$;

-- Voditelj: en gumb „Naprej“ za ves potek
-- lobby → vprašanje → razkritje → (lestvica po kategoriji) → vprašanje … → konec.
create or replace function public.kviz_next(p_room uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.kviz_rooms;
  total int;
begin
  select * into r from public.kviz_rooms where id = p_room and host_id = auth.uid() for update;
  if r.id is null then
    raise exception 'Soba ne obstaja.';
  end if;
  total := cardinality(r.question_ids);

  if r.state = 'question' then
    update public.kviz_rooms set state = 'reveal', reveal = public.kviz_grade(r) where id = r.id;
    return 'reveal';
  end if;

  if r.state = 'reveal' then
    if r.q_index + 1 >= total then
      update public.kviz_rooms set state = 'finished', finished_at = now() where id = r.id;
      return 'finished';
    end if;
    if coalesce((r."current" ->> 'last_in_category')::boolean, false) then
      update public.kviz_rooms set state = 'scoreboard' where id = r.id;
      return 'scoreboard';
    end if;
  end if;

  if r.state in ('lobby', 'reveal', 'scoreboard') then
    if r.q_index + 1 >= total then
      update public.kviz_rooms set state = 'finished', finished_at = now() where id = r.id;
      return 'finished';
    end if;
    update public.kviz_rooms
      set state = 'question', q_index = r.q_index + 1, reveal = null,
          "current" = public.kviz_snapshot(r, r.q_index + 1)
    where id = r.id;
    return 'question';
  end if;

  return r.state;
end;
$$;

-- Voditelj: predčasno končaj igro.
create or replace function public.kviz_finish(p_room uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.kviz_rooms set state = 'finished', finished_at = coalesce(finished_at, now())
  where id = p_room and host_id = (select auth.uid())
$$;

-- Voditelj: ročni popravek ocene (npr. vpisan odgovor s tipkarsko napako).
create or replace function public.kviz_set_correct(p_answer uuid, p_correct boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.kviz_answers;
  q_points int;
begin
  select * into a from public.kviz_answers where id = p_answer;
  if a.id is null or not public.kviz_is_host(a.room_id) then
    raise exception 'Odgovor ne obstaja.';
  end if;
  select points into q_points from public.kviz_questions where id = a.question_id;
  update public.kviz_answers
    set is_correct = p_correct, points = case when p_correct then q_points else 0 end
  where id = p_answer;
end;
$$;

-- Igralec: pridruži se sobi s kodo (ali posodobi vzdevek). Vrne id sobe.
create or replace function public.kviz_join(p_code text, p_nickname text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rid uuid;
  nick text := left(trim(coalesce(p_nickname, '')), 30);
begin
  if auth.uid() is null then
    raise exception 'Ni seje.';
  end if;
  if nick = '' then
    raise exception 'Vpiši vzdevek.';
  end if;
  select id into rid from public.kviz_rooms
  where code = upper(trim(p_code)) and state <> 'finished';
  if rid is null then
    raise exception 'Soba s to kodo ne obstaja ali je že končana.';
  end if;
  insert into public.kviz_players (room_id, user_id, nickname)
  values (rid, auth.uid(), nick)
  on conflict (room_id, user_id) do update set nickname = excluded.nickname;
  return rid;
end;
$$;

-- Igralec: ustvari ekipo in se ji pridruži.
create or replace function public.kviz_create_team(p_room uuid, p_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  tid uuid;
  nm text := left(trim(coalesce(p_name, '')), 40);
begin
  if not public.kviz_in_room(p_room) then
    raise exception 'Nisi v tej sobi.';
  end if;
  if nm = '' then
    raise exception 'Vpiši ime ekipe.';
  end if;
  if exists (select 1 from public.kviz_teams where room_id = p_room and lower(name) = lower(nm)) then
    raise exception 'Ekipa s tem imenom že obstaja.';
  end if;
  insert into public.kviz_teams (room_id, name) values (p_room, nm) returning id into tid;
  update public.kviz_players set team_id = tid where room_id = p_room and user_id = auth.uid();
  return tid;
end;
$$;

-- Igralec: pridruži se obstoječi ekipi.
create or replace function public.kviz_join_team(p_room uuid, p_team uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.kviz_in_room(p_room) then
    raise exception 'Nisi v tej sobi.';
  end if;
  if not exists (select 1 from public.kviz_teams where id = p_team and room_id = p_room) then
    raise exception 'Ekipa ne obstaja.';
  end if;
  update public.kviz_players set team_id = p_team where room_id = p_room and user_id = auth.uid();
end;
$$;

-- Igralec: oddaj (ali spremeni) odgovor ekipe na trenutno vprašanje.
create or replace function public.kviz_answer(p_room uuid, p_choice int default null, p_text text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.kviz_rooms;
  pl public.kviz_players;
  q public.kviz_questions;
  txt text := left(trim(coalesce(p_text, '')), 200);
begin
  select * into pl from public.kviz_players where room_id = p_room and user_id = auth.uid();
  if pl.user_id is null then
    raise exception 'Nisi v tej sobi.';
  end if;
  if pl.team_id is null then
    raise exception 'Najprej izberi ekipo.';
  end if;
  select * into r from public.kviz_rooms where id = p_room;
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
  values (p_room, q.id, pl.team_id, auth.uid(), pl.nickname, p_choice, txt)
  on conflict (room_id, question_id, team_id) do update
    set player_id = excluded.player_id, nickname = excluded.nickname,
        choice_index = excluded.choice_index, text_answer = excluded.text_answer,
        updated_at = now();
end;
$$;

-- Lestvica ekip (voditelj ali igralec v sobi).
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
  where t.room_id = p_room
    and (public.kviz_is_host(p_room) or public.kviz_in_room(p_room))
  order by 3 desc, t.created_at
$$;

-- Pravice: nič za anon/public, igralci in admini so `authenticated`.
revoke execute on function
  public.kviz_is_real_user(), public.kviz_owns_quiz(uuid), public.kviz_is_host(uuid),
  public.kviz_in_room(uuid), public.kviz_my_team(uuid), public.kviz_norm(text),
  public.kviz_snapshot(public.kviz_rooms, int), public.kviz_new_code(),
  public.kviz_grade(public.kviz_rooms), public.kviz_open_room(uuid), public.kviz_next(uuid),
  public.kviz_finish(uuid), public.kviz_set_correct(uuid, boolean), public.kviz_join(text, text),
  public.kviz_create_team(uuid, text), public.kviz_join_team(uuid, uuid),
  public.kviz_answer(uuid, int, text), public.kviz_scoreboard(uuid)
from public, anon;

-- Notranji pomočniki niso za neposredne klice.
revoke execute on function
  public.kviz_snapshot(public.kviz_rooms, int), public.kviz_grade(public.kviz_rooms), public.kviz_new_code()
from authenticated;

grant execute on function
  public.kviz_is_real_user(), public.kviz_owns_quiz(uuid), public.kviz_is_host(uuid),
  public.kviz_in_room(uuid), public.kviz_my_team(uuid), public.kviz_norm(text),
  public.kviz_open_room(uuid), public.kviz_next(uuid), public.kviz_finish(uuid),
  public.kviz_set_correct(uuid, boolean), public.kviz_join(text, text),
  public.kviz_create_team(uuid, text), public.kviz_join_team(uuid, uuid),
  public.kviz_answer(uuid, int, text), public.kviz_scoreboard(uuid)
to authenticated;

-- ============ Realtime ============
alter publication supabase_realtime add table public.kviz_rooms, public.kviz_teams, public.kviz_players, public.kviz_answers;

-- ============ Slike vprašanj ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kviz', 'kviz', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "kviz_images_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'kviz'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.kviz_is_real_user())
  );

create policy "kviz_images_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'kviz' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "kviz_images_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'kviz' and (storage.foldername(name))[1] = (select auth.uid())::text);
