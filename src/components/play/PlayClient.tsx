"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRoomPing } from "@/lib/useRoomPing";
import { LETTERS, OPTION_COLORS, errorText, playerStore } from "@/lib/kviz";
import type { PlayerState } from "@/lib/types/database.types";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { IconCheck, IconUsers, IconX } from "@/components/ui/icons";
import clsx from "@/lib/utils/clsx";

// Telefon igralca. Vse gre prek RPC funkcij z žetonom (glej
// supabase/migrations/0002_player_tokens.sql); stanje se ob signalu iz baze
// ponovno prebere v celoti (kviz_player_state).
export default function PlayClient({ code }: { code: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [token, setToken] = useState<string | null>(() => playerStore.getToken(code));
  const [state, setState] = useState<PlayerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickingTeam, setPickingTeam] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const { data, error } = await supabase.rpc("kviz_player_state", { p_token: token });
    if (error) {
      if (error.message.includes("Nisi več")) {
        playerStore.setToken(code, null);
        setToken(null);
        setState(null);
      }
      return;
    }
    setState(data);
  }, [supabase, token, code]);

  useEffect(() => {
    // Prvo branje; nadaljnja ob signalih (useRoomPing).
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  useRoomPing(state?.room.id ?? null, load);

  const call = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setError(null);
    const { error } = await fn();
    if (error) setError(errorText(error));
    await load();
    return !error;
  };

  if (!token || (!state && error)) {
    return (
      <Shell>
        <NicknameForm
          code={code}
          onJoined={(t) => {
            playerStore.setToken(code, t);
            setToken(t);
          }}
        />
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell>
        <div className="flex justify-center py-20">
          <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-gray-300 border-t-violet-600 dark:border-gray-700 dark:border-t-violet-400" />
        </div>
      </Shell>
    );
  }

  const myTeam = state.teams.find((t) => t.id === state.me.team_id) ?? null;
  const room = state.room;
  const showPicker = !myTeam || (pickingTeam && room.state !== "finished");

  return (
    <Shell
      header={
        <div className="flex items-center justify-between gap-2 text-sm">
          <div className="min-w-0">
            <div className="truncate font-semibold">{room.title}</div>
            <div className="truncate text-gray-500 dark:text-gray-400">
              {state.me.nickname}
              {myTeam && <> · {myTeam.name}</>}
            </div>
          </div>
          <span className="rounded-md bg-gray-100 px-2 py-1 font-mono text-xs font-bold tracking-widest dark:bg-gray-800">
            {room.code}
          </span>
        </div>
      }
    >
      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {showPicker ? (
        <TeamPicker
          state={state}
          onJoin={async (teamId) => {
            if (await call(() => supabase.rpc("kviz_join_team", { p_token: token, p_team: teamId })))
              setPickingTeam(false);
          }}
          onCreate={async (name) => {
            const ok = await call(() => supabase.rpc("kviz_create_team", { p_token: token, p_name: name }));
            if (ok) setPickingTeam(false);
            return ok;
          }}
          onCancel={myTeam ? () => setPickingTeam(false) : undefined}
        />
      ) : room.state === "lobby" ? (
        <Lobby
          state={state}
          onChangeTeam={() => setPickingTeam(true)}
          onRename={(n) => call(() => supabase.rpc("kviz_rename_team", { p_token: token, p_name: n }))}
          onAddMember={(n) => call(() => supabase.rpc("kviz_add_member", { p_token: token, p_name: n }))}
          onRemoveMember={(n) => call(() => supabase.rpc("kviz_remove_member", { p_token: token, p_name: n }))}
        />
      ) : room.state === "question" && room.current ? (
        <QuestionView
          key={room.current.question_id}
          state={state}
          onChoice={(i) => call(() => supabase.rpc("kviz_answer", { p_token: token, p_choice: i }))}
          onText={(t) => call(() => supabase.rpc("kviz_answer", { p_token: token, p_text: t }))}
        />
      ) : room.state === "reveal" && room.current ? (
        <RevealView state={state} />
      ) : (
        <ScoresView state={state} />
      )}
    </Shell>
  );
}

