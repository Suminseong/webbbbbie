import { z } from "zod";
import {
  abilityKeys,
  aptitudeKinds,
  channels,
  conditionKeys,
  paths,
  socialKeys,
  statuses,
} from "@webbbbbie/content";

const finite = z.number().finite();
const natural = finite.int().nonnegative();
const score = finite.min(0).max(100);
const volume = finite.nonnegative();
const word = z.string().min(1);
const amount = finite.int();
const ageBands = z.array(volume).length(5);
function keyed<K extends string>(keys: readonly K[], value: typeof score) {
  return z.object(
    Object.fromEntries(keys.map((key) => [key, value])) as Record<
      K,
      typeof score
    >,
  );
}
const labor = z.object({
  work: natural,
  living: natural,
  sleep: natural,
  community: natural,
  ego: natural,
  plot: z.record(natural),
  rest: natural,
  writing: z.record(natural),
  unused: natural,
});
const spendLevel = natural.max(3);
const timePolicy = z.object({
  sleep: natural,
  plot: natural,
  community: natural,
  ego: natural,
  rest: natural,
});
const spendPolicy = z.object({
  meals: spendLevel,
  gear: spendLevel,
  health: spendLevel,
  research: spendLevel,
  leisure: spendLevel,
  promo: spendLevel,
});
const policy = z.object({
  time: timePolicy,
  spend: spendPolicy,
  autoPlan: z.boolean(),
});
const ledgerKind = z.enum([
  "SALARY",
  "PAYOUT",
  "LIVING",
  "EVENT",
  "ADVANCE",
  "SPEND",
]);
const ability = keyed(abilityKeys, score);
const condition = keyed(conditionKeys, score);
const social = keyed(socialKeys, score);
const path = z.enum(paths);
const status = z.enum(statuses);
const activeStatus = z.enum(["SERIAL_FREE", "SERIAL_PAID"]);
const endStatus = z.enum(["COMPLETED", "RUSHED_END", "DROPPED", "TAKEN_DOWN"]);
const phase = z.enum(["READY", "AWAITING_CHOICE", "AWAITING_WORK", "ENDED"]);
const target = z.object({
  scope: z.enum(["AUTHOR", "WORK", "CONTRACT", "NONE"]),
  id: word.nullable(),
});

