/** Weekly posting cadences exposed to the player. */
export const cadences = [
  { perWeek: 1, mask: 1 },
  { perWeek: 2, mask: 17 },
  { perWeek: 3, mask: 21 },
  { perWeek: 4, mask: 85 },
  { perWeek: 5, mask: 31 },
  { perWeek: 6, mask: 63 },
  { perWeek: 7, mask: 127 },
] as const;

export const maskCadence = (mask: number) =>
  cadences.reduce((best, item) =>
    Math.abs(item.mask - mask) < Math.abs(best.mask - mask) ? item : best,
  ).perWeek;
