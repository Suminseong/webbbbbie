import type { Condition, Content, Effect, EventDef } from "@webbbbbie/content";
import {
  activeWork,
  changeCondition,
  changeSocial,
  clamp,
  createWork,
  learnAptitude,
  record,
  sum,
} from "./author";
import { activeContract, transaction } from "./economy";
import type {
  EngineEvent,
  EventInstance,
  LifeState,
  Target,
  Work,
} from "./model";
import { pick, rand, stream, weighted } from "./rng";
import { canTransition, transitionWork } from "./work";

type Candidate = { def: EventDef; targets: Target[]; scheduled?: string };
const noTarget = (scope: Target["scope"]): Target => ({ scope, id: null });
const targetWork = (state: LifeState, target: Target) =>
  target.scope === "WORK"
    ? state.works.find((item) => item.id === target.id)
    : target.scope === "CONTRACT"
      ? state.works.find(
          (item) =>
            item.id ===
            state.contracts.find((contract) => contract.id === target.id)
              ?.workId,
        )
      : undefined;

function matches(
  state: LifeState,
  content: Content,
  rule: Condition,
  work: Work | undefined,
  day: number,
) {
  const { author } = state;
  let actual: string | number | undefined;
  switch (rule.key) {
    case "health":
    case "fatigue":
    case "stress":
    case "drive":
      actual = author.condition[rule.key];
      break;
    case "cash":
      actual = author.cash;
      break;
    case "job":
      actual = author.jobId;
      break;
    case "jobSlots":
      actual = content.world.jobs.find((job) => job.id === author.jobId)?.slots;
      break;
    case "paid":
      actual = sum(state.works.map((item) => item.revenue.paid));
      break;
    case "published":
      actual = work?.published;
      break;
    case "maxPublished":
      actual = Math.max(
        0,
        ...state.works.filter(activeWork).map((item) => item.published),
      );
      break;
    case "activeWorks":
      actual = state.works.filter(activeWork).length;
      break;
    case "canAddWork":
      actual = Number(
        state.works.filter(activeWork).length <
          content.balance.life.maxActiveWorks,
      );
      break;
    case "canContract":
      actual = Number(!!work && !activeContract(state, work, day));
      break;
    case "demand":
      actual = author.social.demand;
      break;
    case "egoUse":
      actual = author.lastRoutine?.ego ?? 0;
      break;
    case "communityUse":
      actual = author.lastRoutine?.community ?? 0;
      break;
    case "path":
      actual = work?.startPath ?? author.startPath ?? undefined;
      break;
    case "targetFlag": {
      const key = String(rule.value).split(":")[0];
      actual = key + ":" + String((work?.flags ?? state.flags).includes(key));
      break;
    }
    case "special": {
      const key = String(rule.value).replace(/:(true|false)$/, "");
      actual =
        key +
        ":" +
        String(author.specialStates.some((entry) => entry.key === key));
      break;
    }
    case "recognition":
    case "reputation":
    case "fandom":
    case "expectation":
      actual = author.social[rule.key];
      break;
    case "favorites":
      actual = work?.stats.favorites;
      break;
    case "quality":
      actual = work?.quality;
      break;
    case "stock":
      actual = work?.stock;
      break;
    case "contracted":
      actual = Number(!!work && !!activeContract(state, work, day));
      break;
    case "completedWorks":
      actual = state.works.filter(
        (item) => item.end?.reason === "COMPLETED",
      ).length;
      break;
    case "totalWorks":
      actual = state.works.length;
      break;
    case "multitask":
      actual = author.traits.multitask;
      break;
    case "insight":
      actual = author.abilities.insight;
      break;
    case "workAge":
      actual = work ? day - work.startDay : undefined;
      break;
  }
  if (rule.op === "eq") return actual === rule.value;
  if (typeof actual !== "number" || typeof rule.value !== "number")
    return false;
  return rule.op === "gte" ? actual >= rule.value : actual <= rule.value;
}

