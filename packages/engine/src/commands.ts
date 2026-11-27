import type { Content, StartPath } from "@webbbbbie/content";
import {
  displayName,
  oneTimeExpenses,
  playerActionRules,
  sourceText,
  tagUnlocks,
  text,
} from "@webbbbbie/content";
import {
  activeWork,
  blankWork,
  changeCondition,
  changeSocial,
  record,
  serial,
  sum,
  workTitle,
} from "./author";
import type {
  EngineEvent,
  LifeState,
  PlayerCommandError,
  SpendPolicy,
  TimePolicy,
} from "./model";
import { transitionWork } from "./work";
import { groupDigits, transaction } from "./economy";
import { cadences } from "./cadences";
export { cadences, maskCadence } from "./cadences";

export type CommandOutcome =
  | { ok: true; state: LifeState; events: EngineEvent[] }
  | {
      ok: false;
      state: LifeState;
      events: [];
      error: PlayerCommandError;
      reason: string;
    };

type Run = (
  state: LifeState,
  content: Content,
  events: EngineEvent[],
) => { error: PlayerCommandError; reason: string } | void;

export function runCommand(
  original: LifeState,
  copy: LifeState,
  content: Content,
  run: Run,
  allowNewWork = false,
): CommandOutcome {
  if (original.phase === "ENDED")
    return {
      ok: false,
      state: original,
      events: [],
      error: "E_ENDED",
      reason: text("system.command.ended"),
    };
  if (
    original.phase === "AWAITING_CHOICE" ||
    (original.phase === "AWAITING_WORK" && !allowNewWork)
  )
    return {
      ok: false,
      state: original,
      events: [],
      error: "E_NOT_ALLOWED",
      reason: text("system.command.choice-pending"),
    };
  const events: EngineEvent[] = [];
  const failure = run(copy, content, events);
  if (failure) return { ok: false, state: original, events: [], ...failure };
  return { ok: true, state: copy, events };
}

const fail = (error: PlayerCommandError, reason: string) => ({
  error,
  reason: text(reason),
});
const findWork = (state: LifeState, id: string) =>
  state.works.find((work) => work.id === id);
const clean = (value: string, limit: number) =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, limit);
const natural = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Candidate lists for the plan form; values are the stored original names. */
export function planOptions(content: Content) {
  const unique = (values: string[]) => [...new Set(values)];
  return {
    genres: unique(content.world.works.map((work) => work.genre)),
    materials: unique(content.world.works.map((work) => work.material)),
    tags: unique([
      ...content.world.works.flatMap((work) => work.tags),
      ...tagUnlocks.map((tag) => sourceText(tag.textId)),
    ]),
  };
}

export function unlockedTagChapters(state: LifeState) {
  return Math.max(0, ...state.works.map((work) => work.published));
}

export type WorkPlan = {
  title: string;
  genre: string;
  material: string;
  tags: string[];
  platformId: string;
  perWeek: number;
};

function validatePlan(
  plan: WorkPlan,
  content: Content,
  state: LifeState,
  previousTags: string[] = [],
) {
  const options = planOptions(content);
  const title = clean(plan.title, content.balance.plan.maxTitle);
  const tags = [...new Set(plan.tags)];
  if (!title) return fail("E_INVALID_PLAN", "system.command.title-empty");
  if (
    !options.genres.includes(plan.genre) ||
    !options.materials.includes(plan.material)
  )
    return fail("E_INVALID_PLAN", "system.command.unknown-genre");
  if (
    !tags.length ||
    tags.length > content.balance.plan.maxTags ||
    tags.some((tag) => !options.tags.includes(tag))
  )
    return fail("E_INVALID_PLAN", "system.command.tags-invalid");
  const chapters = unlockedTagChapters(state);
  if (
    tags.some((name) =>
      tagUnlocks.some(
        (tag) =>
          sourceText(tag.textId) === name &&
          chapters < tag.publishedChapters &&
          !previousTags.includes(name),
      ),
    )
  )
    return fail("E_NOT_ALLOWED", "system.command.tag-locked");
  if (!content.platforms.some((item) => item.id === plan.platformId))
    return fail("E_INVALID_PLAN", "system.command.platform-invalid");
  if (!cadences.some((item) => item.perWeek === plan.perWeek))
    return fail("E_INVALID_PLAN", "system.command.cadence-invalid");
  return { title, tags };
}

