"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRoomPing } from "@/lib/useRoomPing";
import { LETTERS, OPTION_COLORS, errorText, imageUrl } from "@/lib/kviz";
import type { CategoryExample, KvizAnswer, KvizPlayer, KvizQuestion, KvizRoom, KvizTeam, ScoreRow } from "@/lib/types/database.types";
import { IconArrowLeft, IconCheck, IconChevronRight, IconUsers, IconX } from "@/components/ui/icons";
import clsx from "@/lib/utils/clsx";

type OutlineItem = { categoryId: string; category: string };
type AnswerInfo = Pick<KvizQuestion, "id" | "category_id" | "type" | "prompt" | "options" | "correct_index" | "accepted_answers" | "explanation">;

// Besedilo vprašanja brez napisa „# …“ v prvi vrstici (za preglede).
const plainPrompt = (p?: string | null) => (p ?? "").replace(/^# [^\n]*\n/, "");

type Data = {
  room: KvizRoom;
  teams: KvizTeam[];
  players: KvizPlayer[];
  answers: KvizAnswer[]; // samo za trenutno vprašanje
  scores: ScoreRow[];
};

// Projektor: en gumb „Naprej“ (ali tipka →, presledek, Enter, PageDown —
// deluje tudi s prezentacijskim klikerjem) vodi ves potek prek kviz_next.
export default function Stage({ roomId }: { roomId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: room } = await supabase.from("kviz_rooms").select("*").eq("id", roomId).single();
    if (!room) return;
    const qid = room.current?.question_id ?? "00000000-0000-0000-0000-000000000000";
    const [teams, players, answers, scores] = await Promise.all([
      supabase.from("kviz_teams").select("*").eq("room_id", roomId).order("created_at"),
      supabase.from("kviz_players").select("id, room_id, team_id, nickname, joined_at").eq("room_id", roomId).order("joined_at"),
      supabase.from("kviz_answers").select("*").eq("room_id", roomId).eq("question_id", qid),
      supabase.rpc("kviz_scoreboard", { p_room: roomId }),
    ]);
    setData({
      room,
      teams: teams.data ?? [],
      players: players.data ?? [],
      answers: answers.data ?? [],
      scores: scores.data ?? [],
    });
  }, [supabase, roomId]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  useRoomPing(roomId, load, 4000);

  // Časovnica: kategorija vsakega vprašanja v zamrznjenem vrstnem redu sobe.
  const [outline, setOutline] = useState<OutlineItem[] | null>(null);
  const [examples, setExamples] = useState<Map<string, CategoryExample>>(new Map());
  // Pravilni odgovori po vrstnem redu sobe (za pregled odgovorov v klasičnem kvizu).
  const [answerInfo, setAnswerInfo] = useState<(AnswerInfo | null)[]>([]);
  // Kategorije s pregledom vseh vprašanj po zadnjem vprašanju (0012).
  const [summaryCats, setSummaryCats] = useState<Set<string>>(new Set());
  const roomQuizId = data?.room.quiz_id;
  const questionKey = data?.room.question_ids.join(",");
  useEffect(() => {
    if (!roomQuizId || !questionKey) return;
    let alive = true;
    const ids = questionKey.split(",");
    void Promise.all([
      supabase
        .from("kviz_questions")
        .select("id, category_id, type, prompt, options, correct_index, accepted_answers, explanation")
        .in("id", ids),
      supabase.from("kviz_categories").select("id, name, example, summary").eq("quiz_id", roomQuizId),
    ]).then(([qs, cats]) => {
      if (!alive) return;
      const catOf = new Map((qs.data ?? []).map((q) => [q.id, q.category_id]));
      setAnswerInfo(ids.map((id) => (qs.data ?? []).find((q) => q.id === id) ?? null));
      const nameOf = new Map((cats.data ?? []).map((c) => [c.id, c.name]));
      setExamples(new Map((cats.data ?? []).flatMap((c) => (c.example?.items?.length || c.example?.choice ? [[c.id, c.example] as const] : []))));
      setSummaryCats(new Set((cats.data ?? []).filter((c) => c.summary).map((c) => c.id)));
      setOutline(
        ids.map((id) => {
          const cid = catOf.get(id) ?? "?";
          return { categoryId: cid, category: nameOf.get(cid) ?? "Kategorija" };
        })
      );
    });
    return () => {
      alive = false;
    };
  }, [supabase, roomQuizId, questionKey]);

  const goto = useCallback(
    async (index: number, intro = false) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      const { error } = await supabase.rpc("kviz_goto", { p_room: roomId, p_index: index, p_intro: intro });
      if (error) setError(errorText(error));
      await load();
      setBusy(false);
    },
    [busy, supabase, roomId, load]
  );

  // Koraki uvoda kategorije s primerom (samo na odru): 0 = uvod,
  // 1 = primer „Kako se igra?“, 2 = rešitev primera. Ob drugem vprašanju/stanju
  // se ključ spremeni in korak je spet 0.
  const [introStep, setIntroStep] = useState({ key: "", step: 0 });
  const introKey = data ? `${data.room.state}:${data.room.q_index}` : "";
  const step = introStep.key === introKey ? introStep.step : 0;
  const example =
    data?.room.state === "intro" && data.room.current?.category_id
      ? examples.get(data.room.current.category_id) ?? null
      : null;

  // Klasični kviz: po „Oddajte listke“ (scoreboard/finished) še korak 1 =
  // pregled odgovorov pravkar končane kategorije.
  const reviewable =
    data?.room.mode === "classic" && (data.room.state === "scoreboard" || data.room.state === "finished");
  // Zadnje vprašanje kategorije s pregledom: korak 1 = vsa vprašanja naenkrat.
  const summaryNow =
    data?.room.state === "question" &&
    !!data.room.current?.last_in_category &&
    summaryCats.has(data.room.current?.category_id ?? "");

  const next = useCallback(async () => {
    if (busy || !data) return;
    if (example && step < 2) {
      setIntroStep({ key: introKey, step: step + 1 });
      return;
    }
    if ((reviewable || summaryNow) && step < 1) {
      setIntroStep({ key: introKey, step: 1 });
      return;
    }
    if (data.room.state === "finished") return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("kviz_next", { p_room: roomId });
    if (error) setError(errorText(error));
    await load();
    setBusy(false);
  }, [busy, data, supabase, roomId, load, example, step, introKey, reviewable, summaryNow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (["ArrowRight", " ", "Enter", "PageDown"].includes(e.key)) {
        e.preventDefault();
        void next();
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next]);

  if (!data) return <div className="min-h-screen bg-gray-950" />;
  const { room } = data;
  const classic = room.mode === "classic";

  const nextLabel = summaryNow && step === 0
    ? "Pregled vprašanj"
    : room.state === "intro"
    ? example && step === 0
      ? "Kako se igra?"
      : example && step === 1
        ? "Pokaži rešitev"
        : "Prvo vprašanje"
    : classic
    ? room.state === "lobby"
      ? "Začni kviz"
      : room.state === "question"
        ? room.current?.last_in_category
          ? room.q_index + 1 >= room.question_ids.length
            ? "Konec kviza"
            : "Konec kategorije"
          : "Naslednje vprašanje"
        : reviewable && step === 0
          ? "Pregled odgovorov"
          : room.state === "scoreboard"
            ? "Naslednja kategorija"
            : null
    : room.state === "lobby"
      ? "Začni kviz"
      : room.state === "question"
        ? room.current?.last_in_category
          ? "Razkrij odgovore"
          : "Naslednje vprašanje"
        : room.state === "reveal"
          ? !room.current?.last_in_category
            ? "Naslednji odgovor"
            : room.q_index + 1 >= room.question_ids.length
              ? "Končni rezultati"
              : "Lestvica"
          : room.state === "scoreboard"
            ? "Naslednja kategorija"
            : null;

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-white [background-image:radial-gradient(ellipse_at_top_left,rgba(6,182,212,0.18),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(124,58,237,0.25),transparent_55%)]">
      {outline && outline.length > 0 && (
        <Timeline outline={outline} room={room} disabled={busy} onPick={(i, intro) => void goto(i, intro)} />
      )}
      <header className="flex items-center justify-between gap-4 px-6 py-3 text-sm text-white/60">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/admin" className="rounded-md p-1.5 hover:bg-white/10 hover:text-white" aria-label="Nazaj v admin">
            <IconArrowLeft className="h-5 w-5" />
          </Link>
          <span className="truncate font-semibold text-white/80">{room.title}</span>
        </div>
        <div className="flex items-center gap-4">
          {!classic && room.state !== "lobby" && (
            <span>
              Koda <b className="font-mono tracking-widest text-white">{room.code}</b>
            </span>
          )}
          {!classic && (
            <span className="flex items-center gap-1.5">
              <IconUsers /> {data.teams.length} ekip ·{" "}
              {data.players.length + data.teams.reduce((n, t) => n + (t.members?.length ?? 0), 0)} igralcev
            </span>
          )}
          {classic && (
            <a
              href={`/oder/${room.code}/tocke`}
              target="kviz-tocke"
              className="rounded-md px-2 py-1 hover:bg-white/10 hover:text-white"
            >
              Točkovanje
            </a>
          )}
          <button onClick={toggleFullscreen} className="rounded-md px-2 py-1 hover:bg-white/10 hover:text-white">
            Celoten zaslon (F)
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col px-[4vw] pb-28 pt-2">
        {room.state === "intro" && room.current && (!example || step === 0) && (
          <CategoryIntro key={room.q_index} current={room.current} />
        )}
        {room.state === "intro" && room.current && example && step > 0 && (
          <ExampleSlide key={room.q_index} category={room.current.category} example={example} solved={step >= 2} />
        )}
        {classic && (room.state === "lobby" || ((room.state === "scoreboard" || room.state === "finished") && step === 0)) && (
          <ClassicBreak room={room} />
        )}
        {reviewable && step === 1 && outline && (
          <AnswerReview key={introKey} room={room} outline={outline} answers={answerInfo} />
        )}
        {!classic && room.state === "lobby" && <LobbyView data={data} onKick={async (id) => {
          await supabase.rpc("kviz_kick", { p_player: id });
          await load();
        }} onRemoveMember={async (teamId, name) => {
          await supabase.rpc("kviz_host_remove_member", { p_team: teamId, p_name: name });
          await load();
        }} />}
        {summaryNow && step === 1 && outline && (
          <QuestionSummary key={introKey} room={room} outline={outline} answers={answerInfo} />
        )}
        {(room.state === "question" || room.state === "reveal") && room.current && !(summaryNow && step === 1) && (
          <QuestionStage
            data={data}
            onSetCorrect={async (id, ok) => {
              await supabase.rpc("kviz_set_correct", { p_answer: id, p_correct: ok });
              await load();
            }}
          />
        )}
        {!classic && (room.state === "scoreboard" || room.state === "finished") && <ScoreStage data={data} />}
      </main>

      {error && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-lg bg-rose-600 px-4 py-2 text-sm">{error}</div>
      )}
      {nextLabel && (
        <button
          onClick={() => void next()}
          disabled={busy}
          className="fixed bottom-6 right-6 flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-violet-600 px-7 py-4 text-xl font-semibold shadow-xl shadow-violet-900/40 transition-transform hover:scale-[1.03] disabled:opacity-60"
        >
          {nextLabel} <IconChevronRight className="h-6 w-6" />
        </button>
      )}
    </div>
  );
}

