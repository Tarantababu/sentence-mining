export const SECONDS_PER_DAY = 86400;
export const S_MIN = 0.25;
export const S_INIT = 1.0;
export const S_ASYMPTOTE = 60.0;
export const MISS_BASE = 0.2;
export const MISS_SURPRISE_WEIGHT = 0.55;
export const MISS_RECURRING_MULT = 1.35;
export const SUCCESS_GAIN = 0.8;
export const SHAKY_GAIN_SCALE = 0.35;
export const FOCUS_BOOST = 0.5;
export const RECURRING_BOOST = 0.4;
export const TRACKING_BOOST = 0.2;
export const REDUCTION_CAP = 0.85;
export const P_REVIEW = 0.9;

export type ReviewResult = "knew_it" | "shaky" | "missed";
export type Outcome = ReviewResult | "error" | "used_well";

export type MemorySnapshot = {
  stability_days: number;
  last_seen_at: Date | null;
  last_p: number | null;
  last_outcome: number | null;
  error_count: number;
  success_count: number;
  is_recurring: boolean;
  is_focus: boolean;
  is_tracking: boolean;
};

export type MemoryUpdate = MemorySnapshot & {
  last_p: number;
  last_outcome: number;
  p_before: number;
  s_before: number;
  delta_t_days: number;
};

export type QueueRole = "due" | "stretch" | "upcoming";

export type RankedUnit = {
  key: string;
  label: string;
  kind: string;
  skill_tags: string[];
  stability_days: number;
  p_k: number;
  urgency: number;
  is_recurring: boolean;
  is_focus: boolean;
  is_tracking: boolean;
  error_count: number;
  success_count: number;
  last_seen_at: Date | null;
  next_review_at: Date;
  due: boolean;
  queue: QueueRole;
};

export function utcnow(): Date {
  return new Date();
}

export function elapsedDays(now: Date, lastSeenAt: Date | null, forSuccess = false): number {
  if (lastSeenAt == null) return forSuccess ? S_INIT : 0;
  return Math.max(0, (now.getTime() - lastSeenAt.getTime()) / 1000 / SECONDS_PER_DAY);
}

export function recallProbability(stabilityDays: number, deltaTDays: number, seen: boolean): number {
  if (!seen) return 0;
  const stability = Math.max(stabilityDays, S_MIN);
  return Math.exp(-deltaTDays / stability);
}

export function missReduction(pK: number, isRecurring: boolean): number {
  const recurring = isRecurring ? MISS_RECURRING_MULT : 1;
  return Math.min(MISS_BASE * (1 + MISS_SURPRISE_WEIGHT * pK) * recurring, REDUCTION_CAP);
}

export function applyMiss(stabilityDays: number, pK: number, isRecurring: boolean): number {
  return Math.max(S_MIN, stabilityDays * (1 - missReduction(pK, isRecurring)));
}

export function applySuccess(stabilityDays: number, deltaTDays: number, gainScale = 1): number {
  const stability = Math.max(stabilityDays, S_MIN);
  const spacing = deltaTDays + stability ? deltaTDays / (deltaTDays + stability) : 0;
  const diminish = S_ASYMPTOTE / (S_ASYMPTOTE + stability);
  return stability * (1 + SUCCESS_GAIN * gainScale * spacing * diminish);
}

export function weight(isFocus: boolean, isRecurring: boolean, isTracking: boolean): number {
  let value = 1;
  if (isFocus) value += FOCUS_BOOST;
  if (isRecurring) value += RECURRING_BOOST;
  if (isTracking) value += TRACKING_BOOST;
  return value;
}

export function urgency(
  pK: number,
  flags: { is_focus?: boolean; is_recurring?: boolean; is_tracking?: boolean } = {},
): number {
  return weight(!!flags.is_focus, !!flags.is_recurring, !!flags.is_tracking) * (1 - pK);
}

export function reviewIntervalDays(stabilityDays: number): number {
  return Math.max(stabilityDays, S_MIN) * -Math.log(P_REVIEW);
}

export function nextReviewAt(stabilityDays: number, lastSeenAt: Date | null, now: Date): Date {
  if (!lastSeenAt) return now;
  return new Date(lastSeenAt.getTime() + reviewIntervalDays(stabilityDays) * SECONDS_PER_DAY * 1000);
}

export function queueRole(memory: MemorySnapshot, pK: number, now: Date): QueueRole {
  const neverPracticed = memory.last_seen_at == null;
  if (neverPracticed && memory.error_count > 0) return "due";
  if (memory.last_outcome === 0 && memory.error_count > 0) return "due";
  if (neverPracticed) return "stretch";
  if (pK < P_REVIEW || nextReviewAt(memory.stability_days, memory.last_seen_at, now) <= now) {
    return "due";
  }
  if (memory.is_focus || memory.is_tracking) return "stretch";
  return "upcoming";
}

export function snapshotP(memory: MemorySnapshot, now: Date): [number, number] {
  const seen = memory.last_seen_at != null;
  const delta = elapsedDays(now, memory.last_seen_at);
  return [recallProbability(memory.stability_days, delta, seen), delta];
}