export function planWork(plan: WorkPlan, path?: StartPath): Run {
  return (state, content, events) => {
    if (!state.author.startPath)
      return fail("E_NOT_ALLOWED", "system.command.no-path");
    if (
      state.works.filter(activeWork).length >=
      content.balance.life.maxActiveWorks
    )
      return fail("E_LIMIT", "system.command.work-limit");
    const checked = validatePlan(plan, content, state);
    if ("error" in checked) return checked;
    const template = content.world.works.find(
      (work) => work.genre === plan.genre,
    );
    state.works.push(
      blankWork(
        state,
        state.day,
        path ?? state.author.startPath,
        {
          title: checked.title,
          genre: plan.genre,
          material: plan.material,
          tags: checked.tags,
          platformId: plan.platformId,
          target: template?.target ?? content.balance.plan.defaultTarget,
          mask: cadences.find((item) => item.perWeek === plan.perWeek)!.mask,
          manual: true,
        },
        content,
      ),
    );
    record(
      events,
      "COMMAND",
      state.day,
      text("engine.log.cmd-plan", { work_title: checked.title }),
      state.works[state.works.length - 1].id,
    );
  };
}

export function confirmNewWork(id: string, plan: WorkPlan): Run {
  return (state, content, events) => {
    const waiting = state.pendingNewWork;
    if (state.phase !== "AWAITING_WORK" || !waiting || waiting.id !== id)
      return fail("E_NOT_ALLOWED", "system.command.no-new-work");
    const failure = planWork(plan, waiting.path)(state, content, events);
    if (failure) return failure;
    state.pendingNewWork = null;
    state.phase = "READY";
  };
}

/** Before its first chapter a work can still be reshaped (16번 §3). */
export function reviseWork(id: string, plan: WorkPlan): Run {
  return (state, content, events) => {
    const work = findWork(state, id);
    if (!work) return fail("E_NO_WORK", "system.command.no-work");
    if (work.status !== "PLANNING")
      return fail("E_NOT_ALLOWED", "system.command.revise-locked");
    const checked = validatePlan(plan, content, state, work.tags);
    if ("error" in checked) return checked;
    work.title = checked.title;
    work.manual = true;
    work.genre = plan.genre;
    work.material = plan.material;
    work.tags = checked.tags;
    work.platformId = plan.platformId;
    work.mask = cadences.find((item) => item.perWeek === plan.perWeek)!.mask;
    record(
      events,
      "COMMAND",
      state.day,
      text("engine.log.cmd-revise", { work_title: work.title }),
      work.id,
    );
  };
}

export type WorkPolicyPatch = {
  title?: string;
  perWeek?: number;
  stockTarget?: number;
  priority?: number;
};

export function setWorkPolicy(id: string, patch: WorkPolicyPatch): Run {
  return (state, content, events) => {
    const work = findWork(state, id);
    if (!work) return fail("E_NO_WORK", "system.command.no-work");
    if (!activeWork(work))
      return fail("E_NOT_ALLOWED", "system.command.work-closed");
    if (patch.title !== undefined) {
      const title = clean(patch.title, content.balance.plan.maxTitle);
      if (!title) return fail("E_INVALID_PLAN", "system.command.title-empty");
      work.title = title;
      work.manual = true;
    }
    if (patch.perWeek !== undefined) {
      const cadence = cadences.find((item) => item.perWeek === patch.perWeek);
      if (!cadence)
        return fail("E_INVALID_PLAN", "system.command.cadence-invalid");
      work.mask = cadence.mask;
    }
    if (patch.stockTarget !== undefined) {
      if (
        !natural(patch.stockTarget) ||
        patch.stockTarget > content.balance.plan.stockTargetMax
      )
        return fail("E_INVALID_PLAN", "system.command.stock-invalid");
      work.stockTarget = patch.stockTarget;
    }
    if (patch.priority !== undefined) {
      if (![1, 2, 3].includes(patch.priority))
        return fail("E_INVALID_PLAN", "system.command.priority-invalid");
      work.priority = patch.priority;
    }
    record(
      events,
      "COMMAND",
      state.day,
      text("engine.log.cmd-policy", {
        work_title: workTitle(work),
      }),
      work.id,
    );
  };
}

/** 연참: post one extra chapter a day for the next few days if stock allows. */
export function rushWork(id: string, days: number): Run {
  return (state, content, events) => {
    const work = findWork(state, id);
    if (!work) return fail("E_NO_WORK", "system.command.no-work");
    if (!serial(work))
      return fail("E_NOT_ALLOWED", "system.command.not-serial");
    if (!natural(days) || days > 3)
      return fail("E_INVALID_PLAN", "system.command.rush-invalid");
    work.rush = days;
    record(
      events,
      "COMMAND",
      state.day,
      text(days ? "engine.log.cmd-rush" : "engine.log.cmd-rush-cancel", {
        work_title: workTitle(work),
        days,
      }),
      work.id,
    );
    void content;
  };
}

