"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRoomPing } from "@/lib/useRoomPing";
import { LETTERS, OPTION_COLORS, errorText, imageUrl } from "@/lib/kviz";
import type { KvizAnswer, KvizPlayer, KvizRoom, KvizTeam, ScoreRow } from "@/lib/types/database.types";
import { IconArrowLeft, IconCheck, IconChevronRight, IconUsers, IconX } from "@/components/ui/icons";
import clsx from "@/lib/utils/clsx";

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

  const next = useCallback(async () => {
    if (busy || !data || data.room.state === "finished") return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("kviz_next", { p_room: roomId });
    if (error) setError(errorText(error));
    await load();
    setBusy(false);
  }, [busy, data, supabase, roomId, load]);

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

  const nextLabel =
    room.state === "lobby"
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
      <header className="flex items-center justify-between gap-4 px-6 py-3 text-sm text-white/60">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/admin" className="rounded-md p-1.5 hover:bg-white/10 hover:text-white" aria-label="Nazaj v admin">
            <IconArrowLeft className="h-5 w-5" />
          </Link>
          <span className="truncate font-semibold text-white/80">{room.title}</span>
        </div>
        <div className="flex items-center gap-4">
          {room.state !== "lobby" && (
            <span>
              Koda <b className="font-mono tracking-widest text-white">{room.code}</b>
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <IconUsers /> {data.teams.length} ekip ·{" "}
            {data.players.length + data.teams.reduce((n, t) => n + (t.members?.length ?? 0), 0)} igralcev
          </span>
          <button onClick={toggleFullscreen} className="rounded-md px-2 py-1 hover:bg-white/10 hover:text-white">
            Celoten zaslon (F)
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col px-[4vw] pb-28 pt-2">
        {room.state === "lobby" && <LobbyView data={data} onKick={async (id) => {
          await supabase.rpc("kviz_kick", { p_player: id });
          await load();
        }} onRemoveMember={async (teamId, name) => {
          await supabase.rpc("kviz_host_remove_member", { p_team: teamId, p_name: name });
          await load();
        }} />}
        {(room.state === "question" || room.state === "reveal") && room.current && (
          <QuestionStage
            data={data}
            onSetCorrect={async (id, ok) => {
              await supabase.rpc("kviz_set_correct", { p_answer: id, p_correct: ok });
              await load();
            }}
          />
        )}
        {(room.state === "scoreboard" || room.state === "finished") && <ScoreStage data={data} />}
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

  return (
    <div className="flex flex-1 flex-col gap-[2vw]">
      <div className="flex items-baseline justify-between gap-4 text-[1.4vw] text-white/60 max-lg:text-base">
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

      <div className={clsx("flex flex-1 gap-[3vw]", img ? "items-center max-lg:flex-col" : "flex-col justify-center")}>
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="max-h-[48vh] max-w-[40vw] rounded-2xl object-contain shadow-2xl max-lg:max-w-full" />
        )}
        <h1 className="flex-1 text-center text-[3.6vw] font-bold leading-tight max-lg:text-3xl">{c.prompt}</h1>
      </div>

      {c.type === "choice" ? (
        <div className="grid grid-cols-2 gap-[1.2vw]">
          {c.options.map((opt, i) => {
            const isCorrect = reveal?.correct_index === i;
            const count = reveal?.counts?.[i] ?? 0;
            return (
              <div
                key={i}
                style={{ backgroundColor: OPTION_COLORS[i] }}
                className={clsx(
                  "relative flex items-center gap-[1vw] overflow-hidden rounded-2xl px-[1.5vw] py-[1.4vw] text-[2vw] font-semibold transition-opacity max-lg:text-xl",
                  reveal && !isCorrect && "opacity-30",
                  isCorrect && "ring-[0.4vw] ring-white"
                )}
              >
                <span className="flex h-[3.2vw] min-h-9 w-[3.2vw] min-w-9 shrink-0 items-center justify-center rounded-xl bg-white/25 font-black">
                  {LETTERS[i]}
                </span>
                <span className="min-w-0 flex-1 break-words">{opt}</span>
                {reveal && (
                  <span className="flex shrink-0 items-center gap-2 text-[1.6vw] max-lg:text-lg">
                    {isCorrect && <IconCheck className="h-[2.2vw] min-h-6 w-[2.2vw] min-w-6" />}
                    {count} {count === 1 ? "ekipa" : count === 2 ? "ekipi" : count < 5 ? "ekipe" : "ekip"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : reveal ? (
        <div className="space-y-4">
          <div className="text-center text-[2.4vw] font-bold max-lg:text-2xl">
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
        <p className="text-center text-[1.8vw] text-white/60 max-lg:text-lg">Vpišite odgovor na telefonu.</p>
      )}

      {!reveal && (
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
