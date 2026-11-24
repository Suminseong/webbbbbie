import { z } from "zod";
import balanceData from "../balance.v0.json";
import platformData from "../platforms.json";
import worldData from "../world.json";
import eventData from "../events.json";
import policyData from "../policies.json";

export const abilityKeys = [
  "talent",
  "style",
  "insight",
  "vocabulary",
  "commercial",
  "speed",
  "diligence",
  "resilience",
] as const;
export const conditionKeys = ["health", "fatigue", "stress", "drive"] as const;
export const socialKeys = [
  "recognition",
  "reputation",
  "completionTrust",
  "expectation",
  "demand",
  "fandom",
] as const;
export const statuses = [
  "PLANNING",
  "SERIAL_FREE",
  "SERIAL_PAID",
  "HIATUS",
  "COMPLETED",
  "RUSHED_END",
  "DROPPED",
  "TAKEN_DOWN",
] as const;
export const paths = ["ORIGINAL", "PARODY", "PLAGIARISM"] as const;
export const channels = [
  "NEW",
  "UPDATE",
  "HOT",
  "BEST",
  "OFFICIAL",
  "PROMOTION",
  "COMMUNITY",
  "FANDOM",
  "ORGANIC",
  "BACKLIST",
] as const;
export const aptitudeKinds = [
  "GENRE",
  "MATERIAL",
  "TAG",
  "SCHEDULE",
  "PLATFORM",
] as const;

const label = z.string().min(1);
const id = z.string().regex(/^[a-z][a-z0-9_-]*$/);
const probability = z.number().min(0).max(1);
const finite = z.number().finite();
const natural = finite.int().nonnegative();
const days = natural.positive();
function numeric<K extends string>(keys: readonly K[], value = finite) {
  const shape = Object.fromEntries(keys.map((key) => [key, value])) as Record<
    K,
    typeof value
  >;
  return z.object(shape).strict();
}
const five = z.array(probability).length(5);
const platform = z
  .object({
    id,
    name: label,
    model: z.enum(["EPISODE", "SUBSCRIPTION"]),
    visitors: days,
    ages: five.refine(
      (bands) => Math.abs(bands.reduce((a, b) => a + b, 0) - 1) < 0.00001,
      "Age bands must sum to one",
    ),
    tags: z.array(label).min(1),
    strength: z.enum(abilityKeys),
    frequency: finite.positive(),
    retention: finite.positive(),
    click: probability,
    readStart: probability,
    slots: numeric(channels, probability),
  })
  .strict();

export const effectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("condition"),
    stat: z.enum(conditionKeys),
    amount: finite,
  }),
  z.object({
    kind: z.literal("social"),
    stat: z.enum(socialKeys),
    amount: finite,
  }),
  z.object({ kind: z.literal("special"), key: label, days }),
  z.object({ kind: z.literal("origin"), path: z.enum(paths) }),
  z.object({
    kind: z.literal("transition"),
    to: z.enum(statuses),
    days: days.optional(),
  }),
  z.object({ kind: z.literal("stock"), amount: finite }),
  z.object({ kind: z.literal("quality"), amount: finite }),
  z.object({ kind: z.literal("readerShock"), amount: probability }),
  z.object({ kind: z.literal("createWork") }),
  z.object({ kind: z.literal("cash"), amount: finite.int() }),
  z.object({ kind: z.literal("job"), id }),
  z.object({ kind: z.literal("evidence"), amount: days }),
  z.object({ kind: z.literal("contract") }),
  z.object({ kind: z.literal("flag"), key: id }),
  z.object({ kind: z.literal("schedule"), id, delay: days, window: days }),
]);

const condition = z
  .object({
    key: z.enum([
      "health",
      "fatigue",
      "stress",
      "drive",
      "cash",
      "job",
      "jobSlots",
      "paid",
      "published",
      "maxPublished",
      "activeWorks",
      "canAddWork",
      "canContract",
      "demand",
      "egoUse",
      "communityUse",
      "path",
      "targetFlag",
    ]),
    op: z.enum(["eq", "gte", "lte"]),
    value: z.union([finite, label]),
  })
  .refine((entry) => {
    if (["job", "path", "targetFlag"].includes(entry.key)) {
      return (
        entry.op === "eq" &&
        typeof entry.value === "string" &&
        (entry.key !== "targetFlag" ||
          /^[a-z][a-z0-9_-]*:(true|false)$/.test(entry.value))
      );
    }
    return typeof entry.value === "number";
  }, "Condition value does not match its metric");

