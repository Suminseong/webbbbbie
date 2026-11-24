import originals from "../text.ko.json";
import overrides from "../text-edits.ko.json";

export const originalTexts: Readonly<Record<string, string>> = originals;
export const appliedTexts: Readonly<Record<string, string>> = overrides;
export type TextVariables = Record<string, string | number>;

const token = /\{\{([a-z][a-z0-9_]*)\}\}/g;
export const textIdPattern = /^[a-z][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)+$/;

export function variablesIn(template: string) {
  return Array.from(template.matchAll(token), (match) => match[1]).sort();
}

export function textIssue(source: string, replacement: string): string | null {
  if (!replacement.trim()) return "EMPTY_TEXT";
  if (/\{\{|\}\}/.test(replacement.replace(token, "")))
    return "MALFORMED_VARIABLE";
  if (variablesIn(source).join(",") !== variablesIn(replacement).join(",")) {
    return "VARIABLE_MISMATCH";
  }
  return null;
}

export function sourceText(id: string): string {
  if (!Object.hasOwn(originalTexts, id))
    throw new Error("Unknown text_id: " + id);
  return originalTexts[id];
}

export function textTemplate(id: string, edits = appliedTexts): string {
  const source = sourceText(id);
  if (!Object.hasOwn(edits, id)) return source;
  return edits[id];
}

export function text(id: string, values: TextVariables = {}): string {
  return textTemplate(id).replace(token, (_, key: string) => {
    if (!Object.hasOwn(values, key))
      throw new Error("Missing template variable " + key + " for " + id);
    return String(values[key]);
  });
}

// A custom simulation fixture may supply its own wording. Catalog edits are
// applied only to the registered original, never to a fixture's text or key.
export function matchingText(id: string, original: string): string {
  return Object.hasOwn(originalTexts, id) && originalTexts[id] === original
    ? text(id)
    : original;
}

const displayIds = new Map<string, Map<string, string>>();
for (const [id, value] of Object.entries(originalTexts)) {
  const group = id.split(".").slice(0, 2).join(".");
  if (!group.startsWith("entity.") && group !== "label.aptitude-grade")
    continue;
  const entries = displayIds.get(group) ?? new Map();
  entries.set(value, id);
  displayIds.set(group, entries);
}

export function displayName(group: string, original: string): string {
  const id = displayIds.get(group)?.get(original);
  return id ? text(id) : original;
}

export function displayWorkTitle(original: string): string {
  const exact = displayIds.get("entity.work")?.get(original);
  if (exact) return text(exact);
  const duplicate = /^(.+)( · \d+)$/.exec(original);
  return duplicate
    ? displayName("entity.work", duplicate[1]) + duplicate[2]
    : original;
}
