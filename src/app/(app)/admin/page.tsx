import { createClient } from "@/lib/supabase/server";
import AdminHome from "@/components/admin/AdminHome";

export const metadata = { title: "Kvizi — Garaža pub kviz" };

export default async function Admin() {
  const supabase = await createClient();
  const [quizzes, questions, rooms] = await Promise.all([
    supabase.from("kviz_quizzes").select("*").order("updated_at", { ascending: false }),
    supabase.from("kviz_questions").select("quiz_id"),
    supabase
      .from("kviz_rooms")
      .select("id, code, title, state, q_index, question_ids, created_at")
      .neq("state", "finished")
      .order("created_at", { ascending: false }),
  ]);

  const counts: Record<string, number> = {};
  for (const q of questions.data ?? []) counts[q.quiz_id] = (counts[q.quiz_id] ?? 0) + 1;

  return (
    <AdminHome
      quizzes={(quizzes.data ?? []).map((q) => ({ ...q, questionCount: counts[q.id] ?? 0 }))}
      rooms={(rooms.data ?? []).map((r) => ({
        id: r.id,
        code: r.code,
        title: r.title,
        state: r.state,
        progress: `${Math.max(0, r.q_index + 1)}/${r.question_ids.length}`,
      }))}
    />
  );
}
