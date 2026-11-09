"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { errorText } from "@/lib/kviz";
import type { KvizQuiz, RoomState } from "@/lib/types/database.types";
import Button from "@/components/ui/Button";
import { IconPencil, IconPlus, IconChevronRight, IconShuffle } from "@/components/ui/icons";

type QuizItem = KvizQuiz & { questionCount: number };
type RoomItem = { id: string; code: string; title: string; state: RoomState; progress: string };

const STATE_LABEL: Record<RoomState, string> = {
  lobby: "čaka igralce",
  question: "vprašanje",
  reveal: "razkritje",
  scoreboard: "lestvica",
  finished: "končana",
};

export default function AdminHome({ quizzes, rooms }: { quizzes: QuizItem[]; rooms: RoomItem[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const newQuiz = async () => {
    setBusy("new");
    setError(null);
    const { data, error } = await supabase.from("kviz_quizzes").insert({ title: "Nov kviz" }).select("id").single();
    setBusy(null);
    if (error || !data) return setError(errorText(error));
    router.push(`/admin/kviz/${data.id}`);
  };

  const start = async (quizId: string) => {
    setBusy(quizId);
    setError(null);
    const { data, error } = await supabase.rpc("kviz_open_room", { p_quiz: quizId });
    setBusy(null);
    if (error || !data) return setError(errorText(error));
    router.push(`/oder/${data}`);
  };

  const finish = async (roomId: string) => {
    setBusy(roomId);
    await supabase.rpc("kviz_finish", { p_room: roomId });
    setBusy(null);
    router.refresh();
  };

  return (
    <div className="space-y-8">
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}

      {rooms.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Odprte sobe
          </h2>
          <ul className="space-y-2">
            {rooms.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-900 dark:bg-violet-950/40"
              >
                <span className="font-mono text-lg font-bold tracking-widest">{r.code}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.title}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {STATE_LABEL[r.state]} · {r.progress}
                  </div>
                </div>
                <Button variant="ghost" disabled={busy === r.id} onClick={() => finish(r.id)}>
                  Končaj
                </Button>
                <Link
                  href={`/oder/${r.code}`}
                  className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
                >
                  Oder <IconChevronRight />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Moji kvizi</h1>
          <div className="flex items-center gap-2">
            <Link
              href="/zrebanje"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <IconShuffle /> Žrebaj skupine
            </Link>
            <Button onClick={newQuiz} disabled={busy === "new"}>
              <IconPlus /> Nov kviz
            </Button>
          </div>
        </div>
        {quizzes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            Še nimaš kviza. Ustvari prvega in mu dodaj kategorije ter vprašanja.
          </div>
        ) : (
          <ul className="space-y-2">
            {quizzes.map((q) => (
              <li
                key={q.id}
                className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{q.title}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {q.questionCount} {q.questionCount === 1 ? "vprašanje" : q.questionCount === 2 ? "vprašanji" : q.questionCount < 5 ? "vprašanja" : "vprašanj"}
                  </div>
                </div>
                <Link
                  href={`/admin/kviz/${q.id}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  <IconPencil /> Uredi
                </Link>
                <Button onClick={() => start(q.id)} disabled={busy === q.id || q.questionCount === 0}>
                  Začni igro
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
