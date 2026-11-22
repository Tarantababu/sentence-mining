"use client";

import { FormEvent, useState } from "react";
import { api, IngestResponse } from "../lib/client/api";
import { SAMPLE_LOG } from "../lib/sample";

type Props = {
  open: boolean;
  initialLog?: string;
  onClose: () => void;
  onIngested: (result: IngestResponse) => void;
};

export default function IngestModal({ open, initialLog, onClose, onIngested }: Props) {
  const [log, setLog] = useState(initialLog || SAMPLE_LOG);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.ingest(log);
      onIngested(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`fixed inset-0 z-40 items-end justify-center bg-ink/40 p-4 md:items-center ${open ? "flex" : "hidden"}`}>
      <form
        onSubmit={submit}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-3xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Paste a session log</h2>
            <p className="mt-1 text-sm text-ink/55">
              You said / Correct / Why, then VOCABULARY OF THE DAY, TRACKING LIST, FOCUS FOR NEXT LESSON.
            </p>
          </div>
          <button type="button" className="text-sm text-ink/50" onClick={onClose}>
            Close
          </button>
        </div>
        <textarea
          data-ignore-keys="true"
          maxLength={20000}
          className="mt-4 min-h-[22rem] flex-1 rounded-2xl border border-ink/10 bg-sand p-4 font-mono text-sm leading-relaxed outline-none focus:border-moss"
          value={log}
          onChange={(event) => setLog(event.target.value)}
        />
        {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy || !log.trim()}
            className="rounded-2xl bg-moss px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Ingesting…" : "Ingest and rebuild pack"}
          </button>
          <button
            type="button"
            className="rounded-2xl bg-sand px-5 py-3 text-sm font-semibold"
            onClick={() => setLog(SAMPLE_LOG)}
          >
            Load sample
          </button>
        </div>
      </form>
    </div>
  );
}