const choice = z.object({ id, label, effects: z.array(effectSchema) }).strict();
const event = z
  .object({
    id,
    title: label,
    text: label,
    tier: z.enum(["ORIGIN", "FOLLOW_UP", "FORCED", "REGULAR", "FALLBACK"]),
    scope: z.enum(["AUTHOR", "WORK", "CONTRACT", "NONE"]),
    weight: finite.positive(),
    cooldown: natural,
    minDay: natural,
    once: z.boolean().optional(),
    statuses: z.array(z.enum(statuses)).optional(),
    conditions: z.array(condition).optional(),
    any: z.array(condition).min(1).optional(),
    offer: z.boolean().optional(),
    effects: z.array(effectSchema).optional(),
    choices: z.array(choice).min(1).optional(),
  })
  .strict();

const balance = z
  .object({
    life: numeric(
      [
        "ageMin",
        "ageMax",
        "yearDays",
        "startCash",
        "abilityMin",
        "abilityMax",
        "maxActiveWorks",
      ] as const,
      days,
    ),
    time: numeric(
      [
        "day",
        "sleep",
        "minSleep",
        "living",
        "workUnit",
        "deadlinePressure",
        "communityMax",
        "egoMax",
      ] as const,
      days,
    ),
    writing: numeric([
      "base",
      "speedFactor",
      "conditionMin",
      "fatiguePenalty",
      "stressPenalty",
      "aptitudeMin",
      "aptitudeMax",
      "targetStock",
      "paidChapters",
      "paidFavorites",
      "resumeHealth",
      "defaultHiatus",
      "secondWorkChapters",
    ] as const),
    condition: numeric([
      "initialHealth",
      "initialFatigue",
      "initialStress",
      "initialDrive",
      "healthySleep",
      "healthLoss",
      "healthRecovery",
      "fatigueThreshold",
      "fatigueGain",
      "fatigueRecovery",
      "fatigueSleepBase",
      "missedThreshold",
      "missedStress",
      "restStress",
      "successStress",
    ] as const),
    market: z
      .object({
        reach: probability.positive(),
        groupSize: days,
        ageSpeed: z.array(days).length(5),
        ageAttrition: five,
        newDays: days,
        returnDays: days,
        hotFavorites: days,
        bestFavorites: days,
      })
      .strict(),
    economy: z
      .object({
        settlementDays: days,
        chapterPrice: days,
        purchaseRate: probability,
        authorShare: probability,
        subscriptionWon: days,
        livingExpense: days,
      })
      .strict(),
    events: numeric(
      [
        "forcedGlobalCooldown",
        "forcedSameCooldown",
        "maxPriorityStreak",
        "choiceIntervalMin",
        "choiceIntervalMax",
        "logKeep",
        "summaryKeep",
        "eventHistoryKeep",
      ] as const,
      days,
    ),
    aptitude: numeric(
      [
        "guessEvidence",
        "confirmEvidence",
        "evidenceDays",
        "unknownMin",
        "unknownMax",
        "guessError",
      ] as const,
      days,
    ),
    growth: numeric([
      "completionSkill",
      "rushedSkill",
      "droppedSkill",
      "recognitionCap",
      "completionTrust",
    ] as const),
    limits: z
      .object({
        dailyMeanMs: finite.positive(),
        saveMaxBytes: days,
        sampleWorks: days,
        sampleDays: days,
      })
      .strict(),
  })
  .strict();

const world = z.object({
  jobs: z
    .array(
      z.object({
        id,
        name: label,
        slots: natural.max(30),
        income: natural,
        irregularity: natural.max(8),
      }),
    )
    .min(1),
  homes: z
    .array(
      z.object({
        name: label,
        comfort: natural.max(100),
        expense: finite.positive(),
      }),
    )
    .min(1),
  motives: z
    .array(z.object({ text: label, paths: z.array(z.enum(paths)).min(1) }))
    .min(1),
  penNames: z.array(label).min(1),
  works: z
    .array(
      z.object({
        title: label,
        genre: label,
        material: label,
        tags: z.array(label).min(1),
        target: days,
        mask: days.max(127),
      }),
    )
    .min(1),
  companies: z
    .array(
      z.object({
        id,
        name: label,
        share: probability,
        advance: natural,
        duration: days,
        promise: label,
        honesty: natural.max(100),
        skill: natural.max(100),
        interference: natural.max(100),
      }),
    )
    .min(1),
});
const policies = z
  .object({
    lifeEnd: z.literal("none"),
    allowFalseConviction: z.boolean(),
    minimumReleaseEvents: days,
    completionReach: numeric(
      ["COMPLETED", "RUSHED_END", "DROPPED", "TAKEN_DOWN"] as const,
      probability,
    ),
  })
  .strict();

