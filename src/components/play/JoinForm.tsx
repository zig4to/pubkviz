"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { normalizeCode } from "@/lib/kviz";

export default function JoinForm() {
  const router = useRouter();
  const [code, setCode] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 5) router.push(`/igra/${code}`);
      }}
      className="space-y-3"
    >
      <input
        value={code}
        onChange={(e) => setCode(normalizeCode(e.target.value))}
        placeholder="KODA"
        aria-label="Koda sobe"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
        className="w-full rounded-xl border-2 border-gray-300 bg-white py-4 text-center font-mono text-4xl font-bold uppercase tracking-[0.4em] text-gray-900 placeholder:text-gray-300 focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-700"
      />
      <Button type="submit" disabled={code.length !== 5} className="w-full py-3 text-base">
        Vstopi
      </Button>
    </form>
  );
}
