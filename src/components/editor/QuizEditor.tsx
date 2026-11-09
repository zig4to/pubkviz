"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LETTERS, errorText } from "@/lib/kviz";
import type { KvizCategory, KvizQuestion, KvizQuiz } from "@/lib/types/database.types";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconImage,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@/components/ui/icons";
import QuestionDialog from "./QuestionDialog";

const ICON_BTN =
  "rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-gray-800 dark:hover:text-gray-200";

type Editing = { categoryId: string; question: KvizQuestion | null } | null;

// Urejevalnik: kategorije (vrstni red = vrstni red v igri) z vprašanji.
// Spremembe gredo takoj v bazo (RLS: samo lastnik), lokalno stanje se
// posodobi z vrnjeno vrstico.
export default function QuizEditor({
  quiz,
  categories: initialCats,
  questions: initialQs,
}: {
  quiz: KvizQuiz;
  categories: KvizCategory[];
  questions: KvizQuestion[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [title, setTitle] = useState(quiz.title);
  const [savedTitle, setSavedTitle] = useState(quiz.title);
  const [cats, setCats] = useState(initialCats);
  const [qs, setQs] = useState(initialQs);
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) => setError(errorText(e));

  const saveTitle = async () => {
    const t = title.trim();
    if (!t || t === savedTitle) return setTitle(savedTitle);
    const { error } = await supabase
      .from("kviz_quizzes")
      .update({ title: t, updated_at: new Date().toISOString() })
      .eq("id", quiz.id);
    if (error) return fail(error);
    setSavedTitle(t);
    setTitle(t);
  };

  const addCategory = async () => {
    const position = cats.length ? Math.max(...cats.map((c) => c.position)) + 1 : 0;
    const { data, error } = await supabase
      .from("kviz_categories")
      .insert({ quiz_id: quiz.id, name: `Kategorija ${cats.length + 1}`, position })
      .select("*")
      .single();
    if (error || !data) return fail(error);
    setCats((c) => [...c, data]);
  };

  const renameCategory = async (cat: KvizCategory, name: string) => {
    const n = name.trim();
    if (!n || n === cat.name) return;
    const { error } = await supabase.from("kviz_categories").update({ name: n }).eq("id", cat.id);
    if (error) return fail(error);
    setCats((cs) => cs.map((c) => (c.id === cat.id ? { ...c, name: n } : c)));
  };

  const deleteCategory = async (cat: KvizCategory) => {
    const n = qs.filter((q) => q.category_id === cat.id).length;
    if (!window.confirm(`Izbrišem kategorijo „${cat.name}“${n ? ` in ${n} vprašanj v njej` : ""}?`)) return;
    const { error } = await supabase.from("kviz_categories").delete().eq("id", cat.id);
    if (error) return fail(error);
    setCats((cs) => cs.filter((c) => c.id !== cat.id));
    setQs((all) => all.filter((q) => q.category_id !== cat.id));
  };

  // Premakne element na sosednje mesto in preštevilči cel (urejen) seznam
  // 0…n−1 — položaji imajo lahko vrzeli (brisanje), zato samo zamenjava
  // dveh vrednosti ne bi vedno dala pravega vrstnega reda.
  async function swap<T extends { id: string; position: number }>(
    table: "kviz_categories" | "kviz_questions",
    list: T[],
    i: number,
    j: number,
    set: (fn: (prev: T[]) => T[]) => void
  ) {
    if (!list[i] || !list[j]) return;
    const order = [...list];
    [order[i], order[j]] = [order[j], order[i]];
    const changed = order.map((x, idx) => ({ id: x.id, position: idx })).filter((x, idx) => order[idx].position !== idx);
    const results = await Promise.all(
      changed.map((c) => supabase.from(table).update({ position: c.position }).eq("id", c.id))
    );
    const err = results.find((r) => r.error)?.error;
    if (err) return fail(err);
    const pos = new Map(changed.map((c) => [c.id, c.position]));
    set((prev) => prev.map((x) => (pos.has(x.id) ? { ...x, position: pos.get(x.id)! } : x)));
  }

  const deleteQuestion = async (q: KvizQuestion) => {
    if (!window.confirm(`Izbrišem vprašanje „${q.prompt.slice(0, 60)}“?`)) return;
    const { error } = await supabase.from("kviz_questions").delete().eq("id", q.id);
    if (error) return fail(error);
    if (q.image_path) void supabase.storage.from("kviz").remove([q.image_path]);
    setQs((all) => all.filter((x) => x.id !== q.id));
  };

  const start = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("kviz_open_room", { p_quiz: quiz.id });
    setBusy(false);
    if (error || !data) return fail(error);
    router.push(`/oder/${data}`);
  };

  const deleteQuiz = async () => {
    if (!window.confirm(`Izbrišem cel kviz „${savedTitle}“ z vsemi vprašanji in odigranimi igrami?`)) return;
    const paths = qs.map((q) => q.image_path).filter((p): p is string => !!p);
    const { error } = await supabase.from("kviz_quizzes").delete().eq("id", quiz.id);
    if (error) return fail(error);
    if (paths.length) void supabase.storage.from("kviz").remove(paths);
    router.push("/admin");
    router.refresh();
  };

  const sortedCats = [...cats].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  const total = qs.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/admin" aria-label="Nazaj" className={ICON_BTN}>
          <IconArrowLeft className="h-5 w-5" />
        </Link>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 120))}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          aria-label="Ime kviza"
          className="flex-1 border-transparent bg-transparent text-lg font-semibold shadow-none hover:border-gray-300 dark:border-transparent dark:bg-transparent dark:hover:border-gray-700"
        />
        <Button onClick={start} disabled={busy || total === 0}>
          Začni igro
        </Button>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}

      {sortedCats.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          Kviz je sestavljen iz kategorij (npr. Glasba, Šport, Zgodovina). Dodaj prvo.
        </div>
      )}

      {sortedCats.map((cat, ci) => {
        const catQs = qs
          .filter((q) => q.category_id === cat.id)
          .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
        return (
          <section key={cat.id} className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-1 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
              <span className="w-6 text-sm font-semibold text-gray-400">{ci + 1}.</span>
              <CategoryName cat={cat} onSave={(n) => renameCategory(cat, n)} />
              <button className={ICON_BTN} disabled={ci === 0} aria-label="Gor" onClick={() => swap("kviz_categories", sortedCats, ci, ci - 1, setCats)}>
                <IconArrowUp />
              </button>
              <button
                className={ICON_BTN}
                disabled={ci === sortedCats.length - 1}
                aria-label="Dol"
                onClick={() => swap("kviz_categories", sortedCats, ci, ci + 1, setCats)}
              >
                <IconArrowDown />
              </button>
              <button className={ICON_BTN} aria-label="Izbriši kategorijo" onClick={() => deleteCategory(cat)}>
                <IconTrash />
              </button>
            </div>

            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {catQs.map((q, qi) => (
                <li key={q.id} className="flex items-center gap-2 px-3 py-2">
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                    style={{ backgroundColor: q.type === "choice" ? "#7c3aed" : "#0891b2" }}
                    title={q.type === "choice" ? "Izbira A–D" : "Vpis odgovora"}
                  >
                    {q.type === "choice" ? LETTERS.slice(0, q.options.length).join("") : "vpis"}
                  </span>
                  <button className="min-w-0 flex-1 text-left" onClick={() => setEditing({ categoryId: cat.id, question: q })}>
                    <div className="truncate text-sm">{q.prompt}</div>
                    <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {q.type === "choice" && q.correct_index !== null
                        ? `Pravilno ${LETTERS[q.correct_index]}: ${q.options[q.correct_index]}`
                        : `Pravilno: ${q.accepted_answers.join(" / ")}`}
                      {" · "}
                      {q.points} t.
                    </div>
                  </button>
                  {q.image_path && <IconImage className="h-4 w-4 shrink-0 text-gray-400" />}
                  <button className={ICON_BTN} disabled={qi === 0} aria-label="Gor" onClick={() => swap("kviz_questions", catQs, qi, qi - 1, setQs)}>
                    <IconArrowUp />
                  </button>
                  <button
                    className={ICON_BTN}
                    disabled={qi === catQs.length - 1}
                    aria-label="Dol"
                    onClick={() => swap("kviz_questions", catQs, qi, qi + 1, setQs)}
                  >
                    <IconArrowDown />
                  </button>
                  <button className={ICON_BTN} aria-label="Uredi" onClick={() => setEditing({ categoryId: cat.id, question: q })}>
                    <IconPencil />
                  </button>
                  <button className={ICON_BTN} aria-label="Izbriši" onClick={() => deleteQuestion(q)}>
                    <IconTrash />
                  </button>
                </li>
              ))}
            </ul>
            <div className="px-3 py-2">
              <Button variant="ghost" onClick={() => setEditing({ categoryId: cat.id, question: null })}>
                <IconPlus /> Vprašanje
              </Button>
            </div>
          </section>
        );
      })}

      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={addCategory}>
          <IconPlus /> Kategorija
        </Button>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {sortedCats.length} kat. · {total} vpr.
        </span>
      </div>

      <div className="border-t border-gray-200 pt-6 dark:border-gray-800">
        <Button variant="ghost" onClick={deleteQuiz} className="text-red-600 dark:text-red-400">
          <IconTrash /> Izbriši kviz
        </Button>
      </div>

      {editing && (
        <QuestionDialog
          ownerId={quiz.owner_id}
          quizId={quiz.id}
          categoryId={editing.categoryId}
          question={editing.question}
          nextPosition={
            qs.filter((q) => q.category_id === editing.categoryId).reduce((m, q) => Math.max(m, q.position + 1), 0)
          }
          onClose={() => setEditing(null)}
          onSaved={(row) => {
            setQs((all) => (all.some((q) => q.id === row.id) ? all.map((q) => (q.id === row.id ? row : q)) : [...all, row]));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function CategoryName({ cat, onSave }: { cat: KvizCategory; onSave: (name: string) => void }) {
  const [name, setName] = useState(cat.name);
  return (
    <Input
      value={name}
      onChange={(e) => setName(e.target.value.slice(0, 80))}
      onBlur={() => (name.trim() ? onSave(name) : setName(cat.name))}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      aria-label="Ime kategorije"
      className="flex-1 border-transparent bg-transparent font-semibold shadow-none hover:border-gray-300 dark:border-transparent dark:bg-transparent dark:hover:border-gray-700"
    />
  );
}
