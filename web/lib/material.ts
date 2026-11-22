import type { z } from "zod";
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

function templateFor(unit: RankedUnit, cardType: string): [string, string, string] {
  const defn = CATALOG_BY_KEY[unit.key];
  if (defn && cardType in defn.templates) {
    return defn.templates[cardType as keyof typeof defn.templates];
  }
  const label = unit.label;
  if (cardType === "fill_in_blank") {
    return [`I need to _____ before dinner.`, label, `Use the natural phrase: ${label}.`];
  }
  if (cardType === "fix_error") {
    return [`Fix: I did ${label} wrong in that sentence.`, `I used ${label} correctly.`, `Keep ${label} as a set phrase.`];
  }
  return [
    `Rewrite: I will mention ${label} in a short everyday sentence.`,
    `I'll use ${label} in a short everyday sentence.`,
    `Keep the surrounding English simple; target ${label}.`,
  ];
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
    prompt: `Next session: tell a 20-second story that naturally uses “${unit.label}”. Keep everything else easy.`,
    unit_keys: [unit.key],
    why: `This phrase needs a spoken pass in a real conversation.`,
  }));
  if (budgetPrompts > prompts.length && ranked.length >= 2) {
    const pair = ranked.slice(0, 2);
    prompts.push({
      prompt: `Next session: compare two recent situations using “${pair[0].label}” and “${pair[1].label}”.`,
      unit_keys: pair.map((unit) => unit.key),
      why: pair.map((unit) => unit.label).join(" · "),
    });
  }
  return { cards, speaking_prompts: prompts.slice(0, budgetPrompts), generator: "fallback" };
}

function validateLlmPack(
  payload: z.output<typeof generatedPackSchema>,
  allowedKeys: Set<string>,
  budgetCards: number,
  budgetPrompts: number,
  skillLookup: Record<string, string[]>,
): DraftPack | null {
  const cards: DraftCard[] = [];
  for (const card of payload.cards.slice(0, budgetCards)) {
    const keys = card.unit_keys.filter((key) => allowedKeys.has(key)).slice(0, 2);
    if (!keys.length) return null;
    const tags: string[] = [];
    for (const key of keys) {
      for (const tag of skillLookup[key] || []) if (!tags.includes(tag)) tags.push(tag);
    }
    cards.push({
      card_type: card.card_type,
      prompt: card.prompt.trim(),
      answer: card.answer.trim(),
      why: card.why.trim(),
      unit_keys: keys,
      skill_tags: tags,
      queue: index < payload.cards.length / 2 ? "due" : "stretch",
    });
  }
  if (!cards.length || cards.length !== Math.min(budgetCards, payload.cards.length)) return null;
  const prompts: DraftPrompt[] = [];
  for (const item of payload.speaking_prompts.slice(0, budgetPrompts)) {
    const keys = item.unit_keys.filter((key) => allowedKeys.has(key));
    if (!keys.length) continue;
    prompts.push({ prompt: item.prompt.trim(), unit_keys: keys, why: (item.why || "").trim() });
  }
  return { cards, speaking_prompts: prompts, generator: "openai" };
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
  const user = {
    units: ranked.slice(0, 20).map((unit) => ({
      label: unit.label,
      kind: unit.kind,
      urgency: Number(unit.urgency.toFixed(4)),
      p_k: Number(unit.p_k.toFixed(4)),
      queue: unit.queue,
      due: unit.due,
    })),
    skeleton_cards: skeleton.cards.map((card) => ({
      card_type: card.card_type,
      unit_keys: card.unit_keys,
      prompt: card.prompt,
      answer: card.answer,
      why: card.why,
      queue: card.queue,
    })),
    budget_cards: budgetCards,
    budget_prompts: budgetPrompts,
    constraints: [
      "Each card is a full natural English sentence: fill-in-the-blank, a sentence to fix, or a sentence to rewrite.",
      "prompt, answer, and why must be human language only — never unit slugs such as attend_no_prep.",
      "Keep unit_keys in the JSON field only, never inside the sentence.",
      "Keep skeleton order: due reviews first, then i+1 stretch. One or two targets per card.",
      "Surrounding English must be adult i+1 (easy except the target).",
      "Preserve card_type and the intended answer meaning.",
    ],
  };
  const system =
    "You write short i+1 English sentence cards for an adult learner. " +
    "Each prompt is a natural sentence, never a debug label. " +
    "Never put unit slugs in prompt, answer, or why. " +
    "Return only JSON matching {cards:[{card_type,prompt,answer,why,unit_keys}]," +
    "speaking_prompts:[{prompt,unit_keys,why}]}.";
  const llm = await completeJson(ownerId, system, JSON.stringify(user), generatedPackSchema);
  if (llm == null) return skeleton;
  const validated = validateLlmPack(llm, allowed, budgetCards, budgetPrompts, skillLookup);
  if (validated == null || validated.cards.length < skeleton.cards.length) return skeleton;
  for (const [index, card] of validated.cards.entries()) {
    card.queue = skeleton.cards[index]?.queue ?? card.queue;
  }
  if (validated.speaking_prompts.length < Math.min(budgetPrompts, 1) && budgetPrompts) {
    validated.speaking_prompts = skeleton.speaking_prompts;
    validated.generator = "openai";
  }
  return validated;
}
