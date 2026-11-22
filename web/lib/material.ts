import type { z } from "zod";
import { CATALOG_BY_KEY } from "./catalog";
import { RankedUnit, rotateCardTypes, selectCardGroups } from "./memory";
import { completeJson, generatedPackSchema } from "./openai";

export type DraftCard = {
  card_type: string;
  prompt: string;
  answer: string;
  why: string;
  unit_keys: string[];
  skill_tags: string[];
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
    return [`Complete the natural phrase for: ${label}.`, label, `Target unit: ${label}.`];
  }
  if (cardType === "fix_error") {
    return [`Fix the sentence so it uses ${label} correctly.`, label, `Focus on ${label}.`];
  }
  return [
    `Rewrite a short everyday sentence that uses ${label}.`,
    label,
    `Keep the surrounding English simple; target ${label}.`,
  ];
}

export function fallbackPack(
  ranked: RankedUnit[],
  budgetCards: number,
  budgetPrompts: number,
): DraftPack {
  const groups = selectCardGroups(ranked, budgetCards);
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
    return {
      card_type: cardType,
      prompt,
      answer,
      why,
      unit_keys: group.map((unit) => unit.key),
      skill_tags: tags,
    };
  });

  const prompts: DraftPrompt[] = ranked.slice(0, budgetPrompts).map((unit) => ({
    prompt: `Next session: tell a 20-second story that naturally uses “${unit.label}”. Keep everything else easy.`,
    unit_keys: [unit.key],
    why: `Speak this unit because urgency is high (${unit.urgency.toFixed(2)}).`,
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
      key: unit.key,
      label: unit.label,
      kind: unit.kind,
      urgency: Number(unit.urgency.toFixed(4)),
      p_k: Number(unit.p_k.toFixed(4)),
    })),
    skeleton_cards: skeleton.cards.map((card) => ({
      card_type: card.card_type,
      unit_keys: card.unit_keys,
      prompt: card.prompt,
      answer: card.answer,
      why: card.why,
    })),
    budget_cards: budgetCards,
    budget_prompts: budgetPrompts,
    constraints: [
      "Each card targets 1-2 of the provided unit keys only.",
      "Surrounding English must be natural, adult, and i+1 (easy except the target).",
      "Preserve card_type and the intended answer meaning.",
      "Return JSON: cards[], speaking_prompts[].",
    ],
  };
  const system =
    "You write short i+1 English practice cards for an adult learner. " +
    "Return only JSON matching the schema {cards:[{card_type,prompt,answer,why,unit_keys}]," +
    "speaking_prompts:[{prompt,unit_keys,why}]}.";
  const llm = await completeJson(ownerId, system, JSON.stringify(user), generatedPackSchema);
  if (llm == null) return skeleton;
  const validated = validateLlmPack(llm, allowed, budgetCards, budgetPrompts, skillLookup);
  if (validated == null || validated.cards.length < skeleton.cards.length) return skeleton;
  if (validated.speaking_prompts.length < Math.min(budgetPrompts, 1) && budgetPrompts) {
    validated.speaking_prompts = skeleton.speaking_prompts;
    validated.generator = "openai";
  }
  return validated;
}
