"use client";

import { UnitRow } from "../lib/client/api";

function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  const pct = Math.max(4, Math.min(100, (value / max) * 100));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function UnitInspector({ units }: { units: UnitRow[] }) {
  const ranked = [...units].filter((unit) => unit.error_count + unit.success_count > 0 || unit.is_focus || unit.is_tracking);
  ranked.sort((a, b) => b.urgency - a.urgency);
  return (
    <section className="overflow-hidden rounded-[2rem] bg-white shadow-[0_18px_50px_rgba(18,32,28,0.08)]">
      <div className="border-b border-ink/5 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Memory</p>
        <h2 className="mt-1 font-serif text-xl font-semibold">What is fading</h2>
        <p className="mt-1 text-sm text-ink/50">Stability and recall from every log you have pasted.</p>
      </div>
      <ul>
        {ranked.map((unit) => (
          <li key={unit.label} className="grid gap-3 border-t border-ink/5 px-6 py-4 md:grid-cols-[1.4fr_1fr_auto]">
            <div>
              <p className="font-medium">{unit.label}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {unit.is_recurring && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px]">recurring</span>}
                {unit.is_focus && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px]">focus</span>}
                {unit.is_tracking && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px]">tracking</span>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <p className="text-ink/40">Stability</p>
                <p className="font-semibold">{unit.stability_days.toFixed(1)}d</p>
                <Bar value={unit.stability_days} max={12} className="bg-moss" />
              </div>
              <div>
                <p className="text-ink/40">Recall</p>
                <p className="font-semibold">{Math.round(unit.p_k * 100)}%</p>
                <Bar value={unit.p_k} max={1} className="bg-ink/50" />
              </div>
              <div>
                <p className="text-ink/40">Need</p>
                <p className="font-semibold">{unit.urgency.toFixed(1)}</p>
                <Bar value={unit.urgency} max={2.5} className="bg-amber-500" />
              </div>
            </div>
            <div className="text-right text-xs text-ink/45">
              <p>{unit.error_count} misses</p>
              <p>{unit.success_count} recalls</p>
            </div>
          </li>
        ))}
        {ranked.length === 0 && (
          <li className="px-6 py-8 text-sm text-ink/50">Paste a session log to start a memory trail.</li>
        )}
      </ul>
    </section>
  );
}
