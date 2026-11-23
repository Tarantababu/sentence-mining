"use client";

import { DeckStats, StudyCard, UnitRow } from "../lib/client/api";
import { CARD_TYPE_LABEL } from "../lib/client/grade";
import { formatLastSeen, formatNextReview, recallLabel, stabilityLabel } from "../lib/client/srs";

type Props = {
  units: UnitRow[];
  dueCards: StudyCard[];
  stats?: DeckStats | null;
  now?: string;
  busy?: boolean;
  onReviewDue: (startIndex?: number) => void;
  onStretch?: () => void;
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

function StatTile({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  return (
    <div className="rounded-[1.4rem] border border-ink/8 bg-white px-4 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/40">{label}</p>
      <p className="mt-1 font-serif text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-ink/50">{hint}</p>
    </div>
  );
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

export default function UnitInspector({ units, dueCards, stats, now, busy, onReviewDue, onStretch }: Props) {
  const clock = now ? new Date(now) : new Date();
  const due = units.filter((unit) => unit.due);
  const rest = units.filter((unit) => !unit.due);
  const dailyDone = stats?.remaining_today === 0;
  const newCount = stats?.new ?? due.filter((unit) => !unit.last_seen_at).length;
  const reviewCount = stats?.review ?? due.filter((unit) => unit.last_seen_at && unit.success_count > 0).length;
  const learnCount = stats?.learning ?? Math.max(0, due.length - reviewCount);
  const barTotal = Math.max(1, newCount + learnCount + reviewCount);

  return (
    <div className="space-y-6">
      {stats && (
        <>
          <section className="rounded-[2rem] bg-white p-6 shadow-[0_18px_50px_rgba(18,32,28,0.08)] md:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Today</p>
            <h2 className="mt-1 font-serif text-2xl font-semibold">Daily practice</h2>
            <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-ink/10">
              <div className="bg-leaf" style={{ width: `${(reviewCount / barTotal) * 100}%` }} />
              <div className="bg-rose-500" style={{ width: `${(learnCount / barTotal) * 100}%` }} />
              <div className="bg-sky-500" style={{ width: `${(newCount / barTotal) * 100}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <span>
                <span className="font-semibold text-leaf">{reviewCount}</span> review
              </span>
              <span>
                <span className="font-semibold text-rose-600">{learnCount}</span> learn
              </span>
              <span>
                <span className="font-semibold text-sky-600">{newCount}</span> new
              </span>
            </div>
            <p className="mt-4 text-sm text-ink/60">
              {stats.reps_today} reps today
              {stats.daily_limit == null
                ? " · unlimited"
                : ` · ${stats.remaining_today ?? 0} of ${stats.daily_limit} left`}
              {" · "}
              {stats.knew_it_today} knew it · {stats.shaky_today} almost · {stats.missed_today} not yet
            </p>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="In the database" value={stats.total_items} hint="Every phrase stored" />
            <StatTile label="Learning now" value={stats.learning_now} hint="Due and stretch items" />
            <StatTile label="Waiting" value={stats.waiting} hint="Not in the deck yet" />
            <StatTile label="Learnt" value={stats.learnt} hint="Stable, not due" />
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <StatTile label="Reps today" value={stats.reps_today} hint="Reviews submitted today" />
            <StatTile label="Reps total" value={stats.reps_total} hint="All reviews on this account" />
          </section>
        </>
      )}

      <section className="rounded-[2rem] bg-white p-6 shadow-[0_18px_50px_rgba(18,32,28,0.08)] md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Review first</p>
        <h2 className="mt-1 font-serif text-2xl font-semibold">
          {due.length ? `${due.length} due now` : "Nothing due"}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/55">
          These are the phrases that need a pass before anything new. Review them first; stretch cards wait
          until this queue is clear.
        </p>
        {dailyDone && (
          <p className="mt-3 text-sm text-ink/70">Daily limit reached. Raise it in Settings, or come back tomorrow.</p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            className="rounded-2xl bg-leaf px-5 py-3 text-sm font-bold text-[#123016] disabled:opacity-50"
            onClick={() => onReviewDue(0)}
            disabled={busy || due.length === 0 || dailyDone}
          >
            {busy ? "Building…" : due.length ? "Review due first" : "Nothing due"}
          </button>
          {onStretch && rest.length > 0 && due.length === 0 && !dailyDone && (
            <button
              className="rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
              onClick={onStretch}
              disabled={busy}
            >
              Try a stretch
            </button>
          )}
          <span className="rounded-full bg-sand px-3 py-1.5 text-sm">{rest.length} later</span>
        </div>
      </section>

      {dueCards.length > 0 && (
        <section className="rounded-[2rem] bg-white p-6 shadow-[0_18px_50px_rgba(18,32,28,0.08)] md:p-8">
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Due sentences</h3>
          <p className="mt-1 text-sm text-ink/55">Open any item to start the queue at that sentence.</p>
          <ol className="mt-5 space-y-2">
            {dueCards.map((card, index) => (
              <li key={card.id}>
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 rounded-2xl border border-ink/8 bg-sand/70 px-4 py-3 text-left transition hover:border-moss/40 hover:bg-white"
                  onClick={() => onReviewDue(index)}
                  disabled={busy || dailyDone}
                >
                  <span className="min-w-0">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/40">
                      {index + 1}. {CARD_TYPE_LABEL[card.card_type] ?? "Sentence"}
                    </span>
                    <span className="mt-1 block font-medium leading-snug">
                      {card.prompt.replace(/^(Complete:|Fix:|Rewrite[^:]*:)\s*/i, "")}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-leaf px-3 py-1 text-xs font-semibold text-[#123016]">
                    Review
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

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
            After the due queue
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
