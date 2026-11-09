"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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

function readStore(): { names: string; size: number } {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
    if (v && typeof v.names === "string" && Number.isInteger(v.size)) return v;
  } catch {}
  return { names: "", size: 4 };
}

function writeStore(names: string, size: number) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ names, size }));
  } catch {}
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
  const a = [...names];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
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
  const [groups, setGroups] = useState<string[][] | null>(null);
  const [copied, setCopied] = useState(false);
  // Celozaslonska razglasitev; `round` ob vsakem žrebanju na novo zažene animacijo.
  const [showing, setShowing] = useState(false);
  const [round, setRound] = useState(0);

  const startDraw = () => {
    setGroups(draw(names, size));
    setRound((r) => r + 1);
    setShowing(true);
  };

  const names = parseNames(text);
  const canDraw = names.length >= 2 && size >= 1;
  const groupCount = Math.max(1, Math.ceil(names.length / Math.max(1, size)));

  const update = (t: string, s: number) => {
    setText(t);
    setSize(s);
    writeStore(t, s);
  };

  const copy = async () => {
    const out = (groups ?? []).map((g, i) => `Skupina ${i + 1}: ${g.join(", ")}`).join("\n");
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

        <Button onClick={startDraw} disabled={!canDraw} className="w-full py-3 text-base">
          <IconShuffle className="h-5 w-5" />
          {groups ? "Žrebaj znova" : "Žrebaj"}
        </Button>
      </div>

      {showing && groups && (
        <DrawShow key={round} groups={groups} onClose={() => setShowing(false)} onRedraw={startDraw} />
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
          <ol className="grid gap-3 sm:grid-cols-2">
            {groups.map((g, i) => (
              <li
                key={i}
                className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="mb-2 text-sm font-semibold text-violet-600 dark:text-violet-400">Skupina {i + 1}</div>
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
