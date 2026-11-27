import {
  displayName,
  oneTimeExpenses,
  playerActionRules,
  matchingText,
  sourceText,
  tagUnlocks,
  text,
} from "@webbbbbie/content";
import type { Content } from "@webbbbbie/content";
import { createWork, serial, sum, workTitle } from "./author";
import {
  cadences,
  maskCadence,
  maxFreeUnits,
  planOptions,
  unlockedTagChapters,
} from "./commands";
import { spendingLevels } from "./work";
import { traitsOf } from "./contracts";
import type { ContractRecord, LifeState, Work } from "./model";

export const statusNames = {
  PLANNING: text("label.work-status.planning"),
  SERIAL_FREE: text("label.work-status.serial-free"),
  SERIAL_PAID: text("label.work-status.serial-paid"),
  HIATUS: text("label.work-status.hiatus"),
  COMPLETED: text("label.work-status.completed"),
  RUSHED_END: text("label.work-status.rushed-end"),
  DROPPED: text("label.work-status.dropped"),
  TAKEN_DOWN: text("label.work-status.taken-down"),
};
export const sourceNames = {
  NEW: text("label.acquisition.new"),
  UPDATE: text("label.acquisition.update"),
  HOT: text("label.acquisition.hot"),
  BEST: text("label.acquisition.best"),
  OFFICIAL: text("label.acquisition.official"),
  PROMOTION: text("label.acquisition.promotion"),
  COMMUNITY: text("label.acquisition.community"),
  FANDOM: text("label.acquisition.fandom"),
  ORGANIC: text("label.acquisition.organic"),
  BACKLIST: text("label.acquisition.backlist"),
};
export const abilityNames = {
  talent: text("label.ability.talent"),
  style: text("label.ability.style"),
  insight: text("label.ability.insight"),
  vocabulary: text("label.ability.vocabulary"),
  commercial: text("label.ability.commercial"),
  speed: text("label.ability.speed"),
  diligence: text("label.ability.diligence"),
  resilience: text("label.ability.resilience"),
};
export const conditionNames = {
  health: text("label.condition.health"),
  fatigue: text("label.condition.fatigue"),
  stress: text("label.condition.stress"),
  drive: text("label.condition.drive"),
};
export const ledgerNames = {
  SALARY: text("label.ledger.salary"),
  PAYOUT: text("label.ledger.payout"),
  LIVING: text("label.ledger.living"),
  EVENT: text("label.ledger.event"),
  ADVANCE: text("label.ledger.advance"),
  SPEND: text("label.ledger.spend"),
};
export const aptitudeNames = {
  GENRE: text("label.aptitude-kind.genre"),
  MATERIAL: text("label.aptitude-kind.material"),
  TAG: text("label.aptitude-kind.tag"),
  SCHEDULE: text("label.aptitude-kind.schedule"),
  PLATFORM: text("label.aptitude-kind.platform"),
};
const pathNames = {
  ORIGINAL: text("label.creation-path.original"),
  PARODY: text("label.creation-path.parody"),
  PLAGIARISM: text("label.creation-path.plagiarism"),
};

export function newWorkView(state: LifeState, content: Content) {
  const waiting = state.pendingNewWork;
  if (!waiting) return null;
  const preview = { ...state, works: [...state.works] };
  createWork(preview, content, waiting.day, waiting.path);
  const work = preview.works[preview.works.length - 1];
  return {
    id: waiting.id,
    day: waiting.day,
    title: waiting.sourceTitle,
    reason: text(waiting.reasonId),
    path: pathNames[waiting.path],
    defaultPlan: {
      title: workTitle(work),
      genre: work.genre,
      material: work.material,
      tags: [...work.tags],
      platformId: work.platformId,
      perWeek: maskCadence(work.mask),
    },
  };
}
const ageLabels = [
  text("label.readers-age.teens"),
  text("label.readers-age.twenties"),
  text("label.readers-age.thirties"),
  text("label.readers-age.forties"),
  text("label.readers-age.fifty-plus"),
];

