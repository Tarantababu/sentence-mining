import { SpeakingPrompt } from "../api";

export default function SpeakingPanel({ prompts }: { prompts: SpeakingPrompt[] }) {
  if (!prompts.length) return null;
  return (
    <aside className="rounded-3xl bg-white p-6 shadow-[0_12px_40px_rgba(18,32,28,0.06)]">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Say it now</p>
      <h2 className="mt-1 text-lg font-semibold">Use these out loud</h2>
      <ol className="mt-4 space-y-5">
        {prompts.map((item, index) => (
          <li key={`${item.prompt}-${index}`} className="text-[0.95rem] leading-relaxed">
            <p>
              <span className="mr-2 font-semibold text-moss">{index + 1}.</span>
              {item.prompt.replace(/^Next (session|lesson):\s*/i, "")}
            </p>
            {item.why && <p className="mt-1 text-xs text-ink/40">{item.why}</p>}
          </li>
        ))}
      </ol>
    </aside>
  );
}