function Shell({ header, children }: { header?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-8 pt-4">
      {header && <div className="mb-5 border-b border-gray-200 pb-3 dark:border-gray-800">{header}</div>}
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}

function NicknameForm({ code, onJoined }: { code: string; onJoined: (token: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [nick, setNick] = useState(() => playerStore.getNick());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="my-auto space-y-4 py-10"
      onSubmit={async (e) => {
        e.preventDefault();
        const n = nick.trim();
        if (!n) return;
        setBusy(true);
        setError(null);
        const { data, error } = await supabase.rpc("kviz_join", { p_code: code, p_nickname: n });
        setBusy(false);
        if (error || !data) {
          setError(errorText(error));
          return;
        }
        playerStore.setNick(n);
        onJoined(data.token);
      }}
    >
      <div className="text-center">
        <div className="text-sm text-gray-500 dark:text-gray-400">Soba</div>
        <div className="font-mono text-4xl font-bold tracking-[0.3em]">{code}</div>
      </div>
      <Input
        value={nick}
        onChange={(e) => setNick(e.target.value.slice(0, 30))}
        placeholder="Tvoj vzdevek"
        aria-label="Vzdevek"
        autoFocus
        className="py-3 text-center text-lg"
      />
      {error && <p className="text-center text-sm text-red-600 dark:text-red-400">{error}</p>}
      <Button type="submit" disabled={busy || !nick.trim()} className="w-full py-3 text-base">
        {busy ? "Vstopam …" : "Naprej"}
      </Button>
      <p className="text-center text-sm">
        <Link href="/" className="text-gray-500 hover:underline dark:text-gray-400">
          Druga koda
        </Link>
      </p>
    </form>
  );
}

function TeamPicker({
  state,
  onJoin,
  onCreate,
  onCancel,
}: {
  state: PlayerState;
  onJoin: (teamId: string) => void;
  onCreate: (name: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold">Izberi ekipo</h2>
      {state.teams.length > 0 && (
        <ul className="space-y-2">
          {state.teams.map((t) => {
            const mine = t.id === state.me.team_id;
            return (
              <li key={t.id}>
                <button
                  onClick={() => onJoin(t.id)}
                  disabled={mine}
                  className={clsx(
                    "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                    mine
                      ? "border-violet-500 bg-violet-50 dark:bg-violet-950/50"
                      : "border-gray-200 bg-white hover:border-violet-400 dark:border-gray-800 dark:bg-gray-900"
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{t.name}</div>
                    <div className="truncate text-sm text-gray-500 dark:text-gray-400">
                      {[...t.players, ...(t.members ?? [])].join(", ") || "še prazna"}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-violet-600 dark:text-violet-400">
                    {mine ? "Tvoja" : "Pridruži se"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="space-y-2 rounded-xl border border-dashed border-gray-300 p-4 dark:border-gray-700"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          const ok = await onCreate(name.trim());
          setBusy(false);
          if (ok) setName("");
        }}
      >
        <div className="text-sm font-medium">Nova ekipa</div>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} placeholder="Ime ekipe" aria-label="Ime ekipe" />
          <Button type="submit" disabled={busy || !name.trim()}>
            Ustvari
          </Button>
        </div>
      </form>
      {onCancel && (
        <Button variant="ghost" onClick={onCancel} className="w-full">
          Prekliči
        </Button>
      )}
    </div>
  );
}

function Lobby({
  state,
  onChangeTeam,
  onRename,
  onAddMember,
  onRemoveMember,
}: {
  state: PlayerState;
  onChangeTeam: () => void;
  onRename: (name: string) => Promise<boolean>;
  onAddMember: (name: string) => Promise<boolean>;
  onRemoveMember: (name: string) => Promise<boolean>;
}) {
  const team = state.teams.find((t) => t.id === state.me.team_id);
  const [editing, setEditing] = useState(false);
  const everyone = [...(team?.players ?? []), ...(team?.members ?? [])];

  if (editing && team) {
    return (
      <TeamEditor
        team={team}
        onRename={onRename}
        onAddMember={onAddMember}
        onRemoveMember={onRemoveMember}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="my-auto space-y-6 py-10 text-center">
      <div>
        <div className="text-sm text-gray-500 dark:text-gray-400">Tvoja ekipa</div>
        <div className="break-words text-3xl font-bold">{team?.name}</div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          <IconUsers className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          {everyone.map((n) => (
            <span key={n} className="rounded-full bg-gray-100 px-3 py-1 text-sm dark:bg-gray-800">
              {n}
            </span>
          ))}
        </div>
      </div>
      <p className="animate-pulse text-gray-600 dark:text-gray-300">Čakamo, da voditelj začne …</p>
      <div className="flex flex-col gap-2">
        <Button onClick={() => setEditing(true)} className="w-full py-3 text-base">
          Uredi ekipo
        </Button>
        <Button variant="ghost" onClick={onChangeTeam} className="w-full">
          Zamenjaj ekipo
        </Button>
      </div>
    </div>
  );
}

// Urejanje ekipe v lobiju: ime ekipe in člani brez telefona.
function TeamEditor({
  team,
  onRename,
  onAddMember,
  onRemoveMember,
  onDone,
}: {
  team: PlayerState["teams"][number];
  onRename: (name: string) => Promise<boolean>;
  onAddMember: (name: string) => Promise<boolean>;
  onRemoveMember: (name: string) => Promise<boolean>;
  onDone: () => void;
}) {
  const [teamName, setTeamName] = useState(team.name);
  const [member, setMember] = useState("");
  const [busy, setBusy] = useState(false);
  const members = team.members ?? [];
  const nameChanged = teamName.trim() !== "" && teamName.trim() !== team.name;

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    const ok = await fn();
    setBusy(false);
    return ok;
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Uredi ekipo</h2>

      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (nameChanged) await run(() => onRename(teamName.trim()));
        }}
      >
        <label className="text-sm font-medium" htmlFor="team-name">
          Ime ekipe
        </label>
        <div className="flex gap-2">
          <Input id="team-name" value={teamName} onChange={(e) => setTeamName(e.target.value.slice(0, 40))} />
          <Button type="submit" disabled={busy || !nameChanged}>
            Shrani
          </Button>
        </div>
      </form>

      <div className="space-y-2">
        <div className="text-sm font-medium">Člani</div>
        <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
          {team.players.map((p) => (
            <li key={`p:${p}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0 truncate">{p}</span>
              <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">s telefonom</span>
            </li>
          ))}
          {members.map((m) => (
            <li key={`m:${m}`} className="flex items-center justify-between gap-3 py-1 pl-4 pr-1">
              <span className="min-w-0 truncate">{m}</span>
              <button
                onClick={() => void run(() => onRemoveMember(m))}
                disabled={busy}
                aria-label={`Odstrani ${m}`}
                className="rounded-lg p-2.5 text-gray-500 hover:bg-gray-100 hover:text-red-600 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                <IconX className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const n = member.trim();
            if (!n) return;
            if (await run(() => onAddMember(n))) setMember("");
          }}
        >
          <Input
            value={member}
            onChange={(e) => setMember(e.target.value.slice(0, 30))}
            placeholder="Ime člana brez telefona"
            aria-label="Ime člana"
          />
          <Button type="submit" disabled={busy || !member.trim()}>
            Dodaj
          </Button>
        </form>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Kdor ima telefon, naj se pridruži sam s kodo sobe.
        </p>
      </div>

      <Button variant="secondary" onClick={onDone} className="w-full py-3 text-base">
        Končano
      </Button>
    </div>
  );
}

function CategoryLine({ state }: { state: PlayerState }) {
  const c = state.room.current!;
  return (
    <div className="mb-3 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
      <span className="truncate">{c.category}</span>
      <span className="shrink-0">
        {c.index + 1} / {c.total}
      </span>
    </div>
  );
}

function QuestionView({
  state,
  onChoice,
  onText,
}: {
  state: PlayerState;
  onChoice: (i: number) => Promise<boolean>;
  onText: (t: string) => Promise<boolean>;
}) {
  const c = state.room.current!;
  const ans = state.answer;
  const [pending, setPending] = useState<number | null>(null);
  const [draft, setDraft] = useState(ans?.text_answer ?? "");
  const [busy, setBusy] = useState(false);
  const selected = pending ?? ans?.choice_index ?? null;

  return (
    <div className="flex flex-1 flex-col">
      <CategoryLine state={state} />
      <h2 className="mb-5 text-xl font-bold leading-snug">{c.prompt}</h2>

      {c.type === "choice" ? (
        <div className="grid flex-1 grid-cols-1 content-start gap-3">
          {c.options.map((opt, i) => {
            const isSel = selected === i;
            return (
              <button
                key={i}
                onClick={async () => {
                  setPending(i);
                  await onChoice(i);
                  setPending(null);
                }}
                style={{ backgroundColor: OPTION_COLORS[i] }}
                className={clsx(
                  "flex min-h-16 items-center gap-3 rounded-2xl px-4 py-3 text-left text-lg font-semibold text-white shadow-sm transition-all active:scale-[0.98]",
                  selected !== null && !isSel && "opacity-40",
                  isSel && "ring-4 ring-white/80 ring-offset-2 ring-offset-gray-50 dark:ring-offset-gray-950"
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/25 text-base font-bold">
                  {LETTERS[i]}
                </span>
                <span className="min-w-0 break-words">{opt}</span>
                {isSel && <IconCheck className="ml-auto h-6 w-6 shrink-0" />}
              </button>
            );
          })}
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            setBusy(true);
            await onText(draft.trim());
            setBusy(false);
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 200))}
            placeholder="Odgovor ekipe"
            aria-label="Odgovor"
            className="py-3 text-lg"
          />
          <Button type="submit" disabled={busy || !draft.trim() || draft.trim() === ans?.text_answer} className="w-full py-3 text-base">
            {ans?.text_answer ? "Spremeni odgovor" : "Oddaj"}
          </Button>
        </form>
      )}

      <p className="mt-5 text-center text-sm text-gray-500 dark:text-gray-400">
        {ans
          ? `Odgovor ekipe: ${ans.choice_index !== null ? LETTERS[ans.choice_index] : `„${ans.text_answer}“`} (${ans.nickname}) — lahko ga spremenite, dokler voditelj ne gre naprej. Odgovori bodo razkriti na koncu kategorije.`
          : "Ekipa še ni odgovorila. Odgovori lahko kdorkoli iz ekipe."}
      </p>
    </div>
  );
}

function RevealView({ state }: { state: PlayerState }) {
  const c = state.room.current!;
  const r = state.room.reveal;
  const ans = state.answer;
  const correctText =
    c.type === "choice" && r?.correct_index !== undefined
      ? `${LETTERS[r.correct_index]} — ${c.options[r.correct_index]}`
      : (r?.accepted_answers ?? []).join(" / ");

  return (
    <div className="flex flex-1 flex-col">
      <CategoryLine state={state} />
      <div className="my-auto space-y-6 py-6 text-center">
        {!ans ? (
          <div className="text-2xl font-bold text-gray-500">Niste odgovorili</div>
        ) : ans.is_correct ? (
          <div className="space-y-2">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-white">
              <IconCheck className="h-11 w-11" />
            </div>
            <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">Pravilno!</div>
            <div className="text-lg font-semibold">+{ans.points}</div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-rose-500 text-white">
              <IconX className="h-11 w-11" />
            </div>
            <div className="text-3xl font-bold text-rose-600 dark:text-rose-400">Napačno</div>
          </div>
        )}
        <div className="rounded-xl bg-gray-100 p-4 dark:bg-gray-900">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Pravilen odgovor</div>
          <div className="mt-1 text-lg font-semibold">{correctText}</div>
          {ans && !ans.is_correct && (
            <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Vaš: {ans.choice_index !== null ? `${LETTERS[ans.choice_index]} — ${c.options[ans.choice_index]}` : ans.text_answer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScoresView({ state }: { state: PlayerState }) {
  const finished = state.room.state === "finished";
  const rows = state.scoreboard;
  const myRank = rows.findIndex((r) => r.team_id === state.me.team_id) + 1;
  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-2xl font-bold">{finished ? "Konec kviza!" : "Lestvica"}</h2>
        {myRank > 0 && (
          <p className="mt-1 text-gray-600 dark:text-gray-300">
            Vaša ekipa je na <b>{myRank}.</b> mestu.
          </p>
        )}
      </div>
      <ol className="space-y-2">
        {rows.map((r, i) => (
          <li
            key={r.team_id}
            className={clsx(
              "flex items-center gap-3 rounded-xl border px-4 py-3",
              r.team_id === state.me.team_id
                ? "border-violet-500 bg-violet-50 dark:bg-violet-950/50"
                : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
            )}
          >
            <span className="w-6 text-right font-bold text-gray-400">{i + 1}.</span>
            <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
            <span className="font-mono text-lg font-bold">{r.score}</span>
          </li>
        ))}
      </ol>
      {!finished && <p className="text-center text-sm text-gray-500 dark:text-gray-400">Naslednja kategorija sledi …</p>}
    </div>
  );
}
