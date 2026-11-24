import { channels } from "@webbbbbie/content";
import type { Content, Platform } from "@webbbbbie/content";
import { blankSources, clamp, serial, sum, terminal } from "./author";
import { accrue, activeContract } from "./economy";
import type { LifeState, Work } from "./model";
import { rand, stream } from "./rng";

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
  const promoted = !!(
    contract &&
    company &&
    company.honesty >= 45 &&
    day >= contract.promotionStart &&
    day <= contract.promotionEnd
  );
  // A slot's traffic is shared with competing works: one work receives
  // trafficShare of it, scaled by its appeal (quality squared and the
  // author's commercial sense), so ordinary works stay small (NFR-003, R-03).
  const quality = work.quality / 100;
  const appeal =
    options.trafficShare *
    quality *
    quality *
    (0.75 + state.author.abilities.commercial / 200);
  const fit =
    appeal *
    (0.53 +
      work.tags.filter((tag) => platform.tags.includes(tag)).length * 0.13 +
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
    PROMOTION: promoted || day <= work.stats.promotionUntil ? 1 : 0,
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
    if (posted) {
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
  return { views, paidViews, latest, lost };
}

export function resolveAudience(
  state: LifeState,
  content: Content,
  day: number,
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
    );
    work.stats.views = views;
    work.stats.totalViews += views;
    work.stats.latestViews = latest;
    work.stats.lost = lost;
    if (work.status !== "TAKEN_DOWN")
      gained += accrue(state, work, day, views, paidViews, content);
  }
  return gained;
}
