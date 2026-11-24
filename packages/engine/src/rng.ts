export const stream = {
  CREATION: 0,
  EVENT: 1,
  TARGET: 2,
  ROUTINE: 3,
  WRITING: 4,
  EXPOSURE: 5,
  READERS: 6,
  ECONOMY: 7,
  APTITUDE: 8,
} as const;

export function rand(
  seed: number,
  day: number,
  system: number,
  index: number,
): number {
  let bits =
    seed ^
    Math.imul(day, 0x9e3779b9) ^
    Math.imul(system, 0x85ebca6b) ^
    Math.imul(index, 0xc2b2ae35);
  bits = Math.imul(bits ^ (bits >>> 16), 0x7feb352d);
  bits = Math.imul(bits ^ (bits >>> 15), 0x846ca68b);
  return ((bits ^ (bits >>> 16)) >>> 0) / 4294967296;
}

export function fingerprint(text: string): string {
  let result = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    result = Math.imul(result ^ text.charCodeAt(i), 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

export function pick<T>(items: readonly T[], roll: number): T {
  return items[Math.floor(roll * items.length)];
}

export function weighted<T>(
  items: readonly T[],
  getWeight: (item: T) => number,
  roll: number,
): T {
  let point = roll * items.reduce((total, item) => total + getWeight(item), 0);
  for (const item of items) {
    point -= getWeight(item);
    if (point < 0) return item;
  }
  return items[items.length - 1];
}
