-- Pojasnilo k odgovoru (npr. „S'all good, man“ pri Saulu Goodmanu): oder ga
-- pokaže samo v pregledu odgovorov pod vprašanjem. Ni v kviz_snapshot, zato ga
-- med vprašanjem ne vidi nihče (oder ga bere iz kviz_questions kot lastnik).

alter table public.kviz_questions
  add column explanation text check (char_length(explanation) <= 300);
