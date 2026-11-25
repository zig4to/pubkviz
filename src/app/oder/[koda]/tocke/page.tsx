import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeCode } from "@/lib/kviz";
import Scoring from "@/components/scoring/Scoring";

export const metadata = { title: "Točkovanje — Garaža pub kviz" };

// Točkovanje klasičnega kviza (telefon/tablica/drugo okno voditelja).
// RLS vrne sobo samo njenemu voditelju.
export default async function Tocke({ params }: { params: Promise<{ koda: string }> }) {
  const { koda } = await params;
  const code = normalizeCode(decodeURIComponent(koda));
  const supabase = await createClient();
  const { data: room } = await supabase.from("kviz_rooms").select("id").eq("code", code).maybeSingle();
  if (!room) notFound();
  return <Scoring roomId={room.id} />;
}
