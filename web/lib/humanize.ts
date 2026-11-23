import { CATALOG, CATALOG_BY_KEY } from "./catalog";

const SLUG = /\b[a-z]+(?:_[a-z0-9]+){1,}\b/g;

export function humanizeText(text: string): string {
  const stripped = text.replace(/^(Complete:|Fix:|Rewrite[^:]*:)\s*/i, "");
  return stripped.replace(SLUG, (match) => {
    if (match.startsWith("misc_")) return "this phrase";
    return CATALOG_BY_KEY[match]?.label ?? match;
  });
}

export function labelsForKeys(keys: string[]): string[] {
  return keys.map((key) => CATALOG_BY_KEY[key]?.label ?? key.replaceAll("_", " "));
}

export const ALL_LABELS = CATALOG.map((item) => item.label);