/** Completion still requires writing and releasing every remaining chapter. */
export function prepareEnding(id: string, remaining: number): Run {
  return (state, _content, events) => {
    const work = findWork(state, id);
    if (!work) return fail("E_NO_WORK", "system.command.no-work");
    if (!serial(work) && work.status !== "HIATUS")
      return fail("E_NOT_ALLOWED", "system.command.not-serial");
    if (
      !natural(remaining) ||
      remaining < 1 ||
      remaining > playerActionRules.endingMaxRemaining ||
      remaining < Math.ceil(work.stock)
    )
      return fail("E_INVALID_PLAN", "system.command.ending-invalid");
    work.targetChapters = work.published + remaining;
    work.endingTarget = work.targetChapters;
    record(
      events,
      "COMMAND",
      state.day,
      text("engine.log.ending-plan", {
        work_title: workTitle(work),
        chapters: remaining,
      }),
      work.id,
    );
  };
}

/** Add a one-hour writing attempt to the next day, using rest or unused time. */
export function extraWrite(id: string, requested: boolean): Run {
  return (state, _content, events) => {
    const work = findWork(state, id);
    if (!work) return fail("E_NO_WORK", "system.command.no-work");
    if (
      requested &&
      !serial(work) &&
      !(work.status === "HIATUS" && work.hiatusKind === "STOCK")
    )
      return fail("E_NOT_ALLOWED", "system.command.no-writing");
    if (work.extraWriting === requested)
      return fail(
        "E_NOT_ALLOWED",
        requested
          ? "system.command.writing-already-queued"
          : "system.command.writing-not-queued",
      );
    work.extraWriting = requested;
    record(
      events,
      "COMMAND",
      state.day,
      text(
        requested
          ? "engine.log.cmd-extra-write"
          : "engine.log.cmd-extra-cancel",
        {
          work_title: workTitle(work),
        },
      ),
      work.id,
    );
  };
}

export function hiatusWork(
  id: string,
  kind: "RECOVER" | "STOCK",
  days: number,
): Run {
  return (state, content, events) => {
    const work = findWork(state, id);
    if (!work) return fail("E_NO_WORK", "system.command.no-work");
    if (!serial(work))
      return fail("E_NOT_ALLOWED", "system.command.not-serial");
    if (!natural(days) || days < 1 || days > 60)
      return fail("E_INVALID_PLAN", "system.command.hiatus-invalid");
    transitionWork(work, "HIATUS", state.day, events, days + 1, false);
    work.hiatusKind = kind;
    record(
      events,
      "COMMAND",
      state.day,
      text("engine.log.cmd-hiatus", {
        work_title: workTitle(work),
        days,
      }),
      work.id,
    );
    void content;
  };
}

export function resumeWork(id: string): Run {
  return (state, content, events) => {
    const work = findWork(state, id);
    if (!work) return fail("E_NO_WORK", "system.command.no-work");
    if (work.status !== "HIATUS")
      return fail("E_NOT_ALLOWED", "system.command.not-hiatus");
    if (work.hiatusLockedUntil !== null && state.day < work.hiatusLockedUntil)
      return fail("E_NOT_ALLOWED", "system.command.hiatus-forced");
    if (state.author.condition.health < content.balance.writing.resumeHealth)
      return fail("E_NOT_ALLOWED", "system.command.resume-health");
    transitionWork(work, work.resumeTo ?? "SERIAL_FREE", state.day, events);
    record(
      events,
      "COMMAND",
      state.day,
      text("engine.log.cmd-resume", {
        work_title: workTitle(work),
      }),
      work.id,
    );
    void content;
  };
}

/** 연중: the player stops a work for good; reputation and mood take a hit. */
export function dropWork(id: string): Run {
  return (state, content, events) => {
    const work = findWork(state, id);
    if (!work) return fail("E_NO_WORK", "system.command.no-work");
    if (!serial(work) && work.status !== "HIATUS" && work.status !== "PLANNING")
      return fail("E_NOT_ALLOWED", "system.command.cannot-drop");
    transitionWork(work, "DROPPED", state.day, events);
    work.rush = 0;
    work.extraWriting = false;
    const { plan } = content.balance;
    changeSocial(state.author, "reputation", plan.dropReputation);
    changeCondition(state.author, "stress", plan.dropStress);
    record(
      events,
      "COMMAND",
      state.day,
      text("engine.log.cmd-drop", { work_title: workTitle(work) }),
      work.id,
    );
  };
}

export function maxFreeUnits(state: LifeState, content: Content) {
  const job = content.world.jobs.find(
    (item) => item.id === state.author.jobId,
  )!;
  const { time } = content.balance;
  return time.day - time.living - (job.slots + job.irregularity);
}

