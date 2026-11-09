export const LETTERS = ["A", "B", "C", "D"] as const;

// Barve odgovorov A–D (oder in telefon enako). Inline stil, ne Tailwind
// razredi, da so enake v svetli in temni temi.
export const OPTION_COLORS = ["#e11d48", "#2563eb", "#d97706", "#059669"] as const;

export function imageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/kviz/${path}`;
}

/** Koda sobe: 5 znakov brez dvoumnih (0/O, 1/I). */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

export function errorText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") {
    return e.message;
  }
  return "Nekaj je šlo narobe.";
}

const TOKEN_KEY = (code: string) => `kviz-token-${code}`;
const NICK_KEY = "kviz-nickname";

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* zasebni način */
  }
}

export const playerStore = {
  getToken: (code: string) => lsGet(TOKEN_KEY(code)),
  setToken: (code: string, token: string | null) => lsSet(TOKEN_KEY(code), token),
  getNick: () => lsGet(NICK_KEY) ?? "",
  setNick: (nick: string) => lsSet(NICK_KEY, nick),
};
