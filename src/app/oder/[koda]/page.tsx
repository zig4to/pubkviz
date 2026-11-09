import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeCode } from "@/lib/kviz";
import StageLoader from "@/components/stage/StageLoader";

export const metadata = { title: "Oder — Garaža pub kviz" };

// Projektor voditelja. RLS vrne sobo samo njenemu voditelju.
export default async function Oder({ params }: { params: Promise<{ koda: string }> }) {
  const { koda } = await params;
  const code = normalizeCode(decodeURIComponent(koda));
  const supabase = await createClient();
  const { data: room } = await supabase.from("kviz_rooms").select("id").eq("code", code).maybeSingle();
  if (!room) notFound();
  return <StageLoader roomId={room.id} />;
}
