# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Kaj je Kviz

Pub kviz (uporabnik/voditelj: Žiga). Trije zasloni:

1. **Oder** (`/oder/KODA`, projektor, samo voditelj) — lobi s kodo + QR,
   vprašanja po kategorijah, razkritje, lestvica po vsaki kategoriji, končni
   rezultati. En gumb **Naprej** (tudi →, presledek, Enter, PageDown —
   deluje s prezentacijskim klikerjem), F = celoten zaslon.
2. **Igralec** (`/` vpis kode → `/igra/KODA`, telefon, **brez računa**) —
   vzdevek → ekipa (izberi ali ustvari) → odgovarjanje A–D ali vpis. Igra se
   v **ekipah**: en odgovor na ekipo, kdorkoli iz ekipe ga lahko spremeni,
   dokler je vprašanje odprto.
3. **Admin** (`/admin`, prijava kot v ostalih aplikacijah) — kvizi →
   kategorije (vrstni red = vrstni red v igri) → vprašanja (tip `choice` 2–4
   možnosti ali `text` s sprejetimi odgovori, slika, točke 1/2/3/5), „Začni
   igro“, seznam odprtih sob.

Ogrodje je kopija **Binga** (prijava, SSO iz huba Bitneverse, tema, PWA, UI
primitivi). Isti Supabase projekt **ProjektiBaze** (`abjnxhfxjolwwxlckkje`),
tabele s predpono `kviz_`. Stack: Next.js 16 · React 19 · TypeScript ·
Tailwind v4 · `@supabase/ssr` · `qrcode`. Barva cyan `#06b6d4` → vijolična
`#7c3aed` (primarni gumbi `violet-600`). Ime aplikacije: **Garaža pub kviz**
(kratko „Garaža kviz“). Znak: garaža (streha + vrata) z vprašajem v vratih —
isti risbi v `src/app/icon.svg`, `public/icon.svg` in `components/Logo.tsx`.
Jezik: slovenščina.

## Ukazi

```bash
npm install
npm run dev      # http://localhost:3009
npm run lint
npm run build
```

Ni testov. Za preizkus igre s telefonom na istem Wi-Fi odpri
`http://<IP računalnika>:3009`. QR na odru uporablja `window.location.origin`;
če je oder odprt na `localhost`, ga v razvoju zamenja IP računalnika iz
`/api/lan-origin` (samo `NODE_ENV=development`, sicer 404).

## Okolje, deploy

