import type { Content, WorkStatus } from "@webbbbbie/content";
import { playerActionRules, text } from "@webbbbbie/content";
import {
  activeWork,
  specialModifiers,
  changeCondition,
  changeSocial,
  clamp,
  requestNewWork,
  learnAptitude,
  record,
  relevantAptitudes,
  serial,
  sum,
  terminal,
  workTitle,
} from "./author";
import type { EngineEvent, LifeState, Routine, Work } from "./model";
import { rand, stream } from "./rng";

export function canTransition(from: WorkStatus, to: WorkStatus) {
  if (from === to) return false;
  if (to === "TAKEN_DOWN") return from !== "PLANNING";
  if (terminal(from)) return false;
  if (from === "PLANNING") return to === "SERIAL_FREE" || to === "DROPPED";
  if (to === "HIATUS" || to === "SERIAL_PAID" || to === "SERIAL_FREE") {
    if (from === "HIATUS") return to === "SERIAL_PAID" || to === "SERIAL_FREE";
    return to === "HIATUS" || (from === "SERIAL_FREE" && to === "SERIAL_PAID");
  }
  return to === "COMPLETED" || to === "RUSHED_END" || to === "DROPPED";
}

export function transitionWork(
  work: Work,
  to: WorkStatus,
  day: number,
  events: EngineEvent[],
  hiatusDays = 7,
  forced = true,
) {
  if (!canTransition(work.status, to)) return;
  const previous = work.status;
  if (
    to === "HIATUS" &&
    (previous === "SERIAL_FREE" || previous === "SERIAL_PAID")
  ) {
    work.resumeTo = previous;
    work.hiatusUntil = day + hiatusDays;
    work.hiatusLockedUntil = forced ? day + hiatusDays : null;
  } else if (previous === "HIATUS") {
    work.resumeTo = null;
    work.hiatusUntil = null;
    work.hiatusLockedUntil = null;
    work.hiatusKind = null;
    if (!terminal(to)) work.lastResume = day;
  }
  work.status = to;
  if (to === "SERIAL_PAID" && work.paidFrom === null)
    work.paidFrom = work.published + 1;
  if (to === "SERIAL_PAID" || terminal(to)) work.paidEligibleDay = null;
  if (terminal(to) && work.rush > 0) {
    record(
      events,
      "WORK_ORDER",
      day,
      text("engine.log.extra-post-failed", {
        work_title: workTitle(work),
        reason: text("label.command-result.status"),
      }),
      work.id,
    );
  }
  if (terminal(to) && work.extraWriting) {
    record(
      events,
      "WORK_ORDER",
      day,
      text("engine.log.extra-write-failed", {
        work_title: workTitle(work),
        reason: text("label.command-result.status"),
      }),
      work.id,
    );
    work.extraWriting = false;
  }
  if (to !== "HIATUS") work.rush = 0;
  if (to === "TAKEN_DOWN") {
    work.readers = [[], [], [], [], []];
    work.caughtUp = [0, 0, 0, 0, 0];
  }
  if (terminal(to) && !work.end) {
    work.end = {
      day,
      reason: to as NonNullable<Work["end"]>["reason"],
      favorites: work.stats.favorites,
      views: work.stats.totalViews,
      chapters: work.published,
      rewarded: false,
    };
  }
  const label =
    to === "COMPLETED"
      ? "label.work-log.completed"
      : "label.work-status." + to.toLowerCase().replaceAll("_", "-");
  record(
    events,
    "WORK_STATUS_CHANGED",
    day,
    text("engine.log.status", {
      work_title: workTitle(work),
      status: text(label),
    }),
    work.id,
  );
}

