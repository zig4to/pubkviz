"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { IconArrowLeft, IconCheck, IconCopy, IconShuffle } from "@/components/ui/icons";
import clsx from "@/lib/utils/clsx";
import DrawShow from "./DrawShow";

// Žrebanje skupin: vpiši udeležence (vsak v svojo vrstico ali ločeni z
// vejico), izberi velikost skupine, naključno razporedi. Vse teče v
// brskalniku; seznam imen si stran zapomni (localStorage) za ta brskalnik.
const STORE_KEY = "kviz-zrebanje";
const QUICK_SIZES = [2, 3, 4, 5, 6];

type Store = { names: string; size: number; teams: string };

function readStore(): Store {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
    if (v && typeof v.names === "string" && Number.isInteger(v.size))
      return { names: v.names, size: v.size, teams: typeof v.teams === "string" ? v.teams : "" };
  } catch {}
  return { names: "", size: 4, teams: "" };
}

function writeStore(s: Store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {}
}

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Imena skupin naključno dodeli skupinam; če jih je premalo, ostale dobijo
// „Skupina N“, odvečna imena ostanejo neuporabljena.
function drawLabels(teamNames: string[], count: number): string[] {
  const picked = shuffle(teamNames);
  return Array.from({ length: count }, (_, i) => picked[i] ?? `Skupina ${i + 1}`);
}