const contentSchema = z
  .object({
    balance,
    platforms: z.array(platform).min(1),
    world,
    policies,
    events: z.array(event).min(2),
  })
  .superRefine((content, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    function unique(items: readonly { id: string }[], name: string) {
      if (new Set(items.map((item) => item.id)).size !== items.length)
        issue("Duplicate " + name + " ID");
    }
    unique(content.events, "event");
    unique(content.platforms, "platform");
    unique(content.world.jobs, "job");
    unique(content.world.companies, "company");

    const origin = content.events.filter((entry) => entry.tier === "ORIGIN");
    const fallback = content.events.filter(
      (entry) => entry.tier === "FALLBACK",
    );
    if (origin.length !== 1 || origin[0]?.minDay !== 0 || !origin[0].choices)
      issue("One day-zero choice event is required");
    if (
      fallback.length !== 1 ||
      fallback[0]?.scope !== "NONE" ||
      fallback[0].choices ||
      fallback[0].conditions ||
      fallback[0].any ||
      fallback[0].once ||
      fallback[0].minDay > 1 ||
      fallback[0].cooldown !== 0
    ) {
      issue("One unconditional fallback event is required");
    }
    for (const entry of content.events) {
      if (entry.choices) unique(entry.choices, "choice in " + entry.id);
      if (entry.choices && entry.effects)
        issue("Choices and automatic effects are exclusive in " + entry.id);
      if (entry.tier === "FORCED" && entry.choices)
        issue("Forced events cannot wait for a choice in " + entry.id);
      if (entry.offer && (entry.scope !== "WORK" || !entry.choices))
        issue("Offer must belong to a work choice in " + entry.id);
      const effects =
        entry.effects ?? entry.choices?.flatMap((item) => item.effects) ?? [];
      for (const effect of effects) {
        if (
          effect.kind === "job" &&
          !content.world.jobs.some((job) => job.id === effect.id)
        )
          issue("Unknown job " + effect.id);
        if (
          effect.kind === "schedule" &&
          !content.events.some(
            (next) =>
              next.id === effect.id &&
              next.tier === "FOLLOW_UP" &&
              next.scope === entry.scope,
          )
        )
          issue("Invalid follow-up " + effect.id + " in " + entry.id);
        if (effect.kind === "origin" && entry.tier !== "ORIGIN")
          issue("Origin effect outside day zero in " + entry.id);
        if (effect.kind === "contract" && !entry.offer)
          issue("Contract effect outside offer in " + entry.id);
        if (
          [
            "transition",
            "stock",
            "quality",
            "readerShock",
            "evidence",
          ].includes(effect.kind) &&
          entry.scope !== "WORK"
        )
          issue("Work effect without work scope in " + entry.id);
      }
    }
    if (
      content.balance.time.day !== 48 ||
      content.balance.time.minSleep > content.balance.time.sleep ||
      content.balance.time.sleep +
        content.balance.time.living +
        Math.max(
          ...content.world.jobs.map((job) => job.slots + job.irregularity),
        ) >
        48
    ) {
      issue("Daily time budgets are infeasible");
    }
    const numericSettings = [
      content.balance.life,
      content.balance.writing,
      content.balance.condition,
      content.balance.aptitude,
      content.balance.growth,
    ];
    if (
      numericSettings.some((group) =>
        Object.values(group).some((value) => value < 0),
      )
    )
      issue("Balance coefficients must be nonnegative");
    if (
      content.balance.life.ageMin > content.balance.life.ageMax ||
      content.balance.life.abilityMin > content.balance.life.abilityMax ||
      content.balance.aptitude.unknownMin >
        content.balance.aptitude.unknownMax ||
      content.balance.aptitude.guessEvidence >=
        content.balance.aptitude.confirmEvidence
    )
      issue("Balance ranges are inverted");
  });

export type Content = z.infer<typeof contentSchema>;
export type EventDef = z.infer<typeof event>;
export type Effect = z.infer<typeof effectSchema>;
export type Platform = z.infer<typeof platform>;
export type Condition = z.infer<typeof condition>;
export type WorkStatus = (typeof statuses)[number];
export type StartPath = (typeof paths)[number];
export type Channel = (typeof channels)[number];
export type AptitudeKind = (typeof aptitudeKinds)[number];

export function parseContent(input: unknown): Content {
  return contentSchema.parse(input);
}

export const defaultContent = parseContent({
  balance: balanceData,
  platforms: platformData,
  world: worldData,
  policies: policyData,
  events: eventData,
});
