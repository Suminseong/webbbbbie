import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  defaultContent,
  eventCategories,
  parseContent,
} from "@webbbbbie/content";
import {
  advance,
  confirmNewWork,
  getPendingNewWork,
  choose,
  createLife,
  deserialize,
  getAptitudeView,
  getAuthorView,
  getContractViews,
  getDailySummary,
  getEventLog,
  getLedgerView,
  getPending,
  getWorkViews,
  serialize,
} from "@webbbbbie/engine";
import type { LifeState } from "@webbbbbie/engine";
import { catalogRows } from "./text-catalog";

function run(seed: number, days: number, decisions?: string[]): LifeState {
  return drive(createLife(seed), days, decisions);
}

type ChoicePolicy = "first" | "mixed";

function drive(
  initial: LifeState,
  days: number,
  decisions?: string[],
  policy: ChoicePolicy = "first",
): LifeState {
  let state = initial;
  let index = 0;
  while (state.day < days || state.pending?.day === 0 || state.pendingNewWork) {
    const newWork = getPendingNewWork(state);
    if (newWork) {
      const made = confirmNewWork(state, newWork.id, newWork.defaultPlan);
      if (!made.ok) throw new Error(made.reason);
      state = made.state;
      continue;
    }
    const waiting = getPending(state);
    if (waiting) {
      // "mixed" picks a reproducible option from the seed and day, so balance
      // samples cover every branch instead of only the first listed one.
      const pickIndex =
        policy === "mixed"
          ? (Math.imul(state.seed ^ waiting.day, 0x9e3779b1) >>> 0) %
            waiting.choices.length
          : 0;
      const choice = decisions
        ? decisions[index]
        : waiting.choices[pickIndex].id;
      if (!choice)
        throw new Error("Replay is missing a choice for " + waiting.id);
      const result = choose(state, waiting.id, choice);
      if (!result.ok) throw new Error(result.error + " " + waiting.id);
      state = result.state;
      index += 1;
    } else {
      state = advance(state, days - state.day).state;
    }
  }
  return state;
}

function validate() {
  const data = parseContent(defaultContent);
  const byCategory = Object.fromEntries(
    eventCategories.map((category) => [
      category,
      data.events.filter((item) => item.category === category).length,
    ]),
  );
  const unique = data.events.length;
  const target = data.policies.minimumReleaseEvents;
  console.log(
    "Content valid: " +
      (unique - 1) +
      " daily events, 1 origin, " +
      data.platforms.length +
      " platforms, " +
      data.world.jobs.length +
      " jobs, " +
      data.specials.length +
      " special states, " +
      catalogRows().length +
      " text resources.",
  );
  console.log(
    JSON.stringify({
      uniqueEvents: unique,
      releaseTarget: target,
      remaining: Math.max(0, target - unique),
      byCategory,
      choiceEvents: data.events.filter((item) => item.choices).length,
      followUps: data.events.filter((item) => item.tier === "FOLLOW_UP").length,
    }),
  );
}

function replayDigest(state: LifeState) {
  // Preserve event ordering, targets and timestamps in the golden. UX wording
  // can change independently of the simulation that emitted these events.
  const log = state.log.map((entry) => ({ ...entry, message: "" }));
  return createHash("sha256")
    .update(serialize({ ...state, log }))
    .digest("hex");
}

const quantile = (sorted: readonly number[], q: number) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
    : 0;
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

/**
 * Balance profile over a seed sample. Each life is stepped one day at a time
 * and every choice takes the first listed option, so the sample is
 * reproducible from (seeds, days) alone.
 */
