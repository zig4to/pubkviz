-- Vmesni slajd pred vprašanjem (npr. „Dodatna splošna vprašanja“ sredi
-- kategorije). Prva vrstica = naslov, ostalo = podnaslov. Oder ga pokaže kot
-- korak 0 stanja `question`, Naprej → vprašanje. Ni v kviz_snapshot (oder ga
-- bere iz kviz_questions kot lastnik); urejevalnik ga še ne zna.

alter table public.kviz_questions
  add column section text check (char_length(section) <= 200);