export function prepareWorks(
  state: LifeState,
  content: Content,
  day: number,
  events: EngineEvent[],
) {
  const { author } = state;
  const { writing } = content.balance;
  if (
    author.policy.autoPlan &&
    !state.works.some(activeWork) &&
    author.startPath
  ) {
    // After the last work ends the author rests for a seeded number of days
    // before planning the next one (C-15 family, balance.life.rest*).
    const lastEnd = Math.max(
      -Infinity,
      ...state.works.map((work) => work.end?.day ?? -Infinity),
    );
    const { restMin, restMax } = content.balance.life;
    const rest =
      lastEnd === -Infinity
        ? 0
        : restMin +
          Math.floor(
            rand(state.seed, lastEnd, stream.CREATION, 90) *
              (restMax - restMin + 1),
          );
    if (day >= lastEnd + rest) {
      const exposed = state.works.some((work) => work.status === "TAKEN_DOWN");
      requestNewWork(
        state,
        content,
        day,
        exposed ? "ORIGINAL" : author.startPath,
        text("ui.new-work.auto-title"),
        "system.new-work.auto",
      );
    }
  }
  for (const work of state.works) {
    if (work.status === "PLANNING" && day > work.startDay) {
      transitionWork(work, "SERIAL_FREE", day, events);
    }
    if (
      work.status === "HIATUS" &&
      day >= (work.hiatusUntil ?? day) &&
      author.condition.health >= writing.resumeHealth
    ) {
      transitionWork(work, work.resumeTo ?? "SERIAL_FREE", day, events);
    }
  }
}

