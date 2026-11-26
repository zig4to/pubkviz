import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AnswerSheets from "@/components/print/AnswerSheets";

export const metadata = { title: "Listki — Garaža pub kviz" };

// Listki za odgovore (klasični kviz) za tisk: dve kategoriji na A4.
// Izven skupine (app), da na izpisu ni zgornje vrstice. RLS: samo lastnik.
export default async function Listki({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: quiz } = await supabase.from("kviz_quizzes").select("*").eq("id", id).maybeSingle();
  if (!quiz) notFound();

  const [cats, qs] = await Promise.all([
    supabase.from("kviz_categories").select("*").eq("quiz_id", id).order("position").order("created_at"),
    supabase.from("kviz_questions").select("*").eq("quiz_id", id).order("position").order("created_at"),
  ]);

  return <AnswerSheets quiz={quiz} categories={cats.data ?? []} questions={qs.data ?? []} />;
}
