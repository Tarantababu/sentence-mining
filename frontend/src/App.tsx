import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, ReviewResult, StudyCard, StudyPack, UnitRow } from "./api";

type Tab = "practice" | "ingest" | "units";

const SAMPLE = `You said: I attended to the meeting
Correct: I attended the meeting
Why: attend takes no preposition
RECURRING

VOCABULARY OF THE DAY
- school run: daily kids-to-school trip (used well!)

TRACKING LIST
- attend + no preposition

FOCUS FOR NEXT LESSON
- verb-preposition collocations
`;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
}

function Progress({ current, total }: { current: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((current / total) * 100);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-ink/10">
      <div className="h-full bg-leaf transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function CardPlayer({
  pack,
  onFinished,
}: {
  pack: StudyPack;
  onFinished: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [guess, setGuess] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [grade, setGrade] = useState<ReviewResult | null>(null);
  const card: StudyCard | undefined = pack.cards[index];
  const done = index >= pack.cards.length;

  const submit = useCallback(
    async (result: ReviewResult) => {
      if (!card) return;
      await api.submitReview(card.id, result);
      setGrade(result);
      setRevealed(true);
    },
    [card],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !revealed) {
        event.preventDefault();
        const match = card && normalize(guess) === normalize(card.answer);
        void submit(match ? "knew_it" : guess.trim() ? "shaky" : "missed");
      }
      if (!revealed) return;
      if (event.key === "1") void submit("knew_it");
      if (event.key === "2") void submit("shaky");
      if (event.key === "3") void submit("missed");
      if (event.key === "Enter" && revealed) {
        if (index + 1 >= pack.cards.length) onFinished();
        else {
          setIndex((value) => value + 1);
          setGuess("");
          setRevealed(false);
          setGrade(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, guess, index, onFinished, pack.cards.length, revealed, submit]);

  if (done || !card) {
    return (
      <div className="rounded-2xl bg-white p-8 shadow-sm">
        <h2 className="text-2xl font-semibold">Session complete</h2>
        <p className="mt-2 text-ink/70">Streak +1. Review the speaking prompts, then generate a fresh pack anytime.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm md:p-8">
      <div className="mb-4 flex items-center justify-between text-sm text-ink/60">
        <span className="uppercase tracking-wide">{card.card_type.replaceAll("_", " ")}</span>
        <span>
          {index + 1} / {pack.cards.length}
        </span>
      </div>
      <Progress current={index} total={pack.cards.length} />
      <p className="mt-8 text-2xl font-medium leading-snug">{card.prompt}</p>
      <p className="mt-2 text-sm text-ink/50">{card.unit_keys.join(" · ")}</p>
      <input
        className="mt-6 w-full rounded-xl border border-ink/10 bg-sand px-4 py-3 outline-none focus:border-moss"
        value={guess}
        onChange={(event) => setGuess(event.target.value)}
        placeholder="Type your answer"
        disabled={revealed}
        autoFocus
      />
      {revealed && (
        <div className="mt-4 rounded-xl bg-sand p-4">
          <p className="text-sm uppercase text-moss">{grade?.replace("_", " ")}</p>
          <p className="mt-1 font-medium">{card.answer}</p>
          <p className="mt-2 text-ink/70">
            <span className="font-semibold">Why. </span>
            {card.why}
          </p>
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        {!revealed ? (
          <button
            className="rounded-full bg-moss px-5 py-2 text-white"
            onClick={() => {
              const match = normalize(guess) === normalize(card.answer);
              void submit(match ? "knew_it" : guess.trim() ? "shaky" : "missed");
            }}
          >
            Check
          </button>
        ) : (
          <>
            <button className="rounded-full bg-leaf px-4 py-2" onClick={() => void submit("knew_it")}>
              1 Knew it
            </button>
            <button className="rounded-full bg-amber-300 px-4 py-2" onClick={() => void submit("shaky")}>
              2 Shaky
            </button>
            <button className="rounded-full bg-rose-400 px-4 py-2 text-white" onClick={() => void submit("missed")}>
              3 Missed
            </button>
            <button
              className="rounded-full bg-ink px-4 py-2 text-white"
              onClick={() => {
                if (index + 1 >= pack.cards.length) onFinished();
                else {
                  setIndex((value) => value + 1);
                  setGuess("");
                  setRevealed(false);
                  setGrade(null);
                }
              }}
            >
              Next
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("practice");
  const [pack, setPack] = useState<StudyPack | null>(null);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [log, setLog] = useState(SAMPLE);
  const [status, setStatus] = useState("Loading…");
  const [openai, setOpenai] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const load = useCallback(async () => {
    try {
      const health = await api.health();
      setOpenai(health.openai_configured);
      try {
        setPack(await api.latestPack());
      } catch {
        setPack(null);
      }
      const listed = await api.units();
      setUnits(listed.units);
      setStatus("Ready");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backend unreachable");
      setStatus("Offline");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function ingest(event: FormEvent) {
    event.preventDefault();
    setError(null);
    await api.ingest(log);
    const generated = await api.generatePack();
    setPack(generated);
    setFinished(false);
    setTab("practice");
    await load();
  }

  const streak = useMemo(
    () => units.reduce((sum, unit) => sum + unit.success_count, 0),
    [units],
  );

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-moss">Sentence Mining</p>
          <h1 className="text-3xl font-semibold">Practice the gaps</h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="rounded-full bg-white px-3 py-1 shadow-sm">Streak {streak}</span>
          <span className="rounded-full bg-white px-3 py-1 shadow-sm">
            {openai ? "OpenAI on" : "Templates"}
          </span>
          <span className="text-ink/50">{status}</span>
        </div>
      </header>

      <nav className="mb-6 flex gap-2">
        {(["practice", "ingest", "units"] as Tab[]).map((item) => (
          <button
            key={item}
            className={`rounded-full px-4 py-2 text-sm ${tab === item ? "bg-ink text-white" : "bg-white"}`}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </nav>

      {error && <p className="mb-4 rounded-xl bg-rose-100 px-4 py-3 text-sm">{error}</p>}

      {tab === "practice" && (
        <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
          {pack && !finished ? (
            <CardPlayer pack={pack} onFinished={() => setFinished(true)} />
          ) : (
            <div className="rounded-2xl bg-white p-8 shadow-sm">
              <h2 className="text-xl font-semibold">{pack ? "Ready for another round?" : "No study pack yet"}</h2>
              <p className="mt-2 text-ink/70">Generate cards from current unit memories, or ingest a session log first.</p>
              <button
                className="mt-6 rounded-full bg-moss px-5 py-2 text-white"
                onClick={async () => {
                  const generated = await api.generatePack();
                  setPack(generated);
                  setFinished(false);
                }}
              >
                Generate study pack
              </button>
            </div>
          )}
          <aside className="rounded-2xl bg-white p-6 shadow-sm">
            <h3 className="font-semibold">Next-session speaking</h3>
            <ol className="mt-4 space-y-4">
              {(pack?.speaking_prompts || []).map((item) => (
                <li key={item.prompt} className="text-sm leading-relaxed">
                  <p>{item.prompt}</p>
                  <p className="mt-1 text-xs text-ink/50">{item.unit_keys.join(" · ")}</p>
                </li>
              ))}
              {!pack?.speaking_prompts?.length && <p className="text-sm text-ink/50">Prompts appear after generate.</p>}
            </ol>
          </aside>
        </div>
      )}

      {tab === "ingest" && (
        <form onSubmit={ingest} className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Paste a session log</h2>
          <p className="mt-1 text-sm text-ink/60">You said / Correct / Why, VOCABULARY OF THE DAY, TRACKING LIST, FOCUS FOR NEXT LESSON.</p>
          <textarea
            className="mt-4 h-80 w-full rounded-xl border border-ink/10 bg-sand p-4 font-mono text-sm"
            value={log}
            onChange={(event) => setLog(event.target.value)}
          />
          <button className="mt-4 rounded-full bg-moss px-5 py-2 text-white" type="submit">
            Ingest and generate
          </button>
        </form>
      )}

      {tab === "units" && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-sand text-ink/60">
              <tr>
                <th className="px-4 py-3">Unit</th>
                <th>S_k</th>
                <th>p_k</th>
                <th>Urgency</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {units.map((unit) => (
                <tr key={unit.key} className="border-t border-ink/5">
                  <td className="px-4 py-3">
                    <div className="font-medium">{unit.label}</div>
                    <div className="text-xs text-ink/50">{unit.key}</div>
                  </td>
                  <td>{unit.stability_days.toFixed(2)}</td>
                  <td>{unit.p_k.toFixed(2)}</td>
                  <td>{unit.urgency.toFixed(2)}</td>
                  <td className="space-x-1 py-3 text-xs">
                    {unit.is_recurring && <span className="rounded-full bg-rose-100 px-2 py-0.5">recurring</span>}
                    {unit.is_focus && <span className="rounded-full bg-amber-100 px-2 py-0.5">focus</span>}
                    {unit.is_tracking && <span className="rounded-full bg-sky-100 px-2 py-0.5">tracking</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
