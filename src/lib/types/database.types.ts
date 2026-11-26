// Ročno napisani tipi za tabele Kviza v Supabase (predpona `kviz_`).
// Ustrezajo supabase/migrations/. Ob vsaki novi migraciji, ki doda
// stolpec/tabelo/funkcijo, jih je treba ročno posodobiti.

type Table<Row, Required extends keyof Row> = {
  Relationships: [];
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
};

export type QuestionType = "choice" | "text";
export type RoomState = "lobby" | "intro" | "question" | "reveal" | "scoreboard" | "finished";
/** 0007: telefonski (odgovori na telefonu) ali klasični (listki, samo vprašanja). */
export type QuizMode = "phone" | "classic";

export type KvizQuiz = {
  id: string;
  owner_id: string;
  title: string;
  mode: QuizMode;
  created_at: string;
  updated_at: string;
};

export type KvizCategory = {
  id: string;
  quiz_id: string;
  name: string;
  position: number;
  /** Beležka na telefonu igralca (samo v brskalniku, ne šteje kot odgovor). */
  notes: boolean;
  /** 0009: slika za uvodni zaslon kategorije (pot v bucketu `kviz`). */
  image_path: string | null;
  /** 0010: primer „Kako se igra?“ po uvodu kategorije. */
  example: CategoryExample | null;
  /** 0012: po zadnjem vprašanju pokaži vsa vprašanja kategorije naenkrat. */
  summary: boolean;
  created_at: string;
};

/**
 * Primer „Kako se igra?“. Oblike:
 * - `choice`: eno vzorčno vprašanje A–D, ob rešitvi se označi pravilni odgovor;
 * - `items` + `answer`: kartice z odgovori, ki jih poveže skupna rešitev (Nadpomenka);
 * - `items` brez `answer`: odgovori na karticah se pokažejo šele ob rešitvi.
 */
export type CategoryExample = {
  rules?: string;
  items?: { q?: string; a: string }[];
  answer?: string;
  /** Napis nad rešitvijo (privzeto ime kategorije). */
  label?: string;
  /** Poudari prvo črko odgovorov (Skrita beseda, Abecedni odgovori). */
  firstLetter?: boolean;
  choice?: { q: string; options: string[]; correct: number };
};

export type KvizQuestion = {
  id: string;
  quiz_id: string;
  category_id: string;
  position: number;
  type: QuestionType;
  prompt: string;
  image_path: string | null; // pot v bucketu `kviz` (<uid>/<uuid>.<ext>)
  /** 0013: zvočni posnetek (npr. miks skladb), pot v bucketu `kviz`. */
  audio_path: string | null;
  options: string[]; // 2–4 pri `choice`
  correct_index: number | null; // samo `choice`
  accepted_answers: string[]; // samo `text`, vsaj eden
  /** 0014: pojasnilo, oder ga pokaže samo v pregledu odgovorov. */
  explanation: string | null;
  points: number;
  /** 0015: oznake delov za delne točke (npr. miks: 4 deli po ½); prazno = celo vprašanje. */
  parts: string[];
  created_at: string;
};

/** Očiščen posnetek trenutnega vprašanja (kviz_rooms.current). */
export type RoomCurrent = {
  question_id: string;
  index: number; // 0-based v celem kvizu
  total: number;
  category: string;
  category_id?: string; // od 0006
  notes?: boolean; // od 0006: beležka na telefonu
  category_index: number; // 1-based
  category_total: number;
  category_question: number; // 1-based znotraj kategorije
  category_questions: number;
  type: QuestionType;
  prompt: string;
  image_path: string | null;
  audio_path?: string | null; // od 0013
  options: string[];
  points: number;
  last_in_category: boolean;
  /** 0009: posnetek uvoda kategorije (stanje `intro`) — brez vprašanja. */
  intro?: boolean;
  category_image?: string | null;
};

export type RoomReveal = {
  correct_index?: number;
  counts?: number[];
  accepted_answers?: string[];
};

export type KvizRoom = {
  id: string;
  quiz_id: string;
  host_id: string;
  code: string;
  title: string;
  state: RoomState;
  mode: QuizMode;
  question_ids: string[];
  q_index: number;
  current: RoomCurrent | null;
  reveal: RoomReveal | null;
  created_at: string;
  finished_at: string | null;
};

/** 0015: izžrebane ekipe voditelja (za vse kvize, dokler jih ne izbriše). */
export type KvizSavedTeam = {
  id: string;
  owner_id: string;
  position: number;
  name: string;
  members: string[];
  created_at: string;
};

export type KvizTeam = {
  id: string;
  room_id: string;
  name: string;
  members: string[]; // dopisana imena brez telefona (0003_team_members)
  tiebreak: number | null; // 0016: mesto znotraj izenačene skupine (1 = zmagal izenačenje)
  created_at: string;
};

