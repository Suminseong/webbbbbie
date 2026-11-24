import {
  displayName,
  displayWorkTitle,
  matchingText,
  text,
} from "@webbbbbie/content";
import type { Content } from "@webbbbbie/content";
import { sum } from "./author";
import type { LifeState, Work } from "./model";

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
    states: author.specialStates.map((status) => ({
      name: displayName(
        "entity.special",
        content.specials.find((item) => item.key === status.key)?.name ??
          status.key,
      ),
      until: status.until,
    })),
    cash: author.cash,
    routine: author.lastRoutine
      ? { ...author.lastRoutine, writing: { ...author.lastRoutine.writing } }
      : null,
  };
}

export function workView(work: Work, content: Content) {
  const platform = content.platforms.find(
    (candidate) => candidate.id === work.platformId,
  )!;
  const sources = Object.entries(work.stats.newBySource);
  const bySource = distribute(sources.map(([, value]) => value));
  const byAge = distribute(work.stats.newByAge);
  return {
    id: work.id,
    title: displayWorkTitle(work.title),
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
    newByAge: ageLabels.map((label, index) => ({ label, count: byAge[index] })),
    newBySource: sources.map(([key], index) => ({
      label: sourceNames[key as keyof typeof sourceNames],
      count: bySource[index],
    })),
    accrued: work.revenue.accrued,
    paid: work.revenue.paid,
    missedReason: work.stats.missedReason,
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
    target: work ? displayWorkTitle(work.title) : null,
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
  return state.contracts.map((entry) => ({
    id: entry.id,
    workId: entry.workId,
    title: displayWorkTitle(
      state.works.find((work) => work.id === entry.workId)?.title ??
        entry.workId,
    ),
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
  }));
}

export function ledgerView(state: LifeState) {
  return {
    cash: state.author.cash,
    debt: Math.max(0, -state.author.cash),
    accrued: sum(state.works.map((work) => work.revenue.accrued)),
    paid: sum(state.works.map((work) => work.revenue.paid)),
    /** Totals of entries older than the retention window, by kind. */
    carried: { ...state.ledgerCarry },
    entries: state.ledger.map((entry) => ({ ...entry })),
  };
}
