import { useCallback, useEffect, useRef, useState } from "react";
import { api, ReviewResult, StudyCard, StudyPack } from "../api";
import { autoGrade, CARD_TYPE_LABEL, GRADE_COPY } from "../lib/grade";

type Props = {
  pack: StudyPack;
  onProgress: (completed: number, total: number) => void;
  onFinished: (results: Record<ReviewResult, number>) => void;
};

function PromptBody({ card }: { card: StudyCard }) {
  const parts = card.prompt.split(/_{3,}|…{3,}|_____+/);
  if (card.card_type === "fill_in_blank" && parts.length > 1) {
    return (
      <p className="text-[1.65rem] font-semibold leading-snug tracking-tight">
        {parts.map((part, index) => (
          <span key={`${part}-${index}`}>
            {part}
            {index < parts.length - 1 && (
              <span className="mx-1 inline-block min-w-[4.5rem] border-b-2 border-moss/70 align-baseline" />
            )}
          </span>
        ))}
      </p>
    );
  }
  return <p className="text-[1.65rem] font-semibold leading-snug tracking-tight">{card.prompt}</p>;
}

const GRADE_KEYS: Record<string, ReviewResult> = { "1": "knew_it", "2": "shaky", "3": "missed" };

export default function CardPlayer({ pack, onProgress, onFinished }: Props) {
  const [index, setIndex] = useState(0);
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

  useEffect(() => {
    onProgress(index, total);
  }, [index, onProgress, total]);

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
    grade === "knew_it" ? "border-moss bg-moss/5" : grade === "shaky" ? "border-amber-500 bg-amber-50" : "border-rose-500 bg-rose-50";
  const placeholder =
    card.card_type === "fix_error"
      ? "Type the corrected sentence"
      : card.card_type === "transform_sentence"
        ? "Rewrite the sentence"
        : "Type your answer";

  return (
    <section className="rounded-3xl bg-white p-6 shadow-[0_12px_40px_rgba(18,32,28,0.06)] md:p-10">
      <div className="mb-6 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">
        <span>{CARD_TYPE_LABEL[card.card_type] ?? card.card_type}</span>
        <span>
          {index + 1} / {total}
        </span>
      </div>
      <PromptBody card={card} />
      <p className="mt-3 text-sm text-ink/45">{card.unit_keys.join(" · ")}</p>

      {longPrompt ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          className="mt-8 min-h-[6.5rem] w-full rounded-2xl border border-ink/10 bg-sand px-4 py-3.5 text-lg outline-none transition focus:border-moss"
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
          className="mt-8 w-full rounded-2xl border border-ink/10 bg-sand px-4 py-3.5 text-lg outline-none transition focus:border-moss"
          value={guess}
          onChange={(event) => setGuess(event.target.value)}
          placeholder={placeholder}
          disabled={revealed}
          autoComplete="off"
          spellCheck={false}
        />
      )}

      {revealed && grade && (
        <div className={`mt-5 rounded-2xl border p-4 ${tone}`}>
          <p className="text-sm font-semibold uppercase tracking-wide">{GRADE_COPY[grade].label}</p>
          <p className="mt-1 text-lg font-medium">{card.answer}</p>
          <p className="mt-3 text-[0.95rem] leading-relaxed text-ink/75">
            <span className="font-semibold text-ink">Why. </span>
            {card.why}
          </p>
          <p className="mt-2 text-xs text-ink/45">{GRADE_COPY[grade].hint}. Press 1 / 2 / 3 to override, Enter to continue.</p>
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

      <div className="mt-6 flex flex-wrap gap-2">
        {!revealed ? (
          <>
            <button
              className="rounded-2xl bg-moss px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-moss/90 disabled:opacity-50"
              onClick={() => check()}
              disabled={busy}
            >
              Check
              <span className="ml-2 text-white/70">Enter</span>
            </button>
            <button
              className="rounded-2xl bg-sand px-5 py-3 text-sm font-semibold"
              onClick={() => check("missed")}
              disabled={busy}
            >
              I don’t know
            </button>
          </>
        ) : (
          <>
            <button
              className={`rounded-2xl px-4 py-3 text-sm font-semibold ${grade === "knew_it" ? "bg-moss text-white" : "bg-sand"}`}
              onClick={() => void postAndAdvance("knew_it")}
              disabled={busy}
            >
              1 Knew it
            </button>
            <button
              className={`rounded-2xl px-4 py-3 text-sm font-semibold ${grade === "shaky" ? "bg-amber-500 text-white" : "bg-sand"}`}
              onClick={() => void postAndAdvance("shaky")}
              disabled={busy}
            >
              2 Shaky
            </button>
            <button
              className={`rounded-2xl px-4 py-3 text-sm font-semibold ${grade === "missed" ? "bg-rose-600 text-white" : "bg-sand"}`}
              onClick={() => void postAndAdvance("missed")}
              disabled={busy}
            >
              3 Missed
            </button>
            <button
              className="rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
              onClick={() => grade && void postAndAdvance(grade)}
              disabled={busy || !grade}
            >
              Continue
              <span className="ml-2 text-white/50">Enter</span>
            </button>
          </>
        )}
      </div>
      <p className="mt-5 text-xs text-ink/40">
        Shortcuts: Enter checks or continues · 1 knew it · 2 shaky · 3 missed
        {longPrompt ? " · ⌘/Ctrl+Enter from the rewrite box" : ""}
      </p>
    </section>
  );
}
