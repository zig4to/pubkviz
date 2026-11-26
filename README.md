# Kviz

Pub kviz: vprašanja po kategorijah na projektorju (`/oder/KODA`), igralci se s
telefonom pridružijo s kodo sobe (`/`) in v ekipah odgovarjajo (A–D ali vpis),
admin ureja kvize na `/admin`.

Next.js 16 + Supabase. `npm install && npm run dev` → http://localhost:3009.
Podrobnosti v `CLAUDE.md`.

## Listki za odgovore (tisk)

Za klasični kviz, kjer ekipe odgovore pišejo na papir.

1. Prijavi se in v `/admin` odpri kviz.
2. V glavi urejevalnika klikni **Listki**: v novem zavihku se odpre
   `/listki/<id kviza>` s predogledom listov.
3. Klikni **Natisni** (ali Ctrl+P). Postavitev je že nastavljena: A4 ležeče,
   brez robov. V dialogu tiskanja za čist izpis izklopi *Glave in noge*.
4. Natisni toliko kopij, kolikor je ekip, in vsak list razreži po črtkani
   črti na dva listka A5.

Vsaka kategorija ima svoj listek: prostor za ime ekipe, ime in pravila
kategorije, za vsako vprašanje vrstico za odgovor (krogci A–D pri vprašanjih
z možnostmi, podvrstice pri vprašanjih z delnimi točkami, npr. miks skladb)
in spodaj polje za točke. Vprašanja niso natisnjena, ker se kažejo na odru.

Listki se sestavijo sproti iz trenutnih vprašanj, zato jih po spremembi kviza
samo znova odpri. Odpre jih lahko le lastnik kviza.
