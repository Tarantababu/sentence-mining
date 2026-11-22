import "server-only";

import { CATALOG, CATALOG_BY_KEY } from "./catalog";
import { asJson, readJson, sql } from "./db";
import {
  applyOutcome,
  emptyMemory,
  MemorySnapshot,
  MemoryUpdate,
  RankedUnit,
  ReviewResult,
  snapshotP,
  S_INIT,
  urgency,
  utcnow,
} from "./memory";
import { generatePack } from "./material";
import { completeJson, parsedLogSchema } from "./openai";
import {
  needsEnrichment,
  ParsedSession,
  parseSessionLog,
  parsedSessionFromLlm,
} from "./parser";
import { SAMPLE_LOG } from "./sample";

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
      defn?.label ?? label ?? key.replaceAll("_", " "),
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
  const payload = await completeJson(
    ownerId,
    "Extract language-session notes as JSON with keys errors, vocab, tracking, focus. " +
      "errors: [{raw_utterance, corrected_utterance, explanation, is_recurring}]. " +
      "vocab: [{item, example_usage, used_well}]. tracking and focus are string arrays.",
    rawLog,
    parsedLogSchema,
  );
  if (!payload) return parsed;
  const enriched = parsedSessionFromLlm(payload);
  if (!enriched.errors.length && !enriched.vocab.length) return parsed;
  return enriched;
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
      }),
      now,
    ],
  );
  const sessionId = inserted[0].id;

  await sql(
    "update unit_memories set is_focus = false, is_tracking = false where owner_id = $1",
    [ownerId],
  );

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
    let unit: UnitRow | undefined;
    if (vocab.unit_key) {
      unit = await getOrCreateUnit(vocab.unit_key, vocab.item);
      touched.add(unit.key);
    }
    await sql(
      `insert into session_vocab (session_id, unit_id, item, example_usage, used_well)
       values ($1, $2, $3, $4, $5)`,
      [sessionId, unit?.id ?? null, vocab.item, vocab.example_usage, vocab.used_well],
    );
    if (unit && vocab.used_well) {
      const row = await memoryRow(ownerId, unit.id);
      const update = applyOutcome(snapshotFromRow(row), now, "used_well", { touchLastSeen: true });
      await persistMemory(ownerId, unit.id, update);
    }
  }

  const trackingKeys = new Set<string>();
  for (const item of parsed.tracking) {
    let unit: UnitRow | undefined;
    if (item.unit_keys[0]) {
      unit = await getOrCreateUnit(item.unit_keys[0], item.text);
      trackingKeys.add(unit.key);
      touched.add(unit.key);
    }
    await sql(
      "insert into session_tracking (session_id, unit_id, text) values ($1, $2, $3)",
      [sessionId, unit?.id ?? null, item.text],
    );
    for (const key of item.unit_keys) trackingKeys.add(key);
  }

  const focusKeys = new Set(parsed.focus_unit_keys);
  for (const key of new Set([...trackingKeys, ...focusKeys])) {
    const unit = await getOrCreateUnit(key);
    touched.add(unit.key);
    const row = await memoryRow(ownerId, unit.id);
    if (!row) {
      await sql(
        `insert into unit_memories (owner_id, unit_id, stability_days, last_seen_at)
         values ($1, $2, $3, null)
         on conflict (owner_id, unit_id) do nothing`,
        [ownerId, unit.id, S_INIT],
      );
    }
    await sql(
      `update unit_memories set is_tracking = $1, is_focus = $2, updated_at = now()
       where owner_id = $3 and unit_id = $4`,
      [trackingKeys.has(key), focusKeys.has(key), ownerId, unit.id],
    );
  }

  return { sessionId, parsed };
}

async function rankUnits(ownerId: string, now: Date): Promise<RankedUnit[]> {
  const units = await sql<UnitRow>("select * from units");
  const memories = await sql<MemoryRow>("select * from unit_memories where owner_id = $1", [
    ownerId,
  ]);
  const byUnit = new Map(memories.map((row) => [row.unit_id, row]));
  const ranked: RankedUnit[] = units.map((unit) => {
    const snap = snapshotFromRow(byUnit.get(unit.id));
    const [pK] = snapshotP(snap, now);
    return {
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
    };
  });
  ranked.sort((a, b) => b.urgency - a.urgency);
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
    unit_keys: string[];
    skill_tags: string[];
    order_index: number;
  }[];
  speaking_prompts: { prompt: string; unit_keys: string[]; why: string }[];
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
        prompt: card.prompt,
        answer: card.answer,
        why: card.why,
        unit_keys: readJson<string[]>(card.unit_keys, []),
        skill_tags: readJson<string[]>(card.skill_tags, []),
        order_index: card.order_index,
      })),
    speaking_prompts: readJson(pack.speaking_prompts, []),
  };
}

export async function generateStudyPack(
  ownerId: string,
  budgetCards = 8,
  budgetPrompts = 3,
): Promise<StudyPackOut> {
  await ensureCatalog();
  const now = utcnow();
  const ranked = await rankUnits(ownerId, now);
  let active = ranked.filter((item) => item.urgency > 0 || item.key in CATALOG_BY_KEY);
  if (!active.length) active = ranked;
  const draft = await generatePack(ownerId, active, budgetCards, budgetPrompts);
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
    order_index: number;
  };
  const cards: CardRow[] = [];
  for (const [index, card] of draft.cards.entries()) {
    const rows = await sql<CardRow>(
      `insert into study_cards (study_pack_id, card_type, prompt, answer, why, unit_keys, skill_tags, order_index)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
       returning *`,
      [
        pack.id,
        card.card_type,
        card.prompt,
        card.answer,
        card.why,
        asJson(card.unit_keys),
        asJson(card.skill_tags),
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
  return {
    now: now.toISOString(),
    units: ranked.map((item) => {
      const unit = byKey.get(item.key)!;
      const snap = snapshotFromRow(byUnit.get(unit.id));
      return {
        key: item.key,
        label: item.label,
        kind: item.kind,
        skill_tags: item.skill_tags,
        is_structural: !!unit.is_structural,
        stability_days: item.stability_days,
        last_seen_at: snap.last_seen_at?.toISOString() ?? null,
        p_k: item.p_k,
        urgency: item.urgency,
        last_p: snap.last_p,
        last_outcome: snap.last_outcome,
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
    p_before: pBefore,
    s_before: sBefore,
    s_after: sAfter,
    units: Object.keys(sAfter),
  };
}

export async function seedIfNeeded(ownerId: string): Promise<void> {
  await ensureCatalog();
  const count = await sql<{ n: number }>(
    "select count(*)::int as n from sessions where owner_id = $1",
    [ownerId],
  );
  if (Number(count[0]?.n ?? 0) > 0) return;
  await ingestSession(ownerId, SAMPLE_LOG, "seed");
  await generateStudyPack(ownerId);
}