/** 0016: dodatna vprašanja za izenačenje („kdor je bližji, zmaga“), ločeno od kategorij. */
export type KvizTiebreaker = {
  id: string;
  quiz_id: string;
  position: number;
  prompt: string;
  answer: string;
  explanation: string | null;
  created_at: string;
};

/** Brez stolpca `token` — ta ni berljiv niti voditelju. */
export type KvizPlayer = {
  id: string;
  room_id: string;
  team_id: string | null;
  nickname: string;
  joined_at: string;
};

export type KvizAnswer = {
  id: string;
  room_id: string;
  question_id: string;
  team_id: string;
  player_id: string | null;
  nickname: string | null;
  choice_index: number | null;
  text_answer: string | null;
  is_correct: boolean | null;
  points: number; // numeric od 0015 (delne točke, npr. 1,5)
  parts: (boolean | null)[] | null; // 0015: ocena po delih
  updated_at: string;
};

export type ScoreRow = { team_id: string; name: string; score: number; players: number };

/** Vrne kviz_player_state(token). */
export type PlayerState = {
  room: {
    id: string;
    code: string;
    title: string;
    state: RoomState;
    current: RoomCurrent | null;
    reveal: RoomReveal | null;
  };
  me: { id: string; nickname: string; team_id: string | null };
  teams: { id: string; name: string; players: string[]; members: string[] }[];
  answer: {
    choice_index: number | null;
    text_answer: string | null;
    nickname: string | null;
    is_correct: boolean | null;
    points: number | null;
  } | null;
  scoreboard: { team_id: string; name: string; score: number }[];
};

type Fn<Args, Returns> = { Args: Args; Returns: Returns };

export type Database = {
  public: {
    Tables: {
      kviz_quizzes: Table<KvizQuiz, never>;
      kviz_categories: Table<KvizCategory, "quiz_id" | "name">;
      kviz_questions: Table<KvizQuestion, "quiz_id" | "category_id" | "prompt">;
      kviz_rooms: Table<KvizRoom, never>;
      kviz_teams: Table<KvizTeam, never>;
      kviz_players: Table<KvizPlayer, never>;
      kviz_answers: Table<KvizAnswer, never>;
      kviz_saved_teams: Table<KvizSavedTeam, "name">;
      kviz_tiebreakers: Table<KvizTiebreaker, "quiz_id" | "prompt" | "answer">;
    };
    Views: Record<string, never>;
    Functions: {
      kviz_open_room: Fn<{ p_quiz: string }, string>;
      kviz_next: Fn<{ p_room: string }, RoomState>;
      kviz_goto: Fn<{ p_room: string; p_index: number; p_intro?: boolean }, RoomState>; // 0008, p_intro od 0011
      kviz_finish: Fn<{ p_room: string }, undefined>;
      kviz_set_correct: Fn<{ p_answer: string; p_correct: boolean }, undefined>;
      kviz_kick: Fn<{ p_player: string }, undefined>;
      kviz_scoreboard: Fn<{ p_room: string }, ScoreRow[]>;
      kviz_join: Fn<{ p_code: string; p_nickname: string; p_token?: string | null }, { token: string; room_id: string }>;
      kviz_player_state: Fn<{ p_token: string }, PlayerState>;
      kviz_create_team: Fn<{ p_token: string; p_name: string }, string>;
      kviz_join_team: Fn<{ p_token: string; p_team: string }, undefined>;
      kviz_answer: Fn<{ p_token: string; p_choice?: number | null; p_text?: string | null }, undefined>;
      kviz_rename_team: Fn<{ p_token: string; p_name: string }, undefined>;
      kviz_add_member: Fn<{ p_token: string; p_name: string }, undefined>;
      kviz_remove_member: Fn<{ p_token: string; p_name: string }, undefined>;
      kviz_host_remove_member: Fn<{ p_team: string; p_name: string }, undefined>;
      // 0015: točkovanje klasičnega kviza (voditelj)
      kviz_host_add_team: Fn<{ p_room: string; p_name: string }, string>;
      kviz_host_rename_team: Fn<{ p_team: string; p_name: string }, undefined>;
      kviz_host_delete_team: Fn<{ p_team: string }, undefined>;
      kviz_host_mark: Fn<{ p_team: string; p_question: string; p_correct: boolean | null; p_parts?: (boolean | null)[] | null }, undefined>;
      kviz_save_teams: Fn<{ p_teams: { name: string; members: string[] }[] }, undefined>;
      kviz_host_import_teams: Fn<{ p_room: string }, number>;
      // 0016: izenačenje
      kviz_host_tiebreak_win: Fn<{ p_team: string }, undefined>;
      kviz_host_tiebreak_reset: Fn<{ p_room: string }, undefined>;
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
