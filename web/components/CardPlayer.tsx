"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ReviewResult, StudyCard, StudyPack } from "../lib/client/api";
import { autoGrade, CARD_TYPE_LABEL, GRADE_COPY } from "../lib/client/grade";

type Props = {
  pack: StudyPack;
  startIndex?: number;
  onProgress: (completed: number, total: number) => void;
  onFinished: (results: Record<ReviewResult, number>) => void;
};

function PromptBody({ card, live }: { card: StudyCard; live: boolean }) {
  const parts = card.prompt.split(/_{3,}|…{3,}|_____+/);
  if (card.card_type === "fill_in_blank" && parts.length > 1) {
    return (
      <p className="font-serif text-[2rem] font-semibold leading-[1.25] tracking-tight md:text-[2.35rem]">
        {parts.map((part, index) => (
          <span key={`${part}-${index}`}>
            {part}
            {index < parts.length - 1 && (
              <span
                className={`mx-1 inline-block min-w-[6rem] border-b-[3px] align-baseline ${
                  live ? "blank-pulse border-leaf" : "border-moss"
                }`}
              />
            )}
          </span>
        ))}
      </p>
    );
  }
  return (
    <p className="font-serif text-[2rem] font-semibold leading-[1.25] tracking-tight md:text-[2.35rem]">
      {card.prompt.replace(/^(Complete:|Fix:|Rewrite[^:]*:)\s*/i, "")}
    </p>
  );
}

const GRADE_KEYS: Record<string, ReviewResult> = { "1": "knew_it", "2": "shaky", "3": "missed" };

const TASK: Record<string, string> = {
  fill_in_blank: "Complete the sentence",
  fix_error: "Make this natural",
  transform_sentence: "Rewrite it cleanly",
};

