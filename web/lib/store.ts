import "server-only";

import { CATALOG, CATALOG_BY_KEY, keysForLine, matchFocusKeys, phraseUnitKey } from "./catalog";
import { asJson, readJson, sql } from "./db";
import {
  applyOutcome,
  emptyMemory,
  MemorySnapshot,
  MemoryUpdate,
  nextReviewAt,
  queueRole,
  RankedUnit,
  ReviewResult,
  snapshotP,
  S_INIT,
  urgency,
  utcnow,
} from "./memory";
import { humanizeText } from "./humanize";
import { generatePack } from "./material";
import { completeJson, parsedLogSchema } from "./openai";
import {
  LOG_ENRICH_SYSTEM,
  mergeParsedSessions,
  needsEnrichment,
  ParsedSession,
  parseSessionLog,
  parsedSessionFromLlm,
} from "./parser";
import { getViewerSettings } from "./secrets";

type UnitRow = {
  id: number;
  key: string;
  label: string;
  kind: string;
  skill_tags: unknown;
  is_structural: boolean;
};

type MemoryRow = {
  owner_id: string;
  unit_id: number;
  stability_days: number;
  last_seen_at: Date | string | null;
  last_p: number | null;
  last_outcome: number | null;
  error_count: number;
  success_count: number;
  is_recurring: boolean;
  is_focus: boolean;
  is_tracking: boolean;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function snapshotFromRow(row: MemoryRow | undefined): MemorySnapshot {
  if (!row) return emptyMemory();
  return {
    stability_days: Number(row.stability_days),
    last_seen_at: asDate(row.last_seen_at),
    last_p: row.last_p == null ? null : Number(row.last_p),
    last_outcome: row.last_outcome,
    error_count: Number(row.error_count),
    success_count: Number(row.success_count),
    is_recurring: !!row.is_recurring,
    is_focus: !!row.is_focus,
    is_tracking: !!row.is_tracking,
  };
}

export async function ensureCatalog(): Promise<void> {
  for (const item of CATALOG) {
    await sql(
      `insert into units (key, label, kind, skill_tags, is_structural)
       values ($1, $2, $3, $4::jsonb, $5)
       on conflict (key) do nothing`,
      [item.key, item.label, item.kind, asJson(item.skill_tags), item.is_structural],
    );
  }
}

async function getOrCreateUnit(key: string, label?: string, kind = "chunk"): Promise<UnitRow> {
  const existing = await sql<UnitRow>("select * from units where key = $1", [key]);
  if (existing[0]) return existing[0];
  const defn = CATALOG_BY_KEY[key];
  const inserted = await sql<UnitRow>(
    `insert into units (key, label, kind, skill_tags, is_structural)
     values ($1, $2, $3, $4::jsonb, $5)
     on conflict (key) do update set key = excluded.key
     returning *`,
    [
      key,
      defn?.label ?? label ?? key.replace(/^item_/, "").replaceAll("_", " "),
      defn?.kind ?? kind,
      asJson(defn?.skill_tags ?? ["misc"]),
      defn?.is_structural ?? false,
    ],
  );
  return inserted[0];
}

async function memoryRow(ownerId: string, unitId: number): Promise<MemoryRow | undefined> {
  const rows = await sql<MemoryRow>(
    "select * from unit_memories where owner_id = $1 and unit_id = $2",
    [ownerId, unitId],
  );
  return rows[0];
}

async function persistMemory(ownerId: string, unitId: number, update: MemoryUpdate): Promise<void> {
  await sql(
    `insert into unit_memories (
       owner_id, unit_id, stability_days, last_seen_at, last_p, last_outcome,
       error_count, success_count, is_recurring, is_focus, is_tracking, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     on conflict (owner_id, unit_id) do update set
       stability_days = excluded.stability_days,
       last_seen_at = excluded.last_seen_at,
       last_p = excluded.last_p,
       last_outcome = excluded.last_outcome,
       error_count = excluded.error_count,
       success_count = excluded.success_count,
       is_recurring = excluded.is_recurring,
       is_focus = excluded.is_focus,
       is_tracking = excluded.is_tracking,
       updated_at = now()`,
    [
      ownerId,
      unitId,
      update.stability_days,
      update.last_seen_at,
      update.last_p,
      update.last_outcome,
      update.error_count,
      update.success_count,
      update.is_recurring,
      update.is_focus,
      update.is_tracking,
    ],
  );
}

async function parseWithOptionalEnrichment(ownerId: string, rawLog: string): Promise<ParsedSession> {
  const parsed = parseSessionLog(rawLog);
  if (!needsEnrichment(parsed, rawLog)) return parsed;
  const payload = await completeJson(ownerId, LOG_ENRICH_SYSTEM, rawLog, parsedLogSchema);
  if (!payload) return parsed;
  const enriched = parsedSessionFromLlm(payload);
  if (!enriched.errors.length && !enriched.vocab.length) return parsed;
  return mergeParsedSessions(parsed, enriched);
}

export async function ingestSession(
  ownerId: string,
  rawLog: string,
  source = "paste",
): Promise<{ sessionId: number; parsed: ParsedSession }> {
  await ensureCatalog();
  const now = utcnow();
  const parsed = await parseWithOptionalEnrichment(ownerId, rawLog);
  const inserted = await sql<{ id: number }>(
    `insert into sessions (owner_id, raw_log, source, focus_next_lesson, parsed_payload, ingested_at)
     values ($1, $2, $3, $4, $5::jsonb, $6)
     returning id`,
    [
      ownerId,
      rawLog,
      source,
      parsed.focus_lines.join("\n") || null,
      asJson({
        parser: parsed.parser,
        errors: parsed.errors,
        vocab: parsed.vocab,
        tracking: parsed.tracking,
        focus: parsed.focus_lines,
        focus_unit_keys: parsed.focus_unit_keys,
      }),
      now,
    ],
  );
  const sessionId = inserted[0].id;

  const touched = new Set<string>();

  for (const error of parsed.errors) {
    const unit = await getOrCreateUnit(error.unit_key, error.corrected_utterance);
    touched.add(unit.key);
    await sql(
      `insert into session_errors (session_id, unit_id, raw_utterance, corrected_utterance, explanation, is_recurring)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        sessionId,
        unit.id,
        error.raw_utterance,
        error.corrected_utterance,
        error.explanation,
        error.is_recurring,
      ],
    );
    const row = await memoryRow(ownerId, unit.id);
    const update = applyOutcome(snapshotFromRow(row), now, "error", {
      markRecurring: error.is_recurring || unit.is_structural,
      touchLastSeen: false,
    });
    await persistMemory(ownerId, unit.id, update);
  }

  for (const vocab of parsed.vocab) {
    const unit = await getOrCreateUnit(vocab.unit_key, vocab.item);
    touched.add(unit.key);
    await sql(
      `insert into session_vocab (session_id, unit_id, item, example_usage, used_well)
       values ($1, $2, $3, $4, $5)`,
      [sessionId, unit.id, vocab.item, vocab.example_usage, vocab.used_well],
    );
    if (vocab.used_well) {
      const row = await memoryRow(ownerId, unit.id);
      const update = applyOutcome(snapshotFromRow(row), now, "used_well", { touchLastSeen: true });
      await persistMemory(ownerId, unit.id, update);
    }
  }

  const trackingKeys = new Set<string>();
  for (const item of parsed.tracking) {
    const unit = await getOrCreateUnit(item.unit_keys[0] || item.text, item.text);
    trackingKeys.add(unit.key);
    touched.add(unit.key);
    await sql(
      "insert into session_tracking (session_id, unit_id, text) values ($1, $2, $3)",
      [sessionId, unit.id, item.text],
    );
    for (const key of item.unit_keys) trackingKeys.add(key);
  }

  for (const key of trackingKeys) {
    const unit = await getOrCreateUnit(key);
    touched.add(unit.key);
  }

  await rebuildFlagsFromHistory(ownerId);
  return { sessionId, parsed };
}

async function rebuildFlagsFromHistory(ownerId: string): Promise<void> {
  const orphanVocab = await sql<{ id: number; item: string; example_usage: string }>(
    `select v.id, v.item, v.example_usage
     from session_vocab v
     join sessions s on s.id = v.session_id
     where s.owner_id = $1 and v.unit_id is null`,
    [ownerId],
  );
  for (const row of orphanVocab) {
    const unit = await getOrCreateUnit(phraseUnitKey(row.item, row.example_usage), row.item);
    await sql("update session_vocab set unit_id = $1 where id = $2", [unit.id, row.id]);
  }
  const orphanTracking = await sql<{ id: number; text: string }>(
    `select t.id, t.text
     from session_tracking t
     join sessions s on s.id = t.session_id
     where s.owner_id = $1 and t.unit_id is null`,
    [ownerId],
  );
  for (const row of orphanTracking) {
    const unit = await getOrCreateUnit(phraseUnitKey(row.text), row.text);
    await sql("update session_tracking set unit_id = $1 where id = $2", [unit.id, row.id]);
  }

  await sql(
    "update unit_memories set is_focus = false, is_tracking = false where owner_id = $1",
    [ownerId],
  );
  const errorStats = await sql<{ unit_id: number; n: number; flagged: boolean }>(
    `select e.unit_id, count(*)::int as n, bool_or(e.is_recurring) as flagged
     from session_errors e
     join sessions s on s.id = e.session_id
     where s.owner_id = $1
     group by e.unit_id`,
    [ownerId],
  );
  for (const row of errorStats) {
    const recurring = Boolean(row.flagged) || Number(row.n) > 1;
    await sql(
      `update unit_memories set is_recurring = $1, updated_at = now()
       where owner_id = $2 and unit_id = $3`,
      [recurring, ownerId, row.unit_id],
    );
  }

  const tracking = await sql<{ unit_id: number }>(
    `select distinct unit_id from (
       select t.unit_id
       from session_tracking t
       join sessions s on s.id = t.session_id
       where s.owner_id = $1 and t.unit_id is not null
       union
       select v.unit_id
       from session_vocab v
       join sessions s on s.id = v.session_id
       where s.owner_id = $1 and v.unit_id is not null and v.used_well = false
     ) tracked`,
    [ownerId],
  );
  for (const row of tracking) {
    const existing = await memoryRow(ownerId, row.unit_id);
    if (!existing) {
      await sql(
        `insert into unit_memories (owner_id, unit_id, stability_days, last_seen_at, is_tracking)
         values ($1, $2, $3, null, true)
         on conflict (owner_id, unit_id) do nothing`,
        [ownerId, row.unit_id, S_INIT],
      );
    }
    await sql(
      `update unit_memories set is_tracking = true, updated_at = now()
       where owner_id = $1 and unit_id = $2`,
      [ownerId, row.unit_id],
    );
  }

  const history = await sql<{ parsed_payload: unknown; focus_next_lesson: string | null }>(
    "select parsed_payload, focus_next_lesson from sessions where owner_id = $1",
    [ownerId],
  );
  const focusKeys = new Set<string>();
  for (const session of history) {
    const payload = readJson<{
      focus?: string[];
      focus_unit_keys?: string[];
    }>(session.parsed_payload, {});
    for (const key of payload.focus_unit_keys ?? []) focusKeys.add(key);
    for (const line of payload.focus ?? []) {
      for (const key of keysForLine(line, matchFocusKeys(line))) focusKeys.add(key);
    }
    if (session.focus_next_lesson) {
      for (const key of keysForLine(session.focus_next_lesson, matchFocusKeys(session.focus_next_lesson))) {
        focusKeys.add(key);
      }
    }
  }
  for (const key of focusKeys) {
    const unit = await getOrCreateUnit(key, key.replace(/^item_/, "").replaceAll("_", " "));
    const existing = await memoryRow(ownerId, unit.id);
    if (!existing) {
      await sql(
        `insert into unit_memories (owner_id, unit_id, stability_days, last_seen_at)
         values ($1, $2, $3, null)
         on conflict (owner_id, unit_id) do nothing`,
        [ownerId, unit.id, S_INIT],
      );
    }
    await sql(
      `update unit_memories set is_focus = true, updated_at = now()
       where owner_id = $1 and unit_id = $2`,
      [ownerId, unit.id],
    );
  }
}

function isTracked(snap: MemorySnapshot): boolean {
  return snap.error_count + snap.success_count > 0 || snap.is_focus || snap.is_tracking || snap.is_recurring;
}

async function rankUnits(ownerId: string, now: Date): Promise<RankedUnit[]> {
  const units = await sql<UnitRow>("select * from units");
  const memories = await sql<MemoryRow>("select * from unit_memories where owner_id = $1", [
    ownerId,
  ]);
  const byUnit = new Map(memories.map((row) => [row.unit_id, row]));
  const ranked: RankedUnit[] = [];
  for (const unit of units) {
    const snap = snapshotFromRow(byUnit.get(unit.id));
    if (!isTracked(snap)) continue;
    const [pK] = snapshotP(snap, now);
    const queue = queueRole(snap, pK, now);
    ranked.push({
      key: unit.key,
      label: unit.label,
      kind: unit.kind,
      skill_tags: readJson<string[]>(unit.skill_tags, []),
      stability_days: snap.stability_days,
      p_k: pK,
      urgency: urgency(pK, {
        is_focus: snap.is_focus,
        is_recurring: snap.is_recurring,
        is_tracking: snap.is_tracking,
      }),
      is_recurring: snap.is_recurring,
      is_focus: snap.is_focus,
      is_tracking: snap.is_tracking,
      error_count: snap.error_count,
      success_count: snap.success_count,
      last_seen_at: snap.last_seen_at,
      next_review_at: nextReviewAt(snap.stability_days, snap.last_seen_at, now),
      due: queue === "due",
      queue,
    });
  }
  ranked.sort((a, b) => {
    const order = { due: 0, stretch: 1, upcoming: 2 };
    if (order[a.queue] !== order[b.queue]) return order[a.queue] - order[b.queue];
    if (a.queue === "due") return b.urgency - a.urgency;
    return a.next_review_at.getTime() - b.next_review_at.getTime() || b.urgency - a.urgency;
  });
  return ranked;
}

export type StudyPackOut = {
  id: number;
  generated_at: string;
  budget_cards: number;
  budget_prompts: number;
  generator: string;
    cards: {
    id: number;
    card_type: string;
    prompt: string;
    answer: string;
    why: string;
    queue: "due" | "stretch";
    order_index: number;
  }[];
  speaking_prompts: { prompt: string; why: string }[];
};

function packFromRows(
  pack: {
    id: number;
    generated_at: Date | string;
    budget_cards: number;
    budget_prompts: number;
    generator: string;
    speaking_prompts: unknown;
  },
  cards: {
    id: number;
    card_type: string;
    prompt: string;
    answer: string;
    why: string;
    unit_keys: unknown;
    skill_tags: unknown;
    queue?: string | null;
    order_index: number;
  }[],
): StudyPackOut {
  return {
    id: pack.id,
    generated_at: asDate(pack.generated_at)?.toISOString() || new Date().toISOString(),
    budget_cards: pack.budget_cards,
    budget_prompts: pack.budget_prompts,
    generator: pack.generator,
    cards: cards
      .slice()
      .sort((a, b) => a.order_index - b.order_index)
      .map((card) => ({
        id: card.id,
        card_type: card.card_type,
        prompt: humanizeText(card.prompt),
        answer: humanizeText(card.answer),
        why: humanizeText(card.why),
        queue: card.queue === "stretch" ? "stretch" : "due",
        order_index: card.order_index,
      })),
    speaking_prompts: readJson<{ prompt: string; unit_keys?: string[]; why: string }[]>(
      pack.speaking_prompts,
      [],
    ).map((item) => ({
      prompt: humanizeText(item.prompt),
      why: humanizeText(item.why),
    })),
  };
}

export type SessionLogOut = {
  id: number;
  ingested_at: string;
  source: string;
  error_count: number;
  preview: string;
};

export async function listSessionLogs(ownerId: string): Promise<SessionLogOut[]> {
  const rows = await sql<{
    id: number;
    ingested_at: Date | string;
    source: string;
    raw_log: string;
    error_count: number;
  }>(
    `select s.id, s.ingested_at, s.source, s.raw_log,
            (select count(*)::int from session_errors e where e.session_id = s.id) as error_count
     from sessions s
     where s.owner_id = $1
     order by s.ingested_at desc, s.id desc`,
    [ownerId],
  );
  return rows.map((row) => ({
    id: row.id,
    ingested_at: asDate(row.ingested_at)?.toISOString() ?? "",
    source: row.source,
    error_count: Number(row.error_count),
    preview: row.raw_log.replace(/\s+/g, " ").trim().slice(0, 180),
  }));
}

export async function getSessionLog(
  ownerId: string,
  sessionId: number,
): Promise<(SessionLogOut & { raw_log: string }) | null> {
  const rows = await sql<{
    id: number;
    ingested_at: Date | string;
    source: string;
    raw_log: string;
    error_count: number;
  }>(
    `select s.id, s.ingested_at, s.source, s.raw_log,
            (select count(*)::int from session_errors e where e.session_id = s.id) as error_count
     from sessions s
     where s.owner_id = $1 and s.id = $2`,
    [ownerId, sessionId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    ingested_at: asDate(row.ingested_at)?.toISOString() ?? "",
    source: row.source,
    error_count: Number(row.error_count),
    preview: row.raw_log.replace(/\s+/g, " ").trim().slice(0, 180),
    raw_log: row.raw_log,
  };
}

export async function countReviewsToday(ownerId: string): Promise<{
  total: number;
  knew_it: number;
  shaky: number;
  missed: number;
  all_time: number;
}> {
  const today = await sql<{
    total: number;
    knew_it: number;
    shaky: number;
    missed: number;
  }>(
    `select count(*)::int as total,
            count(*) filter (where result = 'knew_it')::int as knew_it,
            count(*) filter (where result = 'shaky')::int as shaky,
            count(*) filter (where result = 'missed')::int as missed
     from reviews
     where owner_id = $1 and submitted_at >= date_trunc('day', now())`,
    [ownerId],
  );
  const all = await sql<{ n: number }>(
    "select count(*)::int as n from reviews where owner_id = $1",
    [ownerId],
  );
  const row = today[0];
  return {
    total: Number(row?.total ?? 0),
    knew_it: Number(row?.knew_it ?? 0),
    shaky: Number(row?.shaky ?? 0),
    missed: Number(row?.missed ?? 0),
    all_time: Number(all[0]?.n ?? 0),
  };
}

export async function remainingDailyBudget(ownerId: string, requested?: number): Promise<number> {
  const { daily_limit } = await getViewerSettings(ownerId);
  const { total } = await countReviewsToday(ownerId);
  if (daily_limit == null) {
    return requested ?? Number.POSITIVE_INFINITY;
  }
  const leftover = Math.max(0, daily_limit - total);
  if (requested == null) return leftover;
  return Math.min(requested, leftover);
}

export type DeckStats = {
  total_items: number;
  learning_now: number;
  waiting: number;
  learnt: number;
  due: number;
  new: number;
  learning: number;
  review: number;
  stretch: number;
  reps_today: number;
  reps_total: number;
  knew_it_today: number;
  shaky_today: number;
  missed_today: number;
  daily_limit: number | null;
  remaining_today: number | null;
};

export async function deckStats(ownerId: string): Promise<DeckStats> {
  await ensureCatalog();
  const now = utcnow();
  const totalRows = await sql<{ n: number }>("select count(*)::int as n from units");
  const totalItems = Number(totalRows[0]?.n ?? 0);
  const ranked = await rankUnits(ownerId, now);
  const due = ranked.filter((unit) => unit.due);
  const stretch = ranked.filter((unit) => unit.queue === "stretch");
  const newCount = due.filter((unit) => unit.last_seen_at == null).length;
  const review = due.filter((unit) => unit.last_seen_at != null && unit.success_count > 0).length;
  const learning = Math.max(0, due.length - review);
  const learnt = ranked.filter(
    (unit) => unit.queue === "upcoming" && unit.success_count > 0 && unit.p_k >= 0.9,
  ).length;
  const learningNow = ranked.filter((unit) => unit.due || unit.queue === "stretch").length;
  const waiting = Math.max(0, totalItems - ranked.length);
  const reps = await countReviewsToday(ownerId);
  const { daily_limit } = await getViewerSettings(ownerId);
  return {
    total_items: totalItems,
    learning_now: learningNow,
    waiting,
    learnt,
    due: due.length,
    new: newCount,
    learning,
    review,
    stretch: stretch.length,
    reps_today: reps.total,
    reps_total: reps.all_time,
    knew_it_today: reps.knew_it,
    shaky_today: reps.shaky,
    missed_today: reps.missed,
    daily_limit,
    remaining_today: daily_limit == null ? null : Math.max(0, daily_limit - reps.total),
  };
}

export async function generateStudyPack(
  ownerId: string,
  budgetCards?: number,
  budgetPrompts = 3,
  opts: { dueOnly?: boolean; stretchOnly?: boolean } = {},
): Promise<StudyPackOut> {
  await ensureCatalog();
  const now = utcnow();
  let ranked = await rankUnits(ownerId, now);
  if (opts.dueOnly) {
    ranked = ranked.filter((unit) => unit.due);
  } else if (opts.stretchOnly) {
    ranked = ranked.filter((unit) => !unit.due);
  }
  const allowed = await remainingDailyBudget(ownerId, budgetCards);
  const capped = Number.isFinite(allowed) ? allowed : ranked.length;
  budgetCards = ranked.length ? Math.min(Math.max(0, Math.floor(capped)), ranked.length) : 0;
  if (!ranked.length || budgetCards === 0) {
    budgetPrompts = 0;
  }
  const draft = await generatePack(ownerId, ranked, budgetCards, budgetPrompts);
  const inserted = await sql<{
    id: number;
    generated_at: Date | string;
    budget_cards: number;
    budget_prompts: number;
    generator: string;
    speaking_prompts: unknown;
  }>(
    `insert into study_packs (owner_id, generated_at, budget_cards, budget_prompts, generator, speaking_prompts)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     returning *`,
    [
      ownerId,
      now,
      budgetCards,
      budgetPrompts,
      draft.generator,
      asJson(draft.speaking_prompts),
    ],
  );
  const pack = inserted[0];
  type CardRow = {
    id: number;
    card_type: string;
    prompt: string;
    answer: string;
    why: string;
    unit_keys: unknown;
    skill_tags: unknown;
    queue?: string | null;
    order_index: number;
  };
  const cards: CardRow[] = [];
  for (const [index, card] of draft.cards.entries()) {
    const rows = await sql<CardRow>(
      `insert into study_cards (study_pack_id, card_type, prompt, answer, why, unit_keys, skill_tags, queue, order_index)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
       returning *`,
      [
        pack.id,
        card.card_type,
        card.prompt,
        card.answer,
        card.why,
        asJson(card.unit_keys),
        asJson(card.skill_tags),
        card.queue,
        index,
      ],
    );
    cards.push(rows[0]);
  }
  return packFromRows(pack, cards);
}

export async function latestStudyPack(ownerId: string): Promise<StudyPackOut | null> {
  const packs = await sql<{
    id: number;
    generated_at: Date | string;
    budget_cards: number;
    budget_prompts: number;
    generator: string;
    speaking_prompts: unknown;
  }>(
    `select * from study_packs where owner_id = $1
     order by generated_at desc, id desc limit 1`,
    [ownerId],
  );
  if (!packs[0]) return null;
  const cards = await sql<{
    id: number;
    card_type: string;
    prompt: string;
    answer: string;
    why: string;
    unit_keys: unknown;
    skill_tags: unknown;
    order_index: number;
  }>("select * from study_cards where study_pack_id = $1 order by order_index", [packs[0].id]);
  return packFromRows(packs[0], cards);
}

export async function listUnits(ownerId: string) {
  await ensureCatalog();
  const now = utcnow();
  const ranked = await rankUnits(ownerId, now);
  const units = await sql<UnitRow>("select * from units");
  const byKey = new Map(units.map((unit) => [unit.key, unit]));
  const memories = await sql<MemoryRow>("select * from unit_memories where owner_id = $1", [
    ownerId,
  ]);
  const byUnit = new Map(memories.map((row) => [row.unit_id, row]));
  const dueCount = ranked.filter((item) => item.due).length;
  const stats = await deckStats(ownerId);
  return {
    now: now.toISOString(),
    due_count: dueCount,
    stats,
    units: ranked.map((item) => {
      const unit = byKey.get(item.key)!;
      const snap = snapshotFromRow(byUnit.get(unit.id));
      return {
        label: item.label,
        kind: item.kind,
        stability_days: item.stability_days,
        last_seen_at: snap.last_seen_at?.toISOString() ?? null,
        next_review_at: item.next_review_at.toISOString(),
        p_k: item.p_k,
        due: item.due,
        queue: item.queue,
        error_count: snap.error_count,
        success_count: snap.success_count,
        is_recurring: item.is_recurring,
        is_focus: item.is_focus,
        is_tracking: item.is_tracking,
      };
    }),
  };
}

export async function submitReview(ownerId: string, cardId: number, result: ReviewResult) {
  const cards = await sql<{
    id: number;
    unit_keys: unknown;
    study_pack_id: number;
  }>(
    `select c.id, c.unit_keys, c.study_pack_id
     from study_cards c
     join study_packs p on p.id = c.study_pack_id
     where c.id = $1 and p.owner_id = $2`,
    [cardId, ownerId],
  );
  const card = cards[0];
  if (!card) return null;
  const now = utcnow();
  const pBefore: Record<string, number> = {};
  const sBefore: Record<string, number> = {};
  const sAfter: Record<string, number> = {};
  for (const key of readJson<string[]>(card.unit_keys, [])) {
    const unit = (await sql<UnitRow>("select * from units where key = $1", [key]))[0];
    if (!unit) continue;
    const row = await memoryRow(ownerId, unit.id);
    const update = applyOutcome(snapshotFromRow(row), now, result, { touchLastSeen: true });
    await persistMemory(ownerId, unit.id, update);
    pBefore[key] = update.p_before;
    sBefore[key] = update.s_before;
    sAfter[key] = update.stability_days;
  }
  const inserted = await sql<{ id: number }>(
    `insert into reviews (owner_id, card_id, result, submitted_at, p_before, s_before, s_after)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
     returning id`,
    [ownerId, card.id, result, now, asJson(pBefore), asJson(sBefore), asJson(sAfter)],
  );
  return {
    review_id: inserted[0].id,
    card_id: card.id,
    result,
  };
}

export async function seedIfNeeded(ownerId: string): Promise<void> {
  await ensureCatalog();
}
