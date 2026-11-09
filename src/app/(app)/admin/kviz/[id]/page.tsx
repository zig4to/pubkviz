import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import QuizEditor from "@/components/editor/QuizEditor";

export const metadata = { title: "Urejanje — Kviz" };

export default async function UrediKviz({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: quiz } = await supabase.from("kviz_quizzes").select("*").eq("id", id).maybeSingle();
  if (!quiz) notFound();

  const [cats, qs] = await Promise.all([
    supabase.from("kviz_categories").select("*").eq("quiz_id", id).order("position").order("created_at"),
    supabase.from("kviz_questions").select("*").eq("quiz_id", id).order("position").order("created_at"),
  ]);

  return <QuizEditor key={quiz.id} quiz={quiz} categories={cats.data ?? []} questions={qs.data ?? []} />;
}
