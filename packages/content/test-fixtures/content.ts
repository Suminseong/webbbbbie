import { defaultContent, parseContent } from "../src/index";

export function withEvents(...eventIds: string[]) {
  const content = structuredClone(defaultContent);
  content.events = content.events.filter(
    (event) =>
      ["ORIGIN", "FALLBACK"].includes(event.tier) ||
      eventIds.includes(event.id),
  );
  return parseContent(content);
}