function profile(seedCount = 100, days = 730, policy: ChoicePolicy = "mixed") {
  const gaps: number[] = [];
  const categoryCount = new Map<string, number>();
  const tierCount = new Map<string, number>();
  const eventTotals = new Map<string, number>();
  const eventSeeds = new Map<string, number>();
  const seedsWith = {
    multiwork: 0,
    forcedHiatus: 0,
    completed: 0,
    contract: 0,
    rushed: 0,
    dropped: 0,
    takedown: 0,
  };
  const perSeed = {
    endCash: [] as number[],
    works: [] as number[],
    completed: [] as number[],
    topShare: [] as number[],
    distinct: [] as number[],
  };
  const stressDays = { total: 0, high: 0, sum: 0 };
  const bounds = {
    negativeReaders: 0,
    overCapacity: 0,
    overPaid: 0,
    minCash: Infinity,
    maxCash: -Infinity,
    maxDailyReaders: 0,
  };
  const examples: Record<string, number | null> = {
    multiwork: null,
    forcedHiatus: null,
    completed: null,
    contract: null,
    rushed: null,
    takedown: null,
  };
  const categoryOf = (id: string) =>
    (
      defaultContent.events.find((entry) => entry.id === id) as
        { category?: string } | undefined
    )?.category ?? "uncategorized";
  for (let seed = 0; seed < seedCount; seed += 1) {
    let state = drive(createLife(seed), 0, undefined, policy);
    let multi = false;
    while (state.day < days) {
      state = drive(state, state.day + 1, undefined, policy);
      if (
        state.works.filter(
          (work) =>
            work.status === "SERIAL_FREE" ||
            work.status === "SERIAL_PAID" ||
            work.status === "HIATUS",
        ).length >= 2
      )
        multi = true;
      const { stress } = state.author.condition;
      stressDays.total += 1;
      stressDays.sum += stress;
      if (stress >= 77) stressDays.high += 1;
      bounds.minCash = Math.min(bounds.minCash, state.author.cash);
      bounds.maxCash = Math.max(bounds.maxCash, state.author.cash);
      const byPlatform = new Map<string, number>();
      for (const work of state.works) {
        if (
          [...work.readers.flat(), ...work.caughtUp, work.stats.views].some(
            (n) => n < 0 || !Number.isFinite(n),
          )
        )
          bounds.negativeReaders += 1;
        if (work.revenue.paid > work.revenue.accrued) bounds.overPaid += 1;
        byPlatform.set(
          work.platformId,
          (byPlatform.get(work.platformId) ?? 0) + work.stats.newReaders,
        );
      }
      for (const [id, total] of byPlatform) {
        const platform = defaultContent.platforms.find(
          (entry) => entry.id === id,
        )!;
        bounds.maxDailyReaders = Math.max(bounds.maxDailyReaders, total);
        if (
          total >
          platform.visitors * defaultContent.balance.market.reach + 1e-6
        )
          bounds.overCapacity += 1;
      }
    }
    const seen = new Map<string, number>();
    let last = 0;
    for (const [day, [id, , choice]] of state.archive.entries()) {
      if (day === 0) continue;
      seen.set(id, (seen.get(id) ?? 0) + 1);
      eventTotals.set(id, (eventTotals.get(id) ?? 0) + 1);
      if (seen.get(id) === 1) eventSeeds.set(id, (eventSeeds.get(id) ?? 0) + 1);
      const def = defaultContent.events.find((entry) => entry.id === id)!;
      tierCount.set(def.tier, (tierCount.get(def.tier) ?? 0) + 1);
      categoryCount.set(
        categoryOf(id),
        (categoryCount.get(categoryOf(id)) ?? 0) + 1,
      );
      if (choice !== null) {
        if (last > 0) gaps.push(day - last);
        last = day;
      }
    }
    const daily = days;
    const top = Math.max(
      ...[...seen.entries()]
        .filter(([id]) => id !== "fallback")
        .map(([, n]) => n),
      0,
    );
    perSeed.topShare.push(top / daily);
    perSeed.distinct.push(seen.size);
    perSeed.works.push(state.works.length);
    perSeed.endCash.push(state.author.cash);
    const ended = (reason: string) =>
      state.works.filter((work) => work.end?.reason === reason).length;
    perSeed.completed.push(ended("COMPLETED"));
    const flags: [keyof typeof seedsWith, boolean][] = [
      ["multiwork", multi],
      ["forcedHiatus", (state.eventCount["event:forced-hiatus"] ?? 0) > 0],
      ["completed", ended("COMPLETED") > 0],
      ["contract", state.contracts.length > 0],
      ["rushed", ended("RUSHED_END") > 0],
      ["dropped", ended("DROPPED") > 0],
      ["takedown", ended("TAKEN_DOWN") > 0],
    ];
    for (const [key, hit] of flags) {
      if (!hit) continue;
      seedsWith[key] += 1;
      if (key in examples && examples[key] === null) examples[key] = seed;
    }
  }
  gaps.sort((a, b) => a - b);
  const mean = (values: number[]) =>
    values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const totalEvents = [...eventTotals.values()].reduce((a, b) => a + b, 0);
  const topEvents = [...eventTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, n]) => ({ id, share: round(n / totalEvents, 3) }));
  console.log(
    JSON.stringify(
      {
        sample: { seeds: seedCount, days, choicePolicy: policy },
        choiceInterval: {
          count: gaps.length,
          p25: quantile(gaps, 0.25),
          median: quantile(gaps, 0.5),
          p75: quantile(gaps, 0.75),
        },
        seedsWith,
        exampleSeeds: examples,
        perSeed: {
          worksMean: round(mean(perSeed.works)),
          completedMean: round(mean(perSeed.completed)),
          distinctEventsMean: round(mean(perSeed.distinct)),
          topEventShareMean: round(mean(perSeed.topShare), 3),
          endCash: (() => {
            const sorted = [...perSeed.endCash].sort((a, b) => a - b);
            return {
              p10: quantile(sorted, 0.1),
              median: quantile(sorted, 0.5),
              p90: quantile(sorted, 0.9),
              max: sorted[sorted.length - 1],
            };
          })(),
        },
        stress: {
          mean: round(stressDays.sum / stressDays.total),
          highShare: round(stressDays.high / stressDays.total, 3),
        },
        bounds: {
          ...bounds,
          maxDailyReaders: Math.round(bounds.maxDailyReaders),
        },
        tiers: Object.fromEntries(
          [...tierCount.entries()].map(([k, v]) => [
            k,
            round(v / totalEvents, 3),
          ]),
        ),
        categories: Object.fromEntries(
          [...categoryCount.entries()].map(([k, v]) => [
            k,
            round(v / totalEvents, 3),
          ]),
        ),
        topEvents,
        // Coverage: events that never fired, and the rarest that did (seeds hit).
        coverage: (() => {
          const daily = defaultContent.events.filter(
            (entry) => entry.tier !== "ORIGIN",
          );
          const never = daily
            .filter((entry) => !eventTotals.has(entry.id))
            .map((entry) => entry.id);
          const rare = daily
            .filter((entry) => eventTotals.has(entry.id))
            .map((entry) => ({
              id: entry.id,
              seeds: eventSeeds.get(entry.id) ?? 0,
            }))
            .sort((a, b) => a.seeds - b.seeds)
            .slice(0, 10);
          return { fired: daily.length - never.length, never, rare };
        })(),
      },
      null,
      2,
    ),
  );
}

