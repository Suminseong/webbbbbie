import { z } from "zod";
import balanceData from "../balance.v0.json";
import playerActionData from "../player-actions.v0.json";
import oneTimeExpenseData from "../one-time-expenses.v0.json";
import tagUnlockData from "../tag-unlocks.v0.json";
import companyTraitData from "../company-traits.v0.json";
import platformData from "../platforms.json";
import worldData from "../world.json";
import policyData from "../policies.json";
import specialData from "../specials.json";
import lifeEvents from "../events/life.json";
import writingEvents from "../events/writing.json";
import readerEvents from "../events/reader.json";
import platformEvents from "../events/platform.json";
import jobEvents from "../events/job.json";
import communityEvents from "../events/community.json";
import forcedEvents from "../events/forced.json";
import contractEvents from "../events/contract.json";
import specialEvents from "../events/special.json";
import moneyEvents from "../events/money.json";
import originEvents from "../events/origin.json";

import { sourceText } from "./text";
export {
  appliedTexts,
  displayName,
  displayWorkTitle,
  matchingText,
  originalTexts,
  sourceText,
  text,
  textIdPattern,
  textIssue,
  textTemplate,
  variablesIn,
} from "./text";
export type { TextVariables } from "./text";

/** Authored event files, concatenated in this fixed order (content hash input). */
const eventData = [
  ...originEvents,
  ...lifeEvents,
  ...writingEvents,
  ...readerEvents,
  ...platformEvents,
  ...jobEvents,
  ...communityEvents,
  ...forcedEvents,
  ...contractEvents,
  ...specialEvents,
  ...moneyEvents,
];

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
export const eventCategories = [
  "origin",
  "life",
  "writing",
  "reader",
  "platform",
  "job",
  "community",
  "forced",
  "contract",
  "special",
  "money",
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
export const playerActionRules = z
  .object({
    extraWritingSlots: days.max(48),
    healthWritingFloor: natural.max(100),
    fatigueWritingCeiling: natural.max(100),
    stressRiskStart: natural.max(100),
    driveRiskStart: natural.max(100),
    stressFailureScale: probability,
    driveFailureScale: probability,
    endingMaxRemaining: days,
    endingPlotWeight: finite.positive(),
  })
  .strict()
  .parse(playerActionData);
export const oneTimeExpenses = z
  .array(
    z
      .object({
        id: id,
        cost: natural.positive(),
        cooldownDays: natural.positive(),
        effects: z
          .object({
            health: finite.optional(),
            fatigue: finite.optional(),
            stress: finite.optional(),
            drive: finite.optional(),
          })
          .strict(),
      })
      .strict(),
  )
  .min(1)
  .refine(
    (entries) =>
      new Set(entries.map((entry) => entry.id)).size === entries.length,
    "Duplicate expense ID",
  )
  .parse(oneTimeExpenseData);
export const tagUnlocks = z
  .array(
    z
      .object({
        id,
        textId: z.string().min(1),
        publishedChapters: natural.positive(),
        platforms: z.array(id).min(1),
      })
      .strict(),
  )
  .refine(
    (entries) =>
      new Set(entries.map((entry) => entry.id)).size === entries.length,
    "Duplicate unlocked tag ID",
  )
  .parse(tagUnlockData);
/**
 * Per-company contract details (16번 §9, 계약사 특성). `settlementCycle` is
 * a public term. Punctuality, promotion strength and the editors' skill,
 * interference and warmth are hidden: the player only sees observed records.
 */
const editorTrait = z
  .object({
    id,
    name: z.string().min(1),
    pitch: z.string().min(1),
    skill: natural.max(100),
    interference: natural.max(100),
    warmth: natural.max(100),
  })
  .strict();
export const companyTraits = z
  .record(
    id,
    z
      .object({
        settlementCycle: z.union([z.literal(30), z.literal(60), z.literal(90)]),
        payPunctuality: probability,
        promoPower: probability,
        editors: z.array(editorTrait).min(1),
      })
      .strict(),
  )
  .parse(companyTraitData);
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
  z.object({
    kind: z.literal("ability"),
    stat: z.enum(abilityKeys),
    amount: finite,
  }),
  z.object({ kind: z.literal("attachment"), amount: finite }),
  z.object({ kind: z.literal("consistency"), amount: finite }),
  z.object({ kind: z.literal("promotion"), days }),
  z.object({ kind: z.literal("clearSpecial"), key: label }),
  z.object({ kind: z.literal("reassignEditor") }),
]);

