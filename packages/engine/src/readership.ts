import { channels, sourceText, tagUnlocks, text } from "@webbbbbie/content";
import type { Content, Platform } from "@webbbbbie/content";
import {
  blankSources,
  clamp,
  serial,
  sum,
  terminal,
  record,
  workTitle,
} from "./author";
import { traitsOf } from "./contracts";
import { accrue, activeContract } from "./economy";
import { spendingEffect } from "./work";
import type { EngineEvent, LifeState, Work } from "./model";
import { rand, stream } from "./rng";

const unlockedTagPlatforms = new Map(
  tagUnlocks.map((item) => [sourceText(item.textId), new Set(item.platforms)]),
);

function exposure(
  state: LifeState,
  work: Work,
  platform: Platform,
  content: Content,
  day: number,
  index: number,
) {
  const options = content.balance.market;
  const capacity = platform.visitors * options.reach;
  const fromSource = blankSources();
  if (
    !work.published ||
    work.status === "TAKEN_DOWN" ||
    work.status === "PLANNING"
  ) {
    return { fromSource, capacity, readers: 0 };
  }
  const serializing = serial(work);
  const ended = terminal(work.status);
  const sincePost =
    work.stats.lastPosted === null ? day : day - work.stats.lastPosted;
  const loyalty = state.author.social;
  const contract = activeContract(state, work, day);
  const company = content.world.companies.find(
    (candidate) => candidate.id === contract?.companyId,
  );
  // Promotion strength is the company's hidden promoPower inside the agreed window.
  const promoStrength =
    contract &&
    company &&
    day >= contract.promotionStart &&
    day <= contract.promotionEnd
      ? traitsOf(content, company.id).promoPower
      : 0;
  // A slot's traffic is shared with competing works: one work receives
  // trafficShare of it, scaled by its appeal (quality squared and the
  // author's commercial sense), so ordinary works stay small (NFR-003, R-03).
  const quality = work.quality / 100;
  // Hidden per-work luck is heavy-tailed: most works are ignored and a few
  // catch on (16번 §8). Rational form keeps results engine-independent.
  const draw = rand(state.seed, work.startDay, stream.CREATION, 60 + index);
  const luck =
    options.luckFloor +
    ((1 - options.luckFloor) * draw) / (1 - options.luckTail * draw);
  const appeal =
    options.trafficShare *
    quality *
    quality *
    quality *
    luck *
    (0.75 + state.author.abilities.commercial / 200);
  const fit =
    appeal *
    (0.53 +
      work.tags.filter(
        (tag) =>
          platform.tags.includes(tag) ||
          unlockedTagPlatforms.get(tag)?.has(platform.id),
      ).length *
        0.13 +
      state.author.abilities[platform.strength] * 0.004) *
    (0.85 + rand(state.seed, day, stream.EXPOSURE, index) * 0.3);
  // Backlist and organic discovery of an ended work fade hyperbolically with
  // time since the ending and scale with its earned popularity (FR-READER-003).
  const since = work.end ? day - work.end.day : 0;
  const fade = ended
    ? options.backlistHalfLife / (options.backlistHalfLife + Math.max(0, since))
    : 1;
  const popularity = ended
    ? clamp(work.stats.favorites / options.backlistFavorites, 0.05, 1)
    : 1;
  const eligible = {
    NEW: serializing && day - work.startDay <= options.newDays ? 1 : 0,
    UPDATE: serializing
      ? work.stats.publishedToday
        ? 1
        : 0.5 / (1 + sincePost * platform.frequency)
      : 0,
    HOT:
      serializing && work.stats.favorites >= options.hotFavorites
        ? 1 / (1 + sincePost * platform.frequency)
        : 0,
    BEST:
      serializing && work.stats.favorites >= options.bestFavorites ? 0.8 : 0,
    OFFICIAL:
      serializing &&
      work.paidFrom !== null &&
      work.published - work.paidFrom < 7
        ? 1
        : 0,
    PROMOTION:
      Math.max(promoStrength, day <= work.stats.promotionUntil ? 1 : 0) +
      (serializing
        ? spendingEffect(state, content, "promo") *
          content.balance.spending.promoExposure
        : 0),
    COMMUNITY:
      (state.flags.includes("community_tip") ? 0.22 : 0) +
      loyalty.recognition / 200,
    FANDOM:
      (loyalty.fandom +
        loyalty.expectation * (day - work.startDay < options.newDays ? 1 : 0)) /
      100,
    ORGANIC: ended ? 0.25 * fade : serializing ? 1 : 0.18,
    BACKLIST:
      work.status === "COMPLETED" ||
      work.status === "RUSHED_END" ||
      work.status === "DROPPED"
        ? content.policies.completionReach[work.status] * fade * popularity
        : 0,
  };
  for (const channel of channels) {
    const opportunity =
      platform.visitors * platform.slots[channel] * eligible[channel] * fit;
    fromSource[channel] = Math.min(
      capacity,
      opportunity * platform.click * platform.readStart,
    );
  }
  let remaining = 1;
  for (const channel of channels)
    remaining *= 1 - fromSource[channel] / capacity;
  const readers = capacity * clamp(1 - remaining, 0, 1);
  const unadjusted = sum(Object.values(fromSource));
  if (unadjusted) {
    for (const channel of channels) fromSource[channel] *= readers / unadjusted;
  }
  return { fromSource, capacity, readers };
}

