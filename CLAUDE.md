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

Ogrodje je kopija **Binga** (prijava, SSO iz huba TomsStudios, tema, PWA, UI
primitivi). Isti Supabase projekt **ProjektiBaze** (`abjnxhfxjolwwxlckkje`),
tabele s predpono `kviz_`. Stack: Next.js 16 · React 19 · TypeScript ·
Tailwind v4 · `@supabase/ssr` · `qrcode`. Barva cyan `#06b6d4` → vijolična
`#7c3aed` (primarni gumbi `violet-600`), znak Lucide circle-help. Jezik:
slovenščina.

## Ukazi

```bash
npm install
npm run dev      # http://localhost:3009
npm run lint
npm run build
```

Ni testov. Za preizkus igre s telefonom na istem Wi-Fi odpri
`http://<IP računalnika>:3009` (QR na odru uporablja `window.location.origin`,
zato oder odpri prek IP-ja, ne `localhost`, če naj QR deluje s telefonom).

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

`lobby → question → reveal → (scoreboard, če je bilo zadnje vprašanje
kategorije) → question … → finished`. Ob odprtju sobe se vrstni red vprašanj
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

- `src/lib/supabase/middleware.ts`: `/` in `/igra/*` sta javna, `/login` in
  `/registracija` preusmerita prijavljene na `/admin`, vse ostalo zahteva
  prijavo. Prijava/SSO pristane na `/admin` (hub odpre koren s `#sb_at=…` →
  `SsoBridge` na `/`).
- Telefon: `components/play/PlayClient.tsx` (prek `PlayLoader`, `ssr:false`).
- Oder: `components/stage/Stage.tsx` (prek `StageLoader`, `ssr:false`).
- Admin: `components/admin/AdminHome.tsx`, `components/editor/QuizEditor.tsx`
  + `QuestionDialog.tsx` — piše neposredno v tabele z brskalniškim klientom
  (RLS), brez server actions.
- `src/lib/kviz.ts`: barve A–D (`OPTION_COLORS`), `imageUrl`, žeton v
  localStorage.
- `install-promo.js` se naloži samo v admin delu, ne na telefonih igralcev.

## Stanje podatkov (2026-11-09)

- Žiga ima „Demo pub kviz“ (2 kategoriji, 4 vprašanja) za preizkus.

## Pasti

- Ne kliči `setState` v `useEffect` (lint `react-hooks/set-state-in-effect`) —
  prvo nalaganje je ovito v `setTimeout(…, 0)`.
- `src/proxy.ts` matcher mora izključevati statične `.js`. `public/sw.js` je
  network-first; ob spremembi povečaj `VERZIJA`.
- Datoteke so CRLF na Windows; za popravke raje Edit kot sed z regexi.
