"use client";

import Link from "next/link";
import { LETTERS } from "@/lib/kviz";
import type { KvizCategory, KvizQuestion, KvizQuiz } from "@/lib/types/database.types";
import Logo from "@/components/Logo";
import Button from "@/components/ui/Button";
import { IconArrowLeft, IconPrinter } from "@/components/ui/icons";

// Listki za odgovore klasičnega kviza: A4 ležeče = dve A5 polovici (ena
// kategorija na polovico), črtkana črta za rezanje na sredini. Samo prostor za
// odgovore — vprašanja so na odru. Fiksno črno na belem (ne glede na temo).
const PRINT_CSS = `
@page { size: A4 landscape; margin: 0; }
@media print {
  html, body { background: #fff !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

const fmt = (n: number) => n.toLocaleString("sl-SI", { maximumFractionDigits: 2 });

export default function AnswerSheets({
  quiz,
  categories,
  questions,
}: {
  quiz: KvizQuiz;
  categories: KvizCategory[];
  questions: KvizQuestion[];
}) {
  const byCat = (id: string) => questions.filter((q) => q.category_id === id);
  const pairs: KvizCategory[][] = [];
  for (let i = 0; i < categories.length; i += 2) pairs.push(categories.slice(i, i + 2));

  return (
    <div className="min-h-screen bg-gray-200 text-black print:min-h-0 print:bg-white">
      <style>{PRINT_CSS}</style>

      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-300 bg-white px-4 py-2 print:hidden">
        <Link
          href={`/admin/kviz/${quiz.id}`}
          aria-label="Nazaj v urejevalnik"
          className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        >
          <IconArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">Listki: {quiz.title}</div>
          <div className="text-xs text-gray-500">
            {categories.length} kategorij · {pairs.length} {pairs.length === 1 ? "list" : "listov"} A4 ležeče ·
            natisni toliko kopij, kolikor je ekip, in razreži po črtkani črti
          </div>
        </div>
        <Button onClick={() => window.print()} disabled={categories.length === 0} className="gap-2">
          <IconPrinter className="h-4 w-4" />
          Natisni
        </Button>
      </div>

      {categories.length === 0 ? (
        <p className="p-8 text-center text-gray-600 print:hidden">Kviz nima kategorij.</p>
      ) : (
        <div className="flex flex-col items-center gap-6 py-6 print:block print:gap-0 print:py-0">
          {pairs.map((pair, i) => (
            <section
              key={pair[0].id}
              className="relative flex h-[210mm] w-[297mm] shrink-0 overflow-hidden bg-white shadow-lg print:shadow-none"
              style={{ breakAfter: i < pairs.length - 1 ? "page" : "auto" }}
            >
              {pair.map((cat, j) => (
                <Sheet key={cat.id} index={i * 2 + j + 1} category={cat} questions={byCat(cat.id)} />
              ))}
              {pair.length === 1 && <div className="w-1/2" />}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-[6mm] left-1/2 border-l border-dashed border-gray-400"
              />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Sheet({ index, category, questions }: { index: number; category: KvizCategory; questions: KvizQuestion[] }) {
  const total = questions.reduce((s, q) => s + Number(q.points || 0), 0);
  const rules = category.example?.rules?.trim();

  return (
    <div className="flex h-full w-1/2 flex-col px-[12mm] pt-[10mm] pb-[9mm]">
      <header className="shrink-0">
        <div className="flex items-center gap-2 text-[9pt] font-semibold tracking-wide text-gray-600 uppercase">
          <Logo className="h-[6mm] w-[6mm]" />
          Garaža pub kviz
        </div>
        <div className="mt-[5mm] flex items-end gap-2 text-[13pt] font-semibold">
          Ekipa:
          <span className="mb-[1mm] flex-1 border-b-[1.5px] border-black" />
        </div>
        <h2 className="mt-[5mm] text-[15pt] leading-tight font-bold">
          <span className="text-gray-500">{index}.</span> {category.name}
        </h2>
        {rules && <p className="mt-[1.5mm] text-[8.5pt] leading-snug text-gray-600 italic">{rules}</p>}
      </header>

      <ol className="mt-[4mm] flex min-h-0 flex-1 flex-col">
        {questions.length === 0 && <li className="text-[10pt] text-gray-500">(kategorija nima vprašanj)</li>}
        {questions.map((q, k) => (
          <li key={q.id} className="flex max-h-[24mm] min-h-[9mm] flex-1 items-end gap-[3mm] pb-[1.5mm]">
            <span className="w-[7mm] shrink-0 text-right text-[12pt] font-bold tabular-nums">{k + 1}.</span>
            <Answer q={q} />
            <span className="w-[8mm] shrink-0 text-right text-[7.5pt] text-gray-500">{fmt(Number(q.points))} t</span>
          </li>
        ))}
      </ol>

      <footer className="mt-[3mm] flex shrink-0 items-end justify-end gap-2 text-[11pt] font-semibold">
        Točke:
        <span className="mb-[1mm] w-[16mm] border-b-[1.5px] border-black" />
        <span>/ {fmt(total)}</span>
      </footer>
    </div>
  );
}

function Answer({ q }: { q: KvizQuestion }) {
  if (q.type === "choice") {
    const n = Math.min(Math.max(q.options?.length ?? 4, 2), LETTERS.length);
    return (
      <div className="flex flex-1 items-center gap-[5mm] pb-[0.5mm]">
        {LETTERS.slice(0, n).map((l) => (
          <span
            key={l}
            className="flex h-[7mm] w-[7mm] items-center justify-center rounded-full border-[1.5px] border-black text-[10pt] font-semibold"
          >
            {l}
          </span>
        ))}
      </div>
    );
  }
  if (q.parts?.length) {
    return (
      <div className="grid flex-1 grid-cols-2 gap-x-[4mm] gap-y-[2.5mm]">
        {q.parts.map((p, i) => (
          <div key={i} className="flex items-end gap-[1.5mm] text-[8pt] text-gray-600">
            <span className="max-w-[22mm] shrink-0 truncate">{p}</span>
            <span className="mb-[0.5mm] flex-1 border-b border-black" />
          </div>
        ))}
      </div>
    );
  }
  return <span className="mb-[1mm] flex-1 border-b border-black" />;
}
