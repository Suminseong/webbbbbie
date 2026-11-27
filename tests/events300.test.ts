import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createEngine } from "@webbbbbie/engine";
import type { LifeState, EngineEvent } from "@webbbbbie/engine";
import { defaultContent } from "@webbbbbie/content";
import type { Condition, EventDef } from "@webbbbbie/content";
import { selectEvent, applyEvent } from "../packages/engine/src/events";
import { settleWork } from "./auto-new-work";
import ids from "./fixtures/events300-ids.json";
const product = createEngine();
const additions = defaultContent.events.filter((e) => ids.includes(e.id));
function setup(def: EventDef) {
  let state = product.createLife(42);
  state = product.choose(state, state.pending!.id, "original").state;
  state.day = 100;
  const w = state.works[0];
  w.status = def.statuses?.[0] ?? "SERIAL_FREE";
  w.published = 80;
  w.stock = 5;
  w.targetChapters = 150;
  state.author.condition = { health: 50, fatigue: 20, stress: 50, drive: 50 };
  state.author.lastRoutine = {
    work: 0,
    living: 6,
    sleep: 14,
    community: 1,
    ego: 1,
    plot: { [w.id]: 2 },
    rest: 2,
    writing: { [w.id]: 10 },
    unused: 0,
  };
  if (def.scope === "CONTRACT") {
    state.contracts.push({
      id: "C-1",
      workId: w.id,
      companyId: defaultContent.world.companies[0].id,
      signedDay: 0,
      expiresDay: 900,
      share: 0.6,
      advance: 0,
      promise: "test",
      promotionStart: 4,
      promotionEnd: 14,
      status: "ACTIVE",
      editorId: null,
      settlementCycle: 30,
      record: {
        contracts: 1,
        settlements: 0,
        delays: 0,
        lastDelayDay: null,
        promo: "PENDING",
        feedback: 0,
        pressure: 0,
        editorChanges: 0,
      },
    });
    w.contractId = "C-1";
  }
  for (const c of def.conditions ?? []) set(state, c, c.value);
  if (def.tier === "FOLLOW_UP")
    state.followUps.push({
      id: "FU-test",
      from: "EV-test",
      defId: def.id,
      dueDay: 101,
      expiresDay: 120,
      target: {
        scope: def.scope,
        id:
          def.scope === "CONTRACT" ? "C-1" : def.scope === "WORK" ? w.id : null,
      },
    });
  return state;
}
function set(state: LifeState, c: Condition, value: string | number) {
  const w = state.works[0],
    a = state.author,
    r = a.lastRoutine!,
    v = Number(value);
  switch (c.key) {
    case "health":
    case "fatigue":
    case "stress":
    case "drive":
      a.condition[c.key] = v;
      break;
    case "cash":
      a.cash = v;
      break;
    case "job":
      a.jobId = String(value);
      break;
    case "jobSlots":
      a.jobId =
        defaultContent.world.jobs.find((j) =>
          c.op === "lte" ? j.slots <= v : j.slots >= v,
        )?.id ?? "unemployed";
      break;
    case "recognition":
    case "reputation":
    case "fandom":
    case "expectation":
      a.social[c.key] = v;
      break;
    case "published":
      w.published = v;
      break;
    case "workAge":
      w.startDay = 101 - v;
      break;
    case "stock":
    case "quality":
    case "consistency":
    case "attachment":
    case "prep":
      w[c.key] = v;
      break;
    case "sleepSlots":
      r.sleep = v;
      break;
    case "restSlots":
      r.rest = v;
      break;
    case "plotSlots":
      r.plot = { [w.id]: v };
      break;
    case "writingSlots":
      r.writing = { [w.id]: v };
      break;
    case "egoUse":
      r.ego = v;
      break;
    case "communityUse":
      r.community = v;
      break;
    case "paid":
      w.revenue.paid = v;
      w.revenue.accrued = v;
      break;
    case "favorites":
      w.stats.favorites = v;
      break;
    case "activeWorks":
      if (state.works.length > v) state.works.splice(v);
      while (state.works.length < v)
        state.works.push({
          ...structuredClone(w),
          id: "W-" + (state.works.length + 1),
          status: "PLANNING",
        });
      if (v < 1) state.works = [];
      break;
    case "hiatusWorks":
      if (v > 0) {
        if (defersContract(state))
          state.works.push({
            ...structuredClone(w),
            id: "W-2",
            contractId: null,
            status: "HIATUS",
          });
        else w.status = "HIATUS";
      } else for (const x of state.works) x.status = "SERIAL_FREE";
      break;
    case "targetFlag": {
      const [key, b] = String(value).split(":");
      for (const flags of [w.flags, state.flags]) {
        if (b === "true" && !flags.includes(key)) flags.push(key);
        else if (b === "false" && flags.includes(key))
          flags.splice(flags.indexOf(key), 1);
      }
      break;
    }
    case "special": {
      const [key, b] = String(value).split(":");
      a.specialStates = a.specialStates.filter((x) => x.key !== key);
      if (b === "true")
        a.specialStates.push({ key, since: 90, until: 900, cause: null });
      break;
    }
    case "contractDelays":
      state.contracts[0].record.delays = v;
      break;
    case "contractPromoMissed":
      state.contracts[0].record.promo = v ? "DELAYED" : "KEPT";
      break;
    case "canAddWork":
      if (!v)
        while (state.works.length < defaultContent.balance.life.maxActiveWorks)
          state.works.push({
            ...structuredClone(w),
            id: "W-" + (state.works.length + 1),
          });
      break;
    default:
      throw new Error("No fixture setter: " + c.key);
  }
}
const defersContract = (s: LifeState) => s.contracts.length > 0;
function selection(state: LifeState, def: EventDef) {
  return selectEvent(
    state,
    {
      ...defaultContent,
      events: defaultContent.events.filter(
        (x) => x.id === def.id || x.tier === "ORIGIN" || x.tier === "FALLBACK",
      ),
    },
    101,
  );
}
describe("[17번] 95 authored event additions", () => {
  it("counts only distinct mechanics and keeps original 205", () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(additions).toHaveLength(ids.length);
    expect(defaultContent.events).toHaveLength(205 + ids.length);
    const signature = (e: EventDef) =>
      JSON.stringify({
        scope: e.scope,
        tier: e.tier,
        statuses: e.statuses,
        conditions: e.conditions,
        effects: e.effects,
        choices: e.choices?.map((c) => c.effects),
      });
    expect(new Set(additions.map(signature)).size).toBe(ids.length);
  });
  for (const def of additions) {
    it(`${def.id}: actual eligibility, every choice/effect, fixed target, cooldown`, () => {
      const initial = setup(def),
        one = selection(initial, def);
      expect(one.defId).toBe(def.id);
      const gate = def.conditions?.[0];
      if (gate) {
        const blocked = structuredClone(initial);
        const value =
          typeof gate.value === "number"
            ? gate.value + (gate.op === "lte" ? 1 : -1)
            : gate.key === "special" || gate.key === "targetFlag"
              ? gate.value.replace(":true", ":false")
              : "absent-job";
        if (gate.key === "jobSlots") blocked.author.jobId = "unemployed";
        else set(blocked, gate, value);
        expect(selection(blocked, def).defId).not.toBe(def.id);
      }
      for (const choice of def.choices ?? [null]) {
        const state = structuredClone(initial),
          before = structuredClone(initial),
          log: EngineEvent[] = [];
        applyEvent(state, defaultContent, one, choice?.id ?? null, log);
        const fx = choice?.effects ?? def.effects ?? [],
          target = state.works.find(
            (w) =>
              w.id ===
              (def.scope === "CONTRACT"
                ? state.contracts.find((c) => c.id === one.target.id)?.workId
                : one.target.id),
          );
        expect(state.archive.at(-1)).toEqual([
          def.id,
          one.target.id,
          choice?.id ?? null,
        ]);
        expect(state.eventCount["event:" + def.id]).toBe(1);
        expect(state.author.cash - before.author.cash).toBe(
          fx.filter((e) => e.kind === "cash").reduce((n, e) => n + e.amount, 0),
        );
        for (const e of fx) {
          if (e.kind === "stock")
            expect(target!.stock).toBe(
              Math.max(
                0,
                before.works.find((w) => w.id === target!.id)!.stock + e.amount,
              ),
            );
          for (const stat of [
            "health",
            "fatigue",
            "stress",
            "drive",
          ] as const) {
            const delta = fx
              .filter((e) => e.kind === "condition" && e.stat === stat)
              .reduce((n, e) => n + (e.kind === "condition" ? e.amount : 0), 0);
            if (stat === "stress" && delta !== 0) {
              expect(
                Math.sign(
                  state.author.condition[stat] - before.author.condition[stat],
                ),
              ).toBe(Math.sign(delta));
              expect(state.author.condition[stat]).toBeGreaterThanOrEqual(0);
              expect(state.author.condition[stat]).toBeLessThanOrEqual(100);
            } else
              expect(state.author.condition[stat]).toBeCloseTo(
                Math.max(
                  0,
                  Math.min(100, before.author.condition[stat] + delta),
                ),
                10,
              );
          }
          if (
            e.kind === "quality" ||
            e.kind === "consistency" ||
            e.kind === "attachment"
          )
            expect(target![e.kind]).toBe(
              Math.max(
                0,
                Math.min(
                  100,
                  before.works.find((w) => w.id === target!.id)![e.kind] +
                    e.amount,
                ),
              ),
            );
          if (e.kind === "promotion")
            expect(target!.stats.promotionUntil).toBe(101 + e.days);
          if (e.kind === "flag")
            expect(target?.flags ?? state.flags).toContain(e.key);
          if (e.kind === "schedule")
            expect(
              state.followUps.some(
                (f) =>
                  f.defId === e.id &&
                  f.dueDay === 101 + e.delay &&
                  f.target.id === one.target.id,
              ),
            ).toBe(true);
          if (e.kind === "job") expect(state.author.jobId).toBe(e.id);
          if (e.kind === "createWork") {
            expect(state.pendingNewWork).not.toBeNull();
            expect(state.works.length).toBe(before.works.length);
          }
          if (e.kind === "ability")
            expect(state.author.abilities[e.stat]).toBe(
              Math.min(100, before.author.abilities[e.stat] + e.amount),
            );
        }
        for (const other of before.works.filter((w) => w.id !== target?.id))
          expect(state.works.find((w) => w.id === other.id)).toEqual(other);
        expect(selection(state, def).defId).not.toBe(def.id);
      }
    });
  }
  it.each([
    "save-v0.3.0.json",
    "save-v0.3.2-analytics.json",
    "save-v0.3.2-partial.json",
    "pending-forced-multi.json",
    "pending-new-title-illness.json",
    "save-v0.3.5.json",
  ])("migrates %s, advances 60 days and round-trips", (name) => {
    const loaded = product.deserialize(
      readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8"),
    );
    if (!loaded.ok) throw new Error(loaded.error);
    let state = settleWork(product, loaded.state);
    const target = state.day + 60;
    while (state.day < target) {
      state = settleWork(product, state);
      state = state.pending
        ? product.choose(state, state.pending.id, state.pending.choiceIds[0])
            .state
        : product.advance(state, target - state.day).state;
    }
    state = settleWork(product, state);
    expect(product.deserialize(product.serialize(state))).toMatchObject({
      ok: true,
      state,
    });
  });
});
