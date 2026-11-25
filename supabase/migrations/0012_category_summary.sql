-- Pregled vseh vprašanj kategorije (npr. „Od 1 do 10“): po zadnjem vprašanju
-- kategorije oder pokaže vsa vprašanja naenkrat (brez slik in odgovorov), da
-- igralci lahko primerjajo in popravijo odgovore. Korak teče samo na odru.

alter table public.kviz_categories
  add column summary boolean not null default false;
