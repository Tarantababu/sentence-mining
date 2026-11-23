import type { z } from "zod";
import {
  blankFromPair,
  canPractice,
  isDistinctPair,
  isDummyCarrier,
  isValidIPlus1Card,
  wordCount,
} from "./cards";
import { CATALOG_BY_KEY } from "./catalog";
import { RankedUnit, rotateCardTypes, selectDueThenStretch } from "./memory";
import { completeJson, generatedPackSchema } from "./openai";

export type DraftCard = {
  card_type: string;
  prompt: string;
  answer: string;
  why: string;
  unit_keys: string[];
  skill_tags: string[];
  queue: "due" | "stretch";
};

export type DraftPrompt = {
  prompt: string;
  unit_keys: string[];
  why: string;
};

export type DraftPack = {
  cards: DraftCard[];
  speaking_prompts: DraftPrompt[];
  generator: "openai" | "fallback";
};

const LLM_CARD_CAP = 8;

function practiceable(ranked: RankedUnit[]): RankedUnit[] {
  return ranked.filter((unit) => canPractice(unit, unit.key in CATALOG_BY_KEY));
}

function templateFor(unit: RankedUnit, cardType: string): [string, string, string] {
  const raw = unit.you_said?.trim() || "";
  const correct = (unit.correct || unit.label).trim();
  const why = (unit.why || "").trim() || "Say the corrected line the way a native speaker would.";
  if (isDistinctPair(raw, correct)) {
    if (cardType === "fill_in_blank") {
      const blanked = blankFromPair(raw, correct);
      return [blanked.prompt, blanked.answer, why];
    }
    if (cardType === "fix_error") {
      return [raw, correct, why];
    }
    return [raw, correct, why];
  }
  const defn = CATALOG_BY_KEY[unit.key];
  if (defn && cardType in defn.templates) {
    return defn.templates[cardType as keyof typeof defn.templates];
  }
  const phrase = correct || unit.label;
  const blanked = blankFromPair(phrase, phrase);
  return [blanked.prompt, blanked.answer, `Use this naturally: ${phrase}.`];
}

export function fallbackPack(
  ranked: RankedUnit[],
  budgetCards: number,
  budgetPrompts: number,
): DraftPack {
  const usable = practiceable(ranked);
  const groups = selectDueThenStretch(usable, budgetCards);
  const types = rotateCardTypes(groups.length);
  const cards: DraftCard[] = groups.map((group, index) => {
    const cardType = types[index];
    const primary = group[0];
    let [prompt, answer, why] = templateFor(primary, cardType);
    const partner = group[1];
    if (partner && wordCount(partner.label) <= 6) {
      why = `${why} Also keep ${partner.label} in mind.`;
    }
    const tags: string[] = [];
    for (const unit of group) {
      for (const tag of unit.skill_tags) if (!tags.includes(tag)) tags.push(tag);
    }
    const queue = group.some((unit) => unit.queue === "due") ? "due" : "stretch";
    return {
      card_type: cardType,
      prompt,
      answer,
      why,
      unit_keys: partner && wordCount(partner.label) <= 6 ? group.map((unit) => unit.key) : [primary.key],
      skill_tags: tags,
      queue,
    };
  });

  const spoken = usable.length ? usable : ranked;
  const prompts: DraftPrompt[] = spoken.slice(0, budgetPrompts).map((unit) => {
    const target = (unit.correct || unit.label).trim();
    return {
      prompt: isDistinctPair(unit.you_said || "", target)
        ? `Say this naturally: “${target}”. Start from what you actually said: “${unit.you_said}”.`
        : `Tell a 20-second story that naturally uses “${target}”. Keep everything else easy.`,
      unit_keys: [unit.key],
      why: unit.why || "This needs a spoken pass in a real conversation.",
    };
  });
  return { cards, speaking_prompts: prompts.slice(0, budgetPrompts), generator: "fallback" };
}

function asDraftCard(
  card: z.output<typeof generatedPackSchema>["cards"][number],
  keys: string[],
  skillLookup: Record<string, string[]>,
  queue: "due" | "stretch",
): DraftCard {
  const tags: string[] = [];
  for (const key of keys) {
    for (const tag of skillLookup[key] || []) if (!tags.includes(tag)) tags.push(tag);
  }
  return {
    card_type: card.card_type,
    prompt: card.prompt.trim(),
    answer: card.answer.trim(),
    why: card.why.trim(),
    unit_keys: keys,
    skill_tags: tags,
    queue,
  };
}

