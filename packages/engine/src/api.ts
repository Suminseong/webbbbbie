import {
  companyTraits,
  defaultContent,
  matchingText,
  oneTimeExpenses,
  playerActionRules,
  sourceText,
  tagUnlocks,
  text,
} from "@webbbbbie/content";
import type { Content } from "@webbbbbie/content";
import { createAuthor, record, sum } from "./author";
import {
  compactLedger,
  settle,
  transaction,
  updateContracts,
  updateDemand,
} from "./economy";
import {
  dropWork as buildDropWork,
  confirmNewWork as buildConfirmNewWork,
  extraWrite as buildExtraWrite,
  hiatusWork as buildHiatusWork,
  lifeSummary,
  planWork as buildPlanWork,
  purchase as buildPurchase,
  prepareEnding as buildPrepareEnding,
  resumeWork as buildResumeWork,
  retire as buildRetire,
  reviseWork as buildReviseWork,
  runCommand,
  rushWork as buildRushWork,
  setAutoPlan as buildSetAutoPlan,
  setSpendPolicy as buildSetSpendPolicy,
  setTimePolicy as buildSetTimePolicy,
  setWorkPolicy as buildSetWorkPolicy,
} from "./commands";
import type { WorkPlan, WorkPolicyPatch } from "./commands";
import { applyEvent, originEvent, selectEvent } from "./events";
import { applyStateBehaviors, updateStates } from "./states";
import {
  envelopeSchema,
  neverEnd,
  RULES_VERSION,
  SCHEMA_VERSION,
} from "./model";
import type {
  AdvanceResult,
  CommandError,
  EngineEvent,
  EventInstance,
  LifeEndPolicy,
  LifeState,
  SpendPolicy,
  TimePolicy,
} from "./model";
import { resolveAudience } from "./readership";
import { fingerprint } from "./rng";
import { cadences } from "./cadences";
import {
  aptitudeView,
  authorView,
  contractViews,
  lifeSettingsView,
  planOptionsView,
  ledgerView,
  pendingView,
  workView,
  newWorkView,
} from "./views";
import {
  finishWorks,
  planRoutine,
  prepareWorks,
  updateCondition,
  writeAndPublish,
} from "./work";

export type {
  LifeState,
  AdvanceResult,
  CommandError,
  EngineEvent,
  LifeEndPolicy,
} from "./model";
export { abilityNames, conditionNames, ledgerNames } from "./views";
export { cadences } from "./commands";
export type { WorkPlan, WorkPolicyPatch } from "./commands";
export type { PlayerCommandError, SpendPolicy, TimePolicy } from "./model";

type ChoiceResult =
  | { ok: true; state: LifeState; events: EngineEvent[] }
  | { ok: false; state: LifeState; events: []; error: CommandError };
type LoadResult =
  { ok: true; state: LifeState } | { ok: false; error: CommandError };

function copyForCommand(state: LifeState): LifeState {
  // Prior journal entries and inner reader cohorts are immutable. The daily
  // reader pass replaces cohorts, so a command only copies their outer arrays.
  const author = state.author;
  return {
    ...state,
    author: {
      ...author,
      abilities: { ...author.abilities },
      condition: { ...author.condition },
      social: { ...author.social },
      specialStates: author.specialStates.map((entry) => ({ ...entry })),
      policy: {
        ...author.policy,
        time: { ...author.policy.time },
        spend: { ...author.policy.spend },
      },
      deviations: [...author.deviations],
      purchases: { ...author.purchases },
      aptitudes: author.aptitudes.map((entry) => ({ ...entry })),
    },
    works: state.works.map((work) => ({
      ...work,
      stats: { ...work.stats },
      revenue: { ...work.revenue },
      readers: [...work.readers],
      caughtUp: [...work.caughtUp],
      flags: [...work.flags],
      history: [...work.history],
      end: work.end ? { ...work.end } : null,
    })),
    contracts: state.contracts.map((entry) => ({
      ...entry,
      record: { ...entry.record },
    })),
    ledger: [...state.ledger],
    ledgerCarry: { ...state.ledgerCarry },
    companyRecords: Object.fromEntries(
      Object.entries(state.companyRecords).map(([id, entry]) => [
        id,
        { ...entry },
      ]),
    ),
    flags: [...state.flags],
    eventLast: { ...state.eventLast },
    eventCount: { ...state.eventCount },
    followUps: [...state.followUps],
    eventHistory: [...state.eventHistory],
    archive: [...state.archive],
    summaries: [...state.summaries],
  };
}

