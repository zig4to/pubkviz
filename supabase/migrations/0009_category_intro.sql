-- Uvodni zaslon pred vsako kategorijo (ime + slika ali ilustracija).
--
-- Novo stanje sobe 'intro': q_index kaže na prvo vprašanje kategorije,
-- "current" pa je posnetek BREZ vprašanja (samo podatki o kategoriji), da ga
-- telefoni ne vidijo prezgodaj. „Naprej“ iz 'intro' odpre to vprašanje.
--
-- Potek: lobby → intro → vprašanja … → (razkritje → lestvica | klasični
-- premor) → intro naslednje kategorije → …

alter table public.kviz_categories
  add column image_path text check (char_length(image_path) <= 300);

alter table public.kviz_rooms drop constraint kviz_rooms_state_check;
alter table public.kviz_rooms add constraint kviz_rooms_state_check
  check (state in ('lobby', 'intro', 'question', 'reveal', 'scoreboard', 'finished'));

-- Posnetek za uvod kategorije: podatki kategorije, brez vprašanja.
create or replace function public.kviz_intro_snapshot(p_room public.kviz_rooms, p_index int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  snap jsonb;
  img text;
begin
  snap := public.kviz_snapshot(p_room, p_index);
  if snap is null then
    return null;
  end if;
  select c.image_path into img from public.kviz_categories c where c.id = (snap ->> 'category_id')::uuid;
  return (snap - 'question_id' - 'type' - 'prompt' - 'image_path' - 'options' - 'points')
    || jsonb_build_object('intro', true, 'category_image', img);
end;
$$;

revoke execute on function public.kviz_intro_snapshot(public.kviz_rooms, int) from public, anon, authenticated;

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

  -- Uvod kategorije → njeno prvo vprašanje (q_index že kaže nanj).
  if r.state = 'intro' then
    update public.kviz_rooms
      set state = 'question', reveal = null,
          "current" = public.kviz_snapshot(r, r.q_index)
    where id = r.id;
    return 'question';
  end if;

  -- Začetek ali konec kategorije → uvod naslednje kategorije (ali konec).
  if r.state in ('lobby', 'scoreboard') then
    if r.q_index + 1 >= total then
      update public.kviz_rooms set state = 'finished', finished_at = now() where id = r.id;
      return 'finished';
    end if;
    update public.kviz_rooms
      set state = 'intro', q_index = r.q_index + 1, reveal = null,
          "current" = public.kviz_intro_snapshot(r, r.q_index + 1)
    where id = r.id;
    return 'intro';
  end if;

  -- Med vprašanji kategorije: naslednje vprašanje (oba načina).
  if r.state = 'question' and not last_in_cat then
    update public.kviz_rooms
      set q_index = r.q_index + 1, reveal = null,
          "current" = public.kviz_snapshot(r, r.q_index + 1)
    where id = r.id;
    return 'question';
  end if;

  -- Klasični: po zadnjem vprašanju kategorije premor (ali konec), brez razkritja.
  if r.mode = 'classic' then
    if r.state = 'question' and last_in_cat then
      if r.q_index + 1 >= total then
        update public.kviz_rooms set state = 'finished', finished_at = now() where id = r.id;
        return 'finished';
      end if;
      update public.kviz_rooms set state = 'scoreboard' where id = r.id;
      return 'scoreboard';
    end if;
    return r.state;
  end if;

  -- Telefonski: konec kategorije → razkrij prvo vprašanje kategorije.
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

  return r.state;
end;
$$;
