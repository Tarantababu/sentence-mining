import { useCallback, useEffect, useState } from "react";
import { api, IngestResponse, ReviewResult, StudyPack, UnitRow } from "./api";
import CardPlayer from "./components/CardPlayer";
import IngestModal from "./components/IngestModal";
import SpeakingPanel from "./components/SpeakingPanel";
import UnitInspector from "./components/UnitInspector";
import { markSessionComplete, readSessionCount, readStreak } from "./lib/streak";

type View = "practice" | "memory";

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
  const [viewerName, setViewerName] = useState<string | null>(null);

  const refreshUnits = useCallback(async () => {
    const listed = await api.units();
    setUnits(listed.units);
  }, []);

  const load = useCallback(async () => {
    try {
      const health = await api.health();
      setOpenai(health.openai_configured);
      if (health.viewer_name) setViewerName(health.viewer_name);
      let latest = await api.latestPack();
      if (!latest) {
        latest = await api.generatePack();
      }
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
    const parserLabel = result.parser === "openai" ? "OpenAI parse" : "rule parse";
    setNotice(`${result.error_count} errors · ${result.units_touched.length} units · ${parserLabel}`);
    setIngestOpen(false);
    await startNewPack();
  }

  const currentStep = finished
    ? progress.total
    : Math.min(progress.total, progress.completed + (pack ? 1 : 0));
  const pct = progress.total === 0 ? 0 : Math.round((currentStep / progress.total) * 100);
  const connecting = status === "Connecting";
  const generator = pack?.generator === "openai" ? "OpenAI cards" : "Template cards";

  return (
    <div className="min-h-screen">
      <div className="border-b border-ink/10 bg-white/90">
        <div className="mx-auto max-w-5xl px-4 py-2.5">
          <div className="h-3 overflow-hidden rounded-full bg-[#ddd6c8]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="h-full rounded-full bg-leaf transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      <header className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-moss">Sentence Mining</p>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">Practice the gaps</h1>
          {viewerName && <p className="mt-1 text-xs text-ink/45">{viewerName}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">Streak {streak}</span>
          <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">
            Session {session + (finished ? 1 : 0)}
          </span>
          <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">
            {currentStep}/{progress.total || 0}
          </span>
          <span className="rounded-full bg-white px-3 py-1.5 text-ink/50 shadow-sm">
            {openai ? "OpenAI on" : "Templates"} · {pack ? generator : status}
          </span>
        </div>
      </header>

      <div className="mx-auto flex max-w-5xl gap-2 px-4">
        <button
          className={`rounded-full px-4 py-2 text-sm font-medium ${view === "practice" ? "bg-ink text-white" : "bg-white"}`}
          onClick={() => setView("practice")}
        >
          Practice
        </button>
        <button
          className={`rounded-full px-4 py-2 text-sm font-medium ${view === "memory" ? "bg-ink text-white" : "bg-white"}`}
          onClick={() => setView("memory")}
        >
          Memory
        </button>
        <button className="rounded-full bg-white px-4 py-2 text-sm font-medium" onClick={() => setIngestOpen(true)}>
          Paste log
        </button>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {!openai && status === "Ready" && (
          <p className="mb-4 rounded-2xl bg-sand px-4 py-3 text-sm text-ink/70">
            Sample / template cards are in use on this machine. Natural phrasing turns on when
            <span className="font-semibold"> OPENAI_API_KEY</span> is set for the server — never in the browser.
          </p>
        )}
        {error && <p className="mb-4 rounded-2xl bg-rose-100 px-4 py-3 text-sm">{error}</p>}
        {notice && <p className="mb-4 rounded-2xl bg-moss/10 px-4 py-3 text-sm text-moss">{notice}</p>}

        {connecting && (
          <section className="rounded-3xl bg-white p-8 shadow-[0_12px_40px_rgba(18,32,28,0.06)]">
            <p className="text-sm uppercase tracking-[0.16em] text-ink/40">Loading</p>
            <h2 className="mt-2 font-serif text-2xl font-semibold">Preparing your study pack</h2>
            <p className="mt-3 text-ink/60">Memory state is stored on the server so reviews survive a refresh.</p>
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
              <section className="rounded-3xl bg-white p-8 shadow-[0_12px_40px_rgba(18,32,28,0.06)]">
                <h2 className="font-serif text-2xl font-semibold">
                  {finished ? "Session complete" : "No study pack yet"}
                </h2>
                {finished ? (
                  <p className="mt-3 text-ink/70">
                    {finished.knew_it} knew it · {finished.shaky} shaky · {finished.missed} missed. Speaking prompts are on
                    the right — use them in the next lesson.
                  </p>
                ) : (
                  <p className="mt-3 text-ink/70">Generate cards from current memories, or paste a session log.</p>
                )}
                <div className="mt-6 flex flex-wrap gap-2">
                  <button
                    className="rounded-2xl bg-moss px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    onClick={() => void startNewPack()}
                    disabled={busyPack}
                  >
                    {busyPack ? "Generating…" : "Generate study pack"}
                  </button>
                  <button className="rounded-2xl bg-sand px-5 py-3 text-sm font-semibold" onClick={() => setIngestOpen(true)}>
                    Paste session log
                  </button>
                  <button className="rounded-2xl bg-sand px-5 py-3 text-sm font-semibold" onClick={() => setView("memory")}>
                    Inspect units
                  </button>
                </div>
              </section>
            )}
            <SpeakingPanel prompts={pack?.speaking_prompts || []} />
          </div>
        )}

        {view === "memory" && !connecting && <UnitInspector units={units} />}
      </main>

      <IngestModal open={ingestOpen} onClose={() => setIngestOpen(false)} onIngested={(result) => void handleIngested(result)} />
    </div>
  );
}