- `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  (kopirano iz Binga; enaka morata biti na Vercelu).
- Še ni na GitHubu/Vercelu (2026-11-09). Ob deployu na Vercelu **izklopi
  Deployment Protection** — igralci nimajo Vercel računa.
- **Pred `git push` vedno vprašaj Žigo.**

## Baza (Supabase)

| Migracija | Vsebina | Stanje |
|---|---|---|
| `0001_init` | urejevalnik (`kviz_quizzes`, `kviz_categories`, `kviz_questions`, RLS samo lastnik, neanonimen), sobe/ekipe, funkcije igre (`kviz_open_room`, `kviz_next`, `kviz_grade`, `kviz_snapshot`, `kviz_set_correct`, `kviz_finish`, `kviz_norm`), javni bucket `kviz` (slike, pisanje v `<uid>/…`) | izvedena 2026-11-09 (`kviz_init`) |
| `0002_player_tokens` | igralci z žetonom namesto anonimne seje (`kviz_players.token`), `kviz_answers`, RPC za igralce (`kviz_join`, `kviz_player_state`, `kviz_create_team`, `kviz_join_team`, `kviz_answer` — vloga anon), `kviz_scoreboard`, `kviz_kick`, sprožilci `kviz_ping_*` | izvedena 2026-11-09 (`kviz_player_tokens`) |
| `0003_team_members` | člani ekipe brez telefona (`kviz_teams.members text[]`, max 15), `kviz_add_member`/`kviz_remove_member` (žeton), `kviz_host_remove_member` (oder), `kviz_player_state` vrača `members` | izvedena 2026-11-09 (`kviz_team_members`) |
| `0004_team_rename` | `kviz_rename_team` (žeton, samo v lobiju, unikatno ime) | izvedena 2026-11-09 (`kviz_team_rename`) |
| `0005_reveal_per_category` | nov `kviz_next`: razkritje odgovorov na koncu kategorije | izvedena 2026-11-09 (`kviz_reveal_per_category`) |
| `0006_category_notes` | `kviz_categories.notes` (stikalo „Beležka“ v urejevalniku); `kviz_snapshot` vrača še `category_id`, `notes`. Beležka igralca živi samo v localStorage `kviz-notes-<KODA>` (`notesStore` v `lib/kviz.ts`), ne šteje kot odgovor | izvedena 2026-11-18 (`kviz_category_notes`) |
| `0007_classic_mode` | način igre `mode` (`phone`/`classic`) na `kviz_quizzes` (stikalo v urejevalniku), ob `kviz_open_room` kopiran v `kviz_rooms.mode`. Klasični `kviz_next`: lobby → vprašanja → `scoreboard` (premor „Oddajte listke“, brez točk) → … → finished, brez razkritja. `kviz_join` zavrne klasično sobo | izvedena 2026-11-22 (`kviz_classic_mode`) |
| `0008_goto_question` | `kviz_goto(room, index)` za časovnico na odru: skok na vprašanje (stanje `question`; med razkritjem v isti kategoriji ostane `reveal`) | izvedena 2026-11-22 (`kviz_goto_question`) |
| `0009_category_intro` | stanje `intro` pred vsako kategorijo (uvodni zaslon: ime + `kviz_categories.image_path` ali ilustracija). `current` v `intro` je `kviz_intro_snapshot` — brez vprašanja (telefoni ga ne vidijo prezgodaj); `q_index` že kaže na prvo vprašanje kategorije | izvedena 2026-11-22 (`kviz_category_intro`) |
| `0010_category_example` | `kviz_categories.example` jsonb `{rules, items:[{q,a}], answer}` — primer „Kako se igra?“ po uvodu kategorije; koraka (primer → rešitev) teče samo oder znotraj stanja `intro` (`introStep` v `Stage.tsx`). Urejevalnika še ni, vpisano ročno (Nadpomenka v „Testni kviz 3“) | izvedena 2026-11-22 (`kviz_category_example`) |
| `0011_goto_intro` | `kviz_goto(room, index, p_intro)`: s `p_intro` na prvo vprašanje kategorije skoči na njen uvod (`intro`). Časovnica: klik na ime kategorije ali na krogec 1 druge kategorije → uvod | izvedena 2026-11-22 (`kviz_goto_intro`) |
| `0012_category_summary` | `kviz_categories.summary` (stikalo „Pregled“): po zadnjem vprašanju kategorije oder (korak, samo na odru) pokaže vsa vprašanja naenkrat brez slik/odgovorov. Klasični kviz ima po „Oddajte listke“ še pregled pravilnih odgovorov (oder bere `kviz_questions` kot lastnik) | izvedena 2026-11-22 (`kviz_category_summary`) |
| `0013_question_audio` | `kviz_questions.audio_path` (posnetek v bucketu `kviz`, ki sprejme še audio do 15 MB); `kviz_snapshot` ga vrača, `kviz_intro_snapshot` ne. Oder: `AudioPlayer` v `Stage.tsx` (velik gumb, tipka P), urejevalnik: „Dodaj posnetek“ | izvedena 2026-11-22 (`kviz_question_audio`) |
| `0014_question_explanation` | `kviz_questions.explanation` (≤ 300 znakov): pojasnilo, ki ga oder pokaže samo v pregledu odgovorov pod vprašanjem (ni v `kviz_snapshot`) | izvedena 2026-11-24 (`kviz_question_explanation`) |
| `0015_host_scoring` | točkovanje klasičnega kviza (`/oder/KODA/tocke`, `components/scoring/Scoring.tsx`): voditelj ustvari ekipe (`kviz_host_add_team`/`_rename_team`/`_delete_team`) in kljuka ✓/✗ (`kviz_host_mark` → `kviz_answers.is_correct`, `points` = točke vprašanja). Samo `mode = 'classic'`. Še `kviz_saved_teams` (izžrebane ekipe voditelja za vse kvize; `kviz_save_teams` ob vsakem žrebu zamenja nabor, admin jih pokaže nad kvizi in izbriše, `kviz_host_import_teams` jih doda v sobo). Delne točke: `kviz_questions.parts` (oznake delov, vsak vreden `points / n`; miksi v „Ugani miks skladb“ = 4 × ½), `kviz_answers.points` je `numeric`, `kviz_answers.parts` ocena po delih. Urejevalnik `parts` še ne zna, vpisano z migracijo | izvedena 2026-11-25 (`kviz_host_scoring`) |

`src/lib/types/database.types.ts` je **ročno napisan** — ob novi migraciji ga
posodobi. Migracije prek Supabase MCP `apply_migration` (Žiga mora odobriti).

### Zakaj žetoni, ne anonimna prijava

Skupni projekt ima na `auth.users` sprožilec `check_allowed_email`
(registracija samo s povabilom) — anonimne prijave zavrne. Če bi ga omilili,
bi anonimne seje dobile vlogo `authenticated` v **vseh** aplikacijah huba
(npr. Klepet). Zato igralec ob `kviz_join` dobi skrivni `token` (shrani se v
localStorage `kviz-token-<KODA>`) in vse dela prek security definer RPC z
žetonom. Stolpec `token` ni berljiv niti voditelju (column grants).

### Potek igre (`kviz_next`, en gumb)

`lobby → intro → question → question → … (vsa vprašanja kategorije, brez razkritja)
→ reveal (1. vpr. kategorije) → reveal → … → scoreboard → intro → question … →
finished` (od `0005`, `intro` od `0009`; klasični način brez `reveal`). Ko gre voditelj naprej, je prejšnje vprašanje zaprto;
`kviz_grade` oceni vprašanje šele ob njegovem razkritju. Ob odprtju sobe se vrstni red vprašanj
zamrzne v `kviz_rooms.question_ids` (kategorija.position, vprašanje.position).
`current` je očiščen posnetek vprašanja (brez pravilnega odgovora), `reveal`
se nastavi šele ob razkritju (`kviz_grade` oceni vse odgovore). Vpis se
primerja z `kviz_norm` (male črke, brez šumnikov, ločil, presledkov); voditelj
lahko ob razkritju oceno ročno preklopi (`kviz_set_correct`).

### Realtime

Ni `postgres_changes`. Sprožilci na sobah/ekipah/igralcih/odgovorih pokličejo
`realtime.send('{}', 'changed', 'kviz:<room_id>', false)` (javni broadcast,
prazen signal). `src/lib/useRoomPing.ts` posluša ta kanal in ob signalu
ponovno prebere stanje (telefon: `kviz_player_state`, oder: tabele + 
`kviz_scoreboard`), plus rezerva ob vrnitvi v zavihek in vsakih 4–6 s.

## Arhitektura

- `/zrebanje` (gumb „Žrebaj skupine“ na `/`, javno): naključna razporeditev
  udeležencev v skupine izbrane velikosti — samo v brskalniku
  (`components/draw/TeamDraw.tsx`, imena v localStorage `kviz-zrebanje`; ločena
  seznama Moški/Ženske, spola enakomerno pomešana po skupinah). Če je
  voditelj prijavljen, se izžrebane ekipe shranijo v `kviz_saved_teams` (0015).

- `src/lib/supabase/middleware.ts`: `/` in `/igra/*` sta javna, `/login` in
  `/registracija` preusmerita prijavljene na `/admin`, vse ostalo zahteva
  prijavo. Prijava/SSO pristane na `/admin` (hub odpre koren s `#sb_at=…` →
  `SsoBridge` na `/`).
- `/listki/[id]` (gumb „Listki“ v urejevalniku, samo lastnik): listki za
  odgovore klasičnega kviza za tisk — A4 ležeče, dve kategoriji (A5) na list,
  samo prostor za odgovore (krogci A–D pri `choice`, podvrstice pri `parts`),
  `components/print/AnswerSheets.tsx`. Izven `(app)`, da ni zgornje vrstice.
- Telefon: `components/play/PlayClient.tsx` (prek `PlayLoader`, `ssr:false`).
- Oder: `components/stage/Stage.tsx` (prek `StageLoader`, `ssr:false`).
- Admin: `components/admin/AdminHome.tsx`, `components/editor/QuizEditor.tsx`
  + `QuestionDialog.tsx` — piše neposredno v tabele z brskalniškim klientom
  (RLS), brez server actions.
- `src/lib/kviz.ts`: barve A–D (`OPTION_COLORS`), `imageUrl`, žeton v
  localStorage.
- `install-promo.js` se naloži samo v admin delu, ne na telefonih igralcev.

## Stanje podatkov (2026-11-09)

- 2026-11-22: „Garaža pub kviz“ (klasični, 10 kategorij, 55 vprašanj, vsaka
  kategorija ima `example` — oblike `choice` / `items` / `items`+`answer`, glej
  `CategoryExample`). Kategorija 4 „Ugani miks skladb“ ima 5 začasnih vprašanj
  (`(dopolni)`), prava pridejo kasneje.
- Žiga ima „Demo pub kviz“ (2 kategoriji, 4 vprašanja) ter „Testni kviz 1 –
  Svet“ in „Testni kviz 2 – Mešano“ (vsak 2 kategoriji, 5 vprašanj) za preizkus.

## Pasti

- Ne kliči `setState` v `useEffect` (lint `react-hooks/set-state-in-effect`) —
  prvo nalaganje je ovito v `setTimeout(…, 0)`.
- `src/proxy.ts` matcher mora izključevati statične `.js`. `public/sw.js` je
  network-first; ob spremembi povečaj `VERZIJA`.
- `layout.tsx` ima `translate="no"` + `<meta name="google" content="notranslate">`:
  Chrome je stran samodejno prevajal (ime ekipe „Jesenčki“ → „autumn“).
- Datoteke so CRLF na Windows; za popravke raje Edit kot sed z regexi.
