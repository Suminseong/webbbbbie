import { advance, choose, createLife, getPending } from "@webbbbbie/engine";
const N = Number(process.argv[2] ?? 40),
  DAYS = Number(process.argv[3] ?? 730);
const lives: Record<string, number> = {},
  days: Record<string, number> = {};
let stressHi = 0,
  tot = 0,
  hiatus = 0;
for (let seed = 1; seed <= N; seed++) {
  let s = createLife(seed * 104729);
  const seen = new Set<string>();
  while (s.day < DAYS) {
    const p = getPending(s);
    if (p) {
      const r = choose(
        s,
        p.id,
        p.choices[(seed + s.day) % p.choices.length].id,
      );
      if (!r.ok) throw 1;
      s = r.state;
    } else s = advance(s, 1).state;
    for (const st of s.author.specialStates) {
      seen.add(st.key);
      days[st.key] = (days[st.key] ?? 0) + 1;
    }
    tot++;
    if (s.author.condition.stress >= 70) stressHi++;
    hiatus += s.works.filter((w) => w.status === "HIATUS").length;
  }
  for (const k of seen) lives[k] = (lives[k] ?? 0) + 1;
}
console.log(
  "lives with state",
  lives,
  "state-days per life",
  Object.fromEntries(
    Object.entries(days).map(([k, v]) => [k, Math.round(v / N)]),
  ),
);
console.log(
  "stress>=70 share",
  (stressHi / tot).toFixed(3),
  "hiatus work-days/life",
  Math.round(hiatus / N),
);
