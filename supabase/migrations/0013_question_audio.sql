-- Zvočni posnetek pri vprašanju (npr. „Ugani miks skladb“): oder pokaže velik
-- gumb za predvajanje. Bucket `kviz` sprejme še zvok (do 15 MB).

alter table public.kviz_questions
  add column audio_path text check (char_length(audio_path) <= 300);

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif',
                               'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/ogg'],
    file_size_limit = 15728640
where id = 'kviz';

-- Posnetek vprašanja dobi še audio_path (od 0006 + audio).
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
    'category_id', c.id,
    'notes', coalesce(c.notes, false),
    'category_index', cat_pos,
    'category_total', cardinality(cat_ids),
    'category_question', cat_q_index,
    'category_questions', cat_q_total,
    'type', q.type,
    'prompt', q.prompt,
    'image_path', q.image_path,
    'audio_path', q.audio_path,
    'options', to_jsonb(case when q.type = 'choice' then q.options else '{}'::text[] end),
    'points', q.points,
    'last_in_category', next_cat is distinct from q.category_id
  );
end;
$$;

-- Uvod kategorije: brez vprašanja in brez zvoka.
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
  return (snap - 'question_id' - 'type' - 'prompt' - 'image_path' - 'audio_path' - 'options' - 'points')
    || jsonb_build_object('intro', true, 'category_image', img);
end;
$$;
