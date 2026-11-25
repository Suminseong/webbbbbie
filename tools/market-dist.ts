import {
  advance,
  choose,
  createLife,
  getPending,
  getWorkViews,
} from "@webbbbbie/engine";
const N = Number(process.argv[2] ?? 60),
  DAYS = Number(process.argv[3] ?? 900);
const rows: { views: number; ch: number; end?: string }[] = [];
for (let seed = 1; seed <= N; seed++) {
  let s = createLife(seed * 7919);
  while (s.day < DAYS && s.phase !== "ENDED") {
    const p = getPending(s);
    if (p) {
      const r = choose(
        s,
        p.id,
        p.choices[(seed + s.day) % p.choices.length].id,
      );
      if (!r.ok) throw 1;
      s = r.state;
    } else s = advance(s, DAYS - s.day).state;
  }
  for (const w of getWorkViews(s))
    rows.push({ views: w.totalViews, ch: w.published, end: w.end?.reason });
}
const q = (a: number[], p: number) =>
  a.sort((x, y) => x - y)[Math.floor(a.length * p)];
const all = rows.map((r) => r.views),
  h = rows.filter((r) => r.ch >= 100).map((r) => r.views);
console.log(
  "works",
  rows.length,
  "views p25/50/75/90/99",
  [0.25, 0.5, 0.75, 0.9, 0.99].map((p) => q([...all], p)),
);
console.log(
  "100ch works",
  h.length,
  "views p25/50/75/90/99",
  [0.25, 0.5, 0.75, 0.9, 0.99].map((p) => q([...h], p)),
);
console.log("100ch buckets <500,<1k,<5k,<20k,<100k,>=100k", cnt(h));
console.log("dropped/other ended", rows.filter((r) => r.end).length);