/** Splits whole units across works by weight (largest remainder). */
function allocate(
  works: Work[],
  available: number,
  unit: number,
  weigh: (work: Work) => number,
): Record<string, number> {
  if (!works.length) return {};
  const units = Math.floor(Math.max(0, available) / unit);
  const weights = works.map(weigh);
  const total = sum(weights);
  const slots = weights.map((weight) => (units * weight) / total);
  const whole = slots.map(Math.floor);
  const byRemainder = slots
    .map((slot, index) => ({ index, remainder: slot - whole[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const extra = units - sum(whole);
  for (const patch of byRemainder.slice(0, extra)) whole[patch.index] += 1;
  return Object.fromEntries(
    works.map((work, index) => [work.id, whole[index] * unit]),
  );
}

/** A work the author can write into: serializing, or on a stock-building hiatus. */
export const writable = (work: Work) =>
  serial(work) || (work.status === "HIATUS" && work.hiatusKind === "STOCK");

/** Effective spending levels: nothing is spent while broke or in a cut state. */
export function spendingLevels(state: LifeState, content: Content) {
  const { author } = state;
  const cut = specialModifiers(author, content).spendCut || author.cash <= 0;
  const levels = cut
    ? { meals: 0, gear: 0, health: 0, research: 0, leisure: 0, promo: 0 }
    : author.policy.spend;
  return { levels, cut };
}

export function spendingEffect(
  state: LifeState,
  content: Content,
  category: keyof LifeState["author"]["policy"]["spend"],
) {
  return content.balance.spending.efficiency[
    spendingLevels(state, content).levels[category]
  ];
}

export function planRoutine(
  state: LifeState,
  content: Content,
  day: number,
): Routine {
  const { author } = state;
  const { time, writing: rules, plan } = content.balance;
  const job = content.world.jobs.find(
    (candidate) => candidate.id === author.jobId,
  )!;
  const jitter =
    Math.floor(
      rand(state.seed, day, stream.ROUTINE, 0) * (2 * job.irregularity + 1),
    ) - job.irregularity;
  const special = specialModifiers(author, content);
  const deviations: string[] = [];
  const planned = author.policy.time;
  const jobUnits = Math.max(0, job.slots + jitter);
  const work = Math.min(
    time.day - time.living - time.minSleep,
    jobUnits + special.workExtra,
  );
  if (work > jobUnits) deviations.push("label.deviation.extra-work");
  const active = state.works.filter(serial);
  const pressure = active.filter((item) => item.stock < 2).length;
  const push =
    pressure > 0 &&
    author.condition.health >= rules.resumeHealth &&
    rand(state.seed, day, stream.ROUTINE, 1) <
      (author.condition.drive + author.traits.deadlineTolerance) / 180;
  let sleep = planned.sleep;
  if (push) {
    sleep = Math.max(
      time.minSleep,
      sleep - (time.deadlinePressure + pressure - 1),
    );
    if (sleep < planned.sleep) deviations.push("label.deviation.deadline-push");
  }
  const free = time.day - work - time.living;
  sleep = Math.min(sleep, free);
  const left = free - sleep;
  // Impulses add community and ego time beyond the plan (16번 §3, §7).
  const impulse = (index: number, trait: number) =>
    rand(state.seed, day, stream.ROUTINE, index) < trait / 220 ? 1 : 0;
  let community = Math.min(
    left,
    Math.max(
      planned.community,
      Math.min(
        time.communityMax + special.communityBonus,
        planned.community +
          special.communityBonus +
          impulse(2, author.traits.community),
      ),
    ),
  );
  if (community > planned.community)
    deviations.push("label.deviation.community-impulse");
  const posted = state.works.some((item) => item.published > 0);
  let ego = posted
    ? Math.min(
        left - community,
        Math.max(
          planned.ego,
          Math.min(
            time.egoMax + special.egoBonus,
            planned.ego +
              special.egoBonus +
              impulse(3, author.condition.stress + 20),
          ),
        ),
      )
    : 0;
  if (ego > planned.ego) deviations.push("label.deviation.ego-impulse");
  const writers = state.works.filter(
    (item) => writable(item) || item.status === "PLANNING",
  );
  let plot = writers.length ? planned.plot : 0;
  let rest = planned.rest + (writers.length ? 0 : planned.plot);
  // A crowded day squeezes rest first, then ego, community and plot time.
  let overflow = community + ego + plot + rest - left;
  if (overflow > 0) {
    deviations.push("label.deviation.squeezed");
    const cut = (value: number) => {
      const taken = Math.min(value, overflow);
      overflow -= taken;
      return value - taken;
    };
    rest = cut(rest);
    ego = cut(ego);
    community = cut(community);
    plot = cut(plot);
  }
  const remaining = left - community - ego - plot - rest;
  const plotBy = allocate(
    writers,
    plot,
    1,
    (item) =>
      item.priority *
      (item.endingTarget !== null ? playerActionRules.endingPlotWeight : 1) *
      (item.status === "PLANNING" ? 1.4 : 1) *
      (115 - item.prep),
  );
  const writing = allocate(
    state.works.filter(writable),
    remaining,
    time.workUnit,
    (item) =>
      item.priority *
      Math.max(0.5, item.stockTarget - item.stock) *
      (0.5 + item.attachment / 100),
  );
  const writtenPlot = sum(Object.values(plotBy));
  rest += plot - writtenPlot;
  const routine: Routine = {
    work,
    living: time.living,
    sleep,
    community,
    ego,
    plot: plotBy,
    rest,
    writing,
    unused: remaining - sum(Object.values(writing)),
  };
  author.lastPlan = {
    work: jobUnits,
    living: time.living,
    sleep: planned.sleep,
    community: planned.community,
    ego: planned.ego,
    plot: { total: planned.plot },
    rest: planned.rest,
    writing: {
      total: Math.max(
        0,
        time.day -
          jobUnits -
          time.living -
          planned.sleep -
          planned.community -
          planned.ego -
          planned.plot -
          planned.rest,
      ),
    },
    unused: 0,
  };
  author.deviations = deviations;
  void plan;
  return routine;
}

function writingFailure(state: LifeState, day: number) {
  const { health, fatigue, stress, drive } = state.author.condition;
  const rules = playerActionRules;
  if (health <= rules.healthWritingFloor) return "health";
  if (fatigue >= rules.fatigueWritingCeiling) return "fatigue";
  const resilience = state.author.abilities.resilience;
  const risk = 1.2 - resilience * 0.006;
  if (
    stress >= rules.stressRiskStart &&
    rand(state.seed, day, stream.WRITING, 10000) <
      (stress - rules.stressRiskStart + 1) * rules.stressFailureScale * risk
  )
    return "stress";
  if (
    drive <= rules.driveRiskStart &&
    rand(state.seed, day, stream.WRITING, 10001) <
      (rules.driveRiskStart - drive + 1) * rules.driveFailureScale * risk
  )
    return "drive";
  return null;
}

export function writeAndPublish(
  state: LifeState,
  content: Content,
  routine: Routine,
  day: number,
  events: EngineEvent[],
) {
  const { author } = state;
  const { writing, plan, spending } = content.balance;
  const special = specialModifiers(author, content);
  const gear =
    1 + spending.gearWriting * spendingEffect(state, content, "gear");
  const research = spendingEffect(state, content, "research");
  let posted = 0;
  const writers = state.works.filter(writable).length || 1;
  const failed = writingFailure(state, day);
  if (failed && Object.values(routine.writing).some((slots) => slots > 0))
    author.deviations.push("label.deviation.write-" + failed);
  for (const [index, work] of state.works.entries()) {
    work.stats.publishedToday = 0;
    work.stats.missedReason = null;
    const planned = (work.mask & (1 << ((day - 1) % 7))) !== 0;
    const stockBeforeWriting = work.stock;
    if (work.status === "HIATUS" && planned) {
      work.stats.missedReason = "HIATUS";
      record(
        events,
        "CHAPTER_MISSED",
        day,
        text("engine.log.missed-hiatus", {
          work_title: workTitle(work),
        }),
        work.id,
      );
    }
    // Plot time and research spending build preparation; it also fades.
    const invested = routine.plot[work.id] ?? 0;
    if (work.status === "PLANNING" || writable(work)) {
      work.prep = clamp(
        work.prep +
          invested * plan.prepGain * (0.7 + author.abilities.insight / 200) +
          (research * spending.researchPrep) / writers -
          plan.prepDecay,
      );
    }
    let extraSlots = 0;
    if (work.extraWriting) {
      work.extraWriting = false;
      const slots = playerActionRules.extraWritingSlots;
      const reason = !writable(work)
        ? "status"
        : (failed ??
          (routine.rest + routine.unused < slots ? "no-time" : null));
      if (reason) {
        record(
          events,
          "WORK_ORDER",
          day,
          text("engine.log.extra-write-failed", {
            work_title: workTitle(work),
            reason: text("label.command-result." + reason),
          }),
          work.id,
        );
      } else {
        const fromUnused = Math.min(routine.unused, slots);
        routine.unused -= fromUnused;
        routine.rest -= slots - fromUnused;
        routine.writing[work.id] = (routine.writing[work.id] ?? 0) + slots;
        extraSlots = slots;
      }
    }
    if (!writable(work)) {
      if (work.rush > 0) {
        work.rush = 0;
        record(
          events,
          "WORK_ORDER",
          day,
          text("engine.log.extra-post-failed", {
            work_title: workTitle(work),
            reason: text("label.command-result.status"),
          }),
          work.id,
        );
      }
      continue;
    }
    const allotted = routine.writing[work.id] ?? 0;
    const readiness = clamp(work.prep / 60, 0, 1);
    const prepFactor = plan.prepFloor + (1 - plan.prepFloor) * readiness;
    if (allotted > 0 && !failed) {
      const aptitudes = relevantAptitudes(author, work);
      const average = aptitudes.length
        ? sum(aptitudes.map((item) => item.trueValue)) / aptitudes.length
        : 50;
      const fit =
        writing.aptitudeMin +
        ((writing.aptitudeMax - writing.aptitudeMin) * average) / 100;
      const condition = Math.max(
        writing.conditionMin,
        1 -
          (writing.fatiguePenalty * author.condition.fatigue) / 100 -
          writing.stressPenalty *
            Math.max(0, (author.condition.stress - 50) / 50),
      );
      // Long sessions lose efficiency (16번 §4).
      const effectiveSlots = (slots: number) =>
        slots <= plan.overtimeAt
          ? slots
          : plan.overtimeAt +
            (slots - plan.overtimeAt) * plan.overtimeEfficiency;
      const hours = effectiveSlots(allotted);
      const produced =
        hours *
        (writing.base + writing.speedFactor * author.abilities.speed) *
        condition *
        fit *
        special.writing *
        gear *
        prepFactor;
      work.stock += produced;
      if (extraSlots > 0) {
        record(
          events,
          "WORK_ORDER",
          day,
          text("engine.log.extra-write-done", {
            work_title: workTitle(work),
            hours: extraSlots / 2,
            chapters: (
              (produced * (hours - effectiveSlots(allotted - extraSlots))) /
              hours
            ).toFixed(2),
          }),
          work.id,
        );
      }
      work.prep = clamp(work.prep - produced * plan.prepCost);
      const quality =
        ((author.abilities.style +
          author.abilities.vocabulary +
          average +
          105) /
          4) *
        (0.84 + 0.16 * readiness) *
        (1 - 0.1 * Math.max(0, (author.condition.fatigue - 60) / 40));
      const variation =
        (rand(state.seed, day, stream.WRITING, index) - 0.5) * 0.35;
      work.quality = clamp(
        work.quality + (quality - work.quality) * 0.012 + variation,
      );
      work.consistency = clamp(
        work.consistency + (work.prep - 45) * 0.004 + (readiness - 0.5) * 0.1,
      );
      learnAptitude(state, work, day, allotted >= 8 ? 2 : 1, content);
    }
    if (!serial(work)) {
      if (work.rush > 0) {
        work.rush = 0;
        record(
          events,
          "WORK_ORDER",
          day,
          text("engine.log.extra-post-failed", {
            work_title: workTitle(work),
            reason: text("label.command-result.status"),
          }),
          work.id,
        );
      }
      continue;
    }
    let count = 0;
    if (planned && work.stock >= 1 && work.published < work.targetChapters) {
      work.stock -= 1;
      work.published += 1;
      count += 1;
    }
    if (work.rush > 0) {
      work.rush -= 1;
      const enoughStock = stockBeforeWriting >= (planned ? 2 : 1);
      const beforeTarget = work.published < work.targetChapters;
      if (enoughStock && beforeTarget && work.stock >= 1) {
        work.stock -= 1;
        work.published += 1;
        count += 1;
        record(
          events,
          "WORK_ORDER",
          day,
          text("engine.log.extra-post-done", {
            work_title: workTitle(work),
          }),
          work.id,
        );
      } else {
        record(
          events,
          "WORK_ORDER",
          day,
          text("engine.log.extra-post-failed", {
            work_title: workTitle(work),
            reason: text(
              beforeTarget
                ? "label.command-result.no-stock"
                : "label.command-result.target",
            ),
          }),
          work.id,
        );
      }
    }
    if (count > 0) {
      work.stats.publishedToday = count;
      work.stats.lastPosted = day;
      work.stats.streakMissed = 0;
      posted += count;
      record(
        events,
        "CHAPTER_POSTED",
        day,
        text("engine.log.posted", {
          work_title: workTitle(work),
          chapter: work.published,
        }),
        work.id,
      );
    } else if (planned) {
      work.stats.missedReason = "NO_STOCK";
      work.stats.streakMissed += 1;
      record(
        events,
        "CHAPTER_MISSED",
        day,
        text("engine.log.missed-stock", {
          work_title: workTitle(work),
        }),
        work.id,
      );
    } else if (work.stats.streakMissed > 0) {
      work.stats.streakMissed += 1;
    }
  }
  return posted;
}

export function finishWorks(
  state: LifeState,
  content: Content,
  day: number,
  events: EngineEvent[],
) {
  const { author } = state;
  const { writing, growth } = content.balance;
  for (const work of state.works) {
    if (serial(work) && work.published >= work.targetChapters) {
      transitionWork(work, "COMPLETED", day, events);
    }
    const platform = content.platforms.find(
      (candidate) => candidate.id === work.platformId,
    )!;
    if (
      platform.model === "EPISODE" &&
      work.status === "SERIAL_FREE" &&
      work.published >= writing.paidChapters &&
      work.stats.favorites >= writing.paidFavorites
    ) {
      if (work.paidEligibleDay !== null && day >= work.paidEligibleDay)
        transitionWork(work, "SERIAL_PAID", day, events);
      else work.paidEligibleDay = day + 1;
    }
    const end = work.end;
    if (!end || end.rewarded) continue;
    end.rewarded = true;
    const experience =
      end.reason === "COMPLETED"
        ? growth.completionSkill
        : end.reason === "RUSHED_END"
          ? growth.rushedSkill
          : end.reason === "DROPPED"
            ? growth.droppedSkill
            : 0;
    const reach = Math.min(growth.recognitionCap, Math.sqrt(end.favorites) / 9);
    author.abilities.style = clamp(
      author.abilities.style + experience + reach * 0.12,
    );
    author.abilities.insight = clamp(
      author.abilities.insight + experience * 0.4,
    );
    changeSocial(author, "recognition", reach);
    changeSocial(
      author,
      "completionTrust",
      end.reason === "COMPLETED" ? growth.completionTrust : -1,
    );
    changeSocial(
      author,
      "reputation",
      end.reason === "COMPLETED" ? 2 + reach * 0.4 : -2,
    );
    changeSocial(
      author,
      "expectation",
      experience + reach + author.social.completionTrust * 0.05,
    );
    record(
      events,
      "STATE_CHANGED",
      day,
      text("engine.log.growth", { work_title: workTitle(work) }),
      work.id,
    );
  }
}

export function updateCondition(
  state: LifeState,
  content: Content,
  routine: Routine,
) {
  const { author } = state;
  const rules = content.balance.condition;
  const { plan, spending } = content.balance;
  const special = specialModifiers(author, content);
  const allotted = sum(Object.values(routine.writing));
  const plotted = sum(Object.values(routine.plot));
  const workload = routine.work + allotted + plotted * 0.5;
  const restUnits =
    (routine.rest + routine.unused * 0.5) *
    (0.7 + author.abilities.resilience / 200) *
    special.restMult;
  const meals = spendingEffect(state, content, "meals");
  const gearEase = spendingEffect(state, content, "gear");
  const medical = spendingEffect(state, content, "health");
  const leisure = spendingEffect(state, content, "leisure");
  changeCondition(
    author,
    "health",
    (routine.sleep < rules.healthySleep
      ? -(rules.healthySleep - routine.sleep) * rules.healthLoss
      : rules.healthRecovery) +
      spending.mealsHealth * meals +
      spending.healthRecovery * medical,
  );
  changeCondition(
    author,
    "fatigue",
    Math.max(0, workload - rules.fatigueThreshold) * rules.fatigueGain -
      (routine.sleep - rules.fatigueSleepBase) * rules.fatigueRecovery -
      restUnits * plan.restFatigue -
      spending.gearFatigue * gearEase,
  );
  const missed = state.works.filter(
    (work) => work.stats.streakMissed >= rules.missedThreshold && serial(work),
  ).length;
  const traction = state.works.some((work) => work.stats.newReaders >= 200);
  changeCondition(
    author,
    "stress",
    missed * rules.missedStress +
      routine.ego * 0.32 +
      (routine.sleep < rules.healthySleep ? 0.6 : -rules.restStress) -
      restUnits * plan.restStress -
      spending.mealsStress * meals -
      spending.leisureStress * leisure -
      (traction ? rules.successStress : 0) +
      special.stressDaily -
      // Homeostasis: stress drifts back toward its baseline every day.
      rules.stressPull * (author.condition.stress - rules.stressBaseline),
  );
  changeCondition(
    author,
    "drive",
    (routine.sleep - 12) * 0.2 +
      (traction ? 0.45 : -0.12) -
      (author.condition.stress > 65 ? 0.6 : 0) +
      restUnits * plan.restDrive +
      spending.leisureDrive * leisure +
      special.driveDaily -
      rules.drivePull * (author.condition.drive - rules.driveBaseline),
  );
  // Spending accrues daily and is charged at settlement.
  const { levels } = spendingLevels(state, content);
  author.spendAccrued +=
    sum(
      (Object.keys(levels) as (keyof typeof levels)[]).map(
        (key) => spending[key][levels[key]],
      ),
    ) / content.balance.economy.settlementDays;
}