const LEGACY_HASH_030 = "ea70dee1";
const LEGACY_HASH_031 = "3916f2ee";
const LEGACY_HASH_032 = "1d93c10d";
const LEGACY_HASH_033 = "9eb5a1e7";

export function createEngine(
  content: Content = defaultContent,
  lifeEnd: LifeEndPolicy = neverEnd,
) {
  const contentHash = fingerprint(
    JSON.stringify({
      content,
      playerActionRules,
      oneTimeExpenses,
      tagUnlocks,
      companyTraits,
    }),
  );
  const keep = content.balance.events;
  function addLog(state: LifeState, events: readonly EngineEvent[]) {
    state.log = state.log.concat(events).slice(-keep.logKeep);
    for (const work of state.works) {
      if (!work.detail) continue;
      work.detail.journal = work.detail.journal
        .concat(
          events.filter(
            (row) =>
              row.workId === work.id &&
              [
                "EFFECT_APPLIED",
                "WORK_STATUS_CHANGED",
                "COMMAND",
                "WORK_ORDER",
                "PAYOUT",
                "WORK_EXPOSURE",
              ].includes(row.type),
          ),
        )
        .filter(
          (row) =>
            row.day >= state.day - content.balance.economy.ledgerKeepDays,
        )
        .slice(-200);
    }
  }

  function createLife(seed: number): LifeState {
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295)
      throw new RangeError("시드는 0~4294967295의 정수여야 합니다.");
    const state: LifeState = {
      schemaVersion: SCHEMA_VERSION,
      rulesVersion: RULES_VERSION,
      contentHash,
      seed,
      day: 0,
      phase: "AWAITING_CHOICE",
      author: createAuthor(seed, content),
      works: [],
      contracts: [],
      ledger: [],
      ledgerCarry: {},
      ledgerSeq: 0,
      companyRecords: {},
      flags: [],
      eventLast: {},
      eventCount: {},
      lastForced: -10000,
      priorityStreak: 0,
      followUps: [],
      eventHistory: [],
      archive: [],
      pending: null,
      pendingNewWork: null,
      ending: null,
      log: [],
      summaries: [],
    };
    state.pending = originEvent(state, content);
    return state;
  }

  function closeDay(
    state: LifeState,
    instance: EventInstance,
    selection: string | null,
    events: EngineEvent[],
  ) {
    const { day } = instance;
    const def = content.events.find((item) => item.id === instance.defId)!;
    state.pending = null;
    state.phase = "READY";
    applyEvent(state, content, instance, selection, events);
    if (day === 0) return;
    state.author.specialStates = state.author.specialStates.filter(
      (status) => day < status.until,
    );
    prepareWorks(state, content, day, events);
    applyStateBehaviors(state, content, day, events);
    const time = planRoutine(state, content, day);
    state.author.lastRoutine = time;
    // Extra shifts forced by a state (현생이슈) pay a small day wage.
    const extra = time.work - (state.author.lastPlan?.work ?? time.work);
    if (extra > 0)
      transaction(
        state,
        day,
        "SALARY",
        extra * content.balance.plan.sideWage,
        "sidejob",
      );
    const posted = writeAndPublish(state, content, time, day, events);
    updateContracts(state, content, day, events);
    const gained = resolveAudience(state, content, day, events);
    settle(state, content, day, events);
    compactLedger(state, content, day);
    finishWorks(state, content, day, events);
    updateCondition(state, content, time);
    updateStates(state, content, day, events);
    updateDemand(state);
    state.day = day;
    state.summaries.push({
      day,
      eventId: def.id,
      eventTitle: def.title,
      time,
      newReaders: sum(state.works.map((work) => work.stats.newReaders)),
      views: sum(state.works.map((work) => work.stats.views)),
      posted,
      gained,
      cash: state.author.cash,
      condition: { ...state.author.condition },
    });
    if (state.summaries.length > keep.summaryKeep) state.summaries.shift();
    if (lifeEnd(state)) state.phase = "ENDED";
    else if (state.pendingNewWork) state.phase = "AWAITING_WORK";
    record(events, "DAY_CLOSED", day, text("engine.log.day-closed", { day }));
  }

  function advance(state: LifeState, days = 1): AdvanceResult {
    if (!Number.isSafeInteger(days) || days < 0)
      throw new RangeError("진행 일수는 0 이상의 정수여야 합니다.");
    if (state.phase !== "READY" || days === 0) {
      return {
        state,
        events: [],
        stoppedReason: state.phase === "READY" ? "DAYS_DONE" : state.phase,
      };
    }
    const next = copyForCommand(state);
    const events: EngineEvent[] = [];
    for (let offset = 0; offset < days && next.phase === "READY"; offset += 1) {
      const day = next.day + 1;
      const selected = selectEvent(next, content, day);
      const def = content.events.find((entry) => entry.id === selected.defId)!;
      const eventTitle = matchingText("event." + def.id + ".title", def.title);
      record(
        events,
        "DAY_STARTED",
        day,
        text("engine.log.day-started", { day }),
      );
      record(events, "EVENT_SELECTED", day, eventTitle, selected.target.id);
      if (selected.choiceIds.length) {
        next.phase = "AWAITING_CHOICE";
        next.pending = selected;
        record(events, "CHOICE_REQUIRED", day, eventTitle, selected.target.id);
        break;
      }
      closeDay(next, selected, null, events);
    }
    addLog(next, events);
    return {
      state: next,
      events,
      stoppedReason: next.phase === "READY" ? "DAYS_DONE" : next.phase,
    };
  }

  function choose(
    state: LifeState,
    eventInstanceId: string,
    choiceId: string,
  ): ChoiceResult {
    if (state.phase !== "AWAITING_CHOICE" || !state.pending)
      return { ok: false, state, events: [], error: "E_NO_PENDING" };
    if (
      state.pending.id !== eventInstanceId ||
      !state.pending.choiceIds.includes(choiceId)
    ) {
      return { ok: false, state, events: [], error: "E_INVALID_CHOICE" };
    }
    const next = copyForCommand(state);
    const events: EngineEvent[] = [];
    closeDay(next, next.pending!, choiceId, events);
    addLog(next, events);
    return { ok: true, state: next, events };
  }

  function command(
    state: LifeState,
    run: Parameters<typeof runCommand>[3],
    allowNewWork = false,
  ): ReturnType<typeof runCommand> {
    const outcome = runCommand(
      state,
      copyForCommand(state),
      content,
      run,
      allowNewWork,
    );
    if (outcome.ok) addLog(outcome.state, outcome.events);
    return outcome;
  }

  function serialize(state: LifeState) {
    return JSON.stringify({
      format: "webnovel-life-save",
      schemaVersion: SCHEMA_VERSION,
      rulesVersion: RULES_VERSION,
      contentHash,
      savedAtDay: state.day,
      phase: state.phase,
      state,
    });
  }

  function deserialize(text: string): LoadResult {
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      return { ok: false, error: "E_SAVE_CORRUPT" };
    }
    if (
      !decoded ||
      typeof decoded !== "object" ||
      !("format" in decoded) ||
      decoded.format !== "webnovel-life-save"
    ) {
      return { ok: false, error: "E_SAVE_CORRUPT" };
    }
    const version = decoded as Record<string, unknown>;
    const current =
      version.schemaVersion === SCHEMA_VERSION &&
      version.rulesVersion === RULES_VERSION &&
      version.contentHash === contentHash;
    // Content changed since these releases, so their hashes are fixed values.
    const fromV030 =
      version.schemaVersion === 3 &&
      version.rulesVersion === "0.3.0" &&
      version.contentHash === LEGACY_HASH_030;
    const fromV031 =
      version.schemaVersion === 3 &&
      version.rulesVersion === "0.3.1" &&
      version.contentHash === LEGACY_HASH_031;
    // 0.3.2 saves differ only by the 150-event content set; every id they can
    // reference (events, follow-ups, specials) still exists, so they load as is.
    const fromV032 =
      version.schemaVersion === 3 &&
      version.rulesVersion === "0.3.2" &&
      version.contentHash === LEGACY_HASH_032;
    const fromV033 =
      version.schemaVersion === 3 &&
      version.rulesVersion === "0.3.3" &&
      version.contentHash === LEGACY_HASH_033;
    const fromV034 =
      version.schemaVersion === 3 &&
      version.rulesVersion === "0.3.4" &&
      version.contentHash === LEGACY_HASH_033;
    const previous = fromV030 || fromV031 || fromV032 || fromV033 || fromV034;
    if (!current && !previous) {
      return { ok: false, error: "E_SAVE_VERSION" };
    }
    const parsed = envelopeSchema.safeParse(decoded);
    if (!parsed.success) return { ok: false, error: "E_SAVE_CORRUPT" };
    const { state } = parsed.data;
    const works = new Set(state.works.map((work) => work.id));
    const contracts = new Set(state.contracts.map((contract) => contract.id));
    const eventTargetExists = (target: EventInstance["target"]) =>
      target.scope === "WORK"
        ? works.has(target.id ?? "")
        : target.scope === "CONTRACT"
          ? contracts.has(target.id ?? "")
          : target.id === null;
    const pending = state.pending;
    const def =
      pending && content.events.find((entry) => entry.id === pending.defId);
    const agenda =
      pending &&
      def &&
      pending.status === "PENDING" &&
      pending.resolvedChoice === null &&
      pending.id === "EV-" + pending.day &&
      pending.day === (pending.tier === "ORIGIN" ? 0 : state.day + 1) &&
      pending.tier === def.tier &&
      pending.target.scope === def.scope &&
      eventTargetExists(pending.target) &&
      pending.choiceIds.length > 0 &&
      pending.choiceIds.every((id) =>
        def.choices?.some((choice) => choice.id === id),
      ) &&
      (!def.offer ||
        content.world.companies.some(
          (company) => company.id === pending.offerCompanyId,
        ));
    if (
      state.day !== parsed.data.savedAtDay ||
      state.phase !== parsed.data.phase ||
      state.schemaVersion !== parsed.data.schemaVersion ||
      state.rulesVersion !== parsed.data.rulesVersion ||
      state.contentHash !== parsed.data.contentHash ||
      (state.phase === "ENDED") !== !!state.ending ||
      (state.phase === "AWAITING_CHOICE") !== !!agenda ||
      !!pending !== !!agenda ||
      (state.phase === "AWAITING_WORK") !== !!state.pendingNewWork ||
      (state.pendingNewWork !== null &&
        (state.pendingNewWork.day !== state.day ||
          state.pendingNewWork.id !== "NW-" + state.day ||
          state.works.filter((work) => !work.end).length >=
            content.balance.life.maxActiveWorks)) ||
      state.archive.length !==
        (pending?.tier === "ORIGIN" ? 0 : state.day + 1) ||
      works.size !== state.works.length ||
      contracts.size !== state.contracts.length ||
      !content.world.jobs.some((job) => job.id === state.author.jobId) ||
      state.works.some(
        (work) =>
          !content.platforms.some(
            (platform) => platform.id === work.platformId,
          ) ||
          (work.contractId !== null &&
            !state.contracts.some(
              (contract) =>
                contract.id === work.contractId && contract.workId === work.id,
            )) ||
          work.revenue.paid > work.revenue.accrued,
      ) ||
      state.ledgerSeq < state.ledger.length ||
      new Set(state.ledger.map((entry) => entry.id)).size !==
        state.ledger.length ||
      state.contracts.some(
        (contract) =>
          !works.has(contract.workId) ||
          !content.world.companies.some(
            (company) => company.id === contract.companyId,
          ),
      ) ||
      state.followUps.some(
        (item) =>
          !eventTargetExists(item.target) ||
          !content.events.some(
            (entry) => entry.id === item.defId && entry.tier === "FOLLOW_UP",
          ),
      )
    ) {
      return { ok: false, error: "E_SAVE_CORRUPT" };
    }
    if (previous) {
      state.rulesVersion = RULES_VERSION;
      state.contentHash = contentHash;
      if (fromV030) migrateFromV030(state);
    }
    return { ok: true, state };
  }
  function migrateFromV030(state: LifeState) {
    {
      const newTags = new Set(tagUnlocks.map((tag) => sourceText(tag.textId)));
      const schedules = new Set(cadences.map((item) => String(item.mask)));
      for (const entry of createAuthor(state.seed, content).aptitudes) {
        if (
          ((entry.kind === "TAG" && newTags.has(entry.key)) ||
            (entry.kind === "SCHEDULE" && schedules.has(entry.key))) &&
          !state.author.aptitudes.some(
            (item) => item.kind === entry.kind && item.key === entry.key,
          )
        )
          state.author.aptitudes.push(entry);
      }
    }
  }

  return {
    createLife,
    advance,
    choose,
    serialize,
    deserialize,
    confirmNewWork: (state: LifeState, id: string, plan: WorkPlan) =>
      command(state, buildConfirmNewWork(id, plan), true),
    prepareEnding: (state: LifeState, id: string, remaining: number) =>
      command(state, buildPrepareEnding(id, remaining)),
    getPendingNewWork: (state: LifeState) => newWorkView(state, content),
    planWork: (state: LifeState, plan: WorkPlan) =>
      command(state, buildPlanWork(plan)),
    reviseWork: (state: LifeState, id: string, plan: WorkPlan) =>
      command(state, buildReviseWork(id, plan)),
    setWorkPolicy: (state: LifeState, id: string, patch: WorkPolicyPatch) =>
      command(state, buildSetWorkPolicy(id, patch)),
    rushWork: (state: LifeState, id: string, days: number) =>
      command(state, buildRushWork(id, days)),
    extraWrite: (state: LifeState, id: string, requested: boolean) =>
      command(state, buildExtraWrite(id, requested)),
    hiatusWork: (
      state: LifeState,
      id: string,
      kind: "RECOVER" | "STOCK",
      days: number,
    ) => command(state, buildHiatusWork(id, kind, days)),
    resumeWork: (state: LifeState, id: string) =>
      command(state, buildResumeWork(id)),
    dropWork: (state: LifeState, id: string) =>
      command(state, buildDropWork(id)),
    setTimePolicy: (state: LifeState, plan: TimePolicy) =>
      command(state, buildSetTimePolicy(plan)),
    setSpendPolicy: (state: LifeState, plan: SpendPolicy) =>
      command(state, buildSetSpendPolicy(plan)),
    purchase: (state: LifeState, id: string) =>
      command(state, buildPurchase(id)),
    setAutoPlan: (state: LifeState, on: boolean) =>
      command(state, buildSetAutoPlan(on)),
    retire: (state: LifeState) => command(state, buildRetire()),
    getLifeSummary: (state: LifeState) => lifeSummary(state, content),
    getPlanOptions: (state?: LifeState) => planOptionsView(content, state),
    getLifeSettings: (state: LifeState) => lifeSettingsView(state, content),
    getAuthorView: (state: LifeState) => authorView(state, content),
    getWorkViews: (state: LifeState) =>
      state.works.map((work) => workView(work, content, state)),
    getWorkView: (state: LifeState, id: string) => {
      const work = state.works.find((candidate) => candidate.id === id);
      return work ? workView(work, content, state) : undefined;
    },
    getPending: (state: LifeState) => pendingView(state, content),
    getEventLog: (
      state: LifeState,
      range: { from?: number; to?: number } = {},
    ) =>
      state.log
        .filter(
          (item) =>
            item.day >= (range.from ?? 0) && item.day <= (range.to ?? Infinity),
        )
        .map((item) => ({ ...item })),
    getLedgerView: (state: LifeState) => ledgerView(state, content),
    getAptitudeView: (state: LifeState) => aptitudeView(state, content),
    getContractViews: (state: LifeState) => contractViews(state, content),
    getDailySummary: (state: LifeState, day = state.day) => {
      const result = state.summaries.find((item) => item.day === day);
      if (!result) return undefined;
      return {
        ...structuredClone(result),
        eventTitle: matchingText(
          "event." + result.eventId + ".title",
          result.eventTitle,
        ),
      };
    },
  };
}

export const {
  prepareEnding,
  confirmNewWork,
  getPendingNewWork,
  planWork,
  reviseWork,
  setWorkPolicy,
  rushWork,
  extraWrite,
  hiatusWork,
  resumeWork,
  dropWork,
  setTimePolicy,
  setSpendPolicy,
  purchase,
  setAutoPlan,
  retire,
  getLifeSummary,
  getPlanOptions,
  getLifeSettings,
  createLife,
  advance,
  choose,
  serialize,
  deserialize,
  getAuthorView,
  getWorkViews,
  getWorkView,
  getPending,
  getEventLog,
  getLedgerView,
  getAptitudeView,
  getContractViews,
  getDailySummary,
} = createEngine();