/** Transition targets of every effect an event can apply, cached per definition. */
const transitionCache = new WeakMap<EventDef, Work["status"][]>();
function transitionsOf(def: EventDef) {
  let found = transitionCache.get(def);
  if (!found) {
    found = (
      def.effects ??
      def.choices?.flatMap((choice) => choice.effects) ??
      []
    )
      .filter((effect) => effect.kind === "transition")
      .map((effect) => (effect as { to: Work["status"] }).to);
    transitionCache.set(def, found);
  }
  return found;
}

function eligibleTarget(
  state: LifeState,
  content: Content,
  def: EventDef,
  target: Target,
  day: number,
) {
  const work = targetWork(state, target);
  if (
    def.scope !== target.scope ||
    ((target.scope === "WORK" || target.scope === "CONTRACT") && !work)
  )
    return false;
  if (def.statuses && (!work || !def.statuses.includes(work.status)))
    return false;
  if (work && transitionsOf(def).some((to) => !canTransition(work.status, to)))
    return false;
  return (
    (def.conditions ?? []).every((rule) =>
      matches(state, content, rule, work, day),
    ) &&
    (!def.any ||
      def.any.some((rule) => matches(state, content, rule, work, day)))
  );
}

function eligibleEvent(
  state: LifeState,
  content: Content,
  def: EventDef,
  day: number,
  fixed?: Target,
) {
  const last = state.eventLast["event:" + def.id] ?? -10000;
  const config = content.balance.events;
  const cooldown =
    def.tier === "FORCED"
      ? Math.max(def.cooldown, config.forcedSameCooldown)
      : def.cooldown;
  if (day < def.minDay || (def.once && last >= 0) || day - last <= cooldown)
    return [];
  if (
    def.tier === "FORCED" &&
    day - state.lastForced <= config.forcedGlobalCooldown
  )
    return [];
  const targets: Target[] = fixed
    ? [fixed]
    : def.scope === "WORK"
      ? state.works
          // Cheap status prefilter before the full condition check: most work
          // events only concern serializing works, not the backlist.
          .filter((work) => !def.statuses || def.statuses.includes(work.status))
          .map((work) => ({ scope: "WORK", id: work.id }))
      : def.scope === "CONTRACT"
        ? state.contracts
            .filter(
              (contract) =>
                contract.status === "ACTIVE" && day <= contract.expiresDay,
            )
            .map((contract) => ({ scope: "CONTRACT", id: contract.id }))
        : [noTarget(def.scope)];
  return targets.filter((candidate) =>
    eligibleTarget(state, content, def, candidate, day),
  );
}

export function originEvent(state: LifeState, content: Content): EventInstance {
  const def = content.events.find((entry) => entry.tier === "ORIGIN")!;
  return {
    id: "EV-0",
    defId: def.id,
    day: 0,
    tier: def.tier,
    target: noTarget("AUTHOR"),
    choiceIds: def
      .choices!.filter((choice) =>
        choice.effects.some(
          (effect) =>
            effect.kind === "origin" &&
            state.author.paths.includes(effect.path),
        ),
      )
      .map((choice) => choice.id),
    resolvedChoice: null,
    offerCompanyId: null,
    followUpId: null,
    status: "PENDING",
  };
}

/** Relative chance of a candidate work becoming the event target (T-08). */
function targetWeight(def: EventDef, work: Work | undefined) {
  if (!work) return 1;
  switch (def.targetBias) {
    case "views":
      return 1 + work.stats.views / 150;
    case "newest":
      return 1 + work.startDay / 30;
    case "stock":
      return 1 / (1 + work.stock);
    default:
      return 1;
  }
}