export default function CardPlayer({ pack, startIndex = 0, onProgress, onFinished }: Props) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, startIndex), Math.max(pack.cards.length - 1, 0)),
  );
  const [guess, setGuess] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [grade, setGrade] = useState<ReviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const posted = useRef<Set<number>>(new Set());
  const tallies = useRef<Record<ReviewResult, number>>({ knew_it: 0, shaky: 0, missed: 0 });
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const card = pack.cards[index];
  const total = pack.cards.length;
  const longPrompt = card?.card_type === "transform_sentence" || card?.card_type === "fix_error";
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  useEffect(() => {
    onProgressRef.current(index, total);
  }, [index, total]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [index]);

  const postAndAdvance = useCallback(
    async (result: ReviewResult) => {
      if (!card || busy) return;
      setBusy(true);
      setError(null);
      try {
        if (!posted.current.has(card.id)) {
          await api.submitReview(card.id, result);
          posted.current.add(card.id);
          tallies.current[result] += 1;
        }
        const next = index + 1;
        if (next >= total) {
          onProgress(total, total);
          onFinished({ ...tallies.current });
          return;
        }
        setIndex(next);
        setGuess("");
        setRevealed(false);
        setGrade(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save review");
      } finally {
        setBusy(false);
      }
    },
    [busy, card, index, onFinished, onProgress, total],
  );

  const check = useCallback(
    (forced?: ReviewResult) => {
      if (!card || revealed) return;
      const result = forced ?? autoGrade(guess, card.answer);
      setGrade(result);
      setRevealed(true);
    },
    [card, guess, revealed],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.dataset.ignoreKeys === "true")) {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          if (!revealed) check();
          else if (grade) void postAndAdvance(grade);
        }
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (!revealed) check();
        else if (grade) void postAndAdvance(grade);
        return;
      }
      if (revealed && GRADE_KEYS[event.key]) {
        event.preventDefault();
        const nextGrade = GRADE_KEYS[event.key];
        setGrade(nextGrade);
        void postAndAdvance(nextGrade);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [check, grade, postAndAdvance, revealed]);

  if (!card) return null;

  const tone =
    grade === "knew_it"
      ? "teach-ok"
      : grade === "shaky"
        ? "teach-close"
        : "teach-miss";
  const placeholder =
    card.card_type === "fix_error"
      ? "Type the natural sentence"
      : card.card_type === "transform_sentence"
        ? "Rewrite in natural English"
        : "Type the missing words";

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-6 flex items-center gap-1.5" aria-hidden>
        {pack.cards.map((item, step) => (
          <span
            key={item.id}
            className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
              step < index ? "bg-moss" : step === index ? "bg-leaf" : "bg-ink/10"
            }`}
          />
        ))}
      </div>

      <section
        key={card.id}
        className={`card-in relative overflow-hidden rounded-[2rem] bg-white p-7 shadow-[0_24px_60px_rgba(18,32,28,0.10)] md:p-11 ${
          revealed && grade === "knew_it" ? "ring-2 ring-leaf/70" : ""
        }`}
      >
        <div className="mb-8 flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-moss">
            {TASK[card.card_type] ?? CARD_TYPE_LABEL[card.card_type] ?? "Sentence"}
          </p>
          <p className="rounded-full bg-sand px-3 py-1 text-xs font-semibold text-ink/55">
            {index + 1} of {total}
          </p>
        </div>

        <PromptBody card={card} live={!revealed} />

        {longPrompt ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            className="mt-9 min-h-[7rem] w-full rounded-2xl border border-ink/10 bg-sand px-4 py-4 text-lg outline-none transition focus:border-leaf focus:bg-white focus:shadow-[0_0_0_4px_rgba(88,204,2,0.18)]"
            value={guess}
            onChange={(event) => setGuess(event.target.value)}
            placeholder={placeholder}
            disabled={revealed}
            autoComplete="off"
            spellCheck={false}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            className="mt-9 w-full rounded-2xl border border-ink/10 bg-sand px-4 py-4 text-lg outline-none transition focus:border-leaf focus:bg-white focus:shadow-[0_0_0_4px_rgba(88,204,2,0.18)]"
            value={guess}
            onChange={(event) => setGuess(event.target.value)}
            placeholder={placeholder}
            disabled={revealed}
            autoComplete="off"
            spellCheck={false}
          />
        )}

        {revealed && grade && (
          <div className={`teach-in mt-6 rounded-2xl p-5 ${tone}`}>
            <p className="text-sm font-bold tracking-wide">{GRADE_COPY[grade].label}</p>
            <p className="mt-2 font-serif text-2xl font-semibold leading-snug">{card.answer}</p>
            <p className="mt-3 text-[1rem] leading-relaxed text-ink/80">{card.why}</p>
            <p className="say-it mt-4 text-sm font-semibold text-ink">
              Say it once: <span className="font-serif font-semibold">{card.answer}</span>
            </p>
            <p className="mt-1 text-xs text-ink/45">{GRADE_COPY[grade].hint}</p>
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-rose-700">
            {error}{" "}
            <button className="underline" onClick={() => grade && void postAndAdvance(grade)} disabled={busy || !grade}>
              Retry save
            </button>
          </p>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-2">
          {!revealed ? (
            <>
              <button
                className="rounded-2xl bg-leaf px-8 py-3.5 text-sm font-bold text-[#123016] shadow-[0_8px_20px_rgba(88,204,2,0.35)] transition hover:brightness-95 disabled:opacity-50"
                onClick={() => check()}
                disabled={busy}
              >
                Check
              </button>
              <button
                className="rounded-2xl bg-sand px-5 py-3.5 text-sm font-semibold"
                onClick={() => check("missed")}
                disabled={busy}
              >
                Show me
              </button>
              <span className="ml-1 text-xs text-ink/40">Enter</span>
            </>
          ) : (
            <>
              <button
                className={`rounded-2xl px-4 py-3.5 text-sm font-semibold transition ${
                  grade === "knew_it" ? "bg-moss text-white shadow-md" : "bg-sand hover:bg-moss/15"
                }`}
                onClick={() => void postAndAdvance("knew_it")}
                disabled={busy}
              >
                Knew it
              </button>
              <button
                className={`rounded-2xl px-4 py-3.5 text-sm font-semibold transition ${
                  grade === "shaky" ? "bg-amber-500 text-white shadow-md" : "bg-sand hover:bg-amber-50"
                }`}
                onClick={() => void postAndAdvance("shaky")}
                disabled={busy}
              >
                Almost
              </button>
              <button
                className={`rounded-2xl px-4 py-3.5 text-sm font-semibold transition ${
                  grade === "missed" ? "bg-rose-600 text-white shadow-md" : "bg-sand hover:bg-rose-50"
                }`}
                onClick={() => void postAndAdvance("missed")}
                disabled={busy}
              >
                Not yet
              </button>
              <button
                className="ml-auto rounded-2xl bg-ink px-6 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
                onClick={() => grade && void postAndAdvance(grade)}
                disabled={busy || !grade}
              >
                Continue
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
