-- Razkritje odgovorov na koncu vsake kategorije (ne po vsakem vprašanju).
--
-- Potek (en gumb „Naprej“):
--   lobby → vpr. 1 → vpr. 2 → … → zadnje vpr. kategorije
--         → razkritje vpr. 1 → razkritje vpr. 2 → … → lestvica (ali konec)
--         → prvo vprašanje naslednje kategorije …
-- Ko voditelj gre na naslednje vprašanje, je prejšnje zaprto (kviz_answer
-- sprejme odgovor samo za trenutno vprašanje v stanju 'question').
-- Ocenjevanje (kviz_grade) se zgodi ob razkritju posameznega vprašanja.

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
