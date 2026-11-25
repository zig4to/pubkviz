-- Primer „Kako se igra?“ za kategorijo (npr. Nadpomenka). Prikaže se na
-- odru po uvodnem zaslonu kategorije (koraka znotraj stanja 'intro' teče
-- samo oder, baza se ne spremeni): najprej primeri, nato rešitev.
--
-- Oblika: { "rules": text, "items": [{ "q": text?, "a": text }], "answer": text }

alter table public.kviz_categories
  add column example jsonb check (example is null or jsonb_typeof(example) = 'object');
