import { abilityKeys, channels, sourceText } from "@webbbbbie/content";
import type {
  AptitudeKind,
  Channel,
  Content,
  StartPath,
  WorkStatus,
} from "@webbbbbie/content";
import type {
  Aptitude,
  Author,
  ConditionStat,
  EngineEvent,
  LifeState,
  SocialStat,
  Work,
} from "./model";
import { pick, rand, stream, weighted } from "./rng";

export const serial = (work: Work) =>
  work.status === "SERIAL_FREE" || work.status === "SERIAL_PAID";
export const terminal = (status: WorkStatus) =>
  status === "COMPLETED" ||
  status === "RUSHED_END" ||
  status === "DROPPED" ||
  status === "TAKEN_DOWN";
export const activeWork = (work: Work) => !terminal(work.status);
export const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));
export const sum = (values: readonly number[]) =>
  values.reduce((a, b) => a + b, 0);
export const blankSources = () =>
  Object.fromEntries(channels.map((channel) => [channel, 0])) as Record<
    Channel,
    number
  >;

export function record(
  list: EngineEvent[],
  type: EngineEvent["type"],
  day: number,
  message: string,
  workId: string | null = null,
) {
  list.push({ type, day, message, workId });
}

export function changeCondition(
  author: Author,
  stat: ConditionStat,
  amount: number,
) {
  const multiplier =
    stat === "stress" ? 1.2 - author.abilities.resilience * 0.006 : 1;
  author.condition[stat] = clamp(author.condition[stat] + amount * multiplier);
}

export function changeSocial(author: Author, stat: SocialStat, amount: number) {
  author.social[stat] = clamp(author.social[stat] + amount);
}

export function assetAptitudes(work: Work): [AptitudeKind, string][] {
  return [
    ["GENRE", work.genre],
    ["MATERIAL", work.material],
    ...work.tags.map((tag): [AptitudeKind, string] => ["TAG", tag]),
    ["SCHEDULE", String(work.mask)],
    ["PLATFORM", work.platformId],
  ];
}

function generateAptitudes(seed: number, content: Content): Aptitude[] {
  const keys: [AptitudeKind, string][] = [];
  for (const template of content.world.works) {
    keys.push(
      ["GENRE", template.genre],
      ["MATERIAL", template.material],
      ["SCHEDULE", String(template.mask)],
    );
    for (const tag of template.tags) keys.push(["TAG", tag]);
  }
  for (const platform of content.platforms)
    keys.push(["PLATFORM", platform.id]);
  const unique = [
    ...new Map(keys.map((value) => [value.join("/"), value])).values(),
  ];
  const { unknownMin, unknownMax } = content.balance.aptitude;
  return unique.map(([kind, key], index) => ({
    kind,
    key,
    trueValue:
      unknownMin +
      rand(seed, 0, stream.APTITUDE, index) * (unknownMax - unknownMin),
    evidence: 0,
    lastEvidence: -10000,
    estimate: null,
    stage: "UNKNOWN",
  }));
}

export function createAuthor(seed: number, content: Content): Author {
  const { world, balance } = content;
  const { life, condition } = balance;
  const draw = (index: number) => rand(seed, 0, stream.CREATION, index);
  const motive = pick(world.motives, draw(2));
  const abilities = Object.fromEntries(
    abilityKeys.map((key, index) => [
      key,
      Math.floor(
        life.abilityMin +
          draw(index + 10) * (life.abilityMax - life.abilityMin + 1),
      ),
    ]),
  ) as Author["abilities"];
  const trait = (index: number) => Math.floor(20 + draw(index) * 66);
  return {
    penName: pick(world.penNames, draw(0)),
    startAge:
      life.ageMin + Math.floor(draw(1) * (life.ageMax - life.ageMin + 1)),
    motive: motive.text,
    paths: [...motive.paths],
    startPath: null,
    jobId: pick(world.jobs, draw(3)).id,
    home: { ...pick(world.homes, draw(4)) },
    abilities,
    condition: {
      health: condition.initialHealth,
      fatigue: condition.initialFatigue,
      stress: condition.initialStress,
      drive: condition.initialDrive,
    },
    social: {
      recognition: 0,
      reputation: 50,
      completionTrust: 0,
      expectation: 0,
      demand: 0,
      fandom: 0,
    },
    traits: {
      consumption: trait(21),
      community: trait(22),
      multitask: trait(23),
      deadlineTolerance: trait(24),
    },
    specialStates: [],
    aptitudes: generateAptitudes(seed, content),
    cash: life.startCash + Math.floor(draw(5) * 140000),
    lastRoutine: null,
  };
}

