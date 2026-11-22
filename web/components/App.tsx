"use client";

import { useCallback, useEffect, useState } from "react";
import { api, IngestResponse, ReviewResult, StudyPack, UnitRow } from "../lib/client/api";
import { markSessionComplete, readStreak } from "../lib/client/streak";
import CardPlayer from "./CardPlayer";
import IngestModal from "./IngestModal";
import LogHistory from "./LogHistory";
import SettingsPanel from "./SettingsPanel";
import UnitInspector from "./UnitInspector";

type View = "practice" | "logs" | "memory" | "settings";

const TABS: { id: View; label: string }[] = [
  { id: "practice", label: "Practice" },
  { id: "logs", label: "Logs" },
  { id: "memory", label: "Review" },
  { id: "settings", label: "Settings" },
];

function dueCardsOf(pack: StudyPack | null) {
  if (!pack) return [];
  const due = pack.cards.filter((card) => (card.queue ?? "due") !== "stretch");
  return due.length ? due : pack.cards;
}

export default function App() {
  const [view, setView] = useState<View>("memory");
  const [pack, setPack] = useState<StudyPack | null>(null);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [streak, setStreak] = useState(0);
  const [status, setStatus] = useState("Connecting");
  const [error, setError] = useState<string | null>(null);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [finished, setFinished] = useState<Record<ReviewResult, number> | null>(null);
  const [playerKey, setPlayerKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyPack, setBusyPack] = useState(false);
  const [logTick, setLogTick] = useState(0);
  const [dueCount, setDueCount] = useState(0);
  const [clock, setClock] = useState<string | undefined>();
  const [sessionMode, setSessionMode] = useState<"due" | "full">("due");
  const [startIndex, setStartIndex] = useState(0);

  const refreshUnits = useCallback(async () => {
    const listed = await api.units();
    setUnits(listed.units);
    setDueCount(listed.due_count);
    setClock(listed.now);
  }, []);

  const load = useCallback(async () => {
    try {
      await api.health();
      let latest = await api.latestPack();
      if (!latest) latest = await api.generatePack();
      setPack(latest);
      setProgress({ completed: 0, total: latest.cards.length });
      await refreshUnits();
      setStreak(readStreak().count);
      setStatus("Ready");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backend unreachable");
      setStatus("Offline");
    }
  }, [refreshUnits]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleIngested(result: IngestResponse) {
    setNotice(`Saved ${result.error_count} corrections. Memory now uses every log, not only this one.`);
    setIngestOpen(false);
    setLogTick((value) => value + 1);
    setView("memory");
    setBusyPack(true);
    try {
      const generated = await api.generatePack();
      setPack(generated);
      setFinished(null);
      setProgress({ completed: 0, total: generated.cards.length });
      setPlayerKey((value) => value + 1);
      setSessionMode("due");
      await refreshUnits();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rebuild the queue");
    } finally {
      setBusyPack(false);
    }
  }

  const handleProgress = useCallback((completed: number, total: number) => {
    setProgress((prev) => (prev.completed === completed && prev.total === total ? prev : { completed, total }));
  }, []);

  async function startDueReviews(index = 0) {
    setError(null);
    setBusyPack(true);
    try {
      let next = pack;
      const existingDue = dueCardsOf(pack);
      if (!existingDue.length) {
        next = await api.generatePack({ due_only: true, budget_cards: Math.min(8, Math.max(dueCount, 1)) });
        setPack(next);
      }
      const cards = dueCardsOf(next);
      setFinished(null);
      setSessionMode("due");
      setStartIndex(Math.min(Math.max(0, index), Math.max(cards.length - 1, 0)));
      setProgress({ completed: 0, total: cards.length });
      setPlayerKey((value) => value + 1);
      setView("practice");
      await refreshUnits();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start due reviews");
    } finally {
      setBusyPack(false);
    }
  }

  const connecting = status === "Connecting";
  const dueCards = dueCardsOf(pack);
  const practicePack =
    pack && sessionMode === "due"
      ? { ...pack, cards: dueCardsOf(pack) }
      : pack;
  const sessionTotal = (view === "practice" ? practicePack?.cards.length : pack?.cards.length) ?? progress.total;
  const currentStep = finished
    ? sessionTotal
    : Math.min(sessionTotal, progress.completed + (practicePack ? 1 : 0));
  const pct = sessionTotal === 0 ? 0 : Math.round((currentStep / sessionTotal) * 100);

  return (
    <div className="min-h-screen">
      <div className="border-b border-ink/10 bg-white/85 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div
            className="h-4 overflow-hidden rounded-full bg-[#ddd6c8]"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="progress-fill h-full rounded-full bg-leaf" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <header className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-moss">Sentence Mining</p>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            {view === "practice" ? "Make it natural" : "Practice the gaps"}
          </h1>
          <p className="mt-1 text-sm text-ink/50">
            {view === "practice"
              ? "Read, type, then say the line out loud."
              : "Due sentences first. Stretch waits until those are clear."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">{streak} day streak</span>
          <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">
            {currentStep}/{sessionTotal || 0}
          </span>
          <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">{dueCount} due</span>
        </div>
      </header>

      <nav className="mx-auto flex max-w-5xl flex-wrap gap-2 px-4">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`rounded-full px-4 py-2 text-sm font-medium ${view === tab.id ? "bg-ink text-white" : "bg-white"}`}
            onClick={() => setView(tab.id)}
          >
            {tab.id === "memory" && dueCount > 0 ? `Review · ${dueCount}` : tab.label}
          </button>
        ))}
        <button className="rounded-full bg-white px-4 py-2 text-sm font-medium" onClick={() => setIngestOpen(true)}>
          Paste log
        </button>
      </nav>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {error && <p className="mb-4 rounded-2xl bg-rose-100 px-4 py-3 text-sm">{error}</p>}
        {notice && <p className="mb-4 rounded-2xl bg-moss/10 px-4 py-3 text-sm text-moss">{notice}</p>}

        {connecting && (
          <section className="rounded-[2rem] bg-white p-8 shadow-[0_18px_50px_rgba(18,32,28,0.08)]">
            <h2 className="font-serif text-2xl font-semibold">Preparing today’s sentences</h2>
            <p className="mt-3 text-ink/60">Your memory stays on the server between visits.</p>
          </section>
        )}

        {view === "practice" && !connecting && (
          <div className="py-2">
            {practicePack && !finished ? (
              <CardPlayer
                key={`${practicePack.id}-${playerKey}-${startIndex}`}
                pack={practicePack}
                startIndex={startIndex}
                onProgress={handleProgress}
                onFinished={(results) => {
                  setFinished(results);
                  setStreak(markSessionComplete().count);
                  void refreshUnits().then(() => {
                    if (sessionMode === "due") setView("memory");
                  });
                }}
              />
            ) : (
              <section className="mx-auto max-w-2xl rounded-[2rem] bg-white p-8 shadow-[0_18px_50px_rgba(18,32,28,0.08)]">
                <h2 className="font-serif text-2xl font-semibold">
                  {finished ? "That’s the queue" : "No sentences yet"}
                </h2>
                {finished ? (
                  <p className="mt-3 text-ink/70">
                    {finished.knew_it} solid · {finished.shaky} almost · {finished.missed} to retry.
                    Each pass just wrote back into your memory.
                  </p>
                ) : (
                  <p className="mt-3 text-ink/70">Start from the due sentences on Review.</p>
                )}
                <div className="mt-6 flex flex-wrap gap-2">
                  <button
                    className="rounded-2xl bg-leaf px-5 py-3 text-sm font-bold text-[#123016] disabled:opacity-50"
                    onClick={() => void startDueReviews(0)}
                    disabled={busyPack}
                  >
                    {busyPack ? "Building…" : "Review due first"}
                  </button>
                  <button className="rounded-2xl bg-sand px-5 py-3 text-sm font-semibold" onClick={() => setView("memory")}>
                    Back to queue
                  </button>
                  <button className="rounded-2xl bg-sand px-5 py-3 text-sm font-semibold" onClick={() => setIngestOpen(true)}>
                    Paste a log
                  </button>
                </div>
              </section>
            )}
          </div>
        )}

        {view === "logs" && !connecting && (
          <LogHistory refreshToken={logTick} onPaste={() => setIngestOpen(true)} />
        )}
        {view === "memory" && !connecting && (
          <UnitInspector
            units={units}
            dueCards={dueCards}
            now={clock}
            busy={busyPack}
            onReviewDue={(index) => void startDueReviews(index)}
          />
        )}
        {view === "settings" && !connecting && <SettingsPanel />}
      </main>

      <IngestModal open={ingestOpen} onClose={() => setIngestOpen(false)} onIngested={(result) => void handleIngested(result)} />
    </div>
  );
}