function distribute(values: number[]) {
  const counts = values.map(Math.floor);
  const right = values
    .map((value, index) => ({ index, fraction: value - counts[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const item of right.slice(0, Math.floor(sum(values)) - sum(counts)))
    counts[item.index] += 1;
  return counts;
}

export function authorView(state: LifeState, content: Content) {
  const { author } = state;
  return {
    seed: state.seed,
    day: state.day,
    phase: state.phase,
    penName: displayName("entity.pen", author.penName),
    age:
      author.startAge + Math.floor(state.day / content.balance.life.yearDays),
    motive: displayName("entity.motive", author.motive),
    path: author.startPath ? pathNames[author.startPath] : null,
    job: displayName(
      "entity.job",
      content.world.jobs.find((job) => job.id === author.jobId)?.name ??
        author.jobId,
    ),
    home: displayName("entity.home", author.home.name),
    abilities: { ...author.abilities },
    condition: { ...author.condition },
    social: { ...author.social },
    states: author.specialStates.map((status) => {
      const def = content.specials.find((item) => item.key === status.key);
      return {
        key: status.key,
        name: displayName("entity.special", def?.name ?? status.key),
        until: status.until,
        since: status.since,
        days: Math.max(0, state.day - status.since),
        cause: status.cause ? text(status.cause) : null,
        hint: def?.hint ? text(def.hint) : null,
        lifts: !!def?.release,
      };
    }),
    cash: author.cash,
    pendingIncome: sum(
      state.works.map((work) => work.revenue.accrued - work.revenue.paid),
    ),
    spendDue: Math.floor(author.spendAccrued),
    deviations: author.deviations.map((id) => text(id)),
    plan: author.lastPlan
      ? {
          ...author.lastPlan,
          plot: { ...author.lastPlan.plot },
          writing: { ...author.lastPlan.writing },
        }
      : null,
    routine: author.lastRoutine
      ? {
          ...author.lastRoutine,
          writing: { ...author.lastRoutine.writing },
          plot: { ...author.lastRoutine.plot },
        }
      : null,
  };
}

function trend(work: Work, span: number) {
  const recent = work.history.slice(-span);
  return {
    views: Math.floor(sum(recent.map((item) => item[1]))),
    newReaders: Math.floor(sum(recent.map((item) => item[2]))),
  };
}

/**
 * Chapter funnel from the aggregate log. Rate for chapter n is
 * reads(n) / reads(n-1); chapter 1 has no denominator. A log that started
 * after the work began (old save) is flagged `partial`; chapters nobody read
 * in the log window stay null rather than being estimated.
 */
export function chapterFunnel(work: Work) {
  const log = work.chapters;
  const reads = log?.reads ?? [];
  const drops = log?.drops ?? [];
  const rows = reads.map((value, index) => {
    const before = index > 0 ? reads[index - 1] : 0;
    return {
      chapter: index + 1,
      reads: value,
      drops: drops[index] ?? 0,
      previous: index > 0 ? before : null,
      rate: index > 0 && before > 0 ? value / before : null,
    };
  });
  return {
    known: !!log && rows.length > 0,
    partial: !!log && !log.complete,
    since: log?.since ?? null,
    firstReads: rows.length ? rows[0].reads : null,
    rows,
  };
}

export function workView(work: Work, content: Content, state?: LifeState) {
  const platform = content.platforms.find(
    (candidate) => candidate.id === work.platformId,
  )!;
  const sources = Object.entries(work.stats.newBySource);
  const bySource = distribute(sources.map(([, value]) => value));
  const byAge = distribute(work.stats.newByAge);
  const detail = work.detail;
  const expected = sum(detail?.history.map((row) => row[3]) ?? []);
  const fulfilled = sum(
    detail?.history.map((row) => Math.min(row[2], row[3])) ?? [],
  );
  const settlements =
    state?.ledger.filter(
      (row) => row.workId === work.id && row.kind === "PAYOUT",
    ) ?? [];
  const latestSettlement = settlements.at(-1);
  return {
    id: work.id,
    title: workTitle(work),
    genre: displayName("entity.genre", work.genre),
    material: displayName("entity.material", work.material),
    tags: work.tags.map((tag) => displayName("entity.tag", tag)),
    path: pathNames[work.startPath],
    platform: matchingText(
      "entity.platform." + platform.id + ".name",
      platform.name,
    ),
    model: text(
      platform.model === "EPISODE"
        ? "label.platform.episode"
        : "label.platform.subscription",
    ),
    status: work.status,
    statusLabel: statusNames[work.status],
    startDay: work.startDay,
    duration: Math.max(
      0,
      (work.end?.day ?? state?.day ?? work.startDay) - work.startDay,
    ),
    endingTarget: work.endingTarget,
    detail: {
      since: detail?.since ?? null,
      partial: !detail || detail.since > work.startDay,
      paidReads: detail?.paidReads ?? null,
      stability: expected > 0 ? fulfilled / expected : null,
      expected,
      fulfilled,
      history:
        detail?.history.map(([day, quality, posted, expected, paidReads]) => ({
          day,
          quality,
          posted,
          expected,
          paidReads,
        })) ?? [],
    },
    latestSettlement: latestSettlement
      ? { day: latestSettlement.day, amount: latestSettlement.amount }
      : null,
    journal: (
      detail?.journal ??
      (state?.log ?? []).filter(
        (row) =>
          row.workId === work.id &&
          [
            "EFFECT_APPLIED",
            "WORK_STATUS_CHANGED",
            "STATE_CHANGED",
            "COMMAND",
            "WORK_ORDER",
            "PAYOUT",
            "WORK_EXPOSURE",
          ].includes(row.type),
      )
    ).map((row) => ({ ...row })),
    exposure: (detail?.exposure ?? []).map(
      (key) => sourceNames[key as keyof typeof sourceNames],
    ),
    sources: sources.map(([key, value]) => ({
      label: sourceNames[key as keyof typeof sourceNames],
      count: value,
      share: work.stats.newReaders > 0 ? value / work.stats.newReaders : 0,
    })),
    target: work.targetChapters,
    published: work.published,
    stock: work.stock,
    mask: work.mask,
    quality: work.quality,
    contractId: work.contractId,
    paidFrom: work.paidFrom,
    newReaders: Math.floor(work.stats.newReaders),
    totalNew: Math.floor(work.stats.totalNew),
    views: Math.floor(work.stats.views),
    totalViews: Math.floor(work.stats.totalViews),
    latestViews: Math.floor(work.stats.latestViews),
    favorites: Math.floor(work.stats.favorites),
    lost: Math.floor(work.stats.lost),
    newByAge: ageLabels.map((label, index) => ({
      label,
      count: byAge[index],
      share:
        work.stats.newReaders > 0
          ? work.stats.newByAge[index] / work.stats.newReaders
          : 0,
    })),
    newBySource: sources.map(([key], index) => ({
      label: sourceNames[key as keyof typeof sourceNames],
      count: bySource[index],
    })),
    accrued: work.revenue.accrued,
    paid: work.revenue.paid,
    missedReason: work.stats.missedReason,
    prep: Math.floor(work.prep),
    consistency: Math.floor(work.consistency),
    attachment: Math.floor(work.attachment),
    stockTarget: work.stockTarget,
    priority: work.priority,
    rush: work.rush,
    extraWriting: work.extraWriting,
    hiatusKind: work.hiatusKind,
    hiatusUntil: work.hiatusUntil,
    perWeek: maskCadence(work.mask),
    manual: work.manual,
    canRevise: work.status === "PLANNING",
    canRush: serial(work),
    canExtraWrite:
      serial(work) || (work.status === "HIATUS" && work.hiatusKind === "STOCK"),
    canHiatus: serial(work),
    canResume: work.status === "HIATUS",
    canPrepareEnding: serial(work) || work.status === "HIATUS",
    canDrop:
      serial(work) || work.status === "HIATUS" || work.status === "PLANNING",
    inflow: Math.floor(work.stats.totalNew),
    funnel: chapterFunnel(work),
    activeReaders: Math.floor(
      sum(work.readers.map((pool) => sum(pool))) + sum(work.caughtUp),
    ),
    latestPerInflow:
      work.stats.totalNew > 0
        ? (work.stats.latestViews || 0) / Math.max(1, work.stats.totalNew)
        : 0,
    trend: {
      d7: trend(work, 7),
      d14: trend(work, 14),
      d30: trend(work, 30),
    },
    history: work.history.map(([day, views, news]) => ({
      day,
      views: Math.floor(views),
      newReaders: Math.floor(news),
    })),
    platformId: work.platformId,
    rawGenre: work.genre,
    rawMaterial: work.material,
    rawTags: [...work.tags],
    end: work.end
      ? {
          day: work.end.day,
          reason: statusNames[work.end.reason],
          chapters: work.end.chapters,
          views: Math.floor(work.end.views),
          favorites: Math.floor(work.end.favorites),
        }
      : null,
  };
}

const promoNames = {
  PENDING: text("label.contract.promo.pending"),
  KEPT: text("label.contract.promo.kept"),
  DELAYED: text("label.contract.promo.delayed"),
};

/** Public editor introduction only; skill, interference and warmth stay hidden. */
function editorView(
  content: Content,
  companyId: string,
  editorId: string | null,
) {
  const editor = traitsOf(content, companyId).editors.find(
    (item) => item.id === editorId,
  );
  return editor ? { name: text(editor.name), pitch: text(editor.pitch) } : null;
}

/** What the player has seen from earlier contracts with the same company. */
function companyHistory(record: ContractRecord | undefined) {
  return record && record.contracts > 0
    ? {
        contracts: record.contracts,
        settlements: record.settlements,
        delays: record.delays,
        promo: promoNames[record.promo],
        promoKnown: record.promo !== "PENDING",
      }
    : null;
}

export function pendingView(state: LifeState, content: Content) {
  const pending = state.pending;
  if (!pending) return null;
  const def = content.events.find((item) => item.id === pending.defId)!;
  const work = state.works.find((item) => item.id === pending.target.id);
  const company = content.world.companies.find(
    (item) => item.id === pending.offerCompanyId,
  );
  return {
    id: pending.id,
    day: pending.day,
    title: matchingText("event." + def.id + ".title", def.title),
    text: matchingText("event." + def.id + ".body", def.text),
    target: work ? workTitle(work) : null,
    choices: (def.choices ?? [])
      .filter((choice) => pending.choiceIds.includes(choice.id))
      .map((choice) => ({
        id: choice.id,
        label: matchingText(
          "event." + def.id + ".choice." + choice.id,
          choice.label,
        ),
      })),
    offer: company
      ? {
          settlementCycle: traitsOf(content, company.id).settlementCycle,
          editor: editorView(content, company.id, pending.offerEditorId),
          history: companyHistory(state.companyRecords[company.id]),
          name: matchingText(
            "entity.company." + company.id + ".name",
            company.name,
          ),
          share: company.share,
          advance: company.advance,
          duration: company.duration,
          promise: matchingText(
            "entity.company." + company.id + ".promise",
            company.promise,
          ),
        }
      : null,
  };
}

export function aptitudeView(state: LifeState, content: Content) {
  return state.author.aptitudes.map(
    ({ kind, key, evidence, stage, estimate }) => ({
      kind: aptitudeNames[kind],
      key:
        kind === "PLATFORM"
          ? displayName(
              "entity.platform",
              content.platforms.find((platform) => platform.id === key)?.name ??
                key,
            )
          : kind === "SCHEDULE"
            ? text("ui.aptitude.schedule", {
                times: [...Array(7).keys()].filter(
                  (n) => (Number(key) & (1 << n)) !== 0,
                ).length,
              })
            : displayName("entity." + kind.toLowerCase(), key),
      evidence,
      stage,
      estimate:
        estimate === null
          ? null
          : displayName("label.aptitude-grade", estimate),
    }),
  );
}

export function contractViews(state: LifeState, content: Content) {
  const titles = new Map(state.works.map((work) => [work.id, workTitle(work)]));
  return state.contracts.map((entry) => ({
    id: entry.id,
    workId: entry.workId,
    title: titles.get(entry.workId) ?? entry.workId,
    company: displayName(
      "entity.company",
      content.world.companies.find((company) => company.id === entry.companyId)
        ?.name ?? entry.companyId,
    ),
    signedDay: entry.signedDay,
    expiresDay: entry.expiresDay,
    share: entry.share,
    advance: entry.advance,
    promise: displayName("entity.company", entry.promise),
    status: entry.status,
    settlementCycle: entry.settlementCycle,
    editor: editorView(content, entry.companyId, entry.editorId),
    observed: {
      settlements: entry.record.settlements,
      delays: entry.record.delays,
      promo: promoNames[entry.record.promo],
      promoKnown: entry.record.promo !== "PENDING",
      feedback: entry.record.feedback,
      pressure: entry.record.pressure,
      editorChanges: entry.record.editorChanges,
    },
  }));
}

export function ledgerView(state: LifeState, content: Content) {
  const monthLength = content.balance.economy.settlementDays;
  const currentMonth = Math.max(1, Math.ceil(state.day / monthLength));
  const horizon = state.day - content.balance.economy.ledgerKeepDays;
  const months = Array.from(
    { length: Math.min(6, currentMonth) },
    (_, index) => currentMonth - index,
  ).filter((month) => (month - 1) * monthLength + 1 >= horizon);
  const totals = months.map((month) => {
    const entries = state.ledger.filter(
      (entry) => Math.max(1, Math.ceil(entry.day / monthLength)) === month,
    );
    const income = sum(
      entries.filter((entry) => entry.amount > 0).map((entry) => entry.amount),
    );
    const expense = -sum(
      entries.filter((entry) => entry.amount < 0).map((entry) => entry.amount),
    );
    return {
      month,
      current: month === currentMonth,
      income,
      expense,
      net: income - expense,
    };
  });
  return {
    cash: state.author.cash,
    debt: Math.max(0, -state.author.cash),
    accrued: sum(state.works.map((work) => work.revenue.accrued)),
    paid: sum(state.works.map((work) => work.revenue.paid)),
    /** Totals of entries older than the retention window, by kind. */
    carried: { ...state.ledgerCarry },
    entries: state.ledger.map((entry) => ({ ...entry })),
    months: totals,
  };
}

export function planOptionsView(content: Content, state?: LifeState) {
  const options = planOptions(content);
  const chapters = state ? unlockedTagChapters(state) : 0;
  return {
    endingMaxRemaining: playerActionRules.endingMaxRemaining,
    endingPlotWeight: playerActionRules.endingPlotWeight,
    genres: options.genres.map((value) => ({
      value,
      label: displayName("entity.genre", value),
    })),
    materials: options.materials.map((value) => ({
      value,
      label: displayName("entity.material", value),
    })),
    tags: options.tags.map((value) => {
      const unlock = tagUnlocks.find(
        (item) => sourceText(item.textId) === value,
      );
      const required = unlock?.publishedChapters ?? 0;
      return {
        value,
        label: displayName("entity.tag", value),
        unlocked: chapters >= required,
        required,
      };
    }),
    platforms: content.platforms.map((platform) => ({
      id: platform.id,
      label: matchingText(
        "entity.platform." + platform.id + ".name",
        platform.name,
      ),
      tags: [
        ...platform.tags,
        ...tagUnlocks
          .filter(
            (tag) =>
              tag.platforms.includes(platform.id) &&
              chapters >= tag.publishedChapters,
          )
          .map((tag) => sourceText(tag.textId)),
      ].map((tag) => displayName("entity.tag", tag)),
    })),
    cadences: cadences.map((item) => item.perWeek),
    maxTitle: content.balance.plan.maxTitle,
    maxTags: content.balance.plan.maxTags,
    stockTargetMax: content.balance.plan.stockTargetMax,
    maxActiveWorks: content.balance.life.maxActiveWorks,
  };
}

export function lifeSettingsView(state: LifeState, content: Content) {
  const { author } = state;
  const spending = content.balance.spending;
  const job = content.world.jobs.find((item) => item.id === author.jobId)!;
  const free = maxFreeUnits(state, content);
  const time = author.policy.time;
  const planned =
    time.sleep + time.plot + time.community + time.ego + time.rest;
  const { levels, cut } = spendingLevels(state, content);
  const categories = (
    ["meals", "gear", "health", "research", "leisure", "promo"] as const
  ).map((key) => ({
    key,
    level: author.policy.spend[key],
    effective: levels[key],
    costs: [...spending[key]],
  }));
  return {
    autoPlan: author.policy.autoPlan,
    time: { ...time },
    jobUnits: job.slots,
    jobIrregularity: job.irregularity,
    living: content.balance.time.living,
    free,
    writing: Math.max(0, free - planned),
    minSleep: content.balance.time.minSleep,
    spend: categories,
    spendCut: cut,
    monthly: categories.reduce(
      (total, item) => total + item.costs[item.effective],
      0,
    ),
    purchases: oneTimeExpenses.map((item) => {
      const previous = state.author.purchases[item.id];
      const availableDay =
        previous === undefined ? state.day : previous + item.cooldownDays;
      return {
        id: item.id,
        name: text("entity.purchase." + item.id + ".name"),
        description: text("entity.purchase." + item.id + ".description"),
        cost: item.cost,
        cooldownDays: item.cooldownDays,
        availableDay,
        affordable: state.author.cash >= item.cost,
        available: state.day >= availableDay && state.author.cash >= item.cost,
      };
    }),
  };
}