export function advanceReaders(
  work: Work,
  platform: Platform,
  content: Content,
  day = 0,
) {
  const { market } = content.balance;
  let views = 0;
  let paidViews = 0;
  let latest = 0;
  let lost = 0;
  let newFans = 0;
  const current = work.published;
  const posted = work.stats.publishedToday;
  const previous = current - posted;
  if (current <= 0 || work.status === "TAKEN_DOWN")
    return { views, paidViews, latest, lost };
  const groupCount = Math.ceil(current / market.groupSize);
  // Per-chapter aggregates of this day's reading (no reader objects).
  const readAdd = Array<number>(current).fill(0);
  const dropAdd = Array<number>(current).fill(0);
  const paidBefore = work.paidFrom === null ? current : work.paidFrom - 1;
  for (let age = 0; age < platform.ages.length; age += 1) {
    const pool = work.readers[age];
    const next = Array<number>(groupCount).fill(0);
    const attrition =
      (market.ageAttrition[age] * (1.25 - work.quality / 150)) /
      platform.retention;
    const waiting = work.caughtUp[age];
    const waitingLoss =
      waiting * clamp(attrition * (posted ? 0.16 : 0.28), 0, 0.5);
    let caught = waiting - waitingLoss;
    lost += waitingLoss;
    // Waiting readers had read everything up to the latest earlier chapter.
    const waitingAt = (posted ? previous : current) - 1;
    if (waitingAt >= 0) dropAdd[waitingAt] += waitingLoss;
    if (posted) {
      for (let n = previous; n < current; n += 1) readAdd[n] += caught;
      views += caught * posted;
      paidViews +=
        caught * Math.max(0, current - Math.max(previous, paidBefore));
      latest += caught;
    }
    for (let group = 0; group < groupCount; group += 1) {
      const from = group * market.groupSize;
      const through = Math.min(current, from + market.groupSize);
      const span = through - from;
      const available =
        (pool[group] ?? 0) + (group === 0 ? work.stats.newByAge[age] : 0);
      const flow = available * Math.min(1, market.ageSpeed[age] / span);
      const stayed = available - flow;
      const exits = flow * clamp(attrition * span, 0, 0.6);
      const moving = flow - exits;
      next[group] += stayed;
      lost += exits;
      // A reader who stops inside the group read a uniform share of it, so
      // chapter i of the group is read by moving + exits * (1 - (i + .5)/span)
      // readers and exits/span readers stop right after it.
      for (let step = 0; step < span; step += 1) {
        readAdd[from + step] += moving + exits * (1 - (step + 0.5) / span);
        dropAdd[from + step] += exits / span;
      }
      views += (moving + exits * 0.5) * span;
      paidViews +=
        (moving + exits * 0.5) *
        Math.max(0, through - Math.max(from, paidBefore));
      if (group + 1 < groupCount) {
        next[group + 1] += moving;
      } else {
        caught += moving;
        newFans += moving * (0.07 + work.quality * 0.002);
        if (posted) latest += moving;
      }
    }
    work.readers[age] = next;
    work.caughtUp[age] = caught;
  }
  work.stats.favorites += newFans;
  logChapters(work, readAdd, dropAdd, day);
  return { views, paidViews, latest, lost };
}

