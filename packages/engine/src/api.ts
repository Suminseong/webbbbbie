import { defaultContent } from "@webbbbbie/content";
import type { Content } from "@webbbbbie/content";
import { createAuthor, record, sum } from "./author";
import {
  compactLedger,
  settle,
  updateContracts,
  updateDemand,
} from "./economy";
import { applyEvent, originEvent, selectEvent } from "./events";
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
} from "./model";
import { resolveAudience } from "./readership";
import { fingerprint } from "./rng";
import {
  aptitudeView,
  authorView,
  contractViews,
  ledgerView,
  pendingView,
  workView,
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
      aptitudes: author.aptitudes.map((entry) => ({ ...entry })),
    },
    works: state.works.map((work) => ({
      ...work,
      stats: { ...work.stats },
      revenue: { ...work.revenue },
      readers: [...work.readers],
      caughtUp: [...work.caughtUp],
      flags: [...work.flags],
      end: work.end ? { ...work.end } : null,
    })),
    contracts: state.contracts.map((entry) => ({ ...entry })),
    ledger: [...state.ledger],
    ledgerCarry: { ...state.ledgerCarry },
    flags: [...state.flags],
    eventLast: { ...state.eventLast },
    eventCount: { ...state.eventCount },
    followUps: [...state.followUps],
    eventHistory: [...state.eventHistory],
    archive: [...state.archive],
    summaries: [...state.summaries],
  };
}

export function createEngine(
  content: Content = defaultContent,
  lifeEnd: LifeEndPolicy = neverEnd,
) {
  const contentHash = fingerprint(JSON.stringify(content));
  const keep = content.balance.events;
  function addLog(state: LifeState, events: readonly EngineEvent[]) {
    state.log = state.log.concat(events).slice(-keep.logKeep);
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
      flags: [],
      eventLast: {},
      eventCount: {},
      lastForced: -10000,
      priorityStreak: 0,
      followUps: [],
      eventHistory: [],
      archive: [],
      pending: null,
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
    const time = planRoutine(state, content, day);
    state.author.lastRoutine = time;
    const posted = writeAndPublish(state, content, time, day, events);
    updateContracts(state, content, day, events);
    const gained = resolveAudience(state, content, day);
    settle(state, content, day, events);
    compactLedger(state, content, day);
    finishWorks(state, content, day, events);
    updateCondition(state, content, time);
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
    record(events, "DAY_CLOSED", day, day + "일차 마감");
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
      record(events, "DAY_STARTED", day, day + "일차");
      record(events, "EVENT_SELECTED", day, def.title, selected.target.id);
      if (selected.choiceIds.length) {
        next.phase = "AWAITING_CHOICE";
        next.pending = selected;
        record(events, "CHOICE_REQUIRED", day, def.title, selected.target.id);
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
    if (
      !("schemaVersion" in decoded) ||
      !("rulesVersion" in decoded) ||
      !("contentHash" in decoded) ||
      decoded.schemaVersion !== SCHEMA_VERSION ||
      decoded.rulesVersion !== RULES_VERSION ||
      decoded.contentHash !== contentHash
    ) {
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
      state.schemaVersion !== SCHEMA_VERSION ||
      state.rulesVersion !== RULES_VERSION ||
      state.contentHash !== contentHash ||
      (state.phase === "AWAITING_CHOICE") !== !!agenda ||
      !!pending !== !!agenda ||
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
    return { ok: true, state };
  }

  return {
    createLife,
    advance,
    choose,
    serialize,
    deserialize,
    getAuthorView: (state: LifeState) => authorView(state, content),
    getWorkViews: (state: LifeState) =>
      state.works.map((work) => workView(work, content)),
    getWorkView: (state: LifeState, id: string) => {
      const work = state.works.find((candidate) => candidate.id === id);
      return work ? workView(work, content) : undefined;
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
    getLedgerView: ledgerView,
    getAptitudeView: (state: LifeState) => aptitudeView(state, content),
    getContractViews: (state: LifeState) => contractViews(state, content),
    getDailySummary: (state: LifeState, day = state.day) => {
      const result = state.summaries.find((item) => item.day === day);
      return result ? structuredClone(result) : undefined;
    },
  };
}

export const {
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
