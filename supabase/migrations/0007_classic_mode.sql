-- Način igre: 'phone' (telefonski, kot doslej) ali 'classic' (klasični —
-- ekipe pišejo na listke, na odru so samo vprašanja in možnosti, brez
-- razkritja pravilnih odgovorov in brez lestvice).
--
-- Način je nastavitev kviza (kviz_quizzes.mode); ob odprtju sobe se prepiše
-- v kviz_rooms.mode, da sprememba v urejevalniku ne vpliva na tekočo igro.
--
-- Potek klasičnega kviza (en gumb „Naprej“):
--   lobby → vpr. 1 → … → zadnje vpr. kategorije → scoreboard (premor:
--   „Konec kategorije“, brez točk) → prvo vpr. naslednje kategorije …
--   → zadnje vprašanje → finished.

alter table public.kviz_quizzes
  add column mode text not null default 'phone' check (mode in ('phone', 'classic'));

alter table public.kviz_rooms
  add column mode text not null default 'phone' check (mode in ('phone', 'classic'));

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
  insert into public.kviz_rooms (quiz_id, host_id, code, title, question_ids, mode)
  values (p_quiz, auth.uid(), new_code, qz.title, ids, qz.mode);
  return new_code;
end;
$$;

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
  idx int;
  last_in_cat boolean;
begin
  select * into r from public.kviz_rooms where id = p_room and host_id = auth.uid() for update;
  if r.id is null then
    raise exception 'Soba ne obstaja.';
  end if;
  total := cardinality(r.question_ids);
  last_in_cat := coalesce((r."current" ->> 'last_in_category')::boolean, false);

  -- Klasični kviz: samo vprašanja, premor med kategorijami, brez razkritja.
  if r.mode = 'classic' then
    if r.state = 'question' and last_in_cat then
      if r.q_index + 1 >= total then
        update public.kviz_rooms set state = 'finished', finished_at = now() where id = r.id;
        return 'finished';
      end if;
      update public.kviz_rooms set state = 'scoreboard' where id = r.id;
      return 'scoreboard';
    end if;
    if r.state in ('lobby', 'scoreboard', 'question') then
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
  end if;

  -- Telefonski kviz (od 0005).
  -- Med vprašanji kategorije: naslednje vprašanje brez razkritja.
  if r.state = 'question' and not last_in_cat then
    update public.kviz_rooms
      set q_index = r.q_index + 1, reveal = null,
          "current" = public.kviz_snapshot(r, r.q_index + 1)
    where id = r.id;
    return 'question';
  end if;

  -- Konec kategorije: razkrij prvo vprašanje kategorije.
  if r.state = 'question' and last_in_cat then
    idx := r.q_index - (coalesce((r."current" ->> 'category_question')::int, 1) - 1);
    r.q_index := idx;
    update public.kviz_rooms
      set state = 'reveal', q_index = idx, reveal = public.kviz_grade(r),
          "current" = public.kviz_snapshot(r, idx)
    where id = r.id;
    return 'reveal';
  end if;

  if r.state = 'reveal' then
    -- Naslednje razkritje v isti kategoriji.
    if not last_in_cat then
      r.q_index := r.q_index + 1;
      update public.kviz_rooms
        set q_index = r.q_index, reveal = public.kviz_grade(r),
            "current" = public.kviz_snapshot(r, r.q_index)
      where id = r.id;
      return 'reveal';
    end if;
    if r.q_index + 1 >= total then
      update public.kviz_rooms set state = 'finished', finished_at = now() where id = r.id;
      return 'finished';
    end if;
    update public.kviz_rooms set state = 'scoreboard' where id = r.id;
    return 'scoreboard';
  end if;

  if r.state in ('lobby', 'scoreboard') then
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

-- V klasično sobo se s telefonom ni mogoče prijaviti.
create or replace function public.kviz_join(p_code text, p_nickname text, p_token uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rid uuid;
  rmode text;
  pl public.kviz_players;
  nick text := left(trim(coalesce(p_nickname, '')), 30);
begin
  if nick = '' then
    raise exception 'Vpiši vzdevek.';
  end if;
  select id, mode into rid, rmode from public.kviz_rooms
  where code = upper(trim(coalesce(p_code, ''))) and state <> 'finished';
  if rid is null then
    raise exception 'Soba s to kodo ne obstaja ali je že končana.';
  end if;
  if rmode = 'classic' then
    raise exception 'Ta kviz se igra na listke — telefon ni potreben.';
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
