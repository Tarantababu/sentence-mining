import type { z } from "zod";
import { blankFromPair } from "./cards";
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

function templateFor(unit: RankedUnit, cardType: string): [string, string, string] {
  const raw = unit.you_said?.trim() || "";
  const correct = (unit.correct || unit.label).trim();
  const why = (unit.why || "").trim() || `Keep this natural: ${correct}`;
  if (raw && correct) {
    if (cardType === "fill_in_blank") {
      const blanked = blankFromPair(raw, correct);
      return [blanked.prompt, blanked.answer, why];
    }
    if (cardType === "fix_error") {
      return [`Fix: ${raw}`, correct, why];
    }
    return [`Rewrite naturally: ${raw}`, correct, why];
  }
  const defn = CATALOG_BY_KEY[unit.key];
  if (defn && cardType in defn.templates) {
    return defn.templates[cardType as keyof typeof defn.templates];
  }
  const label = unit.label;
  if (cardType === "fill_in_blank") {
    const blanked = blankFromPair(label, label);
    return [blanked.prompt, blanked.answer, `Use the natural phrase: ${label}.`];
  }
  if (cardType === "fix_error") {
    return [`Fix: ${label}`, label, `Keep ${label} as a set phrase.`];
  }
  return [`Rewrite naturally: ${label}`, label, `Keep the surrounding English simple; target ${label}.`];
}

export function fallbackPack(
  ranked: RankedUnit[],
  budgetCards: number,
  budgetPrompts: number,
): DraftPack {
  const groups = selectDueThenStretch(ranked, budgetCards);
  const types = rotateCardTypes(groups.length);
  const cards: DraftCard[] = groups.map((group, index) => {
    const cardType = types[index];
    const primary = group[0];
    let [prompt, answer, why] = templateFor(primary, cardType);
    if (group.length === 2) why = `${why} Also keep ${group[1].label} in mind.`;
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
      unit_keys: group.map((unit) => unit.key),
      skill_tags: tags,
      queue,
    };
  });

  const prompts: DraftPrompt[] = ranked.slice(0, budgetPrompts).map((unit) => ({
    prompt: `Tell a 20-second story that naturally uses “${unit.correct || unit.label}”. Keep everything else easy.`,
    unit_keys: [unit.key],
    why: unit.why || `This phrase needs a spoken pass in a real conversation.`,
  }));
  if (budgetPrompts > prompts.length && ranked.length >= 2) {
    const pair = ranked.slice(0, 2);
    prompts.push({
      prompt: `Compare two recent situations using “${pair[0].correct || pair[0].label}” and “${pair[1].correct || pair[1].label}”.`,
      unit_keys: pair.map((unit) => unit.key),
      why: pair.map((unit) => unit.label).join(" · "),
    });
  }
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
    keptLlm = true;
    const queue = keys.some((key) => queueByKey.get(key) === "due") ? "due" : skeleton.cards[cards.length]?.queue ?? "due";
    cards.push(asDraftCard(card, keys, skillLookup, queue));
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
  const skeleton = fallbackPack(ranked, budgetCards, budgetPrompts);
  if (!ranked.length) return skeleton;
  const allowed = new Set(ranked.map((unit) => unit.key));
  const skillLookup = Object.fromEntries(ranked.map((unit) => [unit.key, unit.skill_tags]));
  const llmBudget = Math.min(LLM_CARD_CAP, budgetCards, skeleton.cards.length);
  const user = {
    units: ranked.slice(0, 16).map((unit) => ({
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
      "i+1: each card targets 1–2 weak units; surrounding English stays easy and adult.",
      "fill_in_blank: one natural sentence with _____ only on the target.",
      "fix_error: show the learner's You said line; answer is the Correct sentence.",
      "transform_sentence: ask for a rewrite; answer is the Correct sentence.",
      "Use you_said / correct / why from the units. Do not invent a different grammar point.",
      "prompt, answer, and why are human language only — never unit slugs.",
      "Keep unit_keys in JSON only. Keep card_type. Keep due cards first.",
    ],
  };
  const system =
    "You write i+1 English practice cards for an adult learner from their own speaking errors. " +
    "Prefer the learner's Correct sentence. Blank or repair only the weak point. " +
    "Never put unit slugs in prompt, answer, or why. " +
    "Return JSON {cards:[{card_type,prompt,answer,why,unit_keys}],speaking_prompts:[{prompt,unit_keys,why}]}.";
  const llm = await completeJson(ownerId, system, JSON.stringify(user), generatedPackSchema, {
    timeoutMs: 20_000,
  });
  if (llm == null) return skeleton;
  const merged = mergeLlmPack(skeleton, llm, allowed, skillLookup, budgetCards, budgetPrompts);
  return merged.cards.length ? merged : skeleton;
}
