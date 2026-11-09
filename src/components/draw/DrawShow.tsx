"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconCheck, IconCopy, IconShuffle, IconX } from "@/components/ui/icons";
import clsx from "@/lib/utils/clsx";

// Celozaslonska razglasitev skupin: vsak „Naprej“ (presledek, →, Enter,
// PageDown — tudi prezentacijski kliker) zavrti imena kot igralni avtomat,
// nato pristane naslednja skupina z izbruhom konfetov. Esc zapre.
const BURST_COLORS = ["#06b6d4", "#7c3aed", "#e11d48", "#2563eb", "#d97706", "#059669", "#ffffff"];
// Zamiki med menjavami imen med vrtenjem (ms) — postopno upočasnjevanje.
const SPIN_STEPS = [50, 50, 55, 55, 60, 60, 65, 70, 75, 80, 90, 100, 115, 130, 150, 175, 205, 240, 280];

type Particle = { dx: number; dy: number; rot: number; size: number; color: string; round: boolean };
type Phase = "ready" | "spin" | "land" | "done";

function makeBurst(): Particle[] {
  return Array.from({ length: 36 }, (_, i) => {
    const angle = (i / 36) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 140 + Math.random() * 260;
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist * 0.75,
      rot: Math.random() * 540 - 270,
      size: 6 + Math.random() * 8,
      color: BURST_COLORS[i % BURST_COLORS.length],
      round: Math.random() > 0.5,
    };
  });
}