type Golden = {
  seed: number;
  days: number;
  sha256: string;
  rulesVersion?: string;
  reason?: string;
};

/**
 * Replays fixed lives and compares save hashes. `golden update <reason>`
 * rewrites the hashes on an intentional rules or content change and records
 * the reason and rules version next to each fixture.
 */
function golden(update?: string) {
  const file = new URL("../golden.json", import.meta.url);
  const fixtures = JSON.parse(readFileSync(file, "utf8")) as Golden[];
  if (update) {
    const next = fixtures.map(({ seed, days }) => {
      const state = run(seed, days);
      return {
        seed,
        days,
        sha256: replayDigest(state),
        rulesVersion: state.rulesVersion,
        reason: update,
      };
    });
    writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
    console.log("Golden fixtures updated: " + update);
    return;
  }
  for (const { seed, days, sha256 } of fixtures) {
    const actual = replayDigest(run(seed, days));
    if (sha256 !== actual)
      throw new Error(
        "Golden mismatch: seed " + seed + ", day " + days + ", got " + actual,
      );
    console.log("Golden replay matched: seed " + seed + ", day " + days);
  }
}

function timed<T>(work: () => T): [T, number] {
  const start = performance.now();
  const result = work();
  return [result, performance.now() - start];
}

function loadTenWorks(): LifeState {
  // Same fixture shape as the C-13 load test: one open work on a 20-year
  // hiatus and nine completed backlist works on one platform.
  let state = createLife(42);
  const origin = getPending(state)!;
  state = (
    choose(state, origin.id, origin.choices[0].id) as { state: LifeState }
  ).state;
  const open = state.works[0];
  open.status = "HIATUS";
  open.published = 12;
  open.hiatusUntil = 7301;
  open.resumeTo = "SERIAL_FREE";
  for (let index = 2; index <= 10; index += 1) {
    const work = structuredClone(open);
    work.id = "W-" + index;
    work.status = "COMPLETED";
    work.published = 60;
    work.hiatusUntil = null;
    work.resumeTo = null;
    work.end = {
      day: 0,
      reason: "COMPLETED",
      favorites: 53,
      views: 219,
      chapters: 60,
      rewarded: true,
    };
    state.works.push(work);
  }
  return state;
}