export function setTimePolicy(plan: TimePolicy): Run {
  return (state, content, events) => {
    const keys = ["sleep", "plot", "community", "ego", "rest"] as const;
    if (!keys.every((key) => natural(plan[key])))
      return fail("E_INVALID_PLAN", "system.command.time-invalid");
    if (plan.sleep < content.balance.time.minSleep)
      return fail("E_INVALID_PLAN", "system.command.sleep-min");
    if (sum(keys.map((key) => plan[key])) > maxFreeUnits(state, content))
      return fail("E_INVALID_PLAN", "system.command.time-over");
    state.author.policy.time = { ...plan };
    record(events, "COMMAND", state.day, text("engine.log.cmd-time"));
  };
}

export function setSpendPolicy(plan: SpendPolicy): Run {
  return (state, _content, events) => {
    const keys = Object.keys(
      state.author.policy.spend,
    ) as (keyof SpendPolicy)[];
    if (
      !keys.every(
        (key) =>
          Number.isInteger(plan[key]) && plan[key] >= 0 && plan[key] <= 3,
      )
    )
      return fail("E_INVALID_PLAN", "system.command.spend-invalid");
    state.author.policy.spend = { ...plan };
    record(events, "COMMAND", state.day, text("engine.log.cmd-spend"));
  };
}

/** Immediate, bounded purchases are distinct from the recurring spending policy. */
export function purchase(id: string): Run {
  return (state, _content, events) => {
    const item = oneTimeExpenses.find((entry) => entry.id === id);
    if (!item) return fail("E_INVALID_PLAN", "system.purchase.invalid");
    const previous = state.author.purchases[id];
    if (previous !== undefined && state.day < previous + item.cooldownDays)
      return fail("E_NOT_ALLOWED", "system.purchase.cooldown");
    if (state.author.cash < item.cost)
      return fail("E_NOT_ALLOWED", "system.purchase.insufficient");
    transaction(state, state.day, "SPEND", -item.cost, "purchase:" + id);
    state.author.purchases[id] = state.day;
    for (const [stat, amount] of Object.entries(item.effects))
      changeCondition(
        state.author,
        stat as keyof typeof state.author.condition,
        amount,
      );
    record(
      events,
      "COMMAND",
      state.day,
      text("engine.log.purchase", {
        item: text("entity.purchase." + id + ".name"),
        cost: groupDigits(item.cost),
      }),
    );
  };
}

export function setAutoPlan(on: boolean): Run {
  return (state, _content, events) => {
    state.author.policy.autoPlan = on;
    record(
      events,
      "COMMAND",
      state.day,
      text(on ? "engine.log.cmd-auto-on" : "engine.log.cmd-auto-off"),
    );
  };
}

/** 작가 생활 종료: a voluntary ending (16번 §10). Saving or pausing never ends a life. */
export function retire(): Run {
  return (state, _content, events) => {
    if (state.pending)
      return fail("E_NOT_ALLOWED", "system.command.retire-pending");
    state.ending = { day: state.day, reason: "VOLUNTARY" };
    state.phase = "ENDED";
    state.pending = null;
    record(events, "COMMAND", state.day, text("engine.log.cmd-retire"));
  };
}

export function lifeSummary(state: LifeState, content: Content) {
  const works = state.works;
  const best = works.reduce<(typeof works)[number] | null>(
    (top, work) =>
      !top || work.stats.totalViews > top.stats.totalViews ? work : top,
    null,
  );
  const count = (reason: string) =>
    works.filter((work) => work.end?.reason === reason).length;
  return {
    endedDay: state.ending?.day ?? state.day,
    ended: state.phase === "ENDED",
    days: state.day,
    works: works.length,
    completed: count("COMPLETED"),
    rushed: count("RUSHED_END"),
    dropped: count("DROPPED"),
    takenDown: count("TAKEN_DOWN"),
    chapters: sum(works.map((work) => work.published)),
    totalViews: Math.floor(sum(works.map((work) => work.stats.totalViews))),
    bestViews: best ? Math.floor(best.stats.totalViews) : 0,
    bestTitle: best ? workTitle(best) : null,
    bestFavorites: Math.floor(
      Math.max(0, ...works.map((work) => work.stats.favorites)),
    ),
    earned: sum(works.map((work) => work.revenue.paid)),
    cash: state.author.cash,
    recognition: Math.floor(state.author.social.recognition),
    contracts: state.contracts.length,
    job: displayName(
      "entity.job",
      content.world.jobs.find((job) => job.id === state.author.jobId)?.name ??
        state.author.jobId,
    ),
    states: state.author.specialStates.length,
  };
}
