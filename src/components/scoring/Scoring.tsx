"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRoomPing } from "@/lib/useRoomPing";
import { LETTERS, errorText } from "@/lib/kviz";
import type { KvizAnswer, KvizQuestion, KvizRoom, KvizTeam } from "@/lib/types/database.types";
import Button from "@/components/ui/Button";
import {
  IconArrowLeft,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconPencil,
  IconTrash,
  IconX,
} from "@/components/ui/icons";
import clsx from "@/lib/utils/clsx";

type Q = Pick<
  KvizQuestion,
  "id" | "category_id" | "type" | "prompt" | "options" | "correct_index" | "accepted_answers" | "points" | "parts"
>;
type Item = Q & { index: number; category: string; n: number; of: number };
type View = "question" | "team" | "total" | "teams";
type Mark = boolean | null;
// Ocena ekipe pri vprašanju; `parts` samo pri vprašanjih z deli (miks: 4 × ½).
type Entry = { correct: Mark; parts: Mark[] | null; points: number };

const plainPrompt = (p?: string | null) => (p ?? "").replace(/^# [^\n]*\n/, "");
const key = (team: string, q: string) => `${team}:${q}`;
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const EMPTY: Entry = { correct: null, parts: null, points: 0 };

// Enako kot kviz_host_mark v bazi (za takojšen prikaz pred odgovorom strežnika).
function entryFor(q: Q, correct: Mark, parts: Mark[] | null): Entry {
  const n = q.parts.length;
  if (!n) return { correct, parts: null, points: correct ? q.points : 0 };
  const p = parts ?? Array.from({ length: n }, () => correct);
  const yes = p.filter((x) => x === true).length;
  const marked = p.filter((x) => x !== null).length;
  return {
    parts: p,
    points: Math.round((q.points * yes * 100) / n) / 100,
    correct: yes === n ? true : marked === 0 ? null : false,
  };
}

// Oznake delov: iz odgovora „Izvajalec – Naslov · Izvajalec – Naslov“, sicer iz baze.
function partLabels(q: Q): string[] {
  const bits = (q.accepted_answers[0] ?? "")
    .split(/\s+[·–-]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return bits.length === q.parts.length ? bits : q.parts;
}

function correctText(q: Q): string {
  if (q.type === "choice") {
    const i = q.correct_index ?? -1;
    return i >= 0 ? `${LETTERS[i]} — ${q.options[i] ?? ""}` : "—";
  }
  return q.accepted_answers.length ? q.accepted_answers.join(" / ") : "—";
}

// Točkovanje klasičnega kviza: voditelj ustvari ekipe in po vsakem vprašanju
// (ali po listkih kategorije) kljuka pravilno / narobe. Točke = točke vprašanja.
export default function Scoring({ roomId }: { roomId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [room, setRoom] = useState<KvizRoom | null>(null);
  const [teams, setTeams] = useState<KvizTeam[]>([]);
  const [answers, setAnswers] = useState<KvizAnswer[]>([]);
  const [questions, setQuestions] = useState<Q[] | null>(null);
  const [catNames, setCatNames] = useState<Map<string, string>>(new Map());
  const [optimistic, setOptimistic] = useState<Map<string, Entry>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [follow, setFollow] = useState(true);
  const [manualIdx, setManualIdx] = useState(0);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [catId, setCatId] = useState<string | null>(null);
  // Izžrebane ekipe voditelja (0015, kviz_saved_teams) — uvoz v to igro.
  const [savedNames, setSavedNames] = useState<string[]>([]);
  const [randomizing, setRandomizing] = useState(false);

  const load = useCallback(async () => {
    const [r, t, a, s] = await Promise.all([
      supabase.from("kviz_rooms").select("*").eq("id", roomId).single(),
      supabase.from("kviz_teams").select("*").eq("room_id", roomId).order("created_at"),
      supabase.from("kviz_answers").select("*").eq("room_id", roomId),
      supabase.from("kviz_saved_teams").select("name").order("position"),
    ]);
    if (r.data) setRoom(r.data);
    setTeams(t.data ?? []);
    setAnswers(a.data ?? []);
    setSavedNames((s.data ?? []).map((x) => x.name));
  }, [supabase, roomId]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  useRoomPing(roomId, load, 5000);

  const quizId = room?.quiz_id;
  const idsKey = room?.question_ids.join(",");
  useEffect(() => {
    if (!quizId || !idsKey) return;
    let alive = true;
    const ids = idsKey.split(",");
    void Promise.all([
      supabase
        .from("kviz_questions")
        .select("id, category_id, type, prompt, options, correct_index, accepted_answers, points, parts")
        .in("id", ids),
      supabase.from("kviz_categories").select("id, name").eq("quiz_id", quizId),
    ]).then(([qs, cats]) => {
      if (!alive) return;
      const byId = new Map((qs.data ?? []).map((q) => [q.id, q]));
      setQuestions(ids.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])));
      setCatNames(new Map((cats.data ?? []).map((c) => [c.id, c.name])));
    });
    return () => {
      alive = false;
    };
  }, [supabase, quizId, idsKey]);

  // Vprašanja v vrstnem redu igre + številka znotraj kategorije.
  const items: Item[] = useMemo(() => {
    if (!questions) return [];
    const total = new Map<string, number>();
    questions.forEach((q) => total.set(q.category_id, (total.get(q.category_id) ?? 0) + 1));
    const seen = new Map<string, number>();
    return questions.map((q, index) => {
      const n = (seen.get(q.category_id) ?? 0) + 1;
      seen.set(q.category_id, n);
      return {
        ...q,
        index,
        n,
        of: total.get(q.category_id) ?? n,
        category: catNames.get(q.category_id) ?? "Kategorija",
      };
    });
  }, [questions, catNames]);
  const categories = useMemo(() => {
    const out: { id: string; name: string; items: Item[] }[] = [];
    items.forEach((it) => {
      const last = out[out.length - 1];
      if (last && last.id === it.category_id) last.items.push(it);
      else out.push({ id: it.category_id, name: it.category, items: [it] });
    });
    return out;
  }, [items]);

  const marks = useMemo(() => {
    const m = new Map<string, Entry>(
      answers.map((a) => [
        key(a.team_id, a.question_id),
        { correct: a.is_correct, parts: a.parts, points: Number(a.points) },
      ]),
    );
    optimistic.forEach((v, k) => m.set(k, v));
    return m;
  }, [answers, optimistic]);
  const entry = (tid: string, qid: string) => marks.get(key(tid, qid)) ?? EMPTY;
  const teamScore = (tid: string, qs: Item[] = items) => qs.reduce((s, q) => s + entry(tid, q.id).points, 0);

  const mark = async (tid: string, q: Q, value: Mark, parts: Mark[] | null = null) => {
    const k = key(tid, q.id);
    setOptimistic((m) => new Map(m).set(k, entryFor(q, value, parts)));
    setError(null);
    const { error } = await supabase.rpc("kviz_host_mark", {
      p_team: tid,
      p_question: q.id,
      p_correct: value,
      p_parts: parts,
    });
    if (error) setError(errorText(error));
    await load();
    setOptimistic((m) => {
      const n = new Map(m);
      n.delete(k);
      return n;
    });
  };

  // Za testiranje: vsem ekipam naključno oceni vsa vprašanja (pri miksih
  // vsak del posebej). Prepiše obstoječe ocene.
  const randomizeAll = async () => {
    if (!teams.length || !items.length) return;
    if (!window.confirm(`Naključno označim vseh ${items.length} vprašanj za ${teams.length} ekip? Obstoječe ocene bodo prepisane.`))
      return;
    setRandomizing(true);
    setError(null);
    const jobs = teams.flatMap((t) =>
      items.map((q) => {
        const parts = q.parts.length ? q.parts.map(() => Math.random() < 0.6) : null;
        return { p_team: t.id, p_question: q.id, p_correct: parts ? null : Math.random() < 0.6, p_parts: parts };
      }),
    );
    // Po 10 hkrati, da ne zasujemo strežnika.
    for (let i = 0; i < jobs.length; i += 10) {
      const res = await Promise.all(jobs.slice(i, i + 10).map((j) => supabase.rpc("kviz_host_mark", j)));
      const bad = res.find((r) => r.error);
      if (bad?.error) {
        setError(errorText(bad.error));
        break;
      }
    }
    await load();
    setRandomizing(false);
  };

  if (!room || !questions) return <div className="min-h-screen" />;

  if (room.mode !== "classic") {
    return (
      <Shell room={room}>
        <p className="rounded-xl border border-gray-200 p-4 text-sm dark:border-gray-800">
          Ročno točkovanje je samo za klasični kviz (listki). Telefonski kviz točkuje sam.
        </p>
      </Shell>
    );
  }

  const stageIdx = Math.min(Math.max(room.q_index, 0), items.length - 1);
  const idx = follow ? stageIdx : Math.min(manualIdx, items.length - 1);
  const current = items[idx];
  const activeView: View = view ?? (teams.length === 0 ? "teams" : "team");
  const team = teams.find((t) => t.id === teamId) ?? teams[0] ?? null;
  const cat =
    categories.find((c) => c.id === catId) ?? categories.find((c) => c.id === current?.category_id) ?? categories[0];

  // 0 = neocenjeno, 1 = delno (npr. miks z neocenjenimi deli), 2 = ocenjeno.
  const graded = (tid: string, q: Q): 0 | 1 | 2 => {
    const e = entry(tid, q.id);
    if (e.parts) {
      const marked = e.parts.filter((x) => x !== null).length;
      return marked === 0 ? 0 : marked === e.parts.length ? 2 : 1;
    }
    return e.correct === null ? 0 : 2;
  };

  const goTo = (i: number) => {
    setFollow(false);
    setManualIdx(Math.max(0, Math.min(items.length - 1, i)));
  };

  // Listek = ena ekipa v eni kategoriji; pregledan, ko so ocenjena vsa vprašanja.
  const sheetDone = (tid: string, c: { items: Item[] }) => c.items.every((q) => graded(tid, q) === 2);
  const catIdx = cat ? categories.findIndex((c) => c.id === cat.id) : -1;
  const teamIdx = team ? teams.findIndex((t) => t.id === team.id) : -1;
  // Naslednji listek: naslednja nepregledana ekipa v tej kategoriji (listki
  // pridejo v poljubnem vrstnem redu), ko so vsi pregledani → naslednja kategorija.
  const nextSheet = (() => {
    if (!cat || !team) return null;
    for (let i = 1; i < teams.length; i++) {
      const t = teams[(teamIdx + i) % teams.length];
      if (!sheetDone(t.id, cat)) return { cat, team: t };
    }
    const c = categories[catIdx + 1];
    if (!c) return null;
    return { cat: c, team: teams.find((t) => !sheetDone(t.id, c)) ?? teams[0] };
  })();
  const openSheet = (c: { id: string; items: Item[] }, tid?: string) => {
    setCatId(c.id);
    setTeamId(tid ?? (teams.find((t) => !sheetDone(t.id, c)) ?? teams[0])?.id ?? null);
    window.scrollTo({ top: 0 });
  };

  // Naprej / nazaj: po vprašanju → vprašanje, po listkih → naslednji listek / prejšnja ekipa.
  const stepping = activeView === "question" || activeView === "team";
  const canPrev = activeView === "question" ? idx > 0 : teamIdx > 0 || catIdx > 0;
  const canNext = activeView === "question" ? idx < items.length - 1 : nextSheet !== null;
  const step = (d: -1 | 1) => {
    if (activeView === "question") goTo(idx + d);
    else if (activeView === "team") {
      if (d === 1 && nextSheet) openSheet(nextSheet.cat, nextSheet.team.id);
      else if (d === -1 && teamIdx > 0) openSheet(cat, teams[teamIdx - 1].id);
      else if (d === -1 && categories[catIdx - 1]) openSheet(categories[catIdx - 1], teams[teams.length - 1].id);
    }
  };
  const withTimeline = stepping && teams.length > 0;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {stepping && (
        <div className="flex gap-1">
          <Button variant="secondary" onClick={() => step(-1)} disabled={!canPrev}>
            <IconChevronLeft /> Nazaj
          </Button>
          <Button variant="secondary" onClick={() => step(1)} disabled={!canNext}>
            Naprej <IconChevronRight />
          </Button>
        </div>
      )}
      <nav className="flex gap-1 rounded-xl bg-gray-100 p-1 text-sm dark:bg-gray-900">
        {(
          [
            ["team", "Po listkih"],
            ["question", "Po vprašanju"],
            ["total", "Seštevek"],
            ["teams", `Ekipe (${teams.length})`],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            aria-pressed={activeView === v}
            className={clsx(
              "whitespace-nowrap rounded-lg px-3 py-1.5 font-medium",
              activeView === v ? "bg-white shadow-sm dark:bg-gray-800" : "text-gray-500 dark:text-gray-400",
            )}
          >
            {label}
          </button>
        ))}
      </nav>
      {teams.length > 0 && (
        <Button variant="ghost" onClick={() => void randomizeAll()} disabled={randomizing} title="Za testiranje">
          {randomizing ? "Označujem …" : "Označi vse naključno (test)"}
        </Button>
      )}
    </div>
  );

  return (
    <Shell room={room} toolbar={toolbar}>
      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <div className={clsx(withTimeline && "grid items-start gap-6 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]")}>
        {withTimeline && (
          <ScoreTimeline
            categories={categories}
            stageIdx={stageIdx}
            isSelected={(q) => (activeView === "question" ? q.index === idx : q.category_id === cat?.id)}
            status={(q) => {
              // Pri listkih: stanje celotne kategorije (vse ekipe), ekipe same imajo ✓.
              const g = teams.map((t) => graded(t.id, q));
              return g.every((x) => x === 2) ? 2 : g.some((x) => x > 0) ? 1 : 0;
            }}
            onPick={(q) => {
              if (activeView === "team") {
                const c = categories.find((x) => x.id === q.category_id);
                if (c && c.id !== cat?.id) openSheet(c);
              } else goTo(q.index);
            }}
          />
        )}

        <div className="min-w-0">
          {activeView !== "teams" && teams.length === 0 && (
            <p className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700">
              Najprej dodaj ekipe v zavihku „Ekipe“.
            </p>
          )}

          {activeView === "teams" && (
            <TeamsEditor
              teams={teams}
              importable={savedNames.filter((n) => !teams.some((t) => t.name.toLowerCase() === n.toLowerCase()))}
              onImport={async () => {
                const { error } = await supabase.rpc("kviz_host_import_teams", { p_room: room.id });
                if (error) setError(errorText(error));
                await load();
              }}
              onAdd={async (name) => {
                const { error } = await supabase.rpc("kviz_host_add_team", { p_room: room.id, p_name: name });
                if (error) return errorText(error);
                await load();
                return null;
              }}
              onRename={async (id, name) => {
                const { error } = await supabase.rpc("kviz_host_rename_team", { p_team: id, p_name: name });
                if (error) return errorText(error);
                await load();
                return null;
              }}
              onDelete={async (id) => {
                const { error } = await supabase.rpc("kviz_host_delete_team", { p_team: id });
                if (error) setError(errorText(error));
                await load();
              }}
            />
          )}

          {activeView === "question" && current && teams.length > 0 && (
            <section>
              <div className="mb-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
                    {current.category}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Vprašanje {current.n}/{current.of} · {current.points}{" "}
                    {current.points === 1
                      ? "točka"
                      : current.points === 2
                        ? "točki"
                        : current.points < 5
                          ? "točke"
                          : "točk"}
                    {current.parts.length > 0 &&
                      ` (${current.parts.length} × ${fmt(current.points / current.parts.length)})`}
                  </div>
                </div>
              </div>
              {!follow && (
                <button
                  onClick={() => setFollow(true)}
                  className="mb-3 w-full rounded-lg bg-violet-50 px-3 py-1.5 text-sm text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
                >
                  Sledi odru (trenutno vprašanje {items[stageIdx]?.n} v „{items[stageIdx]?.category}“)
                </button>
              )}
              <div className="mb-4 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
                <p className="whitespace-pre-line text-sm">{plainPrompt(current.prompt)}</p>
                <p className="mt-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  ✓ {correctText(current)}
                </p>
              </div>
              <ul className="grid gap-2 2xl:grid-cols-2">
                {teams.map((t) => (
                  <MarkRow
                    key={t.id}
                    label={t.name}
                    sub={`skupaj ${fmt(teamScore(t.id))} t.`}
                    q={current}
                    value={entry(t.id, current.id)}
                    onChange={(v, parts) => void mark(t.id, current, v, parts)}
                  />
                ))}
              </ul>
              {teams.some((t) => entry(t.id, current.id).correct === null) && (
                <Button
                  variant="ghost"
                  className="mt-3 w-full"
                  onClick={() => {
                    teams
                      .filter((t) => entry(t.id, current.id).correct === null)
                      .forEach((t) => {
                        const p = entry(t.id, current.id).parts;
                        void mark(t.id, current, false, p ? p.map((x) => x ?? false) : null);
                      });
                  }}
                >
                  Neoznačene → narobe
                </Button>
              )}
            </section>
          )}

          {activeView === "team" && team && cat && (
            <section>
              <select
                value={cat.id}
                onChange={(e) => {
                  const c = categories.find((x) => x.id === e.target.value);
                  if (c) openSheet(c);
                }}
                className="mb-3 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-700 dark:bg-gray-900"
              >
                {categories.map((c, i) => (
                  <option key={c.id} value={c.id}>
                    {i + 1}. {c.name} ({teams.filter((t) => sheetDone(t.id, c)).length}/{teams.length} listkov)
                  </option>
                ))}
              </select>
              <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">
                Izberi ekipo z listka ({teams.filter((t) => sheetDone(t.id, cat)).length}/{teams.length} pregledanih):
              </div>
              <div className="mb-4 grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
                {teams.map((t) => {
                  const done = sheetDone(t.id, cat);
                  const sel = t.id === team.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => {
                        setTeamId(t.id);
                        window.scrollTo({ top: 0 });
                      }}
                      aria-pressed={sel}
                      className={clsx(
                        "flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-2 text-left text-sm font-medium",
                        sel
                          ? "border-violet-600 bg-violet-600 text-white"
                          : done
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "border-gray-300 dark:border-gray-700",
                      )}
                    >
                      {done && <IconCheck className="h-4 w-4 shrink-0" />}
                      <span className="min-w-0 truncate">{t.name}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="min-w-0 truncate text-lg font-bold">{team.name}</h2>
                <span className="shrink-0 text-sm text-gray-500 dark:text-gray-400">
                  {fmt(teamScore(team.id, cat.items))} t. · skupaj{" "}
                  <b className="text-gray-900 dark:text-gray-100">{fmt(teamScore(team.id))}</b>
                </span>
              </div>
              <ul className="space-y-2">
                {cat.items.map((q) => (
                  <MarkRow
                    key={q.id}
                    label={`${q.n}. ${plainPrompt(q.prompt)}`}
                    sub={`✓ ${correctText(q)}`}
                    q={q}
                    value={entry(team.id, q.id)}
                    onChange={(v, parts) => void mark(team.id, q, v, parts)}
                  />
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                {!sheetDone(team.id, cat) && (
                  <Button
                    variant="ghost"
                    className="flex-1"
                    onClick={() => {
                      cat.items
                        .filter((q) => graded(team.id, q) < 2)
                        .forEach((q) => {
                          const p = entry(team.id, q.id).parts;
                          void mark(team.id, q, false, p ? p.map((x) => x ?? false) : null);
                        });
                    }}
                  >
                    Neoznačene → narobe
                  </Button>
                )}
                {nextSheet && (
                  <Button className="flex-1" onClick={() => openSheet(nextSheet.cat, nextSheet.team.id)}>
                    {nextSheet.cat.id === cat.id
                      ? `Naslednji listek: ${nextSheet.team.name}`
                      : `Kategorija ${catIdx + 2}: ${nextSheet.cat.name}`}
                    <IconChevronRight />
                  </Button>
                )}
              </div>
            </section>
          )}

          {activeView === "total" && teams.length > 0 && (
            <section className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2 pr-2">Ekipa</th>
                    {categories.map((c, i) => (
                      <th key={c.id} className="px-1 py-2 text-right" title={c.name}>
                        K{i + 1}
                      </th>
                    ))}
                    <th className="py-2 pl-2 text-right">Skupaj</th>
                  </tr>
                </thead>
                <tbody>
                  {[...teams]
                    .map((t) => ({ t, total: teamScore(t.id) }))
                    .sort((a, b) => b.total - a.total)
                    .map(({ t, total }, i, arr) => (
                      <tr key={t.id} className="border-t border-gray-200 dark:border-gray-800">
                        <td className="py-2 pr-2 text-gray-500">{arr.findIndex((x) => x.total === total) + 1}.</td>
                        <td className="py-2 pr-2 font-medium">{t.name}</td>
                        {categories.map((c) => (
                          <td key={c.id} className="px-1 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">
                            {fmt(teamScore(t.id, c.items))}
                          </td>
                        ))}
                        <td className="py-2 pl-2 text-right text-base font-bold tabular-nums">{fmt(total)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                {categories.map((c, i) => `K${i + 1} = ${c.name}`).join(" · ")}
              </p>
            </section>
          )}
        </div>
      </div>
    </Shell>
  );
}

// Časovnica za točkovanje: vrstica na kategorijo, krogec na vprašanje.
// Zelen = ocenjeno, oranžen = delno, siv = neocenjeno; obroba = izbrano,
// pikica = vprašanje, ki je trenutno na odru. Klik preskoči samo točkovanje,
// oder ostane, kjer je.
function ScoreTimeline({
  categories,
  stageIdx,
  isSelected,
  status,
  onPick,
}: {
  categories: { id: string; name: string; items: Item[] }[];
  stageIdx: number;
  isSelected: (q: Item) => boolean;
  status: (q: Item) => 0 | 1 | 2;
  onPick: (q: Item) => void;
}) {
  return (
    <nav
      aria-label="Časovnica vprašanj"
      className="mb-4 space-y-0.5 rounded-xl border border-gray-200 p-2 lg:sticky lg:top-24 lg:mb-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:border-gray-800"
    >
      {categories.map((c, ci) => {
        const catSelected = c.items.some(isSelected);
        return (
          <div
            key={c.id}
            className={clsx("rounded-lg px-2 py-1.5", catSelected && "bg-violet-50 dark:bg-violet-950/40")}
          >
            <button
              type="button"
              onClick={() => onPick(c.items[0])}
              title={c.name}
              className={clsx(
                "mb-1 block w-full truncate text-left text-xs font-semibold",
                catSelected ? "text-violet-600 dark:text-violet-400" : "text-gray-500 dark:text-gray-400",
              )}
            >
              {ci + 1}. {c.name}
            </button>
            <div className="flex flex-wrap gap-1">
              {c.items.map((q) => {
                const s = status(q);
                const sel = isSelected(q);
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onPick(q);
                    }}
                    title={`${c.name} · vprašanje ${q.n}${q.index === stageIdx ? " (na odru)" : ""}`}
                    aria-label={`${c.name}, vprašanje ${q.n}`}
                    aria-current={sel ? "step" : undefined}
                    className={clsx(
                      "relative flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold tabular-nums transition-colors",
                      s === 2
                        ? "bg-emerald-500 text-white"
                        : s === 1
                          ? "bg-amber-400 text-amber-950"
                          : "bg-gray-200 text-gray-600 hover:bg-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700",
                      sel &&
                        "ring-2 ring-violet-600 ring-offset-2 ring-offset-white dark:ring-violet-400 dark:ring-offset-gray-950",
                    )}
                  >
                    {q.n}
                    {q.index === stageIdx && (
                      <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-cyan-500 dark:border-gray-950" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 pt-1 text-[11px] text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> ocenjeno
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> delno
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-cyan-500" /> na odru
        </span>
      </div>
    </nav>
  );
}

function Shell({ room, toolbar, children }: { room: KvizRoom; toolbar?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="w-full px-4 pb-6 lg:px-6">
      <header className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-200 bg-gray-50/90 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6 dark:border-gray-800 dark:bg-gray-950/90">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link
            href={`/oder/${room.code}`}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Na oder"
          >
            <IconArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate font-semibold">Točkovanje · {room.title}</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Soba <span className="font-mono tracking-widest">{room.code}</span>
            </p>
          </div>
        </div>
        {toolbar}
      </header>
      {children}
    </div>
  );
}

// Vrstica z ✓/✗ za celo vprašanje; pri vprašanju z deli (miks) še gumbi
// za vsak del: klik → ✓, še klik → ✗, še klik → neocenjeno.
function MarkRow({
  label,
  sub,
  q,
  value: entry,
  onChange,
}: {
  label: string;
  sub?: string;
  q: Q;
  value: Entry;
  onChange: (v: Mark, parts: Mark[] | null) => void;
}) {
  const n = q.parts.length;
  const parts: Mark[] = n ? (entry.parts ?? Array.from({ length: n }, () => entry.correct)) : [];
  const partial = n > 0 && entry.points > 0 && entry.correct !== true;
  const value: Mark = partial ? null : entry.correct;
  const labels = n ? partLabels(q) : [];
  return (
    <li
      className={clsx(
        "rounded-xl border px-3 py-2",
        value === true && "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40",
        value === false && "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30",
        partial && "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30",
        value === null && !partial && "border-gray-200 dark:border-gray-800",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 font-medium">{label}</div>
          {sub && <div className="truncate text-xs text-gray-500 dark:text-gray-400">{sub}</div>}
        </div>
        {n > 0 && (
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {fmt(entry.points)}/{q.points}
          </span>
        )}
        <button
          onClick={() => onChange(value === true ? null : true, null)}
          aria-label="Pravilno"
          className={clsx(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border",
            value === true
              ? "border-emerald-600 bg-emerald-600 text-white"
              : "border-gray-300 text-emerald-600 dark:border-gray-700",
          )}
        >
          <IconCheck className="h-6 w-6" />
        </button>
        <button
          onClick={() => onChange(value === false ? null : false, null)}
          aria-label="Narobe"
          className={clsx(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border",
            value === false
              ? "border-rose-600 bg-rose-600 text-white"
              : "border-gray-300 text-rose-600 dark:border-gray-700",
          )}
        >
          <IconX className="h-6 w-6" />
        </button>
      </div>
      {n > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {parts.map((p, i) => (
            <button
              key={i}
              onClick={() => {
                const next = [...parts];
                next[i] = p === null ? true : p === true ? false : null;
                onChange(null, next);
              }}
              className={clsx(
                "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-sm",
                p === true && "border-emerald-600 bg-emerald-600 text-white",
                p === false && "border-rose-600 bg-rose-600 text-white",
                p === null && "border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900",
              )}
            >
              <span className="w-4 shrink-0 text-center font-bold">{p === true ? "✓" : p === false ? "✗" : "·"}</span>
              <span className="min-w-0 truncate">{labels[i]}</span>
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function TeamsEditor({
  teams,
  importable,
  onImport,
  onAdd,
  onRename,
  onDelete,
}: {
  teams: KvizTeam[];
  importable: string[];
  onImport: () => Promise<void>;
  onAdd: (name: string) => Promise<string | null>;
  onRename: (id: string, name: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const e2 = await onAdd(name);
    setErr(e2);
    if (!e2) setName("");
    setBusy(false);
  };

  return (
    <section>
      {importable.length > 0 && (
        <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950/40">
          <div className="mb-2 text-sm">
            <b>Izžrebane ekipe:</b> {importable.join(", ")}
          </div>
          <Button
            className="w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onImport();
              setBusy(false);
            }}
          >
            Dodaj izžrebane ekipe ({importable.length})
          </Button>
        </div>
      )}
      <form onSubmit={add} className="mb-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Ime ekipe"
          autoFocus
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
        <Button type="submit" disabled={busy || !name.trim()}>
          Dodaj
        </Button>
      </form>
      {err && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{err}</p>}
      {teams.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Dodaj vse ekipe, ki igrajo. Imena lahko kasneje popraviš.
        </p>
      )}
      <ul className="space-y-1.5">
        {teams.map((t, i) => (
          <li
            key={t.id}
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 dark:border-gray-800"
          >
            <span className="w-6 text-sm text-gray-400">{i + 1}.</span>
            {editing?.id === t.id ? (
              <form
                className="flex flex-1 gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const e2 = await onRename(t.id, editing.name);
                  setErr(e2);
                  if (!e2) setEditing(null);
                }}
              >
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ id: t.id, name: e.target.value })}
                  maxLength={40}
                  autoFocus
                  className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
                />
                <Button type="submit">Shrani</Button>
              </form>
            ) : (
              <>
                <span className="flex-1 truncate">{t.name}</span>
                <Button variant="ghost" aria-label="Preimenuj" onClick={() => setEditing({ id: t.id, name: t.name })}>
                  <IconPencil />
                </Button>
                <Button
                  variant="ghost"
                  aria-label="Odstrani"
                  onClick={() => {
                    if (window.confirm(`Odstranim ekipo „${t.name}“ in njene točke?`)) void onDelete(t.id);
                  }}
                >
                  <IconTrash />
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
