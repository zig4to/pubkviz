"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRoomPing } from "@/lib/useRoomPing";
import { LETTERS, OPTION_COLORS, errorText, imageUrl } from "@/lib/kviz";
import type { CategoryExample, KvizAnswer, KvizPlayer, KvizQuestion, KvizRoom, KvizTeam, KvizTiebreaker, ScoreRow } from "@/lib/types/database.types";
import { IconArrowLeft, IconCheck, IconChevronRight, IconUsers, IconX } from "@/components/ui/icons";
import clsx from "@/lib/utils/clsx";

type OutlineItem = { categoryId: string; category: string };
type AnswerInfo = Pick<KvizQuestion, "id" | "category_id" | "type" | "prompt" | "options" | "correct_index" | "accepted_answers" | "explanation" | "section">;

// Razvrstitev klasičnega kviza: točke padajoče, nato izenačenje (0016,
// kviz_teams.tiebreak: 1 = zmagal izenačenje; null = neodločeno, zadnji).
// Isto mesto si delijo samo ekipe z enakimi točkami in enakim tiebreak.
type Rankable = { score: number; tiebreak?: number | null };
const tbKey = (t?: number | null) => t ?? Number.MAX_SAFE_INTEGER;
const byRank = (a: Rankable, b: Rankable) => b.score - a.score || tbKey(a.tiebreak) - tbKey(b.tiebreak);
const placeIn = (sorted: Rankable[], x: Rankable) =>
  sorted.findIndex((r) => r.score === x.score && tbKey(r.tiebreak) === tbKey(x.tiebreak)) + 1;