/** Output-only log: rounded to 0.01 so saves stay small; never feeds back. */
function logChapters(
  work: Work,
  reads: readonly number[],
  drops: readonly number[],
  day: number,
) {
  const log = work.chapters ?? {
    complete: false,
    since: day,
    reads: [],
    drops: [],
  };
  const merge = (old: readonly number[], add: readonly number[]) =>
    add.map(
      (value, index) => Math.round(((old[index] ?? 0) + value) * 100) / 100,
    );
  work.chapters = {
    complete: log.complete,
    since: log.since,
    reads: merge(log.reads, reads),
    drops: merge(log.drops, drops),
  };
}

export function resolveAudience(
  state: LifeState,
  content: Content,
  day: number,
  events: EngineEvent[] = [],
) {
  const totals = new Map<string, number>();
  const planned = state.works.map((work, index) => {
    const platform = content.platforms.find(
      (candidate) => candidate.id === work.platformId,
    )!;
    const result = exposure(state, work, platform, content, day, index);
    totals.set(platform.id, (totals.get(platform.id) ?? 0) + result.readers);
    return { work, platform, result };
  });
  let gained = 0;
  for (const { work, platform, result } of planned) {
    const total = totals.get(platform.id)!;
    const scale = total > result.capacity ? result.capacity / total : 1;
    work.stats.newReaders = result.readers * scale;
    work.stats.newByAge = platform.ages.map(
      (share) => work.stats.newReaders * share,
    );
    for (const channel of channels) result.fromSource[channel] *= scale;
    work.stats.newBySource = result.fromSource;
    work.stats.totalNew += work.stats.newReaders;
    const { views, paidViews, latest, lost } = advanceReaders(
      work,
      platform,
      content,
      day,
    );
    work.stats.views = views;
    work.stats.totalViews += views;
    work.stats.latestViews = latest;
    work.stats.lost = lost;
    const before = work.detail;
    const exposed = ["HOT", "BEST"].filter(
      (key) => result.fromSource[key as "HOT" | "BEST"] > 0,
    );
    for (const key of new Set([...(before?.exposure ?? []), ...exposed])) {
      if (exposed.includes(key) === (before?.exposure.includes(key) ?? false))
        continue;
      record(
        events,
        "WORK_EXPOSURE",
        day,
        text("engine.log.exposure-change", {
          work_title: workTitle(work),
          channel: text("label.acquisition." + key.toLowerCase()),
          change: text(
            exposed.includes(key)
              ? "label.exposure.enter"
              : "label.exposure.leave",
          ),
        }),
        work.id,
      );
    }
    const expected =
      serial(work) && !!(work.mask & (1 << ((day - 1) % 7))) ? 1 : 0;
    work.detail = {
      since: before?.since ?? day,
      paidReads: (before?.paidReads ?? 0) + paidViews,
      exposure: exposed,
      journal: before?.journal ?? [],
      history: [
        ...(before?.history ?? []),
        [day, work.quality, work.stats.publishedToday, expected, paidViews] as [
          number,
          number,
          number,
          number,
          number,
        ],
      ].slice(-content.balance.plan.historyKeep),
    };
    work.history.push([day, views, work.stats.newReaders]);
    if (work.history.length > content.balance.plan.historyKeep)
      work.history.shift();
    if (work.status !== "TAKEN_DOWN")
      gained += accrue(state, work, day, views, paidViews, content);
  }
  return gained;
}
