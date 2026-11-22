"use client";

import { useCallback, useEffect, useState } from "react";
import { api, IngestResponse, ReviewResult, StudyPack, UnitRow } from "../lib/client/api";
import { markSessionComplete, readSessionCount, readStreak } from "../lib/client/streak";
import CardPlayer from "./CardPlayer";
import IngestModal from "./IngestModal";
import LogHistory from "./LogHistory";
import SettingsPanel from "./SettingsPanel";
import SpeakingPanel from "./SpeakingPanel";
import UnitInspector from "./UnitInspector";

type View = "practice" | "logs" | "memory" | "settings";

const TABS: { id: View; label: string }[] = [
  { id: "practice", label: "Practice" },
  { id: "logs", label: "Logs" },
  { id: "memory", label: "Memory" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [view, setView] = useState<View>("practice");
  const [pack, setPack] = useState<StudyPack | null>(null);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [streak, setStreak] = useState(0);
  const [session, setSession] = useState(0);
  const [openai, setOpenai] = useState(false);
  const [status, setStatus] = useState("Connecting");
  const [error, setError] = useState<string | null>(null);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [finished, setFinished] = useState<Record<ReviewResult, number> | null>(null);
  const [playerKey, setPlayerKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyPack, setBusyPack] = useState(false);
  const [logTick, setLogTick] = useState(0);

  const refreshUnits = useCallback(async () => {
    const listed = await api.units();
    setUnits(listed.units);
  }, []);

  const load = useCallback(async () => {
    try {
      const health = await api.health();
      setOpenai(health.openai_configured);
      let latest = await api.latestPack();
      if (!latest) latest = await api.generatePack();
      setPack(latest);
      setProgress({ completed: 0, total: latest.cards.length });
      await refreshUnits();
      setStreak(readStreak().count);
      setSession(readSessionCount());
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

  async function startNewPack() {
    setError(null);
    setBusyPack(true);
    try {
      const generated = await api.generatePack();
      setPack(generated);
      setFinished(null);
      setProgress({ completed: 0, total: generated.cards.length });
      setPlayerKey((value) => value + 1);
      setView("practice");
      await refreshUnits();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a pack");
    } finally {
      setBusyPack(false);
    }
  }

  async function handleIngested(result: IngestResponse) {
    setNotice(`Saved ${result.error_count} corrections to your log history.`);
    setIngestOpen(false);
    setLogTick((value) => value + 1);
    setView("logs");
    setBusyPack(true);
    try {
      const generated = await api.generatePack();
      setPack(generated);
      setFinished(null);
      setProgress({ completed: 0, total: generated.cards.length });
      setPlayerKey((value) => value + 1);
      await refreshUnits();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rebuild the lesson");
    } finally {
      setBusyPack(false);
    }
  }

  const currentStep = finished
    ? progress.total
    : Math.min(progress.total, progress.completed + (pack ? 1 : 0));
  const pct = progress.total === 0 ? 0 : Math.round((currentStep / progress.total) * 100);
  const connecting = status === "Connecting";

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
          <h1 className="font-serif text-3xl font-semibold tracking-tight">Practice the gaps</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">{streak} day streak</span>
          <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">
            Lesson {session + (finished ? 1 : 0)}
          </span>
          <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">
            {currentStep}/{progress.total || 0}
          </span>
        </div>
      </header>

      <nav className="mx-auto flex max-w-5xl flex-wrap gap-2 px-4">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`rounded-full px-4 py-2 text-sm font-medium ${view === tab.id ? "bg-ink text-white" : "bg-white"}`}
            onClick={() => setView(tab.id)}
          >
            {tab.label}
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
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(16rem,1fr)]">
            {pack && !finished ? (
              <CardPlayer
                key={`${pack.id}-${playerKey}`}
                pack={pack}
                onProgress={(completed, total) => setProgress({ completed, total })}
                onFinished={(results) => {
                  setFinished(results);
                  setSession((value) => value + 1);
                  setStreak(markSessionComplete().count);
                  void refreshUnits();
                }}
              />
            ) : (
              <section className="rounded-[2rem] bg-white p-8 shadow-[0_18px_50px_rgba(18,32,28,0.08)]">
                <h2 className="font-serif text-2xl font-semibold">
                  {finished ? "Lesson complete" : "No sentences yet"}
                </h2>
                {finished ? (
                  <p className="mt-3 text-ink/70">
                    {finished.knew_it} solid · {finished.shaky} shaky · {finished.missed} missed.
                  </p>
                ) : (
                  <p className="mt-3 text-ink/70">Generate a new set from everything you have pasted.</p>
                )}
                <div className="mt-6 flex flex-wrap gap-2">
                  <button
                    className="rounded-2xl bg-leaf px-5 py-3 text-sm font-bold text-[#123016] disabled:opacity-50"
                    onClick={() => void startNewPack()}
                    disabled={busyPack}
                  >
                    {busyPack ? "Building…" : "New lesson"}
                  </button>
                  <button className="rounded-2xl bg-sand px-5 py-3 text-sm font-semibold" onClick={() => setIngestOpen(true)}>
                    Paste a log
                  </button>
                </div>
              </section>
            )}
            <SpeakingPanel prompts={pack?.speaking_prompts || []} />
          </div>
        )}

        {view === "logs" && !connecting && (
          <LogHistory refreshToken={logTick} onPaste={() => setIngestOpen(true)} />
        )}
        {view === "memory" && !connecting && <UnitInspector units={units} />}
        {view === "settings" && !connecting && (
          <SettingsPanel
            onSaved={(configured) => {
              setOpenai(configured);
            }}
          />
        )}
      </main>

      <IngestModal open={ingestOpen} onClose={() => setIngestOpen(false)} onIngested={(result) => void handleIngested(result)} />
    </div>
  );
}
