-- Skok na poljubno vprašanje (časovnica na odru).
--
-- p_index je 0-based indeks v kviz_rooms.question_ids. Soba preide v stanje
-- 'question' na tem vprašanju (telefonski kviz: vprašanje je spet odprto za
-- odgovore). Izjema: če je oder v razkritju in je ciljno vprašanje v isti
-- kategoriji, ostane v razkritju in ga oceni — tako se lahko voditelj med
-- razkritjem vrača naprej/nazaj. Nadaljnji „Naprej“ teče po običajnem poteku.

create or replace function public.kviz_goto(p_room uuid, p_index int)
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

revoke execute on function public.kviz_goto(uuid, int) from public, anon;
grant execute on function public.kviz_goto(uuid, int) to authenticated;
