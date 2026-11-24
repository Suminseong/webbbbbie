import type { Content } from "@webbbbbie/content";
import { sum } from "./author";
import type { LifeState, Work } from "./model";

export const statusNames = {
  PLANNING: "기획",
  SERIAL_FREE: "무료 연재",
  SERIAL_PAID: "유료 연재",
  HIATUS: "휴재",
  COMPLETED: "정상 완결",
  RUSHED_END: "급완결",
  DROPPED: "연중",
  TAKEN_DOWN: "비공개",
};
export const sourceNames = {
  NEW: "신작",
  UPDATE: "최신 업데이트",
  HOT: "인기작",
  BEST: "베스트",
  OFFICIAL: "정식 연재",
  PROMOTION: "프로모션",
  COMMUNITY: "커뮤니티",
  FANDOM: "기존 팬덤",
  ORGANIC: "자연 유입",
  BACKLIST: "정주행",
};
export const abilityNames = {
  talent: "영근",
  style: "필력",
  insight: "능지",
  vocabulary: "어휘력",
  commercial: "상업성",
  speed: "집필 속도",
  diligence: "성실성",
  resilience: "멘탈 내구도",
};
export const conditionNames = {
  health: "건강",
  fatigue: "피로",
  stress: "멘헤라",
  drive: "창작 의욕",
};
export const ledgerNames = {
  SALARY: "본업 수입",
  PAYOUT: "작품 정산",
  LIVING: "생활비",
  EVENT: "사건 지출",
  ADVANCE: "선인세",
};
export const aptitudeNames = {
  GENRE: "장르",
  MATERIAL: "소재",
  TAG: "태그",
  SCHEDULE: "연재 주기",
  PLATFORM: "플랫폼",
};
const pathNames = {
  ORIGINAL: "순수 창작",
  PARODY: "패러디",
  PLAGIARISM: "표절",
};
const ageLabels = ["10대", "20대", "30대", "40대", "50대 이상"];

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
    penName: author.penName,
    age:
      author.startAge + Math.floor(state.day / content.balance.life.yearDays),
    motive: author.motive,
    path: author.startPath ? pathNames[author.startPath] : null,
    job:
      content.world.jobs.find((job) => job.id === author.jobId)?.name ??
      author.jobId,
    home: author.home.name,
    abilities: { ...author.abilities },
    condition: { ...author.condition },
    social: { ...author.social },
    states: author.specialStates.map((status) => ({
      name:
        content.specials.find((item) => item.key === status.key)?.name ??
        status.key,
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
    title: work.title,
    genre: work.genre,
    material: work.material,
    tags: [...work.tags],
    path: pathNames[work.startPath],
    platform: platform.name,
    model: platform.model === "EPISODE" ? "편결" : "구독",
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
    title: def.title,
    text: def.text,
    target: work?.title ?? null,
    choices: (def.choices ?? [])
      .filter((choice) => pending.choiceIds.includes(choice.id))
      .map((choice) => ({ id: choice.id, label: choice.label })),
    offer: company
      ? {
          name: company.name,
          share: company.share,
          advance: company.advance,
          duration: company.duration,
          promise: company.promise,
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
          ? (content.platforms.find((platform) => platform.id === key)?.name ??
            key)
          : kind === "SCHEDULE"
            ? "주 " +
              [...Array(7).keys()].filter((n) => (Number(key) & (1 << n)) !== 0)
                .length +
              "회"
            : key,
      evidence,
      stage,
      estimate,
    }),
  );
}

export function contractViews(state: LifeState, content: Content) {
  return state.contracts.map((entry) => ({
    id: entry.id,
    workId: entry.workId,
    title:
      state.works.find((work) => work.id === entry.workId)?.title ??
      entry.workId,
    company:
      content.world.companies.find((company) => company.id === entry.companyId)
        ?.name ?? entry.companyId,
    signedDay: entry.signedDay,
    expiresDay: entry.expiresDay,
    share: entry.share,
    advance: entry.advance,
    promise: entry.promise,
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