export function selectEvent(
  state: LifeState,
  content: Content,
  day: number,
): EventInstance {
  const regular: Candidate[] = [];
  const forced: Candidate[] = [];
  const due: Candidate[] = [];
  for (const def of content.events) {
    if (def.tier === "REGULAR" || def.tier === "FORCED") {
      const targets = eligibleEvent(state, content, def, day);
      if (targets.length)
        (def.tier === "FORCED" ? forced : regular).push({ def, targets });
    }
  }
  for (const item of state.followUps) {
    if (day < item.dueDay || day > item.expiresDay) continue;
    const def = content.events.find((entry) => entry.id === item.defId)!;
    const targets = eligibleEvent(state, content, def, day, item.target);
    if (targets.length) due.push({ def, targets, scheduled: item.id });
  }
  const skipPriority =
    state.priorityStreak >= content.balance.events.maxPriorityStreak &&
    regular.length > 0;
  const fallback = content.events.find((entry) => entry.tier === "FALLBACK")!;
  const pool: Candidate[] =
    !skipPriority && due.length
      ? due
      : !skipPriority && forced.length
        ? forced
        : regular.length
          ? regular
          : [{ def: fallback, targets: [noTarget("NONE")] }];
  // C-08: regular choice events are damped right after a choice and boosted
  // once the gap reaches choiceIntervalMax, steering the interval median
  // toward choiceIntervalMin..Max without forbidding back-to-back choices.
  const config = content.balance.events;
  // No daily choice yet (the day-0 origin is not counted) means no damping.
  const gap = day - (state.eventLast["choice:global"] ?? -10000);
  const choiceFactor =
    gap < config.choiceGapFloor
      ? 0
      : gap < config.choiceIntervalMin
        ? 0.3
        : gap >= config.choiceIntervalMax
          ? 3
          : 1;
  const weightOf = (item: Candidate) =>
    item.def.tier === "REGULAR" && item.def.choices
      ? item.def.weight * choiceFactor
      : item.def.weight;
  const drawable = pool.some((item) => weightOf(item) > 0)
    ? pool.filter((item) => weightOf(item) > 0)
    : pool === regular
      ? [{ def: fallback, targets: [noTarget("NONE")] }]
      : pool;
  const one = weighted(
    drawable,
    weightOf,
    rand(state.seed, day, stream.EVENT, 0),
  );
  const target = weighted(
    one.targets,
    (candidate) => targetWeight(one.def, targetWork(state, candidate)),
    rand(state.seed, day, stream.TARGET, 0),
  );
  return {
    id: "EV-" + day,
    defId: one.def.id,
    day,
    tier: one.def.tier,
    target,
    choiceIds: one.def.choices?.map((choice) => choice.id) ?? [],
    resolvedChoice: null,
    offerCompanyId: one.def.offer
      ? pick(content.world.companies, rand(state.seed, day, stream.TARGET, 1))
          .id
      : null,
    followUpId: one.scheduled ?? null,
    status: "PENDING",
  };
}

function signContract(
  state: LifeState,
  content: Content,
  work: Work,
  instance: EventInstance,
) {
  const day = instance.day;
  const company = content.world.companies.find(
    (entry) => entry.id === instance.offerCompanyId,
  );
  if (!company || activeContract(state, work, day)) return;
  const id = "C-" + (state.contracts.length + 1);
  state.contracts.push({
    id,
    workId: work.id,
    companyId: company.id,
    signedDay: day,
    expiresDay: day + company.duration,
    share: company.share,
    advance: company.advance,
    promise: company.promise,
    promotionStart: day + 4,
    promotionEnd: day + 14,
    status: "ACTIVE",
  });
  work.contractId = id;
  transaction(state, day, "ADVANCE", company.advance, id, work.id);
}

