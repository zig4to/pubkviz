-- Preimenovanje ekipe s telefona (kdorkoli iz ekipe, samo v lobiju).

create or replace function public.kviz_rename_team(p_token uuid, p_name text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pl public.kviz_players;
  nm text := left(trim(coalesce(p_name, '')), 40);
begin
  pl := public.kviz_player_by_token(p_token);
  if pl.team_id is null then
    raise exception 'Najprej izberi ekipo.';
  end if;
  if nm = '' then
    raise exception 'Vpiši ime ekipe.';
  end if;
  if (select state from public.kviz_rooms where id = pl.room_id) <> 'lobby' then
    raise exception 'Ime ekipe lahko spremeniš samo pred začetkom kviza.';
  end if;
  if exists (select 1 from public.kviz_teams
             where room_id = pl.room_id and id <> pl.team_id and lower(name) = lower(nm)) then
    raise exception 'Ekipa s tem imenom že obstaja.';
  end if;
  update public.kviz_teams set name = nm where id = pl.team_id;
end;
$$;

revoke execute on function public.kviz_rename_team(uuid, text) from public;
grant execute on function public.kviz_rename_team(uuid, text) to anon, authenticated;
