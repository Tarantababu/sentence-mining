"use client";

import { UnitRow } from "../lib/client/api";
import { formatLastSeen, formatNextReview, recallLabel, stabilityLabel } from "../lib/client/srs";

type Props = {
  units: UnitRow[];
  now?: string;
};

function Chip({ children, tone }: { children: string; tone: "rose" | "amber" | "sky" }) {
  const cls =
    tone === "rose"
      ? "bg-rose-100 text-rose-900"
      : tone === "amber"
        ? "bg-amber-100 text-amber-950"
        : "bg-sky-100 text-sky-950";
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

function SkillCard({ unit, now, rank }: { unit: UnitRow; now: Date; rank?: number }) {
  return (
    <li className="rounded-[1.6rem] border border-ink/8 bg-white p-5 shadow-[0_10px_30px_rgba(18,32,28,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          {rank != null && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/35">
              {rank}. {unit.due ? "Due" : unit.queue === "stretch" ? "Stretch" : "Later"}
            </p>
          )}
          <h3 className="mt-1 font-serif text-xl font-semibold leading-snug">{unit.label}</h3>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            unit.due ? "bg-leaf text-[#123016]" : "bg-sand text-ink/70"
          }`}
        >
          {formatNextReview(unit.next_review_at, unit.due, now)}
        </span>
      </div>
      <p className="mt-3 text-sm text-ink/60">
        {recallLabel(unit.p_k)} · {stabilityLabel(unit.stability_days)} · {formatLastSeen(unit.last_seen_at, now)}
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink/10">
        <div
          className={`h-full rounded-full ${unit.due ? "bg-leaf" : "bg-moss"}`}
          style={{ width: `${Math.max(6, Math.min(100, unit.p_k * 100))}%` }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {unit.is_recurring && <Chip tone="rose">Keeps coming back</Chip>}
        {unit.is_focus && <Chip tone="amber">This week</Chip>}
        {unit.is_tracking && <Chip tone="sky">Watching</Chip>}
      </div>
    </li>
  );
}

export default function UnitInspector({ units, now }: Props) {
  const clock = now ? new Date(now) : new Date();
  const due = units.filter((unit) => unit.due);
  const rest = units.filter((unit) => !unit.due);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-white p-6 shadow-[0_18px_50px_rgba(18,32,28,0.08)] md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Review</p>
        <h2 className="mt-1 font-serif text-2xl font-semibold">What is due from every log</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/55">
          Recall fades as {due.length ? "these phrases" : "each phrase"} sit unused. Misses shorten memory;
          a clean review or “used well!” lengthens it. Practice takes due items first, then a little stretch.
        </p>
        <div className="mt-5 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-leaf/80 px-3 py-1.5 font-semibold text-[#123016]">
            {due.length} due now
          </span>
          <span className="rounded-full bg-sand px-3 py-1.5">{rest.length} coming up</span>
          <span className="rounded-full bg-sand px-3 py-1.5">{units.length} in memory</span>
        </div>
      </section>

      {due.length > 0 && (
        <section>
          <h3 className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">
            Ranked due queue
          </h3>
          <ol className="grid gap-3 md:grid-cols-2">
            {due.map((unit, index) => (
              <SkillCard key={unit.label} unit={unit} now={clock} rank={index + 1} />
            ))}
          </ol>
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <h3 className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">
            Stretch and later
          </h3>
          <ol className="grid gap-3 md:grid-cols-2">
            {rest.map((unit) => (
              <SkillCard key={unit.label} unit={unit} now={clock} />
            ))}
          </ol>
        </section>
      )}

      {units.length === 0 && (
        <section className="rounded-[2rem] bg-white p-8 text-sm text-ink/50 shadow-[0_18px_50px_rgba(18,32,28,0.08)]">
          Paste a speaking-session log to start a review queue.
        </section>
      )}
    </div>
  );
}
