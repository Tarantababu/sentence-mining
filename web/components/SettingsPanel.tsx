"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/client/api";

type Props = {
  onSaved?: (openaiConfigured: boolean) => void;
  onLimitSaved?: () => void;
};

export default function SettingsPanel({ onSaved, onLimitSaved }: Props) {
  const [keyValue, setKeyValue] = useState("");
  const [hasPersonal, setHasPersonal] = useState(false);
  const [hasHosted, setHasHosted] = useState(false);
  const [keySet, setKeySet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [limitBusy, setLimitBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlimited, setUnlimited] = useState(true);
  const [limitValue, setLimitValue] = useState("20");
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    void api.settings().then((result) => {
      setHasPersonal(result.has_personal_key);
      setHasHosted(result.has_hosted_key);
      setKeySet(result.api_key_set);
      setUnlimited(result.daily_limit == null);
      if (result.daily_limit != null) setLimitValue(String(result.daily_limit));
      setRemaining(result.remaining_today);
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
      setKeySet(result.openai_configured);
      setKeyValue("");
      setMessage(result.saved ? "Key saved for this account." : "Personal key cleared.");
      onSaved?.(result.openai_configured);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save key");
    } finally {
      setBusy(false);
    }
  }

  async function saveLimit(nextUnlimited: boolean, rawValue: string) {
    setLimitBusy(true);
    setError(null);
    try {
      const dailyLimit = nextUnlimited ? null : Math.min(200, Math.max(1, Number(rawValue) || 20));
      const result = await api.saveDailyLimit(dailyLimit);
      setUnlimited(result.daily_limit == null);
      if (result.daily_limit != null) setLimitValue(String(result.daily_limit));
      setRemaining(result.remaining_today);
      setMessage(result.daily_limit == null ? "Daily practice is unlimited." : `Daily practice set to ${result.daily_limit}.`);
      onLimitSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save daily limit");
    } finally {
      setLimitBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-white p-6 shadow-[0_18px_50px_rgba(18,32,28,0.08)] md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Settings</p>
        <h2 className="mt-1 font-serif text-2xl font-semibold">OpenAI API key</h2>
        <div
          className={`mt-5 rounded-2xl border px-4 py-4 ${
            keySet ? "border-moss/30 bg-moss/10" : "border-rose-200 bg-rose-50"
          }`}
        >
          <p className={`text-sm font-bold ${keySet ? "text-moss" : "text-rose-800"}`}>
            {keySet ? "API key is set" : "API key is not set"}
          </p>
          <p className="mt-1 text-sm text-ink/65">
            {hasPersonal
              ? "A personal key is saved for this account."
              : hasHosted
                ? "No personal key. New cards use the hosted workspace key."
                : "No key on file. New cards use template sentences until you save one."}
          </p>
        </div>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink/60">
          Stored on the server for your signed-in account only. It never goes in the browser bundle or
          in logs.
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
                      setKeySet(result.openai_configured);
                      setMessage("Personal key cleared.");
                      onSaved?.(result.openai_configured);
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
      </section>

      <section className="rounded-[2rem] bg-white p-6 shadow-[0_18px_50px_rgba(18,32,28,0.08)] md:p-8">
        <h2 className="font-serif text-2xl font-semibold">Daily practice</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/60">
          Unlimited by default. Set a cap if you want a shorter Anki-style session.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            className={`rounded-2xl px-5 py-3 text-sm font-semibold ${
              unlimited ? "bg-leaf text-[#123016]" : "bg-sand"
            }`}
            disabled={limitBusy}
            onClick={() => void saveLimit(true, limitValue)}
          >
            Unlimited
          </button>
          <button
            type="button"
            className={`rounded-2xl px-5 py-3 text-sm font-semibold ${
              !unlimited ? "bg-ink text-white" : "bg-sand"
            }`}
            disabled={limitBusy}
            onClick={() => void saveLimit(false, limitValue)}
          >
            Set a daily limit
          </button>
        </div>
        {!unlimited && (
          <form
            className="mt-4 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void saveLimit(false, limitValue);
            }}
          >
            <label className="text-sm font-medium">
              Reviews per day
              <input
                type="number"
                min={1}
                max={200}
                data-ignore-keys="true"
                className="mt-2 w-32 rounded-2xl border border-ink/10 bg-sand px-4 py-3 outline-none focus:border-moss"
                value={limitValue}
                onChange={(event) => setLimitValue(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
              disabled={limitBusy}
            >
              {limitBusy ? "Saving…" : "Save limit"}
            </button>
          </form>
        )}
        <p className="mt-4 text-sm text-ink/55">
          {unlimited
            ? "No daily cap. Practice every due sentence."
            : remaining == null
              ? `Capped at ${limitValue} reviews today.`
              : `${remaining} of ${limitValue} reviews left today.`}
        </p>
      </section>

      {message && <p className="text-sm text-moss">{message}</p>}
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </div>
  );
}
