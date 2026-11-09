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
export type RoomState = "lobby" | "question" | "reveal" | "scoreboard" | "finished";

export type KvizQuiz = {
  id: string;
  owner_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type KvizCategory = {
  id: string;
  quiz_id: string;
  name: string;
  position: number;
  created_at: string;
};

export type KvizQuestion = {
  id: string;
  quiz_id: string;
  category_id: string;
  position: number;
  type: QuestionType;
  prompt: string;
  image_path: string | null; // pot v bucketu `kviz` (<uid>/<uuid>.<ext>)
  options: string[]; // 2–4 pri `choice`
  correct_index: number | null; // samo `choice`
  accepted_answers: string[]; // samo `text`, vsaj eden
  points: number;
  created_at: string;
};

/** Očiščen posnetek trenutnega vprašanja (kviz_rooms.current). */
export type RoomCurrent = {
  question_id: string;
  index: number; // 0-based v celem kvizu
  total: number;
  category: string;
  category_index: number; // 1-based
  category_total: number;
  category_question: number; // 1-based znotraj kategorije
  category_questions: number;
  type: QuestionType;
  prompt: string;
  image_path: string | null;
  options: string[];
  points: number;
  last_in_category: boolean;
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
  question_ids: string[];
  q_index: number;
  current: RoomCurrent | null;
  reveal: RoomReveal | null;
  created_at: string;
  finished_at: string | null;
};

export type KvizTeam = {
  id: string;
  room_id: string;
  name: string;
  members: string[]; // dopisana imena brez telefona (0003_team_members)
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
  points: number;
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
    };
    Views: Record<string, never>;
    Functions: {
      kviz_open_room: Fn<{ p_quiz: string }, string>;
      kviz_next: Fn<{ p_room: string }, RoomState>;
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
