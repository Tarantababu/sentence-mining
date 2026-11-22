import { UnitRow } from "../api";

function formatLastSeen(iso: string | null | undefined): string {
  if (!iso) return "Not practiced yet";
  const hours = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (hours < 0.5) return "Just now";
  if (hours < 20) return "Earlier today";
  if (hours < 44) return "Yesterday";
  return `${Math.round(hours / 24)} days ago`;
}

export default function UnitInspector({ units }: { units: UnitRow[] }) {
  const ranked = [...units].filter(
    (unit) => unit.error_count + unit.success_count > 0 || unit.is_focus || unit.is_tracking,
  );
  ranked.sort((a, b) => (b.due === a.due ? b.urgency - a.urgency : Number(b.due) - Number(a.due)));
  return (
    <section className="overflow-hidden rounded-3xl bg-white shadow-[0_12px_40px_rgba(18,32,28,0.06)]">
      <div className="border-b border-ink/5 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Review</p>
        <h2 className="mt-1 text-lg font-semibold">What is due</h2>
        <p className="mt-1 text-sm text-ink/50">Recall, stability, and next review from every log you have pasted.</p>
      </div>
      <ul>
        {ranked.map((unit) => (
          <li key={unit.label} className="grid gap-3 border-t border-ink/5 px-6 py-4 md:grid-cols-[1.4fr_1fr_auto]">
            <div>
              <p className="font-medium">{unit.label}</p>
              <p className="mt-1 text-xs text-ink/45">{formatLastSeen(unit.last_seen_at)}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(unit.due ?? unit.p_k < 0.9) && (
                  <span className="rounded-full bg-[#58cc02]/20 px-2 py-0.5 text-[11px] font-semibold">Due now</span>
                )}
                {unit.is_recurring && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px]">Keeps coming back</span>}
                {unit.is_focus && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px]">This week</span>}
                {unit.is_tracking && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px]">Watching</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-ink/40">Recall</p>
                <p className="font-semibold">{Math.round(unit.p_k * 100)}%</p>
              </div>
              <div>
                <p className="text-ink/40">Memory</p>
                <p className="font-semibold">{unit.stability_days.toFixed(1)} days</p>
              </div>
            </div>
            <div className="text-right text-xs text-ink/45">
              <p>{unit.error_count} misses</p>
              <p>{unit.success_count} recalls</p>
            </div>
          </li>
        ))}
        {ranked.length === 0 && (
          <li className="px-6 py-8 text-sm text-ink/50">Paste a session log to start a review queue.</li>
        )}
      </ul>
    </section>
  );
}