const aptitude = z.object({
  kind: z.enum(aptitudeKinds),
  key: word,
  trueValue: score,
  evidence: natural,
  lastEvidence: amount,
  estimate: z.string().nullable(),
  stage: z.enum(["UNKNOWN", "GUESS", "CERTAIN"]),
});
const author = z.object({
  penName: word,
  startAge: natural,
  motive: word,
  paths: z.array(path),
  startPath: path.nullable(),
  jobId: word,
  home: z.object({ name: word, comfort: score, expense: volume }),
  abilities: ability,
  condition,
  social,
  traits: keyed(
    ["consumption", "community", "multitask", "deadlineTolerance"] as const,
    score,
  ),
  specialStates: z.array(
    z.object({
      key: word,
      until: natural,
      since: natural,
      cause: word.nullable(),
    }),
  ),
  policy,
  /** Text IDs explaining why the last day's plan was not followed. */
  deviations: z.array(word),
  lastPlan: labor.nullable(),
  aptitudes: z.array(aptitude),
  cash: amount,
  /** Spending charged at the next settlement (accrues daily). */
  spendAccrued: volume,
  purchases: z.record(natural).default({}),
  lastRoutine: labor.nullable(),
});
/** What the player has observed about a contract; hidden traits stay in content. */
const contractRecord = z.object({
  /** Company history only: contracts signed with this company. */
  contracts: natural.default(0),
  settlements: natural.default(0),
  delays: natural.default(0),
  lastDelayDay: natural.nullable().default(null),
  promo: z.enum(["PENDING", "KEPT", "DELAYED"]).default("PENDING"),
  feedback: natural.default(0),
  pressure: natural.default(0),
  editorChanges: natural.default(0),
});
/** Chapter-level reads and drop-offs of one work (aggregate, no reader objects). */
const chapterLog = z.object({
  /** False when the save predates the log: only counts since `since` are known. */
  complete: z.boolean(),
  since: natural,
  /** reads[n-1]: readers who read chapter n. */
  reads: z.array(volume),
  /** drops[n-1]: readers whose last read chapter was n and who then left. */
  drops: z.array(volume),
});
const workStats = z.object({
  newReaders: volume,
  newByAge: ageBands,
  newBySource: keyed(channels, volume),
  totalNew: volume,
  views: volume,
  totalViews: volume,
  latestViews: volume,
  lost: volume,
  favorites: volume,
  publishedToday: natural,
  streakMissed: natural,
  lastPosted: natural.nullable(),
  promotionUntil: amount,
  missedReason: z.enum(["HIATUS", "NO_STOCK"]).nullable(),
});
const history = z.tuple([natural, volume, volume]);
const work = z.object({
  id: word,
  title: word,
  genre: word,
  material: word,
  tags: z.array(word),
  startPath: path,
  platformId: word,
  contractId: word.nullable(),
  status,
  startDay: natural,
  targetChapters: natural.positive(),
  published: natural,
  stock: volume,
  mask: natural.max(127),
  quality: score,
  consistency: score,
  attachment: score,
  /** Plot preparation (0–100): invested by plot time, spent by new chapters. */
  prep: score,
  stockTarget: natural,
  priority: natural.min(1).max(3),
  /** Extra chapters the player asked for; consumed by the next days. */
  rush: natural,
  /** A one-day extra writing request, charged from the shared free-time budget. */
  extraWriting: z.boolean().default(false),
  hiatusKind: z.enum(["RECOVER", "STOCK"]).nullable(),
  manual: z.boolean(),
  history: z.array(history),
  chapters: chapterLog.nullable().default(null),
  detail: z
    .object({
      since: natural,
      paidReads: volume,
      exposure: z.array(word),
      journal: z
        .array(
          z.object({
            type: word,
            day: natural,
            message: z.string(),
            workId: word.nullable(),
          }),
        )
        .default([]),
      history: z.array(z.tuple([natural, score, natural, natural, volume])),
    })
    .nullable()
    .default(null),
  endingTarget: natural.nullable().default(null),
  hiatusUntil: natural.nullable(),
  /** Forced rest has a minimum duration; a voluntary hiatus may end early. */
  hiatusLockedUntil: natural.nullable().default(null),
  resumeTo: activeStatus.nullable(),
  paidFrom: natural.nullable(),
  paidEligibleDay: natural.nullable(),
  lastResume: natural.nullable(),
  readers: z.array(z.array(volume)).length(5),
  caughtUp: ageBands,
  flags: z.array(word),
  stats: workStats,
  revenue: z.object({ accrued: natural, paid: natural }),
  end: z
    .object({
      day: natural,
      reason: endStatus,
      favorites: volume,
      views: volume,
      chapters: natural,
      rewarded: z.boolean(),
    })
    .nullable(),
});
const contract = z.object({
  editorId: word.nullable().default(null),
  settlementCycle: natural.default(30),
  record: contractRecord.default({}),
  id: word,
  workId: word,
  companyId: word,
  signedDay: natural,
  expiresDay: natural,
  share: finite.min(0).max(1),
  advance: natural,
  promise: word,
  promotionStart: natural,
  promotionEnd: natural,
  status: z.enum(["ACTIVE", "EXPIRED", "TERMINATED"]),
});
const selectedEvent = z.object({
  id: word,
  defId: word,
  day: natural,
  tier: z.enum(["ORIGIN", "FOLLOW_UP", "FORCED", "REGULAR", "FALLBACK"]),
  target,
  choiceIds: z.array(word),
  resolvedChoice: word.nullable(),
  offerCompanyId: word.nullable(),
  offerEditorId: word.nullable().default(null),
  followUpId: word.nullable(),
  status: z.enum(["PENDING", "RESOLVED"]),
});
const scheduled = z.object({
  id: word,
  defId: word,
  from: word,
  target,
  dueDay: natural,
  expiresDay: natural,
});
const ledger = z.object({
  id: word,
  day: natural,
  kind: ledgerKind,
  amount,
  workId: word.nullable(),
  ref: word,
});
const engineEvent = z.object({
  type: z.enum([
    "DAY_STARTED",
    "EVENT_SELECTED",
    "CHOICE_REQUIRED",
    "CHOICE_RESOLVED",
    "EFFECT_APPLIED",
    "CHAPTER_POSTED",
    "CHAPTER_MISSED",
    "WORK_STATUS_CHANGED",
    "STATE_CHANGED",
    "COMMAND",
    "WORK_ORDER",
    "WORK_EXPOSURE",
    "PAYOUT",
    "DAY_CLOSED",
  ]),
  day: natural,
  message: z.string(),
  workId: word.nullable(),
});
const summary = z.object({
  day: natural,
  eventId: word,
  eventTitle: word,
  time: labor,
  newReaders: volume,
  views: volume,
  posted: natural,
  gained: natural,
  cash: amount,
  condition,
});
export const stateSchema = z.object({
  schemaVersion: natural,
  rulesVersion: word,
  contentHash: word,
  seed: natural.max(4294967295),
  day: natural,
  phase,
  author,
  works: z.array(work),
  contracts: z.array(contract),
  ledger: z.array(ledger),
  /** Totals of ledger entries compacted out of `ledger`, by kind. */
  ledgerCarry: z.record(ledgerKind, amount),
  /** Monotonic ledger ID counter; IDs stay unique after compaction. */
  ledgerSeq: natural,
  /** Aggregated observations per company across all contracts. */
  companyRecords: z.record(contractRecord).default({}),
  flags: z.array(word),
  eventLast: z.record(natural),
  eventCount: z.record(natural),
  lastForced: amount,
  priorityStreak: natural,
  followUps: z.array(scheduled),
  eventHistory: z.array(selectedEvent),
  archive: z.array(z.tuple([word, word.nullable(), word.nullable()])),
  pending: selectedEvent.nullable(),
  pendingNewWork: z
    .object({
      id: word,
      day: natural,
      path,
      sourceTitle: word,
      reasonId: word,
    })
    .nullable()
    .default(null),
  /** Set when the author ends their writing life (16번 §10). */
  ending: z.object({ day: natural, reason: z.literal("VOLUNTARY") }).nullable(),
  log: z.array(engineEvent),
  summaries: z.array(summary),
});
export const envelopeSchema = z.object({
  format: z.literal("webnovel-life-save"),
  schemaVersion: natural,
  rulesVersion: word,
  contentHash: word,
  savedAtDay: natural,
  phase,
  state: stateSchema,
});
export type LifeState = z.infer<typeof stateSchema>;
export type Author = z.infer<typeof author>;
export type Work = z.infer<typeof work>;
export type ContractRecord = z.infer<typeof contractRecord>;
export type ChapterLog = z.infer<typeof chapterLog>;
export type Contract = z.infer<typeof contract>;
export type EventInstance = z.infer<typeof selectedEvent>;
export type Target = z.infer<typeof target>;
export type EngineEvent = z.infer<typeof engineEvent>;
export type DailySummary = z.infer<typeof summary>;
export type Routine = z.infer<typeof labor>;
export type LedgerEntry = z.infer<typeof ledger>;
export type Aptitude = z.infer<typeof aptitude>;
export type ConditionStat = (typeof conditionKeys)[number];
export type SocialStat = (typeof socialKeys)[number];
export type LifeEndPolicy = (state: Readonly<LifeState>) => boolean;
export const neverEnd: LifeEndPolicy = () => false;
export const SCHEMA_VERSION = 3;
export const RULES_VERSION = "0.3.6";
export type AdvanceResult = {
  state: LifeState;
  events: EngineEvent[];
  stoppedReason: "DAYS_DONE" | "AWAITING_CHOICE" | "AWAITING_WORK" | "ENDED";
};
export type CommandError =
  "E_NO_PENDING" | "E_INVALID_CHOICE" | "E_SAVE_CORRUPT" | "E_SAVE_VERSION";
export type PlayerCommandError =
  "E_ENDED" | "E_NO_WORK" | "E_NOT_ALLOWED" | "E_INVALID_PLAN" | "E_LIMIT";
export type TimePolicy = z.infer<typeof timePolicy>;
export type SpendPolicy = z.infer<typeof spendPolicy>;
