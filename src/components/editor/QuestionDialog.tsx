"use client";

import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LETTERS, OPTION_COLORS, errorText, imageUrl } from "@/lib/kviz";
import type { KvizQuestion, QuestionType } from "@/lib/types/database.types";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { Field, Input, Label, Textarea } from "@/components/ui/Input";
import { IconImage, IconTrash } from "@/components/ui/icons";
import clsx from "@/lib/utils/clsx";

const MAX_IMAGE = 5 * 1024 * 1024; // = file_size_limit bucketa `kviz`

export default function QuestionDialog({
  ownerId,
  quizId,
  categoryId,
  question,
  nextPosition,
  onClose,
  onSaved,
}: {
  ownerId: string;
  quizId: string;
  categoryId: string;
  question: KvizQuestion | null;
  nextPosition: number;
  onClose: () => void;
  onSaved: (row: KvizQuestion) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<QuestionType>(question?.type ?? "choice");
  const [prompt, setPrompt] = useState(question?.prompt ?? "");
  const [options, setOptions] = useState<string[]>(() => {
    const o = [...(question?.options ?? [])];
    while (o.length < 4) o.push("");
    return o;
  });
  const [correct, setCorrect] = useState(question?.correct_index ?? 0);
  const [accepted, setAccepted] = useState((question?.accepted_answers ?? []).join("\n"));
  const [points, setPoints] = useState(question?.points ?? 1);
  const [imagePath, setImagePath] = useState<string | null>(question?.image_path ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    if (file.size > MAX_IMAGE) return setError("Slika je večja od 5 MB.");
    setUploading(true);
    setError(null);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${ownerId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("kviz").upload(path, file, { contentType: file.type });
    setUploading(false);
    if (error) return setError(errorText(error));
    // Prejšnjo neshranjeno sliko (naloženo v tem oknu) pobriši.
    if (imagePath && imagePath !== question?.image_path) void supabase.storage.from("kviz").remove([imagePath]);
    setImagePath(path);
  };

  const save = async () => {
    setError(null);
    const p = prompt.trim();
    if (!p) return setError("Vpiši vprašanje.");

    let opts: string[] = [];
    let correctIndex: number | null = null;
    let acc: string[] = [];
    if (type === "choice") {
      // Prazne možnosti izpusti, pravilni indeks preračunaj.
      const filled = options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
      if (filled.length < 2) return setError("Vpiši vsaj dve možnosti.");
      const ci = filled.findIndex((x) => x.i === correct);
      if (ci === -1) return setError("Pravilna možnost je prazna.");
      opts = filled.map((x) => x.o);
      correctIndex = ci;
    } else {
      acc = accepted.split("\n").map((s) => s.trim()).filter(Boolean);
      if (!acc.length) return setError("Vpiši vsaj en sprejet odgovor.");
    }

    const row = {
      type,
      prompt: p,
      options: opts,
      correct_index: correctIndex,
      accepted_answers: acc,
      points,
      image_path: imagePath,
    };

    setSaving(true);
    const res = question
      ? await supabase.from("kviz_questions").update(row).eq("id", question.id).select("*").single()
      : await supabase
          .from("kviz_questions")
          .insert({ ...row, quiz_id: quizId, category_id: categoryId, position: nextPosition })
          .select("*")
          .single();
    setSaving(false);
    if (res.error || !res.data) return setError(errorText(res.error));
    if (question?.image_path && question.image_path !== imagePath) {
      void supabase.storage.from("kviz").remove([question.image_path]);
    }
    onSaved(res.data);
  };

  const close = () => {
    if (imagePath && imagePath !== question?.image_path) void supabase.storage.from("kviz").remove([imagePath]);
    onClose();
  };

  const img = imageUrl(imagePath);

  return (
    <Modal open onClose={close} title={question ? "Uredi vprašanje" : "Novo vprašanje"}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
          {(["choice", "text"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={clsx(
                "rounded-md py-1.5 text-sm font-medium",
                type === t ? "bg-white shadow-sm dark:bg-gray-700" : "text-gray-500 dark:text-gray-400"
              )}
            >
              {t === "choice" ? "Izbira A–D" : "Vpis odgovora"}
            </button>
          ))}
        </div>

        <Field label="Vprašanje" htmlFor="q-prompt">
          <Textarea id="q-prompt" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value.slice(0, 500))} autoFocus />
        </Field>

        <div>
          <Label>Slika (neobvezno, prikaže se na projektorju)</Label>
          {img ? (
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img} alt="" className="max-h-32 rounded-md object-contain" />
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  if (imagePath && imagePath !== question?.image_path) void supabase.storage.from("kviz").remove([imagePath]);
                  setImagePath(null);
                }}
              >
                <IconTrash /> Odstrani
              </Button>
            </div>
          ) : (
            <Button type="button" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <IconImage /> {uploading ? "Nalagam …" : "Dodaj sliko"}
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
        </div>

        {type === "choice" ? (
          <div className="space-y-2">
            <Label>Možnosti — klikni črko pravilne</Label>
            {options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCorrect(i)}
                  title="Pravilen odgovor"
                  style={correct === i ? { backgroundColor: OPTION_COLORS[i] } : { borderColor: OPTION_COLORS[i], color: OPTION_COLORS[i] }}
                  className={clsx(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-bold",
                    correct === i ? "text-white" : "border-2"
                  )}
                >
                  {LETTERS[i]}
                </button>
                <Input
                  value={o}
                  onChange={(e) => setOptions((all) => all.map((x, j) => (j === i ? e.target.value.slice(0, 120) : x)))}
                  placeholder={i < 2 ? `Možnost ${LETTERS[i]}` : `Možnost ${LETTERS[i]} (neobvezno)`}
                  aria-label={`Možnost ${LETTERS[i]}`}
                />
              </div>
            ))}
          </div>
        ) : (
          <Field label="Sprejeti odgovori (vsak v svoji vrstici)" htmlFor="q-acc">
            <Textarea
              id="q-acc"
              rows={3}
              value={accepted}
              onChange={(e) => setAccepted(e.target.value)}
              placeholder={"Ljubljana\nLJ"}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Primerjava ne upošteva velikih črk, šumnikov, presledkov in ločil. Ostalo lahko voditelj ob razkritju ročno označi kot pravilno.
            </p>
          </Field>
        )}

        <div className="flex items-center gap-3">
          <Label className="mb-0">Točke</Label>
          <div className="flex gap-1">
            {[1, 2, 3, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPoints(n)}
                className={clsx(
                  "h-8 w-8 rounded-md text-sm font-semibold",
                  points === n ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={close}>
            Prekliči
          </Button>
          <Button type="button" onClick={save} disabled={saving || uploading}>
            {saving ? "Shranjujem …" : "Shrani"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