// Vodoravna časovnica čez cel zaslon: en odsek na kategorijo (širina po
// številu vprašanj), v njem oštevilčena vprašanja 1, 2, 3 … Klik skoči na
// vprašanje (kviz_goto).
function Timeline({
  outline,
  room,
  disabled,
  onPick,
}: {
  outline: OutlineItem[];
  room: KvizRoom;
  disabled: boolean;
  onPick: (index: number, intro: boolean) => void;
}) {
  const segments: { categoryId: string; name: string; start: number; count: number }[] = [];
  outline.forEach((it, i) => {
    const last = segments[segments.length - 1];
    if (last && last.categoryId === it.categoryId) last.count++;
    else segments.push({ categoryId: it.categoryId, name: it.category, start: i, count: 1 });
  });

  const onQuestion = room.state === "question" || room.state === "reveal";
  const active = onQuestion ? room.q_index : -1;
  const doneUpTo = room.state === "scoreboard" || room.state === "finished" ? room.q_index : room.q_index - 1;
  const activeCat = room.q_index >= 0 ? outline[room.q_index]?.categoryId : null;
  // Dolg kviz (npr. 10 kategorij, 50+ vprašanj): manjši krogci, da gre vse v eno vrstico.
  const dense = outline.length > 36;

  return (
    <nav aria-label="Časovnica kviza" className="w-full border-b border-white/10 bg-black/30 px-[2vw] pb-3 pt-2.5 backdrop-blur">
      <ol className="flex w-full gap-[0.9vw]">
        {segments.map((seg, si) => {
          const isCat = seg.categoryId === activeCat;
          const catDone = seg.start + seg.count - 1 <= doneUpTo;
          return (
            <li key={seg.start} className="flex min-w-0 basis-0 flex-col gap-1.5" style={{ flexGrow: seg.count }}>
              <button
                type="button"
                disabled={disabled}
                onClick={(e) => {
                  e.currentTarget.blur();
                  if (!(room.state === "intro" && isCat)) onPick(seg.start, true);
                }}
                title={`Uvod kategorije ${si + 1}`}
                className={clsx(
                  "flex min-w-0 items-center gap-1.5 self-start truncate rounded text-left text-[clamp(0.65rem,0.8vw,0.85rem)] font-semibold uppercase tracking-wider transition-colors hover:text-white disabled:cursor-wait",
                  isCat ? "text-cyan-300" : catDone ? "text-white/60" : "text-white/35"
                )}
              >
                <span className="truncate">Kategorija {si + 1}</span>
              </button>
              <div
                className={clsx(
                  "relative flex items-center justify-between rounded-full px-1 py-1 ring-1 transition-colors",
                  isCat ? "bg-cyan-400/10 ring-cyan-400/40" : "bg-white/[0.04] ring-white/10"
                )}
              >
                <div className="pointer-events-none absolute inset-x-4 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-white/10" />
                {Array.from({ length: seg.count }, (_, k) => {
                  const i = seg.start + k;
                  const isActive = i === active;
                  const isDone = i <= doneUpTo && !isActive;
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={disabled}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        // Prvo vprašanje druge kategorije → najprej njen uvod.
                        if (!isActive) onPick(i, k === 0 && !isCat);
                      }}
                      title={`Kategorija ${si + 1} · vprašanje ${k + 1}`}
                      aria-label={`Kategorija ${si + 1}, vprašanje ${k + 1}`}
                      aria-current={isActive ? "step" : undefined}
                      className={clsx(
                        "relative z-10 flex aspect-square shrink-0 items-center justify-center rounded-full font-bold tabular-nums transition-all duration-200 disabled:cursor-wait",
                        dense ? "h-[clamp(0.95rem,1.2vw,1.5rem)] text-[clamp(0.55rem,0.62vw,0.75rem)]" : "h-[clamp(1.4rem,1.7vw,2rem)] text-[clamp(0.65rem,0.8vw,0.9rem)]",
                        isActive
                          ? "scale-125 bg-gradient-to-br from-cyan-400 to-violet-600 text-white shadow-[0_0_0_3px_rgba(255,255,255,0.9),0_0_18px_rgba(34,211,238,0.6)]"
                          : isDone
                            ? "bg-cyan-500/30 text-cyan-50 hover:bg-cyan-400/50"
                            : "bg-gray-800 text-white/50 ring-1 ring-white/10 hover:bg-white/20 hover:text-white"
                      )}
                    >
                      {k + 1}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
}

function LobbyView({
  data,
  onKick,
  onRemoveMember,
}: {
  data: Data;
  onKick: (playerId: string) => void;
  onRemoveMember: (teamId: string, name: string) => void;
}) {
  // Na localhost (razvoj) QR s telefonom ne bi delal — vzemi IP računalnika.
  const [origin, setOrigin] = useState(window.location.origin);
  useEffect(() => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) return;
    fetch("/api/lan-origin")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { origin: string | null } | null) => {
        if (d?.origin) setOrigin(d.origin);
      })
      .catch(() => {});
  }, []);
  const joinUrl = `${origin}/igra/${data.room.code}`;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toString(joinUrl, { type: "svg", margin: 1, color: { dark: "#0b1020", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [joinUrl]);

  const loose = data.players.filter((p) => !p.team_id);

  return (
    <div className="grid flex-1 items-center gap-[4vw] lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      <div className="text-center lg:text-left">
        <p className="text-[2.2vw] leading-tight text-white/70 max-lg:text-2xl">
          Na telefonu odpri <b className="text-white">{origin.replace(/^https?:\/\//, "")}</b> in vpiši kodo
        </p>
        <div className="my-[2vw] font-mono text-[12vw] font-black leading-none tracking-[0.12em] max-lg:text-7xl">
          {data.room.code}
        </div>
        {qr && (
          <div
            className="mx-auto inline-block w-[17vw] min-w-40 rounded-2xl bg-white p-3 lg:mx-0 [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qr }}
          />
        )}
      </div>

      <div className="rounded-3xl bg-white/5 p-6 ring-1 ring-white/10">
        <h2 className="mb-4 text-2xl font-bold">Ekipe</h2>
        {data.teams.length === 0 && <p className="text-white/50">Čakamo na prve ekipe …</p>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.teams.map((t) => (
            <li key={t.id} className="rounded-xl bg-white/10 px-4 py-3">
              <div className="truncate text-lg font-semibold">{t.name}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {data.players
                  .filter((p) => p.team_id === t.id)
                  .map((p) => (
                    <PlayerChip key={p.id} name={p.nickname} onKick={() => onKick(p.id)} />
                  ))}
                {(t.members ?? []).map((m) => (
                  <PlayerChip key={`m:${m}`} name={m} dashed onKick={() => onRemoveMember(t.id, m)} />
                ))}
              </div>
            </li>
          ))}
        </ul>
        {loose.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-sm text-white/50">Še brez ekipe</div>
            <div className="flex flex-wrap gap-1.5">
              {loose.map((p) => (
                <PlayerChip key={p.id} name={p.nickname} onKick={() => onKick(p.id)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerChip({ name, onKick, dashed }: { name: string; onKick: () => void; dashed?: boolean }) {
  return (
    <span
      title={dashed ? "Brez telefona" : undefined}
      className={clsx(
        "group inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-sm text-white/80",
        dashed ? "border border-dashed border-white/30" : "bg-white/10"
      )}
    >
      {name}
      <button
        onClick={onKick}
        title="Odstrani igralca"
        aria-label={`Odstrani ${name}`}
        className="rounded-full p-0.5 opacity-0 transition-opacity hover:bg-white/20 group-hover:opacity-100"
      >
        <IconX className="h-3 w-3" />
      </button>
    </span>
  );
}

// Velik gumb za predvajanje zvočnega posnetka vprašanja (miks skladb).
// Klik ali tipka P = predvajaj/ustavi; obroč kaže napredek. Presledek in
// puščice ostanejo za „Naprej“.
function AudioPlayer({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);

  const toggle = useCallback(() => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) {
      if (a.ended) a.currentTime = 0;
      void a.play();
    } else a.pause();
  }, []);

  useEffect(() => {
    const audio = ref.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "p" || e.key === "P") toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      audio?.pause();
    };
  }, [toggle]);

  const R = 46;
  const C = 2 * Math.PI * R;
  const frac = dur ? Math.min(1, time / dur) : 0;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[min(1.2vw,2vh)]">
      <audio
        ref={ref}
        src={src}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
      />
      <button
        type="button"
        onClick={(e) => {
          e.currentTarget.blur();
          toggle();
        }}
        aria-label={playing ? "Ustavi posnetek" : "Predvajaj posnetek"}
        className="group relative aspect-square w-[min(16vw,30vh)] min-w-40 rounded-full transition-transform hover:scale-105 active:scale-95"
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="url(#audio-ring)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - frac)}
            className="transition-[stroke-dashoffset] duration-200"
          />
          <defs>
            <linearGradient id="audio-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#22d3ee" />
              <stop offset="1" stopColor="#a78bfa" />
            </linearGradient>
          </defs>
        </svg>
        <span
          className={clsx(
            "absolute inset-[9%] flex items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 shadow-[0_0_60px_rgba(124,58,237,0.55)]",
            playing && "animate-pulse"
          )}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" className="h-[42%] w-[42%] fill-white" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="ml-[6%] h-[46%] w-[46%] fill-white" aria-hidden>
              <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" />
            </svg>
          )}
        </span>
      </button>
      <div className="font-mono text-[min(1.4vw,2.4vh)] tabular-nums text-white/60 max-lg:text-base">
        {fmt(time)} / {dur ? fmt(dur) : "–:––"}
        <span className="ml-3 text-white/35">(tipka P)</span>
      </div>
    </div>
  );
}

function QuestionStage({
  data,
  onSetCorrect,
}: {
  data: Data;
  onSetCorrect: (answerId: string, ok: boolean) => void;
}) {
  const { room, answers, teams } = data;
  const c = room.current!;
  const reveal = room.state === "reveal" ? room.reveal : null;
  const img = imageUrl(c.image_path);
  const answeredTeams = new Set(answers.map((a) => a.team_id));
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? "?";
  const classic = room.mode === "classic";

  return (
    <div className="mx-auto flex w-full max-w-[min(100%,1400px)] flex-1 flex-col gap-[1.5vw]">
      <div className="flex items-baseline justify-between gap-4 text-[1.1vw] text-white/60 max-lg:text-base">
        <span>
          {reveal && (
            <span className="mr-3 rounded-md bg-emerald-500/20 px-2 py-0.5 font-semibold uppercase tracking-wide text-emerald-300">
              Odgovori
            </span>
          )}
          <b className="text-cyan-300">{c.category}</b> · vprašanje {c.category_question}/{c.category_questions}
        </span>
        <span>
          {c.index + 1} / {c.total} · {c.points} {c.points === 1 ? "točka" : c.points === 2 ? "točki" : c.points < 5 ? "točke" : "točk"}
        </span>
      </div>

      <div className={clsx("flex flex-1 gap-[2.5vw]", img ? "items-center max-lg:flex-col" : "flex-col justify-center")}>
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="max-h-[36vh] max-w-[30vw] rounded-2xl object-contain shadow-2xl max-lg:max-w-full" />
        )}
        {c.prompt.includes("\n") ? (
          // Večvrstično vprašanje (npr. Ugotovi letnico): vsak dogodek v svoji
          // vrstici, zadnja vrstica je samo vprašanje.
          // Prva vrstica z „# “ je napis nad seznamom (npr. „# UGANI LETO“).
          <div className={clsx("flex flex-col items-center", !c.audio_path && "flex-1 justify-center")}>
            {c.prompt.startsWith("# ") && (
              <div className="draw-pop mb-[min(1.6vw,2.8vh)] text-center text-[min(2.8vw,4.8vh)] font-black uppercase tracking-[0.25em] text-transparent [background-clip:text] [-webkit-background-clip:text] bg-gradient-to-r from-cyan-300 to-violet-400 max-lg:text-2xl">
                {c.prompt.split("\n")[0].slice(2)}
              </div>
            )}
            <ul className="space-y-[min(1vw,1.7vh)] text-left">
              {c.prompt
                .split("\n")
                .slice(c.prompt.startsWith("# ") ? 1 : 0, -1)
                .filter((l) => l.trim())
                .map((line, k) => (
                  <li
                    key={k}
                    className="draw-pop flex items-baseline gap-[min(1vw,1.7vh)] text-[min(2.1vw,3.7vh)] font-semibold leading-snug max-lg:text-xl"
                    style={{ animationDelay: `${100 + k * 120}ms` }}
                  >
                    <span className="h-[0.45em] w-[0.45em] shrink-0 -translate-y-[0.1em] rounded-full bg-gradient-to-br from-cyan-400 to-violet-500" />
                    {line}
                  </li>
                ))}
            </ul>
            <h1 className="mt-[min(2vw,3.4vh)] text-center text-[min(2.4vw,4.2vh)] font-black leading-tight text-cyan-300 max-lg:text-2xl">
              {c.prompt.split("\n").at(-1)}
            </h1>
          </div>
        ) : (
          <h1 className={clsx("text-center text-[2.6vw] font-bold leading-tight max-lg:text-2xl", !c.audio_path && "flex-1")}>{c.prompt}</h1>
        )}
        {c.audio_path && <AudioPlayer key={c.question_id} src={imageUrl(c.audio_path)!} />}
      </div>

      {c.type === "choice" ? (
        <div className="grid grid-cols-2 gap-[0.9vw]">
          {c.options.map((opt, i) => {
            const isCorrect = reveal?.correct_index === i;
            const count = reveal?.counts?.[i] ?? 0;
            return (
              <div
                key={i}
                style={{ backgroundColor: OPTION_COLORS[i] }}
                className={clsx(
                  "relative flex items-center gap-[0.8vw] overflow-hidden rounded-2xl px-[1.2vw] py-[0.9vw] text-[1.5vw] font-semibold transition-opacity max-lg:text-lg",
                  reveal && !isCorrect && "opacity-30",
                  isCorrect && "ring-[0.4vw] ring-white"
                )}
              >
                <span className="flex h-[2.4vw] min-h-8 w-[2.4vw] min-w-8 shrink-0 items-center justify-center rounded-xl bg-white/25 font-black">
                  {LETTERS[i]}
                </span>
                <span className="min-w-0 flex-1 break-words">{opt}</span>
                {reveal && (
                  <span className="flex shrink-0 items-center gap-2 text-[1.2vw] max-lg:text-lg">
                    {isCorrect && <IconCheck className="h-[1.7vw] min-h-5 w-[1.7vw] min-w-5" />}
                    {count} {count === 1 ? "ekipa" : count === 2 ? "ekipi" : count < 5 ? "ekipe" : "ekip"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : reveal ? (
        <div className="space-y-4">
          <div className="text-center text-[1.8vw] font-bold max-lg:text-2xl">
            Pravilno: <span className="text-emerald-300">{(reveal.accepted_answers ?? []).join(" / ")}</span>
          </div>
          <div className="mx-auto grid max-w-5xl gap-2 sm:grid-cols-2">
            {answers.map((a) => (
              <div key={a.id} className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white/60">{teamName(a.team_id)}</div>
                  <div className="truncate text-lg font-semibold">{a.text_answer}</div>
                </div>
                <button
                  onClick={() => onSetCorrect(a.id, !a.is_correct)}
                  title={a.is_correct ? "Označi kot napačno" : "Označi kot pravilno"}
                  className={clsx(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
                    a.is_correct ? "bg-emerald-500 hover:bg-emerald-400" : "bg-rose-500/80 hover:bg-rose-400"
                  )}
                >
                  {a.is_correct ? <IconCheck className="h-5 w-5" /> : <IconX className="h-5 w-5" />}
                </button>
              </div>
            ))}
          </div>
          {answers.length > 0 && <p className="text-center text-sm text-white/40">Klik na gumb ob odgovoru popravi oceno (npr. tipkarska napaka).</p>}
        </div>
      ) : (
        <p className="text-center text-[1.4vw] text-white/60 max-lg:text-lg">
          {classic ? "Odgovor napišite na listek." : "Vpišite odgovor na telefonu."}
        </p>
      )}

      {!reveal && !classic && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="mr-2 text-white/60">
            Odgovorilo {answeredTeams.size}/{teams.length} ekip
          </span>
          {teams.map((t) => (
            <span
              key={t.id}
              className={clsx(
                "rounded-full px-3 py-1 text-sm transition-colors",
                answeredTeams.has(t.id) ? "bg-emerald-500 text-white" : "bg-white/10 text-white/50"
              )}
            >
              {t.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Barvni pari za ilustracijo kategorije (po vrsti kategorij).
const INTRO_HUES: [string, string][] = [
  ["#06b6d4", "#7c3aed"],
  ["#f59e0b", "#e11d48"],
  ["#10b981", "#0ea5e9"],
  ["#a855f7", "#ec4899"],
  ["#f97316", "#facc15"],
  ["#3b82f6", "#22d3ee"],
];

// Uvodni zaslon kategorije (stanje `intro`): slika kategorije ali, če je ni,
// ilustracija z začetnico; ime, zaporedna številka in število vprašanj.
function CategoryIntro({ current }: { current: NonNullable<KvizRoom["current"]> }) {
  const img = imageUrl(current.category_image);
  const n = current.category_index ?? 1;
  const [from, to] = INTRO_HUES[(n - 1) % INTRO_HUES.length];
  const count = current.category_questions;
  const initial = (current.category.trim()[0] ?? "?").toUpperCase();

  return (
    <div className="grid flex-1 items-center gap-[4vw] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="draw-pop flex justify-center">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt=""
            className="max-h-[58vh] w-full max-w-[38vw] rounded-[2rem] object-cover shadow-2xl ring-1 ring-white/15 max-lg:max-w-full"
          />
        ) : (
          <svg viewBox="0 0 400 400" className="h-auto w-[min(34vw,58vh)] min-w-56 drop-shadow-2xl" aria-hidden>
            <defs>
              <linearGradient id="intro-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={from} />
                <stop offset="1" stopColor={to} />
              </linearGradient>
              <radialGradient id="intro-shine" cx="0.3" cy="0.25" r="0.7">
                <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="200" cy="200" r="190" fill="none" stroke={from} strokeOpacity="0.25" strokeWidth="2" strokeDasharray="4 10" />
            <circle cx="200" cy="200" r="160" fill="none" stroke={to} strokeOpacity="0.35" strokeWidth="3" />
            <circle cx="200" cy="200" r="128" fill="url(#intro-g)" />
            <circle cx="200" cy="200" r="128" fill="url(#intro-shine)" />
            <text
              x="200"
              y="200"
              textAnchor="middle"
              dominantBaseline="central"
              fill="#fff"
              fontSize="150"
              fontWeight="900"
              fontFamily="inherit"
            >
              {initial}
            </text>
            {[
              [52, 92, 9, from],
              [350, 120, 6, to],
              [330, 330, 11, from],
              [70, 318, 7, to],
              [200, 22, 5, to],
            ].map(([x, y, r, c], i) => (
              <circle key={i} cx={x} cy={y} r={r} fill={c as string} opacity="0.85" />
            ))}
            <path d="M318 58 l6 16 16 6 -16 6 -6 16 -6 -16 -16 -6 16 -6z" fill="#fff" opacity="0.8" />
            <path d="M84 250 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4z" fill="#fff" opacity="0.6" />
          </svg>
        )}
      </div>

      <div className="text-center lg:text-left">
        <div className="draw-pop text-[1.5vw] font-bold uppercase tracking-[0.35em] text-cyan-300 max-lg:text-sm" style={{ animationDelay: "120ms" }}>
          Kategorija {n} od {current.category_total}
        </div>
        <h1
          className="draw-land mt-[1vw] break-words bg-clip-text pb-[0.14em] text-[6.5vw] font-black leading-[1.05] text-transparent max-lg:text-6xl"
          style={{ backgroundImage: `linear-gradient(135deg, #fff 30%, ${from} 70%, ${to})`, animationDelay: "200ms" }}
        >
          {current.category}
        </h1>
        <div className="draw-pop mt-[2vw] inline-flex items-center gap-3 rounded-full bg-white/10 px-5 py-2 text-[1.5vw] font-semibold text-white/80 ring-1 ring-white/15 max-lg:text-lg" style={{ animationDelay: "380ms" }}>
          {count} {count === 1 ? "vprašanje" : count === 2 ? "vprašanji" : count < 5 ? "vprašanja" : "vprašanj"}
        </div>
      </div>
    </div>
  );
}

// Primer „Kako se igra?“ (npr. Nadpomenka): pravilo, nato kartice z
// vprašanji in odgovori ena za drugo; ob „Pokaži rešitev“ se kartice
// povežejo v skupni odgovor.
const EXAMPLE_COLORS = ["#06b6d4", "#8b5cf6", "#f59e0b", "#10b981", "#ec4899", "#3b82f6"];

function ExampleSlide({ category, example, solved }: { category: string; example: CategoryExample; solved: boolean }) {
  // Velikosti z min(vw, vh): vse skupaj se prilega višini zaslona.
  return (
    <div className="flex flex-1 flex-col justify-center gap-[min(1.6vw,2.6vh)]">
      <div className="text-center">
        <div className="draw-pop text-[min(1vw,1.7vh)] font-bold uppercase tracking-[0.35em] text-cyan-300 max-lg:text-xs">
          {category} · primer
        </div>
        <h1 className="draw-land mt-[0.3vh] text-[min(3vw,5.2vh)] font-black leading-tight max-lg:text-3xl">Kako se igra?</h1>
        {example.rules && (
          <p
            className="draw-pop mx-auto mt-[1vh] max-w-[78vw] text-[min(1.8vw,3.1vh)] font-medium leading-snug text-white/90 max-lg:max-w-full max-lg:text-lg"
            style={{ animationDelay: "150ms" }}
          >
            {example.rules}
          </p>
        )}
      </div>
      {example.choice ? (
        <ChoiceExample choice={example.choice} solved={solved} />
      ) : (
        <CardsExample category={category} example={example} solved={solved} />
      )}
    </div>
  );
}

// Vzorčno vprašanje A–D; ob rešitvi ostane poudarjen samo pravilni odgovor.
function ChoiceExample({ choice, solved }: { choice: NonNullable<CategoryExample["choice"]>; solved: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-[min(1.2vw,2vh)]">
      <div
        className="draw-pop rounded-[min(1.1vw,1.9vh)] bg-white/[0.06] px-[min(2vw,3.4vh)] py-[min(1.2vw,2vh)] text-center text-[min(2.5vw,4.3vh)] font-bold leading-snug ring-1 ring-white/10 max-lg:text-2xl"
        style={{ animationDelay: "350ms" }}
      >
        {choice.q}
      </div>
      <div className="grid grid-cols-2 gap-[min(0.9vw,1.5vh)]">
        {choice.options.map((opt, i) => {
          const ok = i === choice.correct;
          return (
            <div
              key={i}
              style={{ backgroundColor: OPTION_COLORS[i], animationDelay: `${550 + i * 200}ms` }}
              className={clsx(
                "draw-pop flex items-center gap-[min(0.8vw,1.3vh)] rounded-[min(1vw,1.7vh)] px-[min(1.2vw,2vh)] py-[min(0.8vw,1.3vh)] text-[min(1.5vw,2.6vh)] font-semibold transition-opacity duration-500 max-lg:text-lg",
                solved && !ok && "opacity-30",
                solved && ok && "ring-4 ring-white"
              )}
            >
              <span className="flex h-[min(2.3vw,4vh)] min-h-8 w-[min(2.3vw,4vh)] min-w-8 shrink-0 items-center justify-center rounded-lg bg-white/25 font-black">
                {LETTERS[i]}
              </span>
              <span className="min-w-0 flex-1">{opt}</span>
              {solved && ok && <IconCheck className="h-[min(1.8vw,3vh)] min-h-5 w-[min(1.8vw,3vh)] min-w-5 shrink-0" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Kartice z vprašanji in odgovori. Z `answer`: odgovori so vidni takoj, ob
// rešitvi jih poveže skupni odgovor. Brez `answer`: odgovori se pokažejo ob rešitvi.
function CardsExample({ category, example, solved }: { category: string; example: CategoryExample; solved: boolean }) {
  const items = example.items ?? [];
  const n = items.length;
  const cols = Math.min(n, 4);
  const color = (i: number) => EXAMPLE_COLORS[i % EXAMPLE_COLORS.length];
  const showAnswers = !!example.answer || solved;
  const word = (a: string) =>
    example.firstLetter ? (
      <>
        <span className="text-violet-600">{a.slice(0, 1)}</span>
        {a.slice(1)}
      </>
    ) : (
      a
    );

  return (
    <>
      <ol
        className="mx-auto grid w-full max-w-[1500px] gap-[min(1.1vw,1.8vh)]"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {items.map((it, i) => (
          <li
            key={i}
            className="draw-pop relative flex flex-col overflow-hidden rounded-[min(1.1vw,1.9vh)] bg-white/[0.06] transition-shadow duration-500"
            style={{
              animationDelay: `${400 + i * 450}ms`,
              boxShadow:
                solved && example.answer
                  ? `inset 0 0 0 2px ${color(i)}, 0 0 28px ${color(i)}55`
                  : "inset 0 0 0 1px rgba(255,255,255,0.1)",
            }}
          >
            <div className="h-1" style={{ backgroundColor: color(i) }} />
            <div className="flex flex-1 flex-col gap-[min(0.6vw,1vh)] p-[min(1vw,1.7vh)]">
              <div className="flex items-center gap-2 text-[min(0.8vw,1.4vh)] font-bold uppercase tracking-widest text-white/45 max-lg:text-[10px]">
                <span
                  className="flex h-[min(1.5vw,2.6vh)] min-h-5 w-[min(1.5vw,2.6vh)] min-w-5 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: color(i) }}
                >
                  {i + 1}
                </span>
                {it.q ? "vprašanje" : "namig"}
              </div>
              {it.q && <p className="flex-1 text-[min(1.5vw,2.6vh)] font-medium leading-snug text-white/90 max-lg:text-base">{it.q}</p>}
              {showAnswers ? (
                <div
                  className={clsx(
                    "draw-pop rounded-[min(0.7vw,1.2vh)] bg-white px-[1vw] text-center font-black text-gray-900 shadow-lg",
                    it.q
                      ? "py-[min(0.5vw,0.9vh)] text-[min(1.8vw,3.1vh)] max-lg:text-xl"
                      : "py-[min(1.4vw,2.4vh)] text-[min(2vw,3.5vh)] max-lg:text-2xl"
                  )}
                  style={{ animationDelay: example.answer ? `${650 + i * 450}ms` : `${i * 180}ms` }}
                >
                  {word(it.a)}
                </div>
              ) : (
                <div className="rounded-[min(0.7vw,1.2vh)] border-2 border-dashed border-white/20 py-[min(0.5vw,0.9vh)] text-center text-[min(1.8vw,3.1vh)] font-black text-white/25 max-lg:text-xl">
                  ?
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {example.answer && (
        <div className="flex flex-col items-center">
          <svg
            viewBox="0 0 100 20"
            preserveAspectRatio="none"
            className="mx-auto h-[min(2.4vw,4vh)] min-h-6 w-full max-w-[1500px]"
            aria-hidden
          >
            {items.map((_, i) => {
              const x = ((i + 0.5) / cols) * 100;
              return (
                <path
                  key={i}
                  d={`M${x} 0 C ${x} 12, 50 8, 50 20`}
                  fill="none"
                  stroke={color(i)}
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray={solved ? "0" : "1.5 2"}
                  className="transition-opacity duration-500"
                  style={{ opacity: solved ? 0.9 : 0.25, strokeWidth: solved ? 3 : 2 }}
                />
              );
            })}
          </svg>
          <div className="flex flex-col items-center gap-[min(0.5vw,0.9vh)]">
            <div className="text-[min(1vw,1.7vh)] font-bold uppercase tracking-[0.3em] text-cyan-300 max-lg:text-xs">
              {example.label ?? category}
            </div>
            {solved ? (
              <div className="draw-land rounded-[min(1.2vw,2vh)] bg-gradient-to-r from-cyan-500 to-violet-600 px-[min(2.4vw,4vh)] py-[min(0.9vw,1.5vh)] text-[min(3vw,5.2vh)] font-black uppercase leading-none tracking-wide shadow-[0_0_50px_rgba(124,58,237,0.55)] ring-4 ring-white/80 max-lg:text-3xl">
                {example.answer}
              </div>
            ) : (
              <div
                className="draw-pop rounded-[min(1.2vw,2vh)] border-2 border-dashed border-white/25 px-[min(2.4vw,4vh)] py-[min(0.9vw,1.5vh)] text-[min(3vw,5.2vh)] font-black leading-none text-white/25 max-lg:text-3xl"
                style={{ animationDelay: `${700 + n * 450}ms` }}
              >
                ?
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Pregled vseh vprašanj kategorije (stikalo „Pregled“, npr. Od 1 do 10): samo
// besedila, brez slik in odgovorov — igralci primerjajo in popravijo listke.
function QuestionSummary({
  room,
  outline,
  answers,
}: {
  room: KvizRoom;
  outline: OutlineItem[];
  answers: (AnswerInfo | null)[];
}) {
  const catId = outline[room.q_index]?.categoryId;
  const idx = outline.flatMap((o, i) => (o.categoryId === catId ? [i] : []));
  const two = idx.length > 5;
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col justify-center gap-[min(1.6vw,2.6vh)]">
      <div className="text-center">
        <div className="draw-pop text-[min(1.1vw,1.9vh)] font-bold uppercase tracking-[0.35em] text-cyan-300 max-lg:text-xs">
          Kategorija {room.current?.category_index ?? ""} · {room.current?.category ?? ""}
        </div>
        <h1 className="draw-land mt-[0.3vh] text-[min(3vw,5.2vh)] font-black leading-tight max-lg:text-3xl">Vsa vprašanja</h1>
      </div>
      <ol className={clsx("grid gap-[min(0.9vw,1.5vh)]", two ? "grid-cols-2 grid-flow-col" : "grid-cols-1")} style={two ? { gridTemplateRows: `repeat(${Math.ceil(idx.length / 2)}, minmax(0, auto))` } : undefined}>
        {idx.map((i, k) => (
          <li
            key={i}
            className="draw-pop flex items-center gap-[min(1vw,1.7vh)] rounded-[min(1vw,1.7vh)] bg-white/[0.06] px-[min(1.2vw,2vh)] py-[min(0.8vw,1.3vh)] ring-1 ring-white/10"
            style={{ animationDelay: `${150 + k * 60}ms` }}
          >
            <span className="flex h-[min(2.6vw,4.4vh)] min-h-8 w-[min(2.6vw,4.4vh)] min-w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 text-[min(1.3vw,2.2vh)] font-black max-lg:text-sm">
              {k + 1}
            </span>
            <p className={clsx("min-w-0 flex-1 font-semibold leading-snug", two ? "text-[min(1.45vw,2.5vh)]" : "text-[min(1.9vw,3.2vh)]", "max-lg:text-base")}>
              {plainPrompt(answers[i]?.prompt)}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Klasični kviz: pregled odgovorov pravkar končane kategorije — vsi naenkrat,
// pri izbirnih „C) Francija“, pri vpisu prvi sprejeti odgovor.
function AnswerReview({
  room,
  outline,
  answers,
}: {
  room: KvizRoom;
  outline: OutlineItem[];
  answers: (AnswerInfo | null)[];
}) {
  const catId = outline[room.q_index]?.categoryId;
  const idx = outline.flatMap((o, i) => (o.categoryId === catId ? [i] : []));
  const two = idx.length > 6;
  // Kategorija samih letnic (Ugotovi letnico): večje številke, čisto desno.
  const years = idx.length > 0 && idx.every((i) => answers[i]?.type === "text" && /^\d{3,4}$/.test(answers[i]?.accepted_answers?.[0] ?? ""));
  // Miksi skladb (odgovor „izvajalec – naslov · izvajalec – naslov“): širok
  // stolpec odgovorov, vprašanje skrajšano na „Miks N“.
  const mixes = idx.length > 0 && idx.some((i) => (answers[i]?.accepted_answers?.[0] ?? "").includes(" · "));
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col justify-center gap-[min(1.6vw,2.6vh)]">
      <div className="text-center">
        <div className="draw-pop text-[min(1.1vw,1.9vh)] font-bold uppercase tracking-[0.35em] text-cyan-300 max-lg:text-xs">
          Kategorija {room.current?.category_index ?? ""} · {room.current?.category ?? ""}
        </div>
        <h1 className="draw-land mt-[0.3vh] text-[min(3vw,5.2vh)] font-black leading-tight max-lg:text-3xl">Pravilni odgovori</h1>
      </div>
      <ol className={clsx("grid gap-[min(0.8vw,1.3vh)]", two ? "grid-cols-2" : "grid-cols-1")}>
        {idx.map((i, k) => {
          const q = answers[i];
          const choice = q?.type === "choice" && q.correct_index !== null;
          // Končno vprašanje, ki povezuje prejšnje odgovore (npr. Nadpomenka):
          // ločeno s črto.
          const finale = k > 0 && k === idx.length - 1 && /prejšnj/i.test(q?.prompt ?? "");
          return (
            <Fragment key={i}>
            {finale && (
              <li aria-hidden className="col-span-full my-[min(0.6vw,1vh)] h-[3px] rounded-full bg-gradient-to-r from-transparent via-cyan-400/70 to-transparent" />
            )}
            <li
              className={clsx(
                "draw-pop flex items-center gap-[min(1vw,1.7vh)] rounded-[min(1vw,1.7vh)] px-[min(1.2vw,2vh)] py-[min(0.7vw,1.2vh)] ring-1",
                finale ? "col-span-full bg-violet-500/15 ring-violet-400/40" : "bg-white/[0.06] ring-white/10"
              )}
              style={{ animationDelay: `${150 + k * 60}ms` }}
            >
              <span className="flex h-[min(2.2vw,3.8vh)] min-h-7 w-[min(2.2vw,3.8vh)] min-w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[min(1.1vw,1.9vh)] font-bold text-white/70 max-lg:text-sm">
                {k + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={clsx(
                    "text-white/80 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden leading-snug",
                    two ? "text-[min(1.3vw,2.2vh)]" : "text-[min(1.6vw,2.8vh)]",
                    "max-lg:text-base"
                  )}
                >
                  {mixes ? plainPrompt(q?.prompt).split(":")[0] : plainPrompt(q?.prompt)}
                </p>
                {q?.explanation && (
                  <p
                    className={clsx(
                      "mt-[0.2em] font-semibold italic leading-snug text-amber-300",
                      two ? "text-[min(0.95vw,1.65vh)]" : "text-[min(1.15vw,2vh)]",
                      "max-lg:text-sm"
                    )}
                  >
                    {q.explanation}
                  </p>
                )}
              </div>
              <span
                className={clsx(
                  "flex shrink-0 items-center gap-[min(0.6vw,1vh)] font-black",
                  years
                    ? "mr-[min(1.6vw,2.8vh)] w-[16%] justify-end text-right text-[min(3vw,5.2vh)] tracking-wide"
                    : mixes
                      ? "mr-[min(1vw,1.7vh)] w-[60%] justify-start text-left text-[min(1.8vw,3.1vh)]"
                    : two
                      ? "mr-[min(0.8vw,1.4vh)] w-[26%] justify-start text-left text-[min(1.5vw,2.6vh)]"
                      : "mr-[min(1vw,1.7vh)] w-[24%] justify-start text-left text-[min(1.8vw,3.1vh)]",
                  "max-lg:text-lg"
                )}
              >
                {choice ? (
                  <>
                    <span
                      className="shrink-0 rounded-md px-[0.35em] py-[0.05em] text-white"
                      style={{ backgroundColor: OPTION_COLORS[q!.correct_index!] }}
                    >
                      {LETTERS[q!.correct_index!]})
                    </span>
                    <span className="truncate text-emerald-300">{q!.options[q!.correct_index!]}</span>
                  </>
                ) : (
                  <span className="min-w-0 break-words leading-tight text-emerald-300">
                    {(q?.accepted_answers?.[0] ?? "?").split(" · ").map((part, j) => (
                      <span key={j} className="block">
                        {part}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}

// Klasični kviz (listki): začetek, premor med kategorijami in konec — brez
// kode, QR, ekip in točk.
function ClassicBreak({ room }: { room: KvizRoom }) {
  const total = room.question_ids.length;
  const [kicker, title, sub] =
    room.state === "lobby"
      ? ["Klasični pub kviz", room.title, `${total} ${total === 1 ? "vprašanje" : total === 2 ? "vprašanji" : total < 5 ? "vprašanja" : "vprašanj"} · pripravite listke in pisala`]
      : room.state === "scoreboard"
        ? [`Konec kategorije: ${room.current?.category ?? ""}`, "Oddajte listke", `Sledi ${(room.current?.category_index ?? 0) + 1}. kategorija od ${room.current?.category_total ?? "?"}`]
        : [room.title, "Konec kviza", "Hvala za sodelovanje! Oddajte zadnje listke."];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[1.5vw] text-center">
      <div className="text-[1.6vw] uppercase tracking-widest text-cyan-300 max-lg:text-sm">{kicker}</div>
      <h1 className="text-[6vw] font-black leading-tight max-lg:text-5xl">{title}</h1>
      <p className="text-[2vw] text-white/60 max-lg:text-lg">{sub}</p>
    </div>
  );
}

function ScoreStage({ data }: { data: Data }) {
  const { room, scores } = data;
  const finished = room.state === "finished";
  const max = Math.max(1, ...scores.map((s) => s.score));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-6">
      <div className="text-center">
        <div className="text-[1.4vw] uppercase tracking-widest text-cyan-300 max-lg:text-sm">
          {finished ? room.title : `Konec kategorije: ${room.current?.category ?? ""}`}
        </div>
        <h1 className="text-[4vw] font-black max-lg:text-4xl">{finished ? "Končni rezultati" : "Lestvica"}</h1>
      </div>
      <ol className="space-y-2.5">
        {scores.map((s, i) => (
          <li key={s.team_id} className="flex items-center gap-4">
            <span
              className={clsx(
                "w-14 text-right text-[2vw] font-black max-lg:text-2xl",
                finished && i === 0 ? "text-amber-300" : finished && i === 1 ? "text-slate-300" : finished && i === 2 ? "text-orange-400" : "text-white/40"
              )}
            >
              {i + 1}.
            </span>
            <div className="relative flex-1 overflow-hidden rounded-xl bg-white/5">
              <div
                className="absolute inset-y-0 left-0 rounded-xl bg-gradient-to-r from-cyan-500/70 to-violet-600/70 transition-[width] duration-700"
                style={{ width: `${(s.score / max) * 100}%` }}
              />
              <div className="relative flex items-center justify-between px-5 py-3 text-[1.9vw] font-semibold max-lg:text-xl">
                <span className="truncate">{s.name}</span>
                <span className="font-mono">{s.score}</span>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {scores.length === 0 && <p className="text-center text-white/50">Ni ekip.</p>}
    </div>
  );
}
