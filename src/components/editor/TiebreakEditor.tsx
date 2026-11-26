"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { errorText } from "@/lib/kviz";
import type { KvizTiebreaker } from "@/lib/types/database.types";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { IconArrowDown, IconArrowUp, IconPencil, IconPlus, IconTrash } from "@/components/ui/icons";

type Draft = { prompt: string; answer: string; explanation: string };
const EMPTY: Draft = { prompt: "", answer: "", explanation: "" };

// Dodatna vprašanja za izenačenje („kdor je bližji, zmaga“), 0016. Ločena od
// kategorij, ne štejejo v točke; oder jih po vrsti porabi pred končnimi
// rezultati, če imata dve ali več ekip enako točk. Odgovor je število (lahko
// z enoto, npr. „8849 m“).
export default function TiebreakEditor({ quizId, initial }: { quizId: string; initial: KvizTiebreaker[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (t: KvizTiebreaker | null) => {
    setError(null);
    setEditing(t ? t.id : "new");
    setDraft(t ? { prompt: t.prompt, answer: t.answer, explanation: t.explanation ?? "" } : EMPTY);
  };

  const save = async () => {
    const row = {
      prompt: draft.prompt.trim(),
      answer: draft.answer.trim(),
      explanation: draft.explanation.trim() || null,
    };
    if (!row.prompt || !row.answer) return setError("Vpiši vprašanje in odgovor.");
    setBusy(true);
    setError(null);
    const res =
      editing === "new"
        ? await supabase
            .from("kviz_tiebreakers")
            .insert({ ...row, quiz_id: quizId, position: (items.at(-1)?.position ?? -1) + 1 })
            .select("*")
            .single()
        : await supabase.from("kviz_tiebreakers").update(row).eq("id", editing!).select("*").single();
    setBusy(false);
    if (res.error || !res.data) return setError(errorText(res.error));
    const saved = res.data;
    setItems((xs) => (editing === "new" ? [...xs, saved] : xs.map((x) => (x.id === saved.id ? saved : x))));
    setEditing(null);
  };

  const remove = async (t: KvizTiebreaker) => {
    if (!window.confirm("Izbrišem to dodatno vprašanje?")) return;
    const { error } = await supabase.from("kviz_tiebreakers").delete().eq("id", t.id);
    if (error) return setError(errorText(error));
    setItems((xs) => xs.filter((x) => x.id !== t.id));
  };

  const move = async (i: number, d: -1 | 1) => {
    const a = items[i];
    const b = items[i + d];
    if (!a || !b) return;
    const next = [...items];
    next[i] = { ...b, position: a.position };
    next[i + d] = { ...a, position: b.position };
    setItems(next);
    const r = await Promise.all([
      supabase.from("kviz_tiebreakers").update({ position: b.position }).eq("id", a.id),
      supabase.from("kviz_tiebreakers").update({ position: a.position }).eq("id", b.id),
    ]);
    const bad = r.find((x) => x.error);
    if (bad?.error) setError(errorText(bad.error));
  };

  const form = (
    <div className="space-y-2 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
      <Input
        value={draft.prompt}
        onChange={(e) => setDraft({ ...draft, prompt: e.target.value.slice(0, 500) })}
        placeholder="Vprašanje, npr. Koliko metrov je visok Triglav?"
        autoFocus
      />
      <div className="flex gap-2">
        <Input
          value={draft.answer}
          onChange={(e) => setDraft({ ...draft, answer: e.target.value.slice(0, 200) })}
          placeholder="Odgovor, npr. 2864 m"
          className="w-48"
        />
        <Input
          value={draft.explanation}
          onChange={(e) => setDraft({ ...draft, explanation: e.target.value.slice(0, 300) })}
          placeholder="Pojasnilo (neobvezno)"
          className="flex-1"
        />
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setEditing(null)}>
          Prekliči
        </Button>
        <Button onClick={() => void save()} disabled={busy}>
          Shrani
        </Button>
      </div>
    </div>
  );

  return (
    <section className="rounded-xl border border-amber-300/60 bg-white dark:border-amber-700/50 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <div>
          <h2 className="font-semibold">Dodatna vprašanja (izenačenje)</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Kdor je bližji, zmaga. Ne štejejo v točke — oder jih po vrsti pokaže pred končnimi rezultati, če imajo
            ekipe enako točk.
          </p>
        </div>
        {editing !== "new" && (
          <Button variant="secondary" onClick={() => open(null)}>
            <IconPlus /> Dodaj
          </Button>
        )}
      </div>
      <ol className="divide-y divide-gray-100 dark:divide-gray-800">
        {items.map((t, i) => (
          <li key={t.id} className="px-4 py-2.5">
            {editing === t.id ? (
              form
            ) : (
              <div className="flex items-center gap-3">
                <span className="w-5 text-sm text-gray-400">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.prompt}</div>
                  <div className="truncate text-xs text-emerald-700 dark:text-emerald-400">✓ {t.answer}</div>
                </div>
                <Button variant="ghost" aria-label="Gor" disabled={i === 0} onClick={() => void move(i, -1)}>
                  <IconArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  aria-label="Dol"
                  disabled={i === items.length - 1}
                  onClick={() => void move(i, 1)}
                >
                  <IconArrowDown />
                </Button>
                <Button variant="ghost" aria-label="Uredi" onClick={() => open(t)}>
                  <IconPencil />
                </Button>
                <Button variant="ghost" aria-label="Izbriši" onClick={() => void remove(t)}>
                  <IconTrash />
                </Button>
              </div>
            )}
          </li>
        ))}
        {editing === "new" && <li className="px-4 py-2.5">{form}</li>}
        {items.length === 0 && editing !== "new" && (
          <li className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
            Še ni dodatnih vprašanj. Dodaj vsaj eno ali dve za primer izenačenja.
          </li>
        )}
      </ol>
    </section>
  );
}
