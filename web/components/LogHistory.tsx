"use client";

import { useEffect, useState } from "react";
import { api, SessionLog } from "../lib/client/api";

type Props = {
  refreshToken: number;
  onPaste: () => void;
};

function formatTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LogHistory({ refreshToken, onPaste }: Props) {
  const [logs, setLogs] = useState<SessionLog[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [full, setFull] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .sessions()
      .then((result) => setLogs(result.sessions))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load logs"));
  }, [refreshToken]);

  async function expand(id: number) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (full[id]) return;
    const session = await api.session(id);
    setFull((current) => ({ ...current, [id]: session.raw_log || session.preview }));
  }

  return (
    <section className="rounded-[2rem] bg-white p-6 shadow-[0_18px_50px_rgba(18,32,28,0.08)] md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Logs</p>
          <h2 className="mt-1 font-serif text-2xl font-semibold">Every paste, in order</h2>
          <p className="mt-1 text-sm text-ink/55">
            {logs.length} saved. Memory uses the whole set, not only the latest.
          </p>
        </div>
        <button className="rounded-2xl bg-leaf px-5 py-3 text-sm font-bold text-[#123016]" onClick={onPaste}>
          Paste a log
        </button>
      </div>
      {error && <p className="mt-4 text-sm text-rose-700">{error}</p>}
      <ol className="mt-6 space-y-3">
        {logs.map((log) => (
          <li key={log.id} className="rounded-2xl border border-ink/8 bg-sand/60 p-4">
            <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => void expand(log.id)}>
              <div>
                <p className="text-sm font-semibold">{formatTime(log.ingested_at)}</p>
                <p className="mt-1 text-sm text-ink/60">{log.preview}</p>
              </div>
              <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs text-ink/50">
                {log.error_count} corrections
              </span>
            </button>
            {openId === log.id && (
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 font-mono text-xs leading-relaxed text-ink/80">
                {full[log.id] || "Loading…"}
              </pre>
            )}
          </li>
        ))}
        {logs.length === 0 && <p className="text-sm text-ink/50">No logs yet. Paste a speaking-session note.</p>}
      </ol>
    </section>
  );
}