function bench() {
  const views = (state: LifeState) => {
    getAuthorView(state);
    getWorkViews(state);
    getPending(state);
    getEventLog(state);
    getLedgerView(state);
    getAptitudeView(state);
    getContractViews(state);
    getDailySummary(state);
  };
  const measure = (
    label: string,
    state: LifeState,
    days: number,
    ms: number,
  ) => {
    const [text, saveMs] = timed(() => serialize(state));
    const [, loadMs] = timed(() => deserialize(text));
    const [, queryMs] = timed(() => {
      for (let i = 0; i < 200; i += 1) views(state);
    });
    // Product loop: the browser reads every public selector after each day.
    let stepping = state;
    const [, stepMs] = timed(() => {
      for (let i = 0; i < 30; i += 1) {
        stepping = drive(stepping, stepping.day + 1);
        views(stepping);
      }
    });
    return {
      case: label,
      days,
      works: state.works.length,
      msPerDay: Number((ms / days).toFixed(4)),
      saveBytes: Buffer.byteLength(text),
      serializeMs: Number(saveMs.toFixed(2)),
      deserializeMs: Number(loadMs.toFixed(2)),
      allViewsMs: Number((queryMs / 200).toFixed(4)),
      dayPlusViewsMs: Number((stepMs / 30).toFixed(4)),
    };
  };
  const [long, longMs] = timed(() => run(42, 7300));
  const loaded = loadTenWorks();
  const [ten, tenMs] = timed(() => drive(loaded, 7300));
  console.log(
    JSON.stringify(
      [
        measure("seed42-7300", long, 7300, longMs),
        measure("ten-works-7300", ten, 7300, tenMs),
      ],
      null,
      2,
    ),
  );
}

const [command, seedText = "42", dayText = "60", replayFile] =
  process.argv.slice(2);
if (command === "bench") {
  bench();
} else if (command === "validate") {
  validate();
} else if (command === "golden") {
  golden(seedText === "update" ? dayText : undefined);
} else if (command === "profile") {
  // profile [seeds=100] [days=730] [first|mixed]
  profile(
    Number(seedText === "42" ? 100 : seedText),
    Number(dayText === "60" ? 730 : dayText),
    replayFile === "first" ? "first" : "mixed",
  );
} else if (command === "run" || command === "replay") {
  const seed = Number(seedText);
  const days = Number(dayText);
  if (!Number.isSafeInteger(days) || days < 0)
    throw new RangeError("Invalid day count");
  if (command === "replay" && !replayFile)
    throw new Error("Pass a JSON array of choice IDs");
  const decisions = replayFile
    ? (JSON.parse(readFileSync(replayFile, "utf8")) as string[])
    : undefined;
  const state = run(seed, days, decisions);
  console.log(
    JSON.stringify(
      {
        author: getAuthorView(state),
        works: getWorkViews(state),
        events: state.eventCount,
        sha256: replayDigest(state),
      },
      null,
      2,
    ),
  );
} else {
  throw new Error(
    "Use validate, run [seed] [days], replay [seed] [days] [choices.json], profile or golden.",
  );
}
