---
name: dev
description: Zaženi dev server Kviza v ozadju in ga odpri v Chromu (Claude in Chrome). Uporabi, kadar uporabnik napiše samo "dev" (ali /dev, "zaženi dev in odpri").
---

# dev — zaženi dev server in ga odpri v Chromu

1. **Ali že teče?** Preveri vrata 3009 (PowerShell):
   `Get-NetTCPConnection -LocalPort 3009 -State Listen -ErrorAction SilentlyContinue`
   - Če je kaj vrnil → server že teče, preskoči na korak 3 (ne zaganjaj drugega, sicer `EADDRINUSE`).
2. **Zaženi v ozadju:** `npm run dev` z `run_in_background: true`. Počakaj na vrstico
   `Ready` v izhodni datoteki (kratka zanka, ki bere datoteko do `Ready|Error|EADDRINUSE`,
   največ ~30 s). Ob napaki jo pokaži uporabniku in se ustavi.
3. **Odpri v Chromu:** naloži orodja v ENEM klicu:
   `ToolSearch select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate`
   - `tabs_context_mcp` → če že obstaja zavihek z `localhost:3009`, ga uporabi (navigate na isti URL = osvežitev);
     sicer `tabs_create_mcp` in nato `navigate` na `http://localhost:3009`.
   - Če razširitev ne odgovori, to povej in podaj URL ročno — ne ponavljaj v nedogled.
4. **Poročaj** v eni vrstici: URL (`http://localhost:3009`) in da je zavihek odprt.
