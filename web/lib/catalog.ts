export type CardType = "fill_in_blank" | "fix_error" | "transform_sentence";

export type UnitDef = {
  key: string;
  label: string;
  kind: string;
  skill_tags: string[];
  is_structural: boolean;
  patterns: RegExp[];
  templates: Record<CardType, [string, string, string]>;
};

function t(
  fill: [string, string, string],
  fix: [string, string, string],
  transform: [string, string, string],
): Record<CardType, [string, string, string]> {
  return { fill_in_blank: fill, fix_error: fix, transform_sentence: transform };
}

export const CATALOG: UnitDef[] = [
  {
    key: "do_the_school_run",
    label: "do the school run",
    kind: "chunk",
    skill_tags: ["collocation", "chunks"],
    is_structural: true,
    patterns: [/school runn/i, /school run/i, /do the school/i],
    templates: t(
      [
        "Complete: I _____ every weekday morning with the kids.",
        "do the school run",
        "Fixed chunk: do the school run (not 'running').",
      ],
      [
        "Fix: I do the school running every morning.",
        "I do the school run every morning.",
        "'School run' is a noun chunk; don't use the -ing form here.",
      ],
      [
        "Rewrite with the chunk 'do the school run': I take the children to school each day.",
        "I do the school run each day.",
        "Prefer the set phrase over a literal paraphrase.",
      ],
    ),
  },
  {
    key: "no_point_in_ing",
    label: "no point in + -ing",
    kind: "chunk",
    skill_tags: ["collocation", "chunks", "gerund"],
    is_structural: true,
    patterns: [/no point (to|in)/i, /no point waiting/i, /point in/i],
    templates: t(
      [
        "Complete: There's no point _____ for a reply tonight. (wait)",
        "in waiting",
        "Pattern: no point in + -ing.",
      ],
      [
        "Fix: There is no point to wait.",
        "There's no point in waiting.",
        "'No point' takes in + gerund, not to-infinitive.",
      ],
      [
        "Rewrite with 'no point in': Waiting any longer is useless.",
        "There's no point in waiting any longer.",
        "Use the chunk to express futility.",
      ],
    ),
  },
  {
    key: "by_hand",
    label: "by hand",
    kind: "chunk",
    skill_tags: ["collocation", "chunks", "articles"],
    is_structural: false,
    patterns: [/by the hand/i, /by hand/i],
    templates: t(
      [
        "Complete: She made the pasta _____, not with a machine.",
        "by hand",
        "'By hand' takes no article.",
      ],
      ["Fix: I made it by the hand.", "I made it by hand.", "Zero article: by hand, by bus, by email."],
      [
        "Rewrite with 'by hand': They assembled every piece without machines.",
        "They assembled every piece by hand.",
        "Keep the set phrase; drop the article.",
      ],
    ),
  },
  {
    key: "attend_no_prep",
    label: "attend (no preposition)",
    kind: "verb_prep",
    skill_tags: ["verb-preposition", "collocation"],
    is_structural: true,
    patterns: [/attend(ed|ing)? to (the )?(meeting|class|school|conference)/i, /\battend/i],
    templates: t(
      [
        "Complete: Did you _____ the meeting on Friday? (attend / attend to)",
        "attend",
        "'Attend' a meeting/class takes no preposition.",
      ],
      [
        "Fix: I attended to the meeting.",
        "I attended the meeting.",
        "Don't add 'to' for events. 'Attend to' means 'deal with'.",
      ],
      [
        "Rewrite without a preposition after attend: She went to the conference.",
        "She attended the conference.",
        "attend + event, no to/at.",
      ],
    ),
  },
  {
    key: "schedule_meeting",
    label: "schedule a meeting for",
    kind: "verb_prep",
    skill_tags: ["verb-preposition", "collocation"],
    is_structural: false,
    patterns: [/schedul\w+ .* (on|for) friday/i, /scheduled on/i, /schedule(d)? (a )?meeting/i],
    templates: t(
      [
        "Complete: Let's schedule the meeting _____ Monday morning. (for/on)",
        "for",
        "schedule a meeting for + day/time.",
      ],
      [
        "Fix: The meeting was scheduled on Friday.",
        "The meeting is scheduled for Friday.",
        "Use 'scheduled for' with a planned time.",
      ],
      [
        "Rewrite with 'schedule for': Can we put the call on Thursday?",
        "Can we schedule the call for Thursday?",
        "schedule [event] for [time].",
      ],
    ),
  },
  {
    key: "for_free_vs_freely",
    label: "for free vs freely",
    kind: "lexical_contrast",
    skill_tags: ["lexical-contrast", "adverbs"],
    is_structural: false,
    patterns: [/for freely/i, /for free/i, /\bfreely\b/i],
    templates: t(
      [
        "Complete: Members can use the gym _____. (no payment)",
        "for free",
        "'For free' = at no cost. 'Freely' = without restriction.",
      ],
      ["Fix: I got it for freely.", "I got it for free.", "Cost → for free. Manner → freely."],
      [
        "Rewrite to mean 'at no cost': They gave us the extra night without charging.",
        "They gave us the extra night for free.",
        "Don't swap in the adverb 'freely'.",
      ],
    ),
  },
  {
    key: "rather_not_vs_wouldnt_prefer",
    label: "I'd rather not vs wouldn't prefer",
    kind: "lexical_contrast",
    skill_tags: ["lexical-contrast", "preferences"],
    is_structural: true,
    patterns: [/wouldn'?t prefer/i, /rather not/i, /would prefer not/i],
    templates: t(
      [
        "Complete: I'd _____ stay in tonight. (rather not / wouldn't prefer)",
        "rather not",
        "Natural preference: I'd rather not + verb.",
      ],
      [
        "Fix: I wouldn't prefer to go.",
        "I'd rather not go.",
        "'Wouldn't prefer' is awkward; use 'I'd rather not'.",
      ],
      [
        "Rewrite with 'rather not': I wouldn't prefer to discuss it now.",
        "I'd rather not discuss it now.",
        "Keep rather + not + base verb.",
      ],
    ),
  },
  {
    key: "articles_a_the_zero",
    label: "articles: a / the / zero",
    kind: "grammar",
    skill_tags: ["articles", "grammar"],
    is_structural: true,
    patterns: [/by the bus/i, /to the school/i, /to school/i, /\bthe\b/i, /\barticles?\b/i],
    templates: t(
      [
        "Complete: I went _____ school by _____. (institution / transport)",
        "to school / by bus",
        "Zero article with institutions as activities and with by + transport.",
      ],
      [
        "Fix: I went to school by the bus.",
        "I went to school by bus.",
        "'By bus/train/car' takes zero article.",
      ],
      [
        "Rewrite with zero article where needed: She takes the kids to the school by the bus.",
        "She takes the kids to school by bus.",
        "Activity/institution and by-transport drop the.",
      ],
    ),
  },
];

export const CATALOG_BY_KEY = Object.fromEntries(CATALOG.map((item) => [item.key, item]));

const FOCUS_MAP: [RegExp, string[]][] = [
  [/verb[- ]prep|collocation/i, ["attend_no_prep", "schedule_meeting"]],
  [/rather not|prefer/i, ["rather_not_vs_wouldnt_prefer"]],
  [/article/i, ["articles_a_the_zero"]],
  [/chunk|school run|by hand|no point/i, ["do_the_school_run", "by_hand", "no_point_in_ing"]],
  [/free/i, ["for_free_vs_freely"]],
];

const TRACKING_MAP: [RegExp, string[]][] = [
  [/attend/i, ["attend_no_prep"]],
  [/article|transport|institution/i, ["articles_a_the_zero"]],
  [/schedule/i, ["schedule_meeting"]],
  [/point in/i, ["no_point_in_ing"]],
  [/school run/i, ["do_the_school_run"]],
  [/by hand/i, ["by_hand"]],
  [/rather|prefer/i, ["rather_not_vs_wouldnt_prefer"]],
  [/free/i, ["for_free_vs_freely"]],
];

function searchMap(patterns: [RegExp, string[]][], text: string): string[] {
  const keys: string[] = [];
  for (const [pattern, mapped] of patterns) {
    if (pattern.test(text)) {
      for (const key of mapped) if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

export function matchUnitKey(...texts: string[]): string | null {
  const blob = texts.filter(Boolean).join(" ");
  for (const item of CATALOG) {
    for (const pattern of item.patterns) {
      if (pattern.test(blob)) return item.key;
    }
  }
  return null;
}

export function matchFocusKeys(text: string): string[] {
  return searchMap(FOCUS_MAP, text);
}

export function matchTrackingKeys(text: string): string[] {
  return searchMap(TRACKING_MAP, text);
}

export function slugFromPhrase(phrase: string): string {
  const cleaned = phrase.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "misc").slice(0, 48);
}
