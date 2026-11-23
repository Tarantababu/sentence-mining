"use client";

import { useCallback, useEffect, useState } from "react";
import { api, DeckStats, IngestResponse, ReviewResult, StudyPack, UnitRow } from "../lib/client/api";
import { markSessionComplete, readStreak } from "../lib/client/streak";
import CardPlayer from "./CardPlayer";
import IngestModal from "./IngestModal";
import LogHistory from "./LogHistory";
import SettingsPanel from "./SettingsPanel";
import UnitInspector from "./UnitInspector";

type View = "practice" | "logs" | "memory" | "settings";
type SessionMode = "due" | "stretch";

const TABS: { id: View; label: string }[] = [
  { id: "memory", label: "Dashboard" },
  { id: "practice", label: "Practice" },
  { id: "logs", label: "Logs" },
  { id: "settings", label: "Settings" },
];

function dueCardsOf(pack: StudyPack | null) {
  if (!pack) return [];
  return pack.cards.filter((card) => (card.queue ?? "due") !== "stretch");
}

function stretchCardsOf(pack: StudyPack | null) {
  if (!pack) return [];
  return pack.cards.filter((card) => card.queue === "stretch");
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
  const [clock, setClock] = useState<string | undefined>();
  const [sessionMode, setSessionMode] = useState<SessionMode>("due");
  const [startIndex, setStartIndex] = useState(0);
  const [stats, setStats] = useState<DeckStats | null>(null);

  const refreshUnits = useCallback(async () => {
    const listed = await api.units();
    setUnits(listed.units);
    setClock(listed.now);
    setStats(listed.stats);
    return listed;
  }, []);

  const load = useCallback(async () => {
    try {
      await api.health();
      let latest = await api.latestPack();
      if (!latest) latest = await api.generatePack({ due_only: true });
      setPack(latest);
      setProgress({ completed: 0, total: dueCardsOf(latest).length || latest.cards.length });
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

  const liveDueCount = units.filter((unit) => unit.due).length;
  const stretchReady = units.some((unit) => !unit.due);

  async function handleIngested(result: IngestResponse) {
    setNotice(`Saved ${result.error_count} corrections. Memory now uses every log, not only this one.`);
    setIngestOpen(false);
    setLogTick((value) => value + 1);
    setView("memory");
    setBusyPack(true);
    try {
      const generated = await api.generatePack({ due_only: true });
      setPack(generated);
      setFinished(null);
      setSessionMode("due");
      setProgress({ completed: 0, total: generated.cards.length });
      setPlayerKey((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rebuild the queue");
    } finally {
      await refreshUnits();
      setBusyPack(false);
    }
  }

  const handleProgress = useCallback((completed: number, total: number) => {
    setProgress((prev) => (prev.completed === completed && prev.total === total ? prev : { completed, total }));
  }, []);

  async function startDueReviews(index = 0) {
    setError(null);
    if (stats?.remaining_today === 0) {
      setNotice("Daily limit reached. Change it in Settings, or continue tomorrow.");
      setView("memory");
      return;
    }
    setBusyPack(true);
    try {
      const generated = await api.generatePack({
        due_only: true,
        ...(stats?.remaining_today != null
          ? { budget_cards: Math.min(stats.remaining_today, Math.max(liveDueCount, 1)) }
          : {}),
      });
      setPack(generated);
      const cards = dueCardsOf(generated);
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

  async function startStretch() {
    setError(null);
    setBusyPack(true);
    try {
      const generated = await api.generatePack({
        stretch_only: true,
        budget_prompts: 2,
        ...(stats?.remaining_today != null
          ? { budget_cards: Math.min(stats.remaining_today, 6) }
          : {}),
      });
      setPack(generated);
      setFinished(null);
      setSessionMode("stretch");
      setStartIndex(0);
      setProgress({ completed: 0, total: generated.cards.length });
      setPlayerKey((value) => value + 1);
      setView("practice");
      await refreshUnits();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start stretch practice");
    } finally {
      setBusyPack(false);
    }
  }

  function openPracticeTab() {
    const activeCards =
      sessionMode === "due" ? dueCardsOf(pack) : stretchCardsOf(pack).length ? stretchCardsOf(pack) : pack?.cards || [];
    if (pack && !finished && activeCards.length) {
      setView("practice");
      return;
    }
    if (liveDueCount > 0) void startDueReviews(0);
    else void startStretch();
  }

  const connecting = status === "Connecting";
  const dueCards = dueCardsOf(pack);
  const stretchCards = stretchCardsOf(pack);
  const practicePack =
    pack && sessionMode === "due"
      ? dueCards.length
        ? { ...pack, cards: dueCards }
        : { ...pack, cards: [] }
      : pack && sessionMode === "stretch"
        ? { ...pack, cards: stretchCards.length ? stretchCards : pack.cards }
        : pack;
  const sessionTotal = (view === "practice" ? practicePack?.cards.length : dueCards.length) ?? progress.total;
  const currentStep = finished
    ? sessionTotal
    : Math.min(sessionTotal, progress.completed + (practicePack?.cards.length ? 1 : 0));
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
            {view === "practice"
              ? sessionMode === "stretch"
                ? "Stretch the phrase"
                : "Make it natural"
              : view === "settings"
                ? "Settings"
                : view === "logs"
                  ? "Logs"
                  : "Dashboard"}
          </h1>
          <p className="mt-1 text-sm text-ink/50">
            {view === "practice"
              ? "Read, type, then say the line out loud."
              : view === "memory"
                ? "Due first. See the deck, reps, and what is waiting."
                : view === "settings"
                  ? "API key and daily practice amount."
                  : "Every paste, in order."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">{streak} day streak</span>
          <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">
            {currentStep}/{sessionTotal || 0}
          </span>
          <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">{liveDueCount} due</span>
          {stats && (
            <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">
              {stats.daily_limit == null ? "Unlimited" : `${stats.remaining_today ?? 0}/${stats.daily_limit} today`}
            </span>
          )}
        </div>
      </header>

      <nav className="mx-auto flex max-w-5xl flex-wrap gap-2 px-4">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`rounded-full px-4 py-2 text-sm font-medium ${view === tab.id ? "bg-ink text-white" : "bg-white"}`}
            onClick={() => (tab.id === "practice" ? openPracticeTab() : setView(tab.id))}
          >
            {tab.id === "memory" && liveDueCount > 0 ? `Dashboard · ${liveDueCount}` : tab.label}
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
            {practicePack && practicePack.cards.length > 0 && !finished ? (
              <CardPlayer
                key={`${practicePack.id}-${playerKey}-${startIndex}-${sessionMode}`}
                pack={practicePack}
                startIndex={startIndex}
                onProgress={handleProgress}
                onFinished={(results) => {
                  setFinished(results);
                  setStreak(markSessionComplete().count);
                  void refreshUnits();
                }}
              />
            ) : (
              <section className="mx-auto max-w-2xl rounded-[2rem] bg-white p-8 shadow-[0_18px_50px_rgba(18,32,28,0.08)]">
                <h2 className="font-serif text-2xl font-semibold">
                  {finished
                    ? sessionMode === "due"
                      ? "Due queue clear"
                      : "Stretch complete"
                    : liveDueCount
                      ? "Due sentences ready"
                      : "No sentences yet"}
                </h2>
                {finished ? (
                  <p className="mt-3 text-ink/70">
                    {finished.knew_it} solid · {finished.shaky} almost · {finished.missed} to retry.
                    Each pass just wrote back into your memory.
                    {sessionMode === "due" && stretchReady
                      ? " Stretch cards are waiting when you want a slightly harder line."
                      : ""}
                  </p>
                ) : (
                  <p className="mt-3 text-ink/70">
                    {liveDueCount
                      ? "Start from the due sentences on Review."
                      : "Paste a speaking-session log, or stretch phrases that are already stable."}
                  </p>
                )}
                <div className="mt-6 flex flex-wrap gap-2">
                  {liveDueCount > 0 && (
                    <button
                      className="rounded-2xl bg-leaf px-5 py-3 text-sm font-bold text-[#123016] disabled:opacity-50"
                      onClick={() => void startDueReviews(0)}
                      disabled={busyPack}
                    >
                      {busyPack ? "Building…" : "Review due first"}
                    </button>
                  )}
                  {stretchReady && (
                    <button
                      className="rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                      onClick={() => void startStretch()}
                      disabled={busyPack}
                    >
                      {busyPack ? "Building…" : "Try a stretch"}
                    </button>
                  )}
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
            stats={stats}
            now={clock}
            busy={busyPack}
            onReviewDue={(index) => void startDueReviews(index)}
            onStretch={() => void startStretch()}
          />
        )}
        {view === "settings" && !connecting && (
          <SettingsPanel
            onSaved={(configured) =>
              setNotice(configured ? "Natural phrasing is on for new cards." : "Template sentences until a key is saved.")
            }
            onLimitSaved={() => void refreshUnits()}
          />
        )}
      </main>

      <IngestModal open={ingestOpen} onClose={() => setIngestOpen(false)} onIngested={(result) => void handleIngested(result)} />
    </div>
  );
}
