"use client";

import { SpeakingPrompt } from "../lib/client/api";

export default function SpeakingPanel({ prompts }: { prompts: SpeakingPrompt[] }) {
  return (
    <aside className="rounded-[2rem] bg-white p-6 shadow-[0_18px_50px_rgba(18,32,28,0.08)]">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Next lesson</p>
      <h2 className="mt-1 font-serif text-xl font-semibold">Speak these</h2>
      {prompts.length === 0 ? (
        <p className="mt-4 text-sm text-ink/50">Prompts appear with a study pack.</p>
      ) : (
        <ol className="mt-4 space-y-5">
          {prompts.map((item, index) => (
            <li key={`${item.prompt}-${index}`} className="text-[0.95rem] leading-relaxed">
              <p>
                <span className="mr-2 font-semibold text-moss">{index + 1}.</span>
                {item.prompt}
              </p>
              {item.why && <p className="mt-1 text-xs text-ink/45">{item.why}</p>}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
