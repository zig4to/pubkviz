-- kviz_goto s p_intro: skok na uvod kategorije (stanje 'intro') namesto
-- naravnost na vprašanje. Oder ga uporabi, ko na časovnici klikneš ime
-- kategorije ali prvo vprašanje druge kategorije — tako se ne preskoči
-- uvodni zaslon (ime + slika) in primer „Kako se igra?“.

drop function if exists public.kviz_goto(uuid, int);

create or replace function public.kviz_goto(p_room uuid, p_index int, p_intro boolean default false)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.kviz_rooms;
  snap jsonb;
begin
  select * into r from public.kviz_rooms where id = p_room and host_id = auth.uid() for update;
  if r.id is null then
    raise exception 'Soba ne obstaja.';
  end if;
  if p_index is null or p_index < 0 or p_index >= cardinality(r.question_ids) then
    raise exception 'Vprašanje ne obstaja.';
  end if;

  snap := public.kviz_snapshot(r, p_index);

  if p_intro and coalesce((snap ->> 'category_question')::int, 0) = 1 then
    update public.kviz_rooms
      set state = 'intro', q_index = p_index, reveal = null,
          "current" = public.kviz_intro_snapshot(r, p_index), finished_at = null
    where id = r.id;
    return 'intro';
  end if;

  if r.mode <> 'classic' and r.state = 'reveal'
     and (snap ->> 'category_id') = (r."current" ->> 'category_id') then
    r.q_index := p_index;
    update public.kviz_rooms
      set q_index = p_index, reveal = public.kviz_grade(r), "current" = snap
    where id = r.id;
    return 'reveal';
  end if;

  update public.kviz_rooms
    set state = 'question', q_index = p_index, reveal = null, "current" = snap, finished_at = null
  where id = r.id;
  return 'question';
end;
$$;

revoke execute on function public.kviz_goto(uuid, int, boolean) from public, anon;
grant execute on function public.kviz_goto(uuid, int, boolean) to authenticated;
