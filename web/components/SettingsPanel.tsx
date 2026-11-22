"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/client/api";

type Props = {
  onSaved: (openaiConfigured: boolean) => void;
};

export default function SettingsPanel({ onSaved }: Props) {
  const [keyValue, setKeyValue] = useState("");
  const [hasPersonal, setHasPersonal] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.settings().then((result) => {
      setHasPersonal(result.has_personal_key);
      setConfigured(result.openai_configured);
    });
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.saveOpenAiKey(keyValue);
      setHasPersonal(result.has_personal_key);
      setConfigured(result.openai_configured);
      setKeyValue("");
      setMessage(result.saved ? "Key saved for this account." : "Personal key cleared.");
      onSaved(result.openai_configured);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save key");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[2rem] bg-white p-6 shadow-[0_18px_50px_rgba(18,32,28,0.08)] md:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Settings</p>
      <h2 className="mt-1 font-serif text-2xl font-semibold">OpenAI key</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/60">
        Stored on the server for your signed-in account only. It never goes in the browser bundle or
        in logs. A hosted workspace key is used if you leave this empty.
      </p>
      <form onSubmit={save} className="mt-6 max-w-lg space-y-3">
        <label className="block text-sm font-medium">
          API key
          <input
            type="password"
            name="openai-api-key"
            autoComplete="off"
            data-ignore-keys="true"
            className="mt-2 w-full rounded-2xl border border-ink/10 bg-sand px-4 py-3 outline-none focus:border-moss"
            value={keyValue}
            onChange={(event) => setKeyValue(event.target.value)}
            placeholder={hasPersonal ? "Key on file — paste to replace" : "sk-…"}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save key"}
          </button>
          {hasPersonal && (
            <button
              type="button"
              className="rounded-2xl bg-sand px-5 py-3 text-sm font-semibold"
              disabled={busy}
              onClick={() => {
                setKeyValue("");
                void (async () => {
                  setBusy(true);
                  try {
                    const result = await api.saveOpenAiKey("");
                    setHasPersonal(false);
                    setConfigured(result.openai_configured);
                    setMessage("Personal key cleared.");
                    onSaved(result.openai_configured);
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              Clear
            </button>
          )}
        </div>
      </form>
      {message && <p className="mt-4 text-sm text-moss">{message}</p>}
      {error && <p className="mt-4 text-sm text-rose-700">{error}</p>}
      <p className="mt-4 text-xs text-ink/40">
        {hasPersonal ? "Using your saved key for new cards." : configured ? "Using the hosted key." : "Template sentences until a key is saved."}
      </p>
    </section>
  );
}