function mergeLlmPack(
  skeleton: DraftPack,
  payload: z.output<typeof generatedPackSchema>,
  allowedKeys: Set<string>,
  skillLookup: Record<string, string[]>,
  byKey: Record<string, RankedUnit>,
  budgetCards: number,
  budgetPrompts: number,
): DraftPack {
  const used = new Set<string>();
  const cards: DraftCard[] = [];
  let keptLlm = false;
  const queueByKey = new Map(skeleton.cards.map((card) => [card.unit_keys[0], card.queue]));
  for (const card of payload.cards) {
    if (cards.length >= budgetCards) break;
    const keys = card.unit_keys.filter((key) => allowedKeys.has(key)).slice(0, 2);
    if (!keys.length) continue;
    const source = byKey[keys[0]];
    const drafted = asDraftCard(
      card,
      keys,
      skillLookup,
      keys.some((key) => queueByKey.get(key) === "due") ? "due" : skeleton.cards[cards.length]?.queue ?? "due",
    );
    if (!isValidIPlus1Card(drafted, source)) continue;
    keptLlm = true;
    cards.push(drafted);
    for (const key of keys) used.add(key);
  }
  for (const card of skeleton.cards) {
    if (cards.length >= budgetCards) break;
    if (card.unit_keys.every((key) => used.has(key))) continue;
    cards.push(card);
    for (const key of card.unit_keys) used.add(key);
  }
  const prompts: DraftPrompt[] = [];
  for (const item of payload.speaking_prompts.slice(0, budgetPrompts)) {
    const keys = item.unit_keys.filter((key) => allowedKeys.has(key)).slice(0, 2);
    if (!keys.length) continue;
    if (isDummyCarrier(item.prompt) || isDummyCarrier(item.why || "")) continue;
    prompts.push({ prompt: item.prompt.trim(), unit_keys: keys, why: (item.why || "").trim() });
  }
  if (prompts.length < Math.min(budgetPrompts, 1)) {
    return {
      cards,
      speaking_prompts: skeleton.speaking_prompts,
      generator: keptLlm ? "openai" : "fallback",
    };
  }
  return {
    cards,
    speaking_prompts: prompts.slice(0, budgetPrompts),
    generator: keptLlm ? "openai" : "fallback",
  };
}

export async function generatePack(
  ownerId: string,
  ranked: RankedUnit[],
  budgetCards = 8,
  budgetPrompts = 3,
): Promise<DraftPack> {
  const usable = practiceable(ranked);
  const skeleton = fallbackPack(ranked, budgetCards, budgetPrompts);
  if (!usable.length) return skeleton;
  const allowed = new Set(usable.map((unit) => unit.key));
  const skillLookup = Object.fromEntries(usable.map((unit) => [unit.key, unit.skill_tags]));
  const byKey = Object.fromEntries(usable.map((unit) => [unit.key, unit]));
  const llmBudget = Math.min(LLM_CARD_CAP, budgetCards, skeleton.cards.length);
  const user = {
    units: usable.slice(0, 16).map((unit) => ({
      key: unit.key,
      label: unit.label,
      kind: unit.kind,
      you_said: unit.you_said || "",
      correct: unit.correct || unit.label,
      why: unit.why || "",
      urgency: Number(unit.urgency.toFixed(4)),
      p_k: Number(unit.p_k.toFixed(4)),
      queue: unit.queue,
      due: unit.due,
      recurring: unit.is_recurring,
      focus: unit.is_focus,
    })),
    skeleton_cards: skeleton.cards.slice(0, llmBudget).map((card) => ({
      card_type: card.card_type,
      unit_keys: card.unit_keys,
      prompt: card.prompt,
      answer: card.answer,
      why: card.why,
      queue: card.queue,
    })),
    budget_cards: llmBudget,
    budget_prompts: budgetPrompts,
    constraints: [
      "i+1: each card targets 1–2 weak points. Surrounding English stays easy and adult.",
      "If you_said and correct exist, the card IS that pair. Do not invent a new sentence around them.",
      "Never wrap a learner sentence inside another sentence. Forbidden: 'I will mention … in a short everyday sentence'.",
      "fill_in_blank: one natural sentence with _____ only on the 1–3 word target. Answer is only those missing words.",
      "fix_error: prompt is the You said line; answer is the Correct line.",
      "transform_sentence: prompt is the You said line; answer is the Correct line.",
      "prompt, answer, and why are human language only — never unit slugs.",
      "Keep unit_keys in JSON only. Keep card_type. Keep due cards first.",
    ],
  };
  const system =
    "You write i+1 English practice cards from the learner's own speaking errors. " +
    "The practice item must be the learner's sentence with one small gap or fix — never a dummy carrier. " +
    "Never put unit slugs in prompt, answer, or why. " +
    "Return JSON {cards:[{card_type,prompt,answer,why,unit_keys}],speaking_prompts:[{prompt,unit_keys,why}]}.";
  const llm = await completeJson(ownerId, system, JSON.stringify(user), generatedPackSchema, {
    timeoutMs: 20_000,
  });
  if (llm == null) return skeleton;
  const merged = mergeLlmPack(skeleton, llm, allowed, skillLookup, byKey, budgetCards, budgetPrompts);
  return merged.cards.length ? merged : skeleton;
}
