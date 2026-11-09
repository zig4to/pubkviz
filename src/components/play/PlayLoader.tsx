"use client";

import dynamic from "next/dynamic";

// Igralčev žeton živi v localStorage, zato stran teče samo v brskalniku.
const PlayClient = dynamic(() => import("./PlayClient"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-gray-300 border-t-violet-600 dark:border-gray-700 dark:border-t-violet-400" />
    </div>
  ),
});

export default function PlayLoader({ code }: { code: string }) {
  return <PlayClient code={code} />;
}