export function createWork(
  state: LifeState,
  content: Content,
  day: number,
  path: StartPath,
) {
  if (
    state.works.filter(activeWork).length >= content.balance.life.maxActiveWorks
  )
    return;
  const index = state.works.length;
  const template = pick(
    content.world.works,
    rand(state.seed, day, stream.CREATION, 32 + index * 2),
  );
  const author = state.author;
  const platform = weighted(
    content.platforms,
    (candidate) =>
      1 + template.tags.filter((tag) => candidate.tags.includes(tag)).length,
    rand(state.seed, day, stream.CREATION, 33 + index * 2),
  );
  const name = state.works.some((work) => work.title === template.title)
    ? template.title + " · " + (index + 1)
    : template.title;
  const quality = clamp(
    32 + author.abilities.style * 0.55 + (path === "PLAGIARISM" ? 5 : 0),
  );
  state.works.push({
    id: "W-" + (index + 1),
    title: name,
    genre: template.genre,
    material: template.material,
    tags: [...template.tags],
    startPath: path,
    platformId: platform.id,
    contractId: null,
    status: "PLANNING",
    startDay: day,
    targetChapters: template.target,
    published: 0,
    stock: 0,
    mask: template.mask,
    quality,
    consistency: 56,
    attachment: 42 + author.traits.multitask * 0.32,
    hiatusUntil: null,
    resumeTo: null,
    paidFrom: null,
    paidEligibleDay: null,
    lastResume: null,
    readers: [[], [], [], [], []],
    caughtUp: [0, 0, 0, 0, 0],
    flags: [],
    stats: {
      newReaders: 0,
      newByAge: [0, 0, 0, 0, 0],
      newBySource: blankSources(),
      totalNew: 0,
      views: 0,
      totalViews: 0,
      latestViews: 0,
      lost: 0,
      favorites: 0,
      publishedToday: 0,
      streakMissed: 0,
      lastPosted: null,
      promotionUntil: -1,
      missedReason: null,
    },
    revenue: { accrued: 0, paid: 0 },
    end: null,
  });
}

export function relevantAptitudes(author: Author, work: Work) {
  const keys = assetAptitudes(work);
  return author.aptitudes.filter((aptitude) =>
    keys.some(([kind, key]) => kind === aptitude.kind && key === aptitude.key),
  );
}

const grades = ["low", "medium", "high", "standout"].map((grade) =>
  sourceText("label.aptitude-grade." + grade),
);
function grade(value: number) {
  return Math.min(grades.length - 1, Math.floor(value / 25));
}

export function learnAptitude(
  state: LifeState,
  work: Work,
  day: number,
  amount: number,
  content: Content,
  direct = false,
) {
  const { aptitude } = content.balance;
  const insight = state.author.abilities.insight;
  const milestones = relevantAptitudes(state.author, work);
  for (const [index, item] of milestones.entries()) {
    if (
      day === item.lastEvidence ||
      (!direct && day - item.lastEvidence < aptitude.evidenceDays)
    )
      continue;
    item.lastEvidence = day;
    item.evidence += amount;
    const guess = Math.max(
      1,
      aptitude.guessEvidence - Math.floor(insight / 45),
    );
    const confirm = Math.max(
      guess + 1,
      aptitude.confirmEvidence - Math.floor(insight / 25),
    );
    if (item.evidence < guess) continue;
    const certain = item.evidence >= confirm;
    const actual = grade(item.trueValue);
    const roll = rand(state.seed, day, stream.APTITUDE, index + 100);
    const error =
      Math.floor(roll * (aptitude.guessError * 2 + 1)) - aptitude.guessError;
    item.stage = certain ? "CERTAIN" : "GUESS";
    item.estimate =
      grades[
        clamp(
          actual +
            (certain && !content.policies.allowFalseConviction ? 0 : error),
          0,
          grades.length - 1,
        )
      ];
  }
}