function applyEffect(
  state: LifeState,
  content: Content,
  instance: EventInstance,
  effect: Effect,
  events: EngineEvent[],
) {
  const { author } = state;
  const work = targetWork(state, instance.target);
  const day = instance.day;
  switch (effect.kind) {
    case "condition":
      changeCondition(author, effect.stat, effect.amount);
      break;
    case "social":
      changeSocial(author, effect.stat, effect.amount);
      break;
    case "special": {
      const existing = author.specialStates.find(
        (item) => item.key === effect.key,
      );
      if (existing)
        existing.until = Math.max(existing.until, day + effect.days);
      else
        author.specialStates.push({
          key: effect.key,
          until: day + effect.days,
        });
      break;
    }
    case "origin":
      author.startPath = effect.path;
      createWork(state, content, day, effect.path);
      break;
    case "transition":
      if (work)
        transitionWork(
          work,
          effect.to,
          day,
          events,
          effect.days ?? content.balance.writing.defaultHiatus,
        );
      break;
    case "stock":
      if (work) work.stock = Math.max(0, work.stock + effect.amount);
      break;
    case "quality":
      if (work) work.quality = clamp(work.quality + effect.amount);
      break;
    case "readerShock":
      if (work) {
        work.readers = work.readers.map((age) =>
          age.map((count) => count * (1 - effect.amount)),
        );
        work.caughtUp = work.caughtUp.map(
          (count) => count * (1 - effect.amount),
        );
      }
      break;
    case "createWork":
      if (author.startPath) createWork(state, content, day, "ORIGINAL");
      break;
    case "cash":
      transaction(state, day, "EVENT", effect.amount, instance.id, work?.id);
      break;
    case "job":
      author.jobId = effect.id;
      break;
    case "evidence":
      if (work) learnAptitude(state, work, day, effect.amount, content, true);
      break;
    case "contract":
      if (work) signContract(state, content, work, instance);
      break;
    case "flag": {
      const flags = work?.flags ?? state.flags;
      if (!flags.includes(effect.key)) flags.push(effect.key);
      break;
    }
    case "ability":
      author.abilities[effect.stat] = clamp(
        author.abilities[effect.stat] + effect.amount,
      );
      break;
    case "attachment":
      if (work) work.attachment = clamp(work.attachment + effect.amount);
      break;
    case "consistency":
      if (work) work.consistency = clamp(work.consistency + effect.amount);
      break;
    case "promotion":
      if (work)
        work.stats.promotionUntil = Math.max(
          work.stats.promotionUntil,
          day + effect.days,
        );
      break;
    case "clearSpecial":
      author.specialStates = author.specialStates.filter(
        (item) => item.key !== effect.key,
      );
      break;
    case "schedule":
      if (
        !state.followUps.some(
          (item) =>
            item.defId === effect.id && item.target.id === instance.target.id,
        )
      ) {
        state.followUps.push({
          id: instance.id + ":" + effect.id,
          defId: effect.id,
          from: instance.id,
          target: { ...instance.target },
          dueDay: day + effect.delay,
          expiresDay: day + effect.delay + effect.window,
        });
      }
      break;
  }
}

export function applyEvent(
  state: LifeState,
  content: Content,
  instance: EventInstance,
  choiceId: string | null,
  events: EngineEvent[],
) {
  const definition = content.events.find(
    (entry) => entry.id === instance.defId,
  )!;
  const selected = definition.choices?.find((choice) => choice.id === choiceId);
  const effects = selected?.effects ?? definition.effects ?? [];
  if (selected)
    record(
      events,
      "CHOICE_RESOLVED",
      instance.day,
      selected.label,
      instance.target.id,
    );
  for (const effect of effects)
    applyEffect(state, content, instance, effect, events);
  if (effects.length)
    record(
      events,
      "EFFECT_APPLIED",
      instance.day,
      definition.title + " · 결과 반영",
      instance.target.id,
    );
  const resolved: EventInstance = {
    ...instance,
    status: "RESOLVED",
    resolvedChoice: choiceId,
  };
  const key = "event:" + definition.id;
  state.eventLast[key] = instance.day;
  state.eventCount[key] = (state.eventCount[key] ?? 0) + 1;
  if (selected && instance.day > 0)
    state.eventLast["choice:global"] = instance.day;
  if (instance.tier === "FORCED") state.lastForced = instance.day;
  state.priorityStreak =
    instance.tier === "FORCED" || instance.tier === "FOLLOW_UP"
      ? state.priorityStreak + 1
      : 0;
  const expired = state.followUps.some(
    (item) => instance.day > item.expiresDay,
  );
  if (expired && !state.flags.includes("followUpExpired"))
    state.flags.push("followUpExpired");
  state.followUps = state.followUps.filter(
    (item) =>
      item.id !== instance.followUpId && instance.day <= item.expiresDay,
  );
  state.eventHistory.push(resolved);
  const limit = content.balance.events.eventHistoryKeep;
  if (state.eventHistory.length > limit)
    state.eventHistory.splice(0, state.eventHistory.length - limit);
  state.archive.push([definition.id, instance.target.id, choiceId]);
}
