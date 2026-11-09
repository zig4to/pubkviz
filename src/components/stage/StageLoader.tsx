"use client";

import dynamic from "next/dynamic";

// Oder potrebuje window (naslov za QR, celozaslonski način) — samo v brskalniku.
const Stage = dynamic(() => import("./Stage"), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-gray-950" />,
});

export default function StageLoader({ roomId }: { roomId: string }) {
  return <Stage roomId={roomId} />;
}