function parseNames(text: string) {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function randomInt(max: number) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

// Fisher–Yates, nato razdeli v ceil(n / size) skupin tako, da se velikosti
// razlikujejo največ za 1 (npr. 10 ljudi po 4 → 4, 3, 3).
function draw(names: string[], size: number): string[][] {
  const a = shuffle(names);
  const count = Math.max(1, Math.ceil(a.length / size));
  const groups: string[][] = Array.from({ length: count }, () => []);
  a.forEach((n, i) => groups[i % count].push(n));
  return groups;
}

export default function TeamDraw() {
  const router = useRouter();
  const [initial] = useState(readStore);
  const [text, setText] = useState(initial.names);
  const [size, setSize] = useState(initial.size);
  const [teamText, setTeamText] = useState(initial.teams);
  const [groups, setGroups] = useState<string[][] | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  // Celozaslonska razglasitev; `round` ob vsakem žrebanju na novo zažene animacijo.
  const [showing, setShowing] = useState(false);
  const [round, setRound] = useState(0);
  // Shranjevanje žreba v bazo (samo prijavljen voditelj): na voljo za vse kvize.
  const supabase = useMemo(() => createClient(), []);
  const [saved, setSaved] = useState<"saving" | "saved" | "anon" | "error" | null>(null);

  const save = async (g: string[][], l: string[]) => {
    setSaved("saving");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setSaved("anon");
      return;
    }
    const { error } = await supabase.rpc("kviz_save_teams", {
      p_teams: g.map((members, i) => ({ name: l[i], members })),
    });
    setSaved(error ? "error" : "saved");
  };

  const startDraw = () => {
    const g = draw(names, size);
    const l = drawLabels(teamNames, g.length);
    setGroups(g);
    setLabels(l);
    setRound((r) => r + 1);
    setShowing(true);
    void save(g, l);
  };

  const names = parseNames(text);
  const teamNames = parseNames(teamText);
  const canDraw = names.length >= 2 && size >= 1;
  const groupCount = Math.max(1, Math.ceil(names.length / Math.max(1, size)));

  const update = (t: string, s: number, tt = teamText) => {
    setText(t);
    setSize(s);
    setTeamText(tt);
    writeStore({ names: t, size: s, teams: tt });
  };

  const copy = async () => {
    const out = (groups ?? []).map((g, i) => (labels[i] !== `Skupina ${i + 1}` ? `Skupina ${i + 1} – ${labels[i]}` : labels[i]) + `: ${g.join(", ")}`).join("\n");
    try {
      await navigator.clipboard.writeText(out);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-12 pt-4">
      <button
        onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
        className="mb-4 inline-flex items-center gap-1.5 rounded-md py-1 pr-2 text-sm text-gray-500 hover:text-violet-600 dark:text-gray-400 dark:hover:text-violet-400"
      >
        <IconArrowLeft className="h-4 w-4" /> Nazaj
      </button>
      <h1 className="text-2xl font-bold tracking-tight">Žrebaj skupine</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500 dark:text-gray-400">
        Vpiši vse udeležence, izberi, koliko ljudi naj bo v skupini, in naključno jih razporedi.
      </p>

      <div className="space-y-5">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="names" className="text-sm font-medium">
              Udeleženci
            </label>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {names.length}{" "}
              {names.length === 1 ? "oseba" : names.length === 2 ? "osebi" : names.length === 3 || names.length === 4 ? "osebe" : "oseb"}
            </span>
          </div>
          <Textarea
            id="names"
            value={text}
            onChange={(e) => update(e.target.value, size)}
            rows={8}
            placeholder={"Ana\nBor\nCene\n…"}
            className="font-medium"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">Vsako ime v svojo vrstico ali ločeno z vejico.</p>
        </div>

        <div className="space-y-1.5">
          <div className="text-sm font-medium">Ljudi na skupino</div>
          <div className="flex flex-wrap items-center gap-2">
            {QUICK_SIZES.map((n) => (
              <button
                key={n}
                onClick={() => update(text, n)}
                className={clsx(
                  "h-11 w-11 rounded-lg border text-base font-semibold transition-colors",
                  size === n
                    ? "border-violet-600 bg-violet-600 text-white"
                    : "border-gray-300 bg-white hover:border-violet-400 dark:border-gray-700 dark:bg-gray-900"
                )}
              >
                {n}
              </button>
            ))}
            <div className="w-20 shrink-0">
              <Input
                type="number"
                min={1}
                max={50}
                value={size}
                onChange={(e) => update(text, Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
                aria-label="Druga velikost skupine"
                className="h-11 text-center"
              />
            </div>
          </div>
          {names.length >= 2 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {groupCount} {groupCount === 1 ? "skupina" : groupCount === 2 ? "skupini" : groupCount < 5 ? "skupine" : "skupin"}
              {names.length % size !== 0 && groupCount > 1 && " — nekatere bodo imele osebo manj"}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="teams" className="text-sm font-medium">
              Imena skupin <span className="font-normal text-gray-500 dark:text-gray-400">(neobvezno)</span>
            </label>
            {teamNames.length > 0 && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {teamNames.length} / {groupCount}
              </span>
            )}
          </div>
          <Textarea
            id="teams"
            value={teamText}
            onChange={(e) => update(text, size, e.target.value)}
            rows={4}
            placeholder={"Jesenčki\nKvizovci\nPametnjakoviči\n…"}
            className="font-medium"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {teamNames.length === 0
              ? "Imena se bodo naključno dodelila skupinam. Brez imen bodo skupine oštevilčene."
              : teamNames.length < groupCount
                ? "Imen je manj kot skupin — ostale skupine bodo oštevilčene."
                : teamNames.length > groupCount
                  ? "Imen je več kot skupin — odvečna imena ne bodo uporabljena."
                  : "Imena se bodo naključno dodelila skupinam."}
          </p>
        </div>

        <Button onClick={startDraw} disabled={!canDraw} className="w-full py-3 text-base">
          <IconShuffle className="h-5 w-5" />
          {groups ? "Žrebaj znova" : "Žrebaj"}
        </Button>
      </div>

      {showing && groups && (
        <DrawShow key={round} groups={groups} labels={labels} onClose={() => setShowing(false)} onRedraw={startDraw} />
      )}

      {groups && !showing && (
        <div className="mt-8 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Skupine</h2>
            <Button variant="ghost" onClick={copy}>
              {copied ? <IconCheck className="h-4 w-4 text-emerald-500" /> : <IconCopy className="h-4 w-4" />}
              {copied ? "Kopirano" : "Kopiraj"}
            </Button>
          </div>
          {saved && saved !== "saving" && (
            <p
              className={clsx(
                "rounded-md px-3 py-2 text-sm",
                saved === "saved"
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
              )}
            >
              {saved === "saved"
                ? "Ekipe so shranjene — vidiš jih v adminu nad kvizi in jih lahko dodaš v katerikoli kviz."
                : saved === "anon"
                  ? "Ekipe niso shranjene: za shranjevanje se prijavi kot voditelj."
                  : "Ekip ni bilo mogoče shraniti."}
            </p>
          )}
          <ol className="grid gap-3 sm:grid-cols-2">
            {groups.map((g, i) => (
              <li
                key={i}
                className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
              >
                {labels[i] !== `Skupina ${i + 1}` && (
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Skupina {i + 1}:</div>
                )}
                <div className="mb-2 text-sm font-semibold text-violet-600 dark:text-violet-400">{labels[i]}</div>
                <ul className="space-y-1">
                  {g.map((n, j) => (
                    <li key={j} className="font-medium">
                      {n}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