// Besedilo vprašanja brez napisa „# …“ v prvi vrstici (za preglede).
const plainPrompt = (p?: string | null) => (p ?? "").replace(/^# [^\n]*\n/, "");

type Data = {
  room: KvizRoom;
  teams: KvizTeam[];
  players: KvizPlayer[];
  answers: KvizAnswer[]; // samo za trenutno vprašanje
  scores: ScoreRow[];
  // Klasični konec: točke vseh ocen (kviz_scoreboard zaokroži ½ točke na cela).
  points: { team_id: string; question_id: string; points: number; is_correct: boolean | null; parts: (boolean | null)[] | null }[];
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
    const classicEnd = room.mode === "classic" && room.state === "finished";
    const [teams, players, answers, scores, points] = await Promise.all([
      supabase.from("kviz_teams").select("*").eq("room_id", roomId).order("created_at"),
      supabase.from("kviz_players").select("id, room_id, team_id, nickname, joined_at").eq("room_id", roomId).order("joined_at"),
      supabase.from("kviz_answers").select("*").eq("room_id", roomId).eq("question_id", qid),
      supabase.rpc("kviz_scoreboard", { p_room: roomId }),
      classicEnd
        ? supabase.from("kviz_answers").select("team_id, question_id, points, is_correct, parts").eq("room_id", roomId)
        : Promise.resolve({
            data: [] as {
              team_id: string;
              question_id: string;
              points: number;
              is_correct: boolean | null;
              parts: (boolean | null)[] | null;
            }[],
          }),
    ]);
    setData({
      room,
      teams: teams.data ?? [],
      players: players.data ?? [],
      answers: answers.data ?? [],
      scores: scores.data ?? [],
      points: (points.data ?? []).map((p) => ({
        team_id: p.team_id,
        question_id: p.question_id,
        points: Number(p.points),
        is_correct: p.is_correct,
        parts: p.parts,
      })),
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
  // 0016: dodatna vprašanja za izenačenje (po vrsti).
  const [tiebreakers, setTiebreakers] = useState<KvizTiebreaker[]>([]);
  const roomQuizId = data?.room.quiz_id;
  const questionKey = data?.room.question_ids.join(",");
  useEffect(() => {
    if (!roomQuizId || !questionKey) return;
    let alive = true;
    const ids = questionKey.split(",");
    void Promise.all([
      supabase
        .from("kviz_questions")
        .select("id, category_id, type, prompt, options, correct_index, accepted_answers, explanation, section")
        .in("id", ids),
      supabase.from("kviz_categories").select("id, name, example, summary").eq("quiz_id", roomQuizId),
      supabase.from("kviz_tiebreakers").select("*").eq("quiz_id", roomQuizId).order("position").order("created_at"),
    ]).then(([qs, cats, tbs]) => {
      if (!alive) return;
      setTiebreakers(tbs.data ?? []);
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
  // Končni rezultati: med samodejnim razkrivanjem / premorom je Naprej skrit.
  const [revealHold, setRevealHold] = useState(false);
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
  // 0017: vmesni slajd pred vprašanjem — korak 0 = slajd, vprašanje od koraka 1
  // (pregled vprašanj se zamakne za en korak).
  const section =
    data?.room.state === "question" ? (answerInfo[data.room.q_index]?.section?.trim() || null) : null;
  const secOff = section ? 1 : 0;

  // Skok na skriti zaslon kategorije (pike pod časovnico): kviz_goto na
  // vprašanje / uvod, za „Oddajte listke“ še kviz_next (→ scoreboard ali
  // finished pri zadnji kategoriji), nato lokalni korak.
  const jump = useCallback(
    async (index: number, opts: { intro?: boolean; advance?: boolean; step: number }) => {
      if (busy || !data) return;
      setBusy(true);
      setError(null);
      setRevealHold(false);
      let { error } = await supabase.rpc("kviz_goto", { p_room: roomId, p_index: index, p_intro: !!opts.intro });
      if (!error && opts.advance) ({ error } = await supabase.rpc("kviz_next", { p_room: roomId }));
      if (error) setError(errorText(error));
      else {
        const state = opts.intro
          ? "intro"
          : opts.advance
            ? index + 1 >= data.room.question_ids.length
              ? "finished"
              : "scoreboard"
            : "question";
        setIntroStep({ key: `${state}:${index}`, step: opts.step });
      }
      await load();
      setBusy(false);
    },
    [busy, data, supabase, roomId, load]
  );

  // Končna razvrstitev (točke iz točkovanja z ½, nato izenačenje).
  const standings = useMemo(
    () =>
      (data?.teams ?? [])
        .map((t) => ({
          id: t.id,
          name: t.name,
          members: t.members ?? [],
          tiebreak: t.tiebreak ?? null,
          score: (data?.points ?? []).filter((p) => p.team_id === t.id).reduce((s, p) => s + p.points, 0),
        }))
        .sort(byRank),
    [data]
  );
  // Neodločena izenačenja: skupine ≥ 2 ekip z enakimi točkami brez tiebreak.
  const openTies = useMemo(
    () =>
      standings
        .filter((r) => r.tiebreak === null)
        .reduce<(typeof standings)[]>((acc, r) => {
          const g = acc.find((x) => x[0].score === r.score);
          if (g) g.push(r);
          else acc.push([r]);
          return acc;
        }, [])
        .filter((g) => g.length > 1),
    [standings]
  );
  const tieQuestionIdx = standings.filter((r) => r.tiebreak !== null).length; // vsaka odločitev porabi eno vprašanje
  const tieBlock = data?.room.state === "finished" && step === 3 && openTies.length > 0;

  // Klasični konec po tabeli točk: diaprojekcija odgovorov po ekipah, po dve
  // kategoriji na stran → n ekip × pages strani. Zadnji korak = endStep.
  const teamCount = data?.teams.length ?? 0;
  const reviewPages = Math.ceil(new Set((outline ?? []).map((o) => o.categoryId)).size / 2);
  const endStep = 4 + teamCount + teamCount * reviewPages;

  const next = useCallback(async () => {
    if (busy || !data || revealHold || tieBlock) return;
    if (example && step < 2) {
      setIntroStep({ key: introKey, step: step + 1 });
      return;
    }
    if (section && step < 1) {
      setIntroStep({ key: introKey, step: 1 });
      return;
    }
    if ((reviewable || summaryNow) && step < 1 + secOff) {
      setIntroStep({ key: introKey, step: 1 + secOff });
      return;
    }
    // Klasični konec: po pregledu zadnjih odgovorov še korak 2 = zahvala,
    // korak 3 = končni rezultati (prazni), 3 + k = razkritih k ekip od zadnje,
    // 4 + n = tabela točk po kategorijah, nato strani odgovorov po ekipah.
    if (reviewable && data.room.state === "finished" && step >= 1 && step < endStep) {
      setIntroStep({ key: introKey, step: step + 1 });
      return;
    }
    if (data.room.state === "finished") return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("kviz_next", { p_room: roomId });
    if (error) setError(errorText(error));
    await load();
    setBusy(false);
  }, [busy, data, supabase, roomId, load, example, step, introKey, reviewable, summaryNow, section, secOff, endStep, revealHold, tieBlock]);

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

  const nextLabel = section && step === 0
    ? "Prvo vprašanje"
    : summaryNow && step === secOff
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
          : room.state === "finished" && step === 1
            ? "Zaključek"
          : room.state === "finished" && step === 2
            ? "Končni rezultati"
          : room.state === "finished" && step >= 3 && step < 3 + data.teams.length
            ? step === 3 && data.teams.length > 3
              ? "Začni prikazovati rezultate"
              : step === 2 + data.teams.length
              ? "Zmagovalec"
              : step === 1 + data.teams.length
                ? "2. mesto"
                : step === data.teams.length
                  ? "3. mesto"
                  : "Razkrij naslednjo ekipo"
          : room.state === "finished" && step === 3 + data.teams.length
            ? "Tabela točk"
          : room.state === "finished" && step === 4 + data.teams.length && endStep > step
            ? "Odgovori po ekipah"
          : room.state === "finished" && step > 4 + data.teams.length && step < endStep
            ? "Naslednja stran"
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

  // Konec klasičnega kviza (zahvala, rezultati, tabela, diaprojekcija): pike
  // v časovnici pod zadnjo kategorijo, za „Pregled odgovorov“ (korak 2 naprej).
  const endSlides: { label: string; group: string; step: number }[] = (() => {
    if (!classic) return [];
    const n = data.teams.length;
    const out = [
      { label: "Zahvala", group: "Zahvala" },
      { label: "Končni rezultati", group: "Rezultati" },
      ...standings.map((_, k) => ({ label: `${n - k}. mesto`, group: "Rezultati" })),
      { label: "Tabela točk", group: "Tabela" },
      ...(reviewPages > 0 && n > 0 ? [{ label: "Odgovori po ekipah", group: "Odgovori" }] : []),
    ];
    return out.map((o, i) => ({ ...o, step: i + 2 }));
  })();

  // Med diaprojekcijo odgovorov: pike za vse strani (po skupinah ekip) pod časovnico.
  const slideStart = 5 + data.teams.length;
  const slideGroups: { name: string; steps: { step: number; label: string }[] }[] =
    classic && room.state === "finished" && step >= slideStart
      ? (() => {
          // Isti vrstni red kot TeamAnswersSlide (od zadnjega mesta).
          const order = [...standings].reverse();
          return order.map((t, ti) => ({
            name: t.name,
            steps: Array.from({ length: reviewPages }, (_, p) => ({
              step: slideStart + ti * reviewPages + p,
              label: `${t.name} · stran ${p + 1}/${reviewPages}`,
            })),
          }));
        })()
      : [];

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-white [background-image:radial-gradient(ellipse_at_top_left,rgba(6,182,212,0.18),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(124,58,237,0.25),transparent_55%)]">
      {outline && outline.length > 0 && (
        <Timeline
          outline={outline}
          room={room}
          disabled={busy}
          onPick={(i, intro) => void goto(i, intro)}
          step={step}
          exampleCats={new Set(examples.keys())}
          summaryCats={summaryCats}
          endSlides={endSlides}
          onJump={(s) => void jump(s.index, { intro: s.intro, advance: s.advance, step: s.step })}
        />
      )}
      {slideGroups.length > 0 && (
        <nav
          aria-label="Strani odgovorov po ekipah"
          className="flex flex-wrap items-end justify-center gap-x-5 gap-y-1.5 border-b border-white/5 px-6 py-2"
        >
          {slideGroups.map((g) => (
            <div key={g.steps[0]?.step} className="flex flex-col items-center gap-1">
              <span className="max-w-[10rem] truncate text-[10px] font-semibold uppercase tracking-wider text-white/40">
                {g.name}
              </span>
              <div className="flex gap-1">
                {g.steps.map((s) => (
                  <button
                    key={s.step}
                    type="button"
                    title={s.label}
                    aria-label={s.label}
                    aria-current={s.step === step ? "step" : undefined}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      setIntroStep({ key: introKey, step: s.step });
                    }}
                    className={clsx(
                      "h-3 w-3 rounded-full transition-colors",
                      s.step === step
                        ? "bg-cyan-400 ring-2 ring-cyan-400/40 ring-offset-1 ring-offset-gray-950"
                        : s.step < step
                          ? "bg-violet-500/70 hover:bg-violet-400"
                          : "bg-white/15 hover:bg-white/35",
                    )}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>
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
        {classic && room.state === "finished" && step === 2 && <ThankYou />}
        {classic && room.state === "finished" && step === 4 + data.teams.length && (
          <PointsTable data={data} outline={outline ?? []} />
        )}
        {/* Radio od tabele točk do konca diaprojekcije — ena instanca, da glasba ne preneha ob menjavi strani. */}
        {classic && room.state === "finished" && step >= 4 + data.teams.length && <RadioButton />}
        {classic && room.state === "finished" && step > 4 + data.teams.length && outline && (
          <TeamAnswersSlide
            data={data}
            outline={outline}
            answers={answerInfo}
            slide={step - 5 - data.teams.length}
            last={step === endStep}
            onNext={() => void next()}
          />
        )}
        {/* Pred končnimi rezultati: najprej odloči vsa izenačenja (dodatna vprašanja). */}
        {classic && room.state === "finished" && step === 3 && openTies.length > 0 && (
          <TiebreakView
            key={openTies[0].map((t) => t.id).join(",")}
            group={openTies[0]}
            question={tiebreakers[tieQuestionIdx] ?? null}
            canReset={tieQuestionIdx > 0}
            onWin={async (teamId) => {
              const { error } = await supabase.rpc("kviz_host_tiebreak_win", { p_team: teamId });
              if (error) setError(errorText(error));
              await load();
            }}
            onReset={async () => {
              const { error } = await supabase.rpc("kviz_host_tiebreak_reset", { p_room: room.id });
              if (error) setError(errorText(error));
              await load();
            }}
          />
        )}
        {classic && room.state === "finished" && step >= 3 && step < 4 + data.teams.length &&
          !(step === 3 && openTies.length > 0) && (
          <FinalReveal
            title={room.title}
            revealed={step - 3}
            onHold={setRevealHold}
            onNext={() =>
              setIntroStep((s) => ({ key: introKey, step: (s.key === introKey ? s.step : 0) + 1 }))
            }
            rows={standings}
          />
        )}
        {!classic && room.state === "lobby" && <LobbyView data={data} onKick={async (id) => {
          await supabase.rpc("kviz_kick", { p_player: id });
          await load();
        }} onRemoveMember={async (teamId, name) => {
          await supabase.rpc("kviz_host_remove_member", { p_team: teamId, p_name: name });
          await load();
        }} />}
        {section && step === 0 && <SectionSlide key={introKey} text={section} category={room.current?.category ?? ""} />}
        {summaryNow && step === 1 + secOff && outline && (
          <QuestionSummary key={introKey} room={room} outline={outline} answers={answerInfo} />
        )}
        {(room.state === "question" || room.state === "reveal") && room.current &&
          !(summaryNow && step === 1 + secOff) && !(section && step === 0) && (
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
      {nextLabel && !revealHold && !tieBlock && (
        <button
          onClick={() => void next()}
          disabled={busy}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-violet-600 px-7 py-4 text-xl font-semibold shadow-xl shadow-violet-900/40 transition-transform hover:scale-[1.03] disabled:opacity-60"
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
// Skriti zasloni kategorije (pike pod krogci vprašanj): levo uvod (+ primer,
// rešitev), desno po zadnjem vprašanju (pregled vprašanj; v klasičnem kvizu
// „Oddajte listke“ in pregled odgovorov). Klik → onJump.
type SubSlide = { label: string; index: number; intro?: boolean; advance?: boolean; step: number; active: boolean };

function Timeline({
  outline,
  room,
  disabled,
  onPick,
  step,
  exampleCats,
  summaryCats,
  endSlides,
  onJump,
}: {
  outline: OutlineItem[];
  room: KvizRoom;
  disabled: boolean;
  onPick: (index: number, intro: boolean) => void;
  step: number;
  exampleCats: Set<string>;
  summaryCats: Set<string>;
  endSlides: { label: string; group: string; step: number }[];
  onJump: (s: SubSlide) => void;
}) {
  const classic = room.mode === "classic";
  const lastIdx = outline.length - 1;
  // Konec kviza: pod zadnjo kategorijo, skupine (Zahvala, Rezultati, Tabela, ekipe).
  const endGroups = endSlides.reduce<{ name: string; items: SubSlide[] }[]>((acc, e) => {
    const s: SubSlide = {
      label: e.label,
      index: lastIdx,
      advance: true,
      step: e.step,
      active: room.state === "finished" && room.q_index === lastIdx && step === e.step,
    };
    const g = acc[acc.length - 1];
    if (g && g.name === e.group) g.items.push(s);
    else acc.push({ name: e.group, items: [s] });
    return acc;
  }, []);
  const subSlides = (start: number, count: number, categoryId: string) => {
    const last = start + count - 1;
    const before: SubSlide[] = [{ label: "Uvod", index: start, intro: true, step: 0, active: false }];
    if (exampleCats.has(categoryId))
      before.push(
        { label: "Kako se igra?", index: start, intro: true, step: 1, active: false },
        { label: "Rešitev primera", index: start, intro: true, step: 2, active: false },
      );
    const after: SubSlide[] = [];
    if (summaryCats.has(categoryId)) after.push({ label: "Pregled vprašanj", index: last, step: 1, active: false });
    if (classic)
      after.push(
        { label: "Oddajte listke", index: last, advance: true, step: 0, active: false },
        { label: "Pregled odgovorov", index: last, advance: true, step: 1, active: false },
      );
    const atEnd = room.state === "scoreboard" || room.state === "finished";
    const mark = (s: SubSlide) => ({
      ...s,
      active:
        room.q_index === s.index &&
        step === s.step &&
        (s.intro ? room.state === "intro" : s.advance ? atEnd : room.state === "question"),
    });
    return { before: before.map(mark), after: after.map(mark) };
  };
  const dot = (s: SubSlide, si: number) => (
    <button
      key={`${s.label}-${s.step}`}
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.currentTarget.blur();
        if (!s.active) onJump(s);
      }}
      title={`Kategorija ${si + 1} · ${s.label}`}
      aria-label={`Kategorija ${si + 1}, ${s.label}`}
      aria-current={s.active ? "step" : undefined}
      className={clsx(
        "h-2 w-2 rounded-full transition-colors disabled:cursor-wait",
        s.active ? "bg-cyan-300 ring-2 ring-cyan-300/40" : "bg-white/20 hover:bg-white/60",
      )}
    />
  );
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
    <nav aria-label="Časovnica kviza" className="relative z-40 w-full border-b border-white/10 bg-black/30 px-[2vw] pb-3 pt-2.5 backdrop-blur">
      <ol className="flex w-full gap-[0.9vw]">
        {segments.map((seg, si) => {
          const isCat = seg.categoryId === activeCat;
          const catDone = seg.start + seg.count - 1 <= doneUpTo;
          return (
            <li key={seg.start} className="flex min-w-0 basis-0 flex-col gap-1.5" style={{ flexGrow: seg.count }}>
              {/* Ime kategorije se pokaže šele ob hoverju (oblaček pod oznako). */}
              <div className="group relative min-w-0 self-start">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    if (!(room.state === "intro" && isCat)) onPick(seg.start, true);
                  }}
                  aria-label={`Uvod kategorije ${si + 1}: ${seg.name}`}
                  className={clsx(
                    "flex min-w-0 max-w-full items-center gap-1.5 truncate rounded text-left text-[clamp(0.65rem,0.8vw,0.85rem)] font-semibold uppercase tracking-wider transition-colors hover:text-white disabled:cursor-wait",
                    isCat ? "text-cyan-300" : catDone ? "text-white/60" : "text-white/35"
                  )}
                >
                  <span className="truncate">Kategorija {si + 1}</span>
                </button>
                <div
                  role="tooltip"
                  className={clsx(
                    "pointer-events-none absolute top-full z-50 mt-1 whitespace-nowrap rounded-md bg-gray-950/95 px-2.5 py-1 text-[clamp(0.7rem,0.9vw,0.95rem)] font-semibold text-white opacity-0 shadow-lg ring-1 ring-white/15 transition-opacity duration-150 group-hover:opacity-100",
                    si === segments.length - 1 ? "right-0" : "left-0"
                  )}
                >
                  {seg.name}
                </div>
              </div>
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
              {(() => {
                const { before, after } = subSlides(seg.start, seg.count, seg.categoryId);
                const isLast = si === segments.length - 1;
                return (
                  <>
                    <div className="relative flex items-center justify-between px-1">
                      <div className="flex gap-1">{before.map((s) => dot(s, si))}</div>
                      <div className="flex gap-1">{after.map((s) => dot(s, si))}</div>
                      {/* Konec kviza: lebdi pod črto nad stranjo, brez svoje vrstice v časovnici. */}
                      {isLast && endGroups.length > 0 && (
                      <div className="absolute right-0 top-full z-40 mt-1 flex flex-wrap justify-end gap-x-2 gap-y-1 rounded-b-md border-t border-white/10 bg-gray-950/70 px-1 pb-1 pt-1 backdrop-blur">
                        {endGroups.map((g) => (
                          <div key={g.name + g.items[0].step} className="flex gap-1" title={g.name}>
                            {g.items.map((s) => dot(s, si))}
                          </div>
                        ))}
                      </div>
                      )}
                    </div>
                  </>
                );
              })()}
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

// 0017: vmesni slajd sredi kategorije (npr. „Dodatna splošna vprašanja“).
function SectionSlide({ text, category }: { text: string; category: string }) {
  const [title, ...rest] = text.split("\n");
  const sub = rest.join(" ").trim();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[min(1.4vw,2.4vh)] text-center">
      <div className="draw-pop text-[min(1.1vw,1.9vh)] font-bold uppercase tracking-[0.35em] text-cyan-300 max-lg:text-xs">
        {category}
      </div>
      <h1 className="draw-land bg-gradient-to-r from-cyan-300 to-violet-400 bg-clip-text text-[min(5vw,8.5vh)] font-black leading-tight text-transparent max-lg:text-4xl">
        {title}
      </h1>
      {sub && (
        <p
          className="draw-pop text-[min(2.2vw,3.8vh)] font-semibold text-white/80 max-lg:text-xl"
          style={{ animationDelay: "250ms" }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

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
      {solved && example.solvedNote && (
        <p
          className="draw-pop mx-auto max-w-[70vw] rounded-[min(1vw,1.7vh)] bg-cyan-400/10 px-[min(1.6vw,2.7vh)] py-[min(0.8vw,1.4vh)] text-center text-[min(1.6vw,2.8vh)] font-semibold leading-snug text-cyan-100 ring-1 ring-cyan-300/30 max-lg:max-w-full max-lg:text-base"
          style={{ animationDelay: "700ms" }}
        >
          {example.solvedNote}
        </p>
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

// Zadnji zaslon klasičnega kviza (po pregledu zadnjih odgovorov).
// Izenačenje pred končnimi rezultati (0016): dodatno vprašanje „kdor je
// bližji, zmaga“. Ekipe odgovor napišejo na listek, voditelj pokaže pravilni
// odgovor in klikne ekipo, ki je bila bližje. Pri treh ali več izenačenih se
// za preostale postavi naslednje vprašanje.
function TiebreakView({
  group,
  question,
  canReset,
  onWin,
  onReset,
}: {
  group: { id: string; name: string; members: string[]; score: number }[];
  question: KvizTiebreaker | null;
  canReset: boolean;
  onWin: (teamId: string) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const fmt = (x: number) => String(Math.round(x * 100) / 100).replace(".", ",");
  const pick = async (id: string) => {
    if (busy) return;
    setBusy(true);
    await onWin(id);
    setBusy(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-[3vh] text-center">
      <div className="kviz-pop text-[min(1.6vw,2.8vh)] font-bold uppercase tracking-[0.3em] text-amber-300">
        Izenačenje · {fmt(group[0].score)} t.
      </div>
      <div className="flex flex-wrap justify-center gap-x-[2vw] gap-y-2 text-[min(2.4vw,4vh)] font-black">
        {group.map((t, i) => (
          <span key={t.id}>
            {i > 0 && <span className="mr-[2vw] text-white/30">vs</span>}
            {t.name}
          </span>
        ))}
      </div>
      <div className="text-[min(1.3vw,2.3vh)] uppercase tracking-widest text-white/50">
        Dodatno vprašanje — kdor je bližji, zmaga
      </div>
      {question ? (
        <h1 className="max-w-5xl text-balance text-[min(3.6vw,6.5vh)] font-black leading-tight">{question.prompt}</h1>
      ) : (
        <p className="text-[min(2vw,3.5vh)] text-white/60">
          Ni več pripravljenih dodatnih vprašanj — dodaj jih v urejevalniku ali izberi zmagovalca.
        </p>
      )}
      {question && (
        <div className="min-h-[12vh]">
          {shown ? (
            <div className="kviz-pop">
              <div className="text-[min(5vw,9vh)] font-black text-emerald-300">{question.answer}</div>
              {question.explanation && (
                <div className="mt-1 text-[min(1.4vw,2.4vh)] text-white/60">{question.explanation}</div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                setShown(true);
              }}
              className="rounded-full border border-white/20 px-6 py-3 text-lg font-semibold text-white/80 hover:bg-white/10"
            >
              Pokaži odgovor
            </button>
          )}
        </div>
      )}
      {(shown || !question) && (
        <div className="flex flex-col items-center gap-3">
          <div className="text-sm uppercase tracking-widest text-white/50">Katera ekipa je bila bližje?</div>
          <div className="flex flex-wrap justify-center gap-3">
            {group.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={busy}
                onClick={() => void pick(t.id)}
                className="rounded-2xl bg-violet-600 px-7 py-4 text-xl font-bold shadow-lg shadow-violet-900/40 hover:bg-violet-500 disabled:opacity-50"
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {canReset && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Ponastavim vse odločitve izenačenj?")) void onReset();
          }}
          className="text-xs text-white/30 underline hover:text-white/60"
        >
          Ponastavi izenačenja
        </button>
      )}
    </div>
  );
}

function ThankYou() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[2vw] text-center">
      <h1 className="bg-gradient-to-r from-cyan-300 to-violet-400 bg-clip-text text-[7vw] font-black leading-tight text-transparent max-lg:text-5xl">
        To je bilo to!
      </h1>
      <p className="max-w-[60vw] text-[2.4vw] font-semibold leading-snug max-lg:max-w-xl max-lg:text-xl">
        Hvala vsem ekipam za odlično vzdušje.
      </p>
      <p className="max-w-[60vw] text-[2vw] leading-snug text-white/70 max-lg:max-w-xl max-lg:text-lg">
        Upamo, da ste se nasmejali in odnesli domov kakšno novo modrost. Zdaj pa lepo počasi, kozarec vode vmes ne
        škodi.
      </p>
      <p className="mt-[1vw] text-[1.3vw] uppercase tracking-widest text-cyan-300/80 max-lg:text-sm">
        Rezultati bodo razglašeni čez 10 minut …
      </p>
    </div>
  );
}

// Klasični kviz: končni rezultati po korakih. revealed = 0 → samo naslov;
// vsak korak razkrije eno ekipo od zadnjega mesta naprej: najprej velika
// razglasitev na sredini, nato se vrstica pojavi v grafu (graf raste od spodaj
// navzgor, mesta zgoraj ostanejo prazna, dokler niso razkrita). Točke iz
// točkovanja z ½; enake točke = isto mesto.
// Prazen zaslon čaka na gumb „Začni prikazovati rezultate“; nato se ekipe
// pod 3. mestom razkrijejo same (2 s premora po vsaki animaciji),
// prve tri pa z gumbom; gumb je viden takoj (tudi med animacijo)
// (`onHold(true)` gumb skrije in zaklene Naprej).
// Ognjemet čez cel zaslon (canvas, pointer-events none): rakete s sledjo
// poletijo z dna in počijo v iskre, po `ms` ugasne. Zvok: pok (šum) ob eksploziji.
function Fireworks({ delay, ms }: { delay: number; ms: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    type Rocket = { x: number; y: number; vx: number; vy: number; ty: number; hue: number };
    type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number; size: number };
    const rockets: Rocket[] = [];
    const sparks: Spark[] = [];
    let raf = 0;
    let start = 0;
    let nextLaunch = 0;
    let audio: AudioContext | null = null;
    try {
      audio = new AudioContext();
    } catch {
      audio = null;
    }
    const bang = (vol: number) => {
      if (!audio) return;
      const len = Math.floor(audio.sampleRate * 0.6);
      const buf = audio.createBuffer(1, len, audio.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = audio.createBufferSource();
      src.buffer = buf;
      const lp = audio.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900 + Math.random() * 900;
      const g = audio.createGain();
      g.gain.value = vol;
      src.connect(lp).connect(g).connect(audio.destination);
      src.start();
    };
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      cv.width = window.innerWidth * dpr;
      cv.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const launch = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const x = w * (0.1 + Math.random() * 0.8);
      const ty = h * (0.12 + Math.random() * 0.35);
      const hues = [45, 190, 270, 330, 140, 20];
      rockets.push({
        x,
        y: h + 10,
        vx: (Math.random() - 0.5) * 2,
        vy: -Math.sqrt(2 * 0.12 * (h - ty)) - 1,
        ty,
        hue: hues[Math.floor(Math.random() * hues.length)],
      });
    };
    const burst = (r: Rocket) => {
      const count = 70 + Math.floor(Math.random() * 50);
      const speed = 3 + Math.random() * 3;
      const ring = Math.random() < 0.3;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + Math.random() * 0.1;
        const s = ring ? speed : speed * (0.3 + Math.random() * 0.7);
        const max = 55 + Math.random() * 35;
        sparks.push({
          x: r.x,
          y: r.y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          life: max,
          max,
          hue: r.hue + (Math.random() * 30 - 15),
          size: 1.6 + Math.random() * 1.4,
        });
      }
      bang(0.25 + Math.random() * 0.2);
    };

    const frame = (t: number) => {
      if (!start) start = t;
      const el = t - start;
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      if (el < ms && el >= nextLaunch) {
        launch();
        if (Math.random() < 0.45) launch();
        nextLaunch = el + 250 + Math.random() * 450;
      }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.x += r.vx;
        r.y += r.vy;
        r.vy += 0.12;
        ctx.fillStyle = `hsl(${r.hue} 100% 75%)`;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
        if (r.vy >= -0.5 || r.y <= r.ty) {
          burst(r);
          rockets.splice(i, 1);
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.vx *= 0.975;
        p.vy = p.vy * 0.975 + 0.06;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1;
        const k = p.life / p.max;
        ctx.fillStyle = `hsla(${p.hue} 100% ${55 + 25 * k}% / ${k})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * k), 0, Math.PI * 2);
        ctx.fill();
        if (p.life <= 0) sparks.splice(i, 1);
      }
      if (el < ms || rockets.length || sparks.length) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    };
    const timer = window.setTimeout(() => {
      raf = requestAnimationFrame(frame);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      void audio?.close();
    };
  }, [delay, ms]);
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-40" />;
}

const REVEAL_PAUSE_MS = 2000;

function FinalReveal({
  title,
  revealed,
  rows,
  onNext,
  onHold,
}: {
  title: string;
  revealed: number;
  rows: { id: string; name: string; members: string[]; score: number; tiebreak?: number | null }[];
  onNext: () => void;
  onHold: (hold: boolean) => void;
}) {
  const n = rows.length;
  const shown = Math.min(revealed, n);
  const max = Math.max(1, ...rows.map((r) => r.score));
  const rank = (i: number) => placeIn(rows, rows[i]);
  const fmt = (x: number) => String(Math.round(x * 100) / 100).replace(".", ",");
  const latest = shown > 0 ? n - shown : -1; // indeks nazadnje razkrite ekipe
  const medal = (r: number) =>
    r === 1 ? "text-amber-300" : r === 2 ? "text-slate-300" : r === 3 ? "text-orange-400" : "text-white/40";
  // Časi razglasitve (s): mesto takoj, bobni od 0,5 do D, ob D činele + ime.
  // Bobni trajajo 1,9 s za vsa mesta (tudi zmagovalca — takrat je že jasno, kdo je ostal).
  const D = 2.4;
  const OUT = D + 2.2; // razglasitev se umakne
  const ROW = OUT + 0.3; // vrstica v grafu

  const played = useRef(-1);
  useEffect(() => {
    if (latest < 0 || played.current === latest) return;
    played.current = latest;
    playDrumroll(0.5, D);
  }, [latest, D]);

  // Samodejno razkrivanje do 4. mesta, nato premor pred gumbom za prve tri.
  const cb = useRef({ onNext, onHold });
  useEffect(() => {
    cb.current = { onNext, onHold };
  });
  useEffect(() => {
    if (shown >= n) {
      // Po zmagovalcu: Naprej (Tabela točk) šele po animaciji + premoru.
      const end = (ROW + 1.5) * 1000; // gumb takoj po animaciji
      const a = window.setTimeout(() => cb.current.onHold(true), 0);
      const b = window.setTimeout(() => cb.current.onHold(false), end);
      return () => {
        window.clearTimeout(a);
        window.clearTimeout(b);
        cb.current.onHold(false);
      };
    }
    // Prazen zaslon čaka na gumb „Začni prikazovati rezultate“.
    if (shown === 0) return;
    const nextIdx = n - shown - 1; // indeks ekipe, ki pride naslednja
    const auto = nextIdx >= 3;
    // Prve tri: gumb je viden takoj (brez čakanja na konec animacije).
    if (!auto) return;
    // Samodejno: vrstica + stolpec na mestu + premor; gumb (prve tri): takoj po animaciji.
    const wait = (ROW + 1.5) * 1000 + (auto ? REVEAL_PAUSE_MS : 0);
    const a = window.setTimeout(() => cb.current.onHold(true), 0);
    const b = window.setTimeout(() => {
      cb.current.onHold(false);
      if (auto) cb.current.onNext();
    }, wait);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
      cb.current.onHold(false);
    };
  }, [shown, n, ROW]);

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-6">
      {/* Zmagovalec: 10 s ognjemeta od trenutka, ko se pokaže ime. */}
      {latest === 0 && <Fireworks key={rows[0]?.id} delay={D * 1000} ms={10000} />}
      <style>{`
        @keyframes kviz-pop {
          0% { opacity: 0; transform: scale(.5); }
          60% { opacity: 1; transform: scale(1.08); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes kviz-out { to { opacity: 0; transform: scale(.94) translateY(3vh); } }
        @keyframes kviz-gone { to { opacity: 0; } }
        @keyframes kviz-drum {
          0%, 100% { transform: scale(1); opacity: .35; }
          50% { transform: scale(1.5); opacity: 1; }
        }
        @keyframes kviz-shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-.15vw) rotate(-.6deg); }
          75% { transform: translateX(.15vw) rotate(.6deg); }
        }
        @keyframes kviz-row-in {
          from { opacity: 0; transform: translateY(1.5rem); }
          to { opacity: 1; transform: none; }
        }
        @keyframes kviz-bar { from { width: 0; } }
        @keyframes kviz-fade { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      <div className={clsx("text-center transition-all duration-700", shown === 0 && "translate-y-[18vh]")}>
        <div className="text-[1.4vw] uppercase tracking-widest text-cyan-300 max-lg:text-sm">{title}</div>
        <h1 className={clsx("whitespace-nowrap font-black transition-all duration-700", shown === 0 ? "text-[7vw] max-lg:text-5xl" : "text-[4vw] max-lg:text-4xl")}>
          Končni rezultati
        </h1>
      </div>

      {n === 0 && <p className="text-center text-white/50">Ni ekip.</p>}

      <ol className="space-y-2.5">
        {rows.map((r, i) => {
          const visible = i >= n - shown;
          const rk = rank(i);
          // Nazadnje razkrita vrstica počaka, da se razglasitev na sredini umakne.
          const delay = i === latest ? `${ROW}s` : "0s";
          return (
            <li key={r.id} className="flex items-center gap-4" style={{ visibility: visible ? "visible" : "hidden" }}>
              {visible && (
                <>
                  <span
                    className={clsx("w-14 text-right text-[2vw] font-black max-lg:text-2xl", medal(rk))}
                    style={{ animation: `kviz-fade .4s ${delay} both` }}
                  >
                    {rk}.
                  </span>
                  <div
                    className="relative flex-1 overflow-hidden rounded-xl bg-white/5"
                    style={{ animation: `kviz-row-in .5s ${delay} both` }}
                  >
                    <div
                      className={clsx(
                        "absolute inset-y-0 left-0 rounded-xl bg-gradient-to-r",
                        rk === 1
                          ? "from-amber-400/80 to-violet-600/80"
                          : rk === 2
                            ? "from-slate-300/80 to-violet-600/80"
                            : rk === 3
                              ? "from-orange-500/80 to-violet-600/80"
                              : "from-cyan-500/70 to-violet-600/70",
                      )}
                      style={{
                        width: `${(r.score / max) * 100}%`,
                        animation: `kviz-bar 1.2s cubic-bezier(.2,.8,.2,1) ${i === latest ? `${ROW + 0.3}s` : "0s"} both`,
                      }}
                    />
                    <div className="relative flex items-center justify-between px-5 py-3 text-[1.9vw] font-semibold max-lg:text-xl">
                      <span className="flex min-w-0 items-baseline gap-[1vw]">
                        <span className="shrink-0">{r.name}</span>
                        {r.members.length > 0 && (
                          <span className="truncate text-[1.1vw] font-normal text-white/60 max-lg:text-sm">
                            {r.members.join(" · ")}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 pl-3 font-mono">{fmt(r.score)}</span>
                    </div>
                  </div>
                </>
              )}
              {!visible && <div className="flex-1 py-3 text-[1.9vw] max-lg:text-xl">&nbsp;</div>}
            </li>
          );
        })}
      </ol>

      {latest >= 0 && (
        <div
          key={latest}
          className="pointer-events-none fixed inset-0 z-30 flex flex-col items-center justify-center bg-gray-950/85 text-center backdrop-blur-sm"
          style={{ animation: `kviz-fade .3s both, kviz-out .5s ease-in ${OUT}s forwards` }}
        >
          {/* 1) mesto, med bobni se trese */}
          <div
            className={clsx("text-[6vw] font-black max-lg:text-5xl", medal(rank(latest)))}
            style={{ animation: `kviz-pop .5s both, kviz-shake .12s linear .5s ${Math.round((D - 0.5) / 0.12)}` }}
          >
            {rank(latest)}. mesto
          </div>
          {/* 2) bobni: utripajoče pike do D */}
          <div className="relative h-[10vw] w-full max-lg:h-24">
            <div
              className="absolute inset-0 flex items-center justify-center gap-[1.5vw]"
              style={{ animation: `kviz-fade .2s .5s both, kviz-gone .15s ${D}s forwards` }}
            >
              {[0, 1, 2].map((k) => (
                <span
                  key={k}
                  className="h-[1.4vw] w-[1.4vw] rounded-full bg-cyan-300 max-lg:h-3 max-lg:w-3"
                  style={{ animation: `kviz-drum .6s ease-in-out ${0.5 + k * 0.2}s infinite` }}
                />
              ))}
            </div>
            {/* 3) ob činelah ime ekipe */}
            <div
              className="absolute inset-0 flex items-center justify-center px-[4vw] text-[8vw] font-black leading-none max-lg:text-6xl"
              style={{ animation: `kviz-pop .6s cubic-bezier(.2,1.4,.4,1) ${D}s both` }}
            >
              <span className="truncate">{rows[latest].name}</span>
            </div>
          </div>
          {rows[latest].members.length > 0 && (
            <div
              className="mb-[1vw] px-[4vw] text-[2.6vw] font-semibold text-cyan-200 max-lg:text-xl"
              style={{ animation: `kviz-fade .4s ${D + 0.3}s both` }}
            >
              {rows[latest].members.join(" · ")}
            </div>
          )}
          <div
            className="font-mono text-[3vw] text-white/70 max-lg:text-2xl"
            style={{ animation: `kviz-fade .4s ${D + 0.5}s both` }}
          >
            {fmt(rows[latest].score)} {rows[latest].score === 1 ? "točka" : rows[latest].score === 2 ? "točki" : rows[latest].score === 3 || rows[latest].score === 4 ? "točke" : "točk"}
          </div>
        </div>
      )}

    </div>
  );
}

// Klasični kviz, zadnji zaslon: točke vsake ekipe po kategorijah (K1, K2, …)
// in skupaj, razvrščeno po skupnih točkah. Spodaj gumb za izhod.
function PointsTable({ data, outline }: { data: Data; outline: OutlineItem[] }) {
  const { room, teams, points } = data;
  const fmt = (x: number) => String(Math.round(x * 100) / 100).replace(".", ",");
  const cats: { id: string; name: string }[] = [];
  outline.forEach((it) => {
    if (!cats.some((c) => c.id === it.categoryId)) cats.push({ id: it.categoryId, name: it.category });
  });
  const catOf = new Map(room.question_ids.map((qid, i) => [qid, outline[i]?.categoryId]));
  const rows = teams
    .map((t) => {
      const byCat = new Map<string, number>();
      let total = 0;
      points
        .filter((p) => p.team_id === t.id)
        .forEach((p) => {
          const c = catOf.get(p.question_id);
          if (c) byCat.set(c, (byCat.get(c) ?? 0) + p.points);
          total += p.points;
        });
      return { id: t.id, name: t.name, byCat, total, score: total, tiebreak: t.tiebreak };
    })
    .sort(byRank);
  const best = new Map(cats.map((c) => [c.id, Math.max(0, ...rows.map((r) => r.byCat.get(c.id) ?? 0))]));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center gap-[1.5vw]">
      <div className="text-center">
        <div className="text-[1.4vw] uppercase tracking-widest text-cyan-300 max-lg:text-sm">{room.title}</div>
        <h1 className="text-[3.5vw] font-black max-lg:text-3xl">Tabela točk</h1>
      </div>
      <table className="w-full text-[1.5vw] tabular-nums max-lg:text-base">
        <thead>
          <tr className="align-bottom text-[1.1vw] uppercase tracking-wide text-white/50 max-lg:text-xs">
            <th className="py-2 pr-3 text-right">#</th>
            <th className="py-2 pr-3 text-left">Ekipa</th>
            {cats.map((c, i) => (
              <th key={c.id} className="px-1 py-2 text-center align-bottom" title={c.name}>
                K{i + 1}
                <div className="mx-auto max-w-[8vw] text-balance text-[0.7vw] font-normal normal-case leading-tight tracking-normal text-white/40 max-lg:text-[9px]">
                  {c.name.toLowerCase()}
                </div>
              </th>
            ))}
            <th className="py-2 pl-3 text-right text-cyan-300">Skupaj</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rk = placeIn(rows, r);
            return (
              <tr key={r.id} className="border-t border-white/10">
                <td
                  className={clsx(
                    "py-[0.6vw] pr-3 text-right font-black",
                    rk === 1 ? "text-amber-300" : rk === 2 ? "text-slate-300" : rk === 3 ? "text-orange-400" : "text-white/40",
                  )}
                >
                  {rk}.
                </td>
                <td className="max-w-[20vw] truncate py-[0.6vw] pr-3 font-semibold">{r.name}</td>
                {cats.map((c) => {
                  const v = r.byCat.get(c.id) ?? 0;
                  return (
                    <td
                      key={c.id}
                      className={clsx(
                        "px-1 py-[0.6vw] text-center",
                        v > 0 && v === best.get(c.id) ? "font-bold text-emerald-300" : "text-white/70",
                      )}
                    >
                      {fmt(v)}
                    </td>
                  );
                })}
                <td className="py-[0.6vw] pl-3 text-right text-[1.8vw] font-black max-lg:text-lg">{fmt(r.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-center text-[1vw] text-white/40 max-lg:text-xs">
        zeleno = največ točk v kategoriji
      </p>
    </div>
  );
}

// Klasični kviz po tabeli točk: diaprojekcija za vsako ekipo (od zadnjega
// mesta do zmagovalca), na stran po dve kategoriji (levo, desno): vprašanja
// s pravilnim odgovorom in oceno ekipe (✓ / ✗ / delne točke). Vsaka stran
// ostane 30 s, nato sama gre naprej (Naprej preskoči). Zapisanih odgovorov
// z listkov nimamo — samo oceno iz točkovanja.
const SLIDE_MS = 30000;

function TeamAnswersSlide({
  data,
  outline,
  answers,
  slide,
  last,
  onNext,
}: {
  data: Data;
  outline: OutlineItem[];
  answers: (AnswerInfo | null)[];
  slide: number;
  last: boolean;
  onNext: () => void;
}) {
  const { room, teams, points } = data;
  const fmt = (x: number) => String(Math.round(x * 100) / 100).replace(".", ",");

  // Samodejno naprej po 30 s (ref, da se časovnik ne resetira ob osvežitvi podatkov).
  const nextRef = useRef(onNext);
  useEffect(() => {
    nextRef.current = onNext;
  });
  useEffect(() => {
    if (last) return;
    const t = window.setTimeout(() => nextRef.current(), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [slide, last]);

  const cats: { id: string; name: string; idx: number[] }[] = [];
  outline.forEach((it, i) => {
    const c = cats.find((x) => x.id === it.categoryId);
    if (c) c.idx.push(i);
    else cats.push({ id: it.categoryId, name: it.category, idx: [i] });
  });
  const pages = Math.ceil(cats.length / 2);
  const mark = new Map(points.map((p) => [`${p.team_id}:${p.question_id}`, p]));
  const total = (tid: string, qids: string[] = room.question_ids) =>
    qids.reduce((s, q) => s + (mark.get(`${tid}:${q}`)?.points ?? 0), 0);

  const ranked = teams.map((t) => ({ ...t, score: total(t.id) })).sort(byRank);
  const order = [...ranked].reverse(); // od zadnjega mesta naprej
  const team = order[Math.floor(slide / pages)];
  const page = slide % pages;
  if (!team) return null;
  const rank = placeIn(ranked, team);
  const shown = cats.slice(page * 2, page * 2 + 2);

  const answerText = (q: AnswerInfo | null) => {
    if (!q) return "";
    if (q.type === "choice") return q.correct_index !== null ? q.options[q.correct_index] ?? "" : "";
    return q.accepted_answers[0] ?? "";
  };

  return (
    <div key={slide} className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-[min(1.4vw,2.2vh)]">
      <style>{`@keyframes kviz-progress { from { width: 0; } to { width: 100%; } }`}</style>
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <div className="text-[min(1.1vw,1.9vh)] font-bold uppercase tracking-[0.3em] text-cyan-300 max-lg:text-xs">
            {rank}. mesto · stran {page + 1}/{pages}
          </div>
          <div className="flex min-w-0 items-baseline gap-[min(1.5vw,2.5vh)]">
            <h1 className="draw-land shrink-0 text-[min(3.4vw,5.8vh)] font-black leading-tight max-lg:text-3xl">
              {team.name}
            </h1>
            {(team.members?.length ?? 0) > 0 && (
              <span className="truncate text-[min(1.6vw,2.7vh)] font-semibold text-cyan-200/80 max-lg:text-lg">
                <span className="text-white/40">– </span>
                {team.members.join(" · ")}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right font-mono text-[min(2.2vw,3.8vh)] font-bold max-lg:text-xl">
          {fmt(total(team.id))} <span className="text-white/50">t.</span>
        </div>
      </div>
      {!last && (
        <div className="h-1 overflow-hidden rounded-full bg-white/10">
          <div
            key={slide}
            className="h-full bg-gradient-to-r from-cyan-400 to-violet-500"
            style={{ animation: `kviz-progress ${SLIDE_MS}ms linear both` }}
          />
        </div>
      )}

      <div className="grid flex-1 grid-cols-2 gap-[min(2vw,3.4vh)]">
        {shown.map((c) => {
          const n = cats.indexOf(c) + 1;
          const qids = c.idx.map((i) => room.question_ids[i]);
          const dense = c.idx.length > 6;
          return (
            <section key={c.id} className="draw-pop flex min-w-0 flex-col gap-[min(0.6vw,1vh)]">
              <div className="flex items-baseline justify-between gap-3 border-b border-white/15 pb-[min(0.5vw,0.8vh)]">
                <h2 className="truncate text-[min(1.7vw,2.9vh)] font-bold max-lg:text-lg">
                  <span className="text-cyan-300">Kategorija {n}:</span> {c.name}
                </h2>
                <span className="shrink-0 font-mono text-[min(1.5vw,2.6vh)] font-bold text-white/80 max-lg:text-base">
                  {fmt(total(team.id, qids))} t.
                </span>
              </div>
              <ol className="flex flex-col gap-[min(0.45vw,0.75vh)]">
                {c.idx.map((i, k) => {
                  const q = answers[i];
                  const m = mark.get(`${team.id}:${room.question_ids[i]}`);
                  const partial = !!m?.parts && m.points > 0 && m.is_correct !== true;
                  const ok = m?.is_correct === true;
                  const bad = m?.is_correct === false && !partial;
                  return (
                    <li
                      key={i}
                      className={clsx(
                        "flex items-center gap-[min(0.8vw,1.3vh)] rounded-[min(0.7vw,1.2vh)] px-[min(0.9vw,1.5vh)] ring-1",
                        dense ? "py-[min(0.25vw,0.45vh)]" : "py-[min(0.5vw,0.85vh)]",
                        ok
                          ? "bg-emerald-500/15 ring-emerald-400/40"
                          : partial
                            ? "bg-amber-400/15 ring-amber-300/40"
                            : bad
                              ? "bg-rose-500/12 ring-rose-400/30"
                              : "bg-white/[0.05] ring-white/10",
                      )}
                    >
                      <span className="w-[1.6em] shrink-0 text-center text-[min(1vw,1.7vh)] font-bold text-white/50 max-lg:text-sm">
                        {k + 1}
                      </span>
                      {/* Dolge kategorije (npr. 10 vprašanj): vprašanje in odgovor v eni vrstici. */}
                      <div className={clsx("min-w-0 flex-1", dense && "flex items-baseline gap-[min(0.8vw,1.3vh)]")}>
                        <p
                          className={clsx(
                            "truncate text-white/70 max-lg:text-sm",
                            dense ? "min-w-0 flex-1 text-[min(0.95vw,1.6vh)]" : "text-[min(1.1vw,1.9vh)]",
                          )}
                        >
                          {plainPrompt(q?.prompt).split("\n")[0]}
                        </p>
                        <p
                          className={clsx(
                            "truncate font-semibold max-lg:text-base",
                            dense ? "max-w-[45%] shrink-0 text-[min(1.2vw,2vh)]" : "text-[min(1.3vw,2.2vh)]",
                          )}
                        >
                          {answerText(q)}
                        </p>
                      </div>
                      <span
                        className={clsx(
                          "flex shrink-0 items-center justify-center rounded-full font-black",
                          dense ? "h-[min(1.9vw,3.2vh)] w-[min(1.9vw,3.2vh)]" : "h-[min(2.4vw,4vh)] w-[min(2.4vw,4vh)]",
                          ok ? "bg-emerald-500 text-white" : partial ? "w-auto bg-amber-400 px-2 text-amber-950" : bad ? "bg-rose-500 text-white" : "bg-white/10 text-white/40",
                        )}
                      >
                        {ok ? (
                          <IconCheck className="h-[60%] w-[60%]" />
                        ) : partial ? (
                          <span className="text-[min(1vw,1.7vh)]">{fmt(m!.points)}</span>
                        ) : bad ? (
                          <IconX className="h-[60%] w-[60%]" />
                        ) : (
                          "–"
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>

      {last && (
        <div className="flex justify-center pb-2">
          <Link
            href="/"
            className="rounded-2xl bg-gradient-to-r from-cyan-500 to-violet-600 px-7 py-4 text-xl font-semibold shadow-xl shadow-violet-900/40 transition-transform hover:scale-[1.03]"
          >
            Zaključi kviz
          </Link>
        </div>
      )}
    </div>
  );
}

// Spletni radio (house) za konec večera: plavajoč gumb spodaj levo.
// Ibiza Global Radio, rezerva laut.fm deephouse (SomaFM v Chromu ne predvaja).
const RADIO = [
  { url: "https://listenssl.ibizaglobalradio.com:8024/ibizaglobalradio.mp3", name: "Ibiza Global Radio" },
  { url: "https://stream.laut.fm/deephouse", name: "laut.fm Deep House" },
];

function RadioButton() {
  const ref = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState<"off" | "loading" | "on" | "error">("off");
  const [src, setSrc] = useState(0);
  const start = async (i: number) => {
    const a = ref.current;
    if (!a) return;
    if (i >= RADIO.length) return setState("error");
    setSrc(i);
    a.src = RADIO[i].url;
    setState("loading");
    try {
      await a.play();
      setState("on");
    } catch {
      void start(i + 1); // naslednja postaja
    }
  };
  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (state === "on" || state === "loading") {
      a.pause();
      a.removeAttribute("src"); // prekini tok, ob ponovnem predvajanju v živo
      a.load();
      setState("off");
      return;
    }
    void start(0);
  };
  return (
    <div className="fixed bottom-6 left-6 z-20 flex items-center gap-3">
      <audio ref={ref} preload="none" />
      <button
        onClick={() => void toggle()}
        aria-label={state === "on" ? "Ustavi radio" : "Predvajaj radio"}
        className={clsx(
          "flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition-transform hover:scale-105",
          state === "on" ? "bg-violet-600" : "bg-white/10 ring-1 ring-white/20 hover:bg-white/20",
        )}
      >
        {state === "on" || state === "loading" ? (
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="ml-0.5 h-6 w-6" fill="currentColor" aria-hidden>
            <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
          </svg>
        )}
      </button>
      <div className="text-sm leading-tight">
        <div className="font-semibold">House radio</div>
        <div className="text-white/50">
          {state === "on" ? `v živo · ${RADIO[src].name}` : state === "loading" ? "nalagam …" : state === "error" ? "ni povezave" : "Ibiza Global Radio"}
        </div>
      </div>
    </div>
  );
}

// Bobni (Web Audio, brez datoteke): udarci snare od `start` s, vse gostejši
// in glasnejši, ob `end` činela + bas. Klik Naprej je uporabnikova gesta,
// zato brskalnik zvok dovoli.
function playDrumroll(start: number, end: number) {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const ch = noise.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;

    const hit = (t: number, gain: number, decay: number, type: BiquadFilterType, freq: number) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + decay);
      src.connect(f).connect(g).connect(ctx.destination);
      src.start(t);
      src.stop(t + decay + 0.05);
    };

    // Bobnanje se stopnjuje: počasi začne (razmik 280 ms) in eksponentno
    // pospešuje do pravega vrtinca (40 ms) tik pred činelo; glasnost 0,1 → 0,55.
    let t = start;
    while (t < end) {
      const p = (t - start) / (end - start);
      hit(now + t, 0.1 + 0.45 * p * p, 0.1 - 0.04 * p, "bandpass", 1600 + 600 * p);
      t += 0.28 * Math.pow(0.04 / 0.28, p);
    }
    // Činela + bas ob razkritju imena.
    hit(now + end, 0.6, 1.8, "highpass", 5000);
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.frequency.setValueAtTime(90, now + end);
    osc.frequency.exponentialRampToValueAtTime(40, now + end + 0.4);
    og.gain.setValueAtTime(0.7, now + end);
    og.gain.exponentialRampToValueAtTime(0.001, now + end + 0.5);
    osc.connect(og).connect(ctx.destination);
    osc.start(now + end);
    osc.stop(now + end + 0.6);
    window.setTimeout(() => void ctx.close(), (end + 2.5) * 1000);
  } catch {}
}

// Lestvica telefonskega kviza; ekipe z enakimi točkami si delijo mesto.
function ScoreStage({ data }: { data: Data }) {
  const { room, scores } = data;
  const finished = room.state === "finished";
  const max = Math.max(1, ...scores.map((s) => s.score));
  const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-6">
      <div className="text-center">
        <div className="text-[1.4vw] uppercase tracking-widest text-cyan-300 max-lg:text-sm">
          {finished ? room.title : `Konec kategorije: ${room.current?.category ?? ""}`}
        </div>
        <h1 className="text-[4vw] font-black max-lg:text-4xl">{finished ? "Končni rezultati" : "Lestvica"}</h1>
      </div>
      <ol className="space-y-2.5">
        {scores.map((s) => {
          const i = scores.findIndex((x) => x.score === s.score);
          return (
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
                <span className="font-mono">{fmt(s.score)}</span>
              </div>
            </div>
          </li>
          );
        })}
      </ol>
      {scores.length === 0 && <p className="text-center text-white/50">Ni ekip.</p>}
    </div>
  );
}