export function emptyMemory(): MemorySnapshot {
  return {
    stability_days: S_INIT,
    last_seen_at: null,
    last_p: null,
    last_outcome: null,
    error_count: 0,
    success_count: 0,
    is_recurring: false,
    is_focus: false,
    is_tracking: false,
  };
}

export function applyOutcome(
  memory: MemorySnapshot,
  now: Date,
  result: Outcome,
  opts: { markRecurring?: boolean; touchLastSeen?: boolean } = {},
): MemoryUpdate {
  const isRecurring = memory.is_recurring || !!opts.markRecurring;
  const [pBefore, delta] = snapshotP(memory, now);
  const sBefore = memory.stability_days;
  let lastSeen = memory.last_seen_at;
  let errorCount = memory.error_count;
  let successCount = memory.success_count;
  let lastOutcome = memory.last_outcome;
  let newS = sBefore;

  if (result === "missed" || result === "error") {
    newS = applyMiss(sBefore, pBefore, isRecurring);
    errorCount += 1;
    lastOutcome = 0;
    if (opts.touchLastSeen) lastSeen = now;
  } else if (result === "shaky") {
    const successDelta = elapsedDays(now, lastSeen, true);
    newS = applySuccess(sBefore, successDelta, SHAKY_GAIN_SCALE);
    successCount += 1;
    lastOutcome = 1;
    lastSeen = now;
  } else {
    const successDelta = elapsedDays(now, lastSeen, true);
    newS = applySuccess(sBefore, successDelta, 1);
    successCount += 1;
    lastOutcome = 1;
    lastSeen = now;
  }

  return {
    stability_days: newS,
    last_seen_at: lastSeen,
    last_p: pBefore,
    last_outcome: lastOutcome ?? 0,
    error_count: errorCount,
    success_count: successCount,
    is_recurring: isRecurring,
    is_focus: memory.is_focus,
    is_tracking: memory.is_tracking,
    p_before: pBefore,
    s_before: sBefore,
    delta_t_days: delta,
  };
}

export function selectCardGroups(
  ranked: RankedUnit[],
  budgetCards: number,
  maxUnitsPerCard = 2,
  coverageAlpha = 1,
  wrap = true,
): RankedUnit[][] {
  let remaining = [...ranked];
  const selectedKeys = new Set<string>();
  const tagCounts: Record<string, number> = {};
  const groups: RankedUnit[][] = [];

  const penalty = (unit: RankedUnit) => {
    let value = 1;
    if (selectedKeys.has(unit.key)) value += coverageAlpha;
    value +=
      0.5 * coverageAlpha * unit.skill_tags.reduce((sum, tag) => sum + (tagCounts[tag] || 0), 0);
    return value;
  };

  const pool = [...ranked];
  while (groups.length < budgetCards) {
    if (remaining.length === 0) {
      if (!wrap) break;
      remaining = [...pool];
      if (remaining.length === 0) break;
    }
    remaining.sort((a, b) => b.urgency / penalty(b) - a.urgency / penalty(a));
    const primary = remaining.shift()!;
    let partner: RankedUnit | undefined;
    const slotsAfter = budgetCards - groups.length - 1;
    const canConsumePartner = maxUnitsPerCard > 1 && remaining.length > slotsAfter;
    if (canConsumePartner) {
      const primaryTags = new Set(primary.skill_tags);
      partner = remaining.find(
        (candidate) =>
          candidate.skill_tags.some((tag) => primaryTags.has(tag)) &&
          candidate.urgency >= 0.45 * primary.urgency,
      );
    }
    if (partner) remaining = remaining.filter((unit) => unit !== partner);
    const group = partner ? [primary, partner] : [primary];
    groups.push(group);
    for (const unit of group) {
      selectedKeys.add(unit.key);
      for (const tag of unit.skill_tags) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }
  return groups;
}

export function selectDueThenStretch(ranked: RankedUnit[], budgetCards: number): RankedUnit[][] {
  const due = ranked.filter((unit) => unit.queue === "due");
  const stretch = ranked.filter((unit) => unit.queue !== "due");
  const dueGroups = selectCardGroups(due, Math.min(budgetCards, due.length), 2, 1, false);
  const remaining = budgetCards - dueGroups.length;
  if (remaining <= 0) return dueGroups.slice(0, budgetCards);
  if (stretch.length) {
    return [...dueGroups, ...selectCardGroups(stretch, remaining, 2, 1, true)].slice(0, budgetCards);
  }
  return [...dueGroups, ...selectCardGroups(due, remaining, 2, 1, true)].slice(0, budgetCards);
}

export function rotateCardTypes(count: number): string[] {
  const cycle = ["fill_in_blank", "fix_error", "transform_sentence"] as const;
  const types: string[] = [];
  const tallies: Record<string, number> = {
    fill_in_blank: 0,
    fix_error: 0,
    transform_sentence: 0,
  };
  const cap = Math.max(1, Math.ceil(count / 2));
  let index = 0;
  while (types.length < count) {
    const candidate = cycle[index % 3];
    index += 1;
    if (tallies[candidate] >= cap) continue;
    types.push(candidate);
    tallies[candidate] += 1;
    if (index > count * 6) types.push(cycle[types.length % 3]);
  }
  return types.slice(0, count);
}
