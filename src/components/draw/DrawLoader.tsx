"use client";

import dynamic from "next/dynamic";

// Seznam imen živi v localStorage, zato stran teče samo v brskalniku.
const TeamDraw = dynamic(() => import("./TeamDraw"), { ssr: false });

export default function DrawLoader() {
  return <TeamDraw />;
}