export default function DrawShow({
  groups,
  onClose,
  onRedraw,
}: {
  groups: string[][];
  onClose: () => void;
  onRedraw: () => void;
}) {
  const [idx, setIdx] = useState(-1);
  const [phase, setPhase] = useState<Phase>("ready");
  const [spinName, setSpinName] = useState("");
  const [burst, setBurst] = useState<Particle[]>([]);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const all = groups.flat();

  useEffect(() => {
    // Gumb „Žrebaj“ ima še fokus — brez tega bi presledek žrebal znova.
    (document.activeElement as HTMLElement | null)?.blur();
    return () => window.clearTimeout(timer.current);
  }, []);

  const next = useCallback(() => {
    if (phase === "spin" || phase === "done") return;
    const target = idx + 1;
    if (target >= groups.length) {
      setPhase("done");
      return;
    }
    setIdx(target);
    setPhase("spin");
    let step = 0;
    const tick = () => {
      setSpinName(all[Math.floor(Math.random() * all.length)] ?? "");
      if (step < SPIN_STEPS.length) {
        timer.current = window.setTimeout(tick, SPIN_STEPS[step++]);
      } else {
        setBurst(makeBurst());
        setPhase("land");
      }
    };
    tick();
  }, [phase, idx, groups.length, all]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ([" ", "ArrowRight", "Enter", "PageDown"].includes(e.key)) {
        e.preventDefault();
        next();
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, onClose]);

  const copy = async () => {
    const out = groups.map((g, i) => `Skupina ${i + 1}: ${g.join(", ")}`).join("\n");
    try {
      await navigator.clipboard.writeText(out);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const revealed = phase === "done" ? groups.length : phase === "land" ? idx + 1 : Math.max(0, idx);
  const current = idx >= 0 ? groups[idx] : null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-gray-950 bg-[radial-gradient(ellipse_at_top,rgba(124,58,237,0.35),transparent_60%),radial-gradient(ellipse_at_bottom,rgba(6,182,212,0.18),transparent_60%)] text-white"
      onClick={phase === "done" ? undefined : next}
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-white/60 sm:px-6">
        <span>
          {phase === "done" ? `Vse skupine (${groups.length})` : `Skupina ${Math.max(1, idx + (phase === "ready" ? 2 : 1))} od ${groups.length}`}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="Zapri"
          className="rounded-md p-2 hover:bg-white/10 hover:text-white"
        >
          <IconX className="h-5 w-5" />
        </button>
      </header>

      {phase === "done" ? (
        <div className="flex-1 overflow-y-auto px-4 pb-6 sm:px-8">
          <ol className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g, i) => (
              <li
                key={i}
                className="draw-pop rounded-2xl bg-white/10 p-5 ring-1 ring-white/15"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <div className="mb-2 text-sm font-bold uppercase tracking-wider text-cyan-300">Skupina {i + 1}</div>
                <ul className="space-y-1 text-xl font-semibold">
                  {g.map((n, j) => (
                    <li key={j}>{n}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button onClick={copy} className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 font-medium hover:bg-white/20">
              {copied ? <IconCheck className="h-5 w-5 text-emerald-400" /> : <IconCopy className="h-5 w-5" />}
              {copied ? "Kopirano" : "Kopiraj"}
            </button>
            <button
              onClick={onRedraw}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 font-medium hover:bg-violet-500"
            >
              <IconShuffle className="h-5 w-5" /> Žrebaj znova
            </button>
            <button onClick={onClose} className="rounded-lg px-4 py-2.5 font-medium text-white/70 hover:bg-white/10 hover:text-white">
              Zapri
            </button>
          </div>
        </div>
      ) : (
        <div className="relative flex flex-1 flex-col items-center justify-center px-4 text-center">
          {phase === "ready" && (
            <div className="draw-pop space-y-4">
              <div className="text-[clamp(2rem,6vw,5rem)] font-black leading-none">Žrebanje skupin</div>
              <div className="text-lg text-white/60 sm:text-2xl">
                {all.length} udeležencev · {groups.length} {groups.length === 2 ? "skupini" : groups.length < 5 ? "skupine" : "skupin"}
              </div>
              <div className="pt-6 text-base text-white/50 sm:text-xl">
                Pritisni <kbd className="rounded-md border border-white/30 px-2 py-0.5 font-mono">presledek</kbd> ali klikni za prvo skupino
              </div>
            </div>
          )}

          {phase === "spin" && (
            <div className="space-y-6">
              <div className="text-xl font-bold uppercase tracking-[0.3em] text-cyan-300 sm:text-3xl">Skupina {idx + 1}</div>
              <div className="draw-pulse mx-auto flex min-h-[1.6em] min-w-[8ch] items-center justify-center rounded-3xl bg-white/10 px-10 py-6 text-[clamp(2.5rem,8vw,6.5rem)] font-black leading-none ring-2 ring-violet-500/60">
                <span className="blur-[1px]">{spinName}</span>
              </div>
              <div className="text-white/40">Žrebam …</div>
            </div>
          )}

          {phase === "land" && current && (
            <div key={idx} className="relative space-y-6">
              <div className="pointer-events-none absolute left-1/2 top-1/2">
                {burst.map((p, i) => (
                  <span
                    key={i}
                    className="draw-burst absolute block"
                    style={
                      {
                        width: p.size,
                        height: p.size * (p.round ? 1 : 0.45),
                        background: p.color,
                        borderRadius: p.round ? "9999px" : "2px",
                        "--dx": `${p.dx}px`,
                        "--dy": `${p.dy}px`,
                        "--rot": `${p.rot}deg`,
                      } as React.CSSProperties
                    }
                  />
                ))}
              </div>
              <div className="draw-land text-[clamp(1.75rem,5vw,4rem)] font-black uppercase tracking-wider text-cyan-300">
                Skupina {idx + 1}
              </div>
              <ul className="flex flex-wrap justify-center gap-3 sm:gap-4">
                {current.map((n, j) => (
                  <li
                    key={j}
                    className="draw-pop rounded-2xl bg-white px-5 py-3 text-[clamp(1.4rem,4vw,3.25rem)] font-extrabold text-gray-900 shadow-xl shadow-violet-900/40"
                    style={{ animationDelay: `${250 + j * 280}ms` }}
                  >
                    {n}
                  </li>
                ))}
              </ul>
              <div
                className="draw-pop pt-4 text-sm text-white/40 sm:text-base"
                style={{ animationDelay: `${600 + current.length * 280}ms` }}
              >
                {idx + 1 < groups.length ? "Presledek za naslednjo skupino" : "Presledek za pregled vseh skupin"}
              </div>
            </div>
          )}
        </div>
      )}

      {phase !== "done" && revealed > 0 && (
        <footer className="flex gap-2 overflow-x-auto px-4 pb-4 sm:px-6">
          {groups.slice(0, phase === "land" ? idx : revealed).map((g, i) => (
            <div key={i} className={clsx("shrink-0 rounded-xl bg-white/10 px-3 py-2 text-left text-sm ring-1 ring-white/10")}>
              <div className="text-xs font-bold text-cyan-300">Skupina {i + 1}</div>
              <div className="max-w-[16rem] truncate text-white/80">{g.join(", ")}</div>
            </div>
          ))}
        </footer>
      )}
    </div>
  );
}
