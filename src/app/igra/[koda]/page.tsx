import PlayLoader from "@/components/play/PlayLoader";
import { normalizeCode } from "@/lib/kviz";

export default async function Igra({ params }: { params: Promise<{ koda: string }> }) {
  const { koda } = await params;
  return <PlayLoader code={normalizeCode(decodeURIComponent(koda))} />;
}
