import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defaultContent, parseContent } from "@webbbbbie/content";
import {
  advance,
  choose,
  createLife,
  getAuthorView,
  getWorkViews,
  getPending,
  serialize,
} from "@webbbbbie/engine";
import type { LifeState } from "@webbbbbie/engine";
import { catalogRows } from "./text-catalog";

function run(seed: number, days: number, decisions?: string[]): LifeState {
  let state = createLife(seed);
  let index = 0;
  while (state.day < days || state.pending?.day === 0) {
    const waiting = getPending(state);
    if (waiting) {
      const choice = decisions ? decisions[index] : waiting.choices[0].id;
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
  console.log(
    "Content valid: " +
      data.events.filter((item) => item.tier !== "ORIGIN").length +
      " daily events, 1 origin, " +
      data.platforms.length +
      " platforms, " +
      data.world.jobs.length +
      " jobs, " +
      catalogRows().length +
      " text resources.",
  );
}

function profile() {
  const gaps: number[] = [];
  let multi = 0;
  let forced = 0;
  for (let seed = 0; seed < 100; seed += 1) {
    const state = run(seed, 120);
    let last = 0;
    if (
      state.works.some(
        (work, index) =>
          index > 0 &&
          work.startDay < (state.works[index - 1].end?.day ?? Infinity),
      )
    )
      multi += 1;
    forced += state.eventCount["event:forced-hiatus"] ?? 0;
    for (const [day, event] of state.archive.entries()) {
      if (day === 0 || event[2] === null) continue;
      if (last > 0) gaps.push(day - last);
      last = day;
    }
  }
  gaps.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      seeds: 100,
      daysPerSeed: 120,
      intervals: gaps.length,
      median: gaps[Math.floor(gaps.length / 2)],
      runsWithMultiwork: multi,
      forcedHiatusEvents: forced,
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

function golden() {
  const fixtures = JSON.parse(
    readFileSync(new URL("../golden.json", import.meta.url), "utf8"),
  ) as { seed: number; days: number; sha256: string }[];
  for (const { seed, days, sha256 } of fixtures) {
    const actual = replayDigest(run(seed, days));
    if (sha256 !== actual)
      throw new Error(
        "Golden mismatch: seed " + seed + ", day " + days + ", got " + actual,
      );
    console.log("Golden replay matched: seed " + seed + ", day " + days);
  }
}

const [command, seedText = "42", dayText = "60", replayFile] =
  process.argv.slice(2);
if (command === "validate") {
  validate();
} else if (command === "golden") {
  golden();
} else if (command === "profile") {
  profile();
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