/** Condition keys whose value is a "key:true|false" string. */
const stringConditions = ["job", "path", "targetFlag", "special"];

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
      "special",
      "recognition",
      "reputation",
      "fandom",
      "expectation",
      "favorites",
      "quality",
      "stock",
      "contracted",
      "completedWorks",
      "totalWorks",
      "multitask",
      "insight",
      "workAge",
      "contractDelays",
      "contractPromoMissed",
      "contractSkill",
      "contractInterference",
      "contractWarmth",
      "sleepSlots",
      "restSlots",
      "plotSlots",
      "writingSlots",
      "hiatusWorks",
      "prep",
      "consistency",
      "attachment",
    ]),
    op: z.enum(["eq", "gte", "lte"]),
    value: z.union([finite, label]),
  })
  .refine((entry) => {
    if (stringConditions.includes(entry.key)) {
      return (
        entry.op === "eq" &&
        typeof entry.value === "string" &&
        (entry.key !== "targetFlag" ||
          /^[a-z][a-z0-9_-]*:(true|false)$/.test(entry.value)) &&
        (entry.key !== "special" || /^.+:(true|false)$/.test(entry.value))
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
    category: z.enum(eventCategories),
    tier: z.enum(["ORIGIN", "FOLLOW_UP", "FORCED", "REGULAR", "FALLBACK"]),
    scope: z.enum(["AUTHOR", "WORK", "CONTRACT", "NONE"]),
    targetBias: z.enum(["views", "newest", "stock"]).optional(),
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
        "restMin",
        "restMax",
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
      "stressPull",
      "stressBaseline",
      "drivePull",
      "driveBaseline",
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
        backlistHalfLife: days,
        trafficShare: probability.positive(),
        luckFloor: probability,
        luckTail: probability,
        backlistFavorites: days,
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
        ledgerKeepDays: days,
      })
      .strict(),
    events: numeric(
      [
        "forcedGlobalCooldown",
        "forcedSameCooldown",
        "maxPriorityStreak",
        "choiceIntervalMin",
        "choiceIntervalMax",
        "choiceGapFloor",
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
    plan: numeric([
      "defaultSleep",
      "defaultPlot",
      "defaultCommunity",
      "defaultEgo",
      "defaultRest",
      "maxTitle",
      "maxTags",
      "stockTargetMax",
      "prepStart",
      "prepGain",
      "prepDecay",
      "prepCost",
      "prepFloor",
      "overtimeAt",
      "overtimeEfficiency",
      "restStress",
      "restDrive",
      "restFatigue",
      "rushFatigue",
      "rushStress",
      "dropReputation",
      "dropStress",
      "hiatusRecover",
      "defaultTarget",
      "historyKeep",
      "sideWage",
    ] as const),
    spending: z
      .object({
        meals: z.array(natural).length(4),
        gear: z.array(natural).length(4),
        health: z.array(natural).length(4),
        research: z.array(natural).length(4),
        leisure: z.array(natural).length(4),
        promo: z.array(natural).length(4),
        efficiency: z.array(finite.nonnegative()).length(4),
        mealsHealth: finite,
        mealsStress: finite,
        gearWriting: finite,
        gearFatigue: finite,
        healthRecovery: finite,
        researchPrep: finite,
        leisureStress: finite,
        leisureDrive: finite,
        promoExposure: finite,
      })
      .strict(),
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
const metric = z.enum(["cash", "health", "fatigue", "stress", "drive"]);
const stateRule = z
  .object({ metric, op: z.enum(["gte", "lte"]), value: finite })
  .strict();
const special = z
  .object({
    key: label,
    name: label,
    writing: finite.positive().max(2),
    stressDaily: finite,
    driveDaily: finite,
    egoBonus: natural.max(4),
    communityBonus: natural.max(4),
    /** Sustained-state rules (16번 §7); absent for plain timed states. */
    cause: label.optional(),
    min: natural.optional(),
    max: days.optional(),
    onset: z
      .object({ when: z.array(stateRule).min(1), chance: probability })
      .strict()
      .optional(),
    release: z.array(stateRule).optional(),
    workExtra: natural.max(12).optional(),
    sleepLoss: natural.max(8).optional(),
    driveHigh: finite.optional(),
    driveLow: finite.optional(),
    hiatusChance: probability.optional(),
    newWorkChance: probability.optional(),
    rushEndChance: probability.optional(),
    spendCut: z.boolean().optional(),
    restMult: finite.positive().optional(),
    hint: label.optional(),
  })
  .strict();

const policies = z
  .object({
    lifeEnd: z.enum(["none", "voluntary"]),
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
    specials: z.array(special).min(1),
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
    if (
      new Set(content.specials.map((item) => item.key)).size !==
      content.specials.length
    )
      issue("Duplicate special state key");
    const specialKeys = new Set(content.specials.map((item) => item.key));

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
      if ((entry.tier === "ORIGIN") !== (entry.category === "origin"))
        issue("Origin category must match the origin tier in " + entry.id);
      if (entry.tier === "FORCED" && entry.category !== "forced")
        issue("Forced events belong to the forced category in " + entry.id);
      if (entry.targetBias && entry.scope !== "WORK")
        issue("Target bias needs a work scope in " + entry.id);
      for (const rule of [...(entry.conditions ?? []), ...(entry.any ?? [])]) {
        if (
          rule.key === "special" &&
          !specialKeys.has(String(rule.value).replace(/:(true|false)$/, ""))
        )
          issue("Unknown special state condition in " + entry.id);
        if (
          rule.key.startsWith("contract") &&
          entry.scope !== "CONTRACT" &&
          rule.key !== "contracted"
        )
          issue("Contract condition without contract scope in " + entry.id);
        if (
          [
            "favorites",
            "quality",
            "stock",
            "contracted",
            "workAge",
            "prep",
            "consistency",
            "attachment",
          ].includes(rule.key) &&
          entry.scope !== "WORK" &&
          entry.scope !== "CONTRACT"
        )
          issue("Work condition without work scope in " + entry.id);
      }
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
        if (
          (effect.kind === "special" || effect.kind === "clearSpecial") &&
          !specialKeys.has(effect.key)
        )
          issue("Unknown special state " + effect.key + " in " + entry.id);
        if (effect.kind === "origin" && entry.tier !== "ORIGIN")
          issue("Origin effect outside day zero in " + entry.id);
        if (effect.kind === "reassignEditor" && entry.scope !== "CONTRACT")
          issue("Editor effect without contract scope in " + entry.id);
        if (effect.kind === "contract" && !entry.offer)
          issue("Contract effect outside offer in " + entry.id);
        if (
          [
            "transition",
            "stock",
            "quality",
            "readerShock",
            "evidence",
            "attachment",
            "consistency",
            "promotion",
          ].includes(effect.kind) &&
          entry.scope !== "WORK" &&
          entry.scope !== "CONTRACT"
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
      content.balance.life.restMin > content.balance.life.restMax ||
      content.balance.aptitude.unknownMin >
        content.balance.aptitude.unknownMax ||
      content.balance.aptitude.guessEvidence >=
        content.balance.aptitude.confirmEvidence
    )
      issue("Balance ranges are inverted");
  });

export type Content = z.infer<typeof contentSchema>;
export type EventCategory = (typeof eventCategories)[number];
export type SpecialDef = z.infer<typeof special>;
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
  platforms: platformData.map((platform) => ({
    ...platform,
    name: sourceText(platform.name),
    tags: platform.tags.map(sourceText),
  })),
  world: {
    jobs: worldData.jobs.map((job) => ({ ...job, name: sourceText(job.name) })),
    homes: worldData.homes.map((home) => ({
      ...home,
      name: sourceText(home.name),
    })),
    motives: worldData.motives.map((motive) => ({
      ...motive,
      text: sourceText(motive.text),
    })),
    penNames: worldData.penNames.map(sourceText),
    works: worldData.works.map((work) => ({
      ...work,
      title: sourceText(work.title),
      genre: sourceText(work.genre),
      material: sourceText(work.material),
      tags: work.tags.map(sourceText),
    })),
    companies: worldData.companies.map((company) => ({
      ...company,
      name: sourceText(company.name),
      promise: sourceText(company.promise),
    })),
  },
  policies: policyData,
  specials: (specialData as unknown[]).map((raw) => {
    const state = raw as { name: string };
    return {
      ...(raw as object),
      name: sourceText(state.name),
    };
  }),
  events: eventData.map((event) => ({
    ...event,
    title: sourceText(event.title),
    text: sourceText(event.text),
    choices:
      "choices" in event
        ? event.choices?.map((choice) => ({
            ...choice,
            label: sourceText(choice.label),
          }))
        : undefined,
  })),
});
