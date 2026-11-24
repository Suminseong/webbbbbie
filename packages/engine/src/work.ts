import type { Content, WorkStatus } from "@webbbbbie/content";
import { displayWorkTitle, text } from "@webbbbbie/content";
import {
  activeWork,
  specialModifiers,
  changeCondition,
  changeSocial,
  clamp,
  createWork,
  learnAptitude,
  record,
  relevantAptitudes,
  serial,
  sum,
  terminal,
} from "./author";
import type { EngineEvent, LifeState, Routine, Work } from "./model";
import { rand, stream } from "./rng";

export function canTransition(from: WorkStatus, to: WorkStatus) {
  if (from === to) return false;
  if (to === "TAKEN_DOWN") return from !== "PLANNING";
  if (terminal(from)) return false;
  if (from === "PLANNING") return to === "SERIAL_FREE";
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
) {
  if (!canTransition(work.status, to)) return;
  const previous = work.status;
  if (
    to === "HIATUS" &&
    (previous === "SERIAL_FREE" || previous === "SERIAL_PAID")
  ) {
    work.resumeTo = previous;
    work.hiatusUntil = day + hiatusDays;
  } else if (previous === "HIATUS") {
    work.resumeTo = null;
    work.hiatusUntil = null;
    if (!terminal(to)) work.lastResume = day;
  }
  work.status = to;
  if (to === "SERIAL_PAID" && work.paidFrom === null)
    work.paidFrom = work.published + 1;
  if (to === "SERIAL_PAID" || terminal(to)) work.paidEligibleDay = null;
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
      work_title: displayWorkTitle(work.title),
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
  if (!state.works.some(activeWork) && author.startPath) {
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
      createWork(state, content, day, exposed ? "ORIGINAL" : author.startPath);
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

function allocateWriting(
  works: Work[],
  available: number,
  unit: number,
  target: number,
): Record<string, number> {
  if (!works.length) return {};
  const units = Math.floor(available / unit);
  const weights = works.map(
    (work) =>
      Math.max(0.5, target - work.stock) * (0.5 + work.attachment / 100),
  );
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

export function planRoutine(
  state: LifeState,
  content: Content,
  day: number,
): Routine {
  const { author } = state;
  const { time, writing: rules } = content.balance;
  const job = content.world.jobs.find(
    (candidate) => candidate.id === author.jobId,
  )!;
  const jitter =
    Math.floor(
      rand(state.seed, day, stream.ROUTINE, 0) * (2 * job.irregularity + 1),
    ) - job.irregularity;
  const work = Math.max(0, job.slots + jitter);
  const active = state.works.filter(serial);
  const pressure = active.filter((item) => item.stock < 2).length;
  const push =
    pressure > 0 &&
    author.condition.health >= rules.resumeHealth &&
    rand(state.seed, day, stream.ROUTINE, 1) <
      (author.condition.drive + author.traits.deadlineTolerance) / 180;
  const sleep = Math.max(
    time.minSleep,
    time.sleep - (push ? time.deadlinePressure + pressure - 1 : 0),
  );
  const free = time.day - work - time.living - sleep;
  const special = specialModifiers(author, content);
  const community = Math.min(
    free,
    time.communityMax + special.communityBonus,
    Math.floor(
      (author.traits.community * rand(state.seed, day, stream.ROUTINE, 2)) / 19,
    ),
  );
  const ego = Math.min(
    free - community,
    time.egoMax + special.egoBonus,
    state.works.some((item) => item.published > 0)
      ? Math.floor(
          ((author.condition.stress + 30) *
            rand(state.seed, day, stream.ROUTINE, 3)) /
            25,
        ) + special.egoBonus
      : 0,
  );
  const writing = allocateWriting(
    active,
    free - community - ego,
    time.workUnit,
    rules.targetStock,
  );
  return {
    work,
    living: time.living,
    sleep,
    community,
    ego,
    writing,
    unused: free - community - ego - sum(Object.values(writing)),
  };
}

export function writeAndPublish(
  state: LifeState,
  content: Content,
  routine: Routine,
  day: number,
  events: EngineEvent[],
) {
  const { author } = state;
  const { writing } = content.balance;
  const special = specialModifiers(author, content);
  let posted = 0;
  for (const [index, work] of state.works.entries()) {
    work.stats.publishedToday = 0;
    work.stats.missedReason = null;
    const planned = (work.mask & (1 << ((day - 1) % 7))) !== 0;
    if (work.status === "HIATUS" && planned) {
      work.stats.missedReason = "HIATUS";
      record(
        events,
        "CHAPTER_MISSED",
        day,
        text("engine.log.missed-hiatus", {
          work_title: displayWorkTitle(work.title),
        }),
        work.id,
      );
    }
    if (!serial(work)) continue;
    const allotted = routine.writing[work.id] ?? 0;
    if (allotted > 0) {
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
      work.stock +=
        allotted *
        (writing.base + writing.speedFactor * author.abilities.speed) *
        condition *
        fit *
        special.writing;
      const quality =
        (author.abilities.style + author.abilities.vocabulary + average + 105) /
        4;
      const variation =
        (rand(state.seed, day, stream.WRITING, index) - 0.5) * 0.35;
      work.quality = clamp(
        work.quality + (quality - work.quality) * 0.012 + variation,
      );
      learnAptitude(state, work, day, allotted >= 8 ? 2 : 1, content);
    }
    if (planned && work.stock >= 1) {
      work.stock -= 1;
      work.published += 1;
      work.stats.publishedToday = 1;
      work.stats.lastPosted = day;
      work.stats.streakMissed = 0;
      posted += 1;
      record(
        events,
        "CHAPTER_POSTED",
        day,
        text("engine.log.posted", {
          work_title: displayWorkTitle(work.title),
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
          work_title: displayWorkTitle(work.title),
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
      text("engine.log.growth", { work_title: displayWorkTitle(work.title) }),
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
  const special = specialModifiers(author, content);
  const allotted = sum(Object.values(routine.writing));
  const workload = routine.work + allotted;
  changeCondition(
    author,
    "health",
    routine.sleep < rules.healthySleep
      ? -(rules.healthySleep - routine.sleep) * rules.healthLoss
      : rules.healthRecovery,
  );
  changeCondition(
    author,
    "fatigue",
    Math.max(0, workload - rules.fatigueThreshold) * rules.fatigueGain -
      (routine.sleep - rules.fatigueSleepBase) * rules.fatigueRecovery,
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
      special.driveDaily -
      rules.drivePull * (author.condition.drive - rules.driveBaseline),
  );
}
