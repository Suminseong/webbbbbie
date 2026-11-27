import { settleWork } from "./auto-new-work";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  defaultContent,
  eventCategories,
  parseContent,
  text,
} from "@webbbbbie/content";
import { createEngine } from "@webbbbbie/engine";
import type { LifeState } from "@webbbbbie/engine";
import { withEvents } from "../packages/content/test-fixtures/content";

type Engine = ReturnType<typeof createEngine>;
const product = createEngine();
const quiet = createEngine(withEvents());

function select(engine: Engine, state: LifeState, choice?: string) {
  const pending = engine.getPending(state);
  if (!pending) throw new Error("Expected a pending choice");
  const result = engine.choose(
    state,
    pending.id,
    choice ?? pending.choices[0].id,
  );
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
function ready(engine = product, seed = 42) {
  return select(engine, engine.createLife(seed));
}
function play(engine: Engine, initial: LifeState, day: number) {
  let state = initial;
  while (state.day < day) {
    state = settleWork(engine, state);
    state = state.pending
      ? select(engine, state)
      : engine.advance(state, day - state.day).state;
  }
  return state;
}
function published(fixture = quiet, seed = 42) {
  const state = ready(fixture, seed);
  const work = state.works[0];
  work.status = "SERIAL_FREE";
  work.platformId = "series";
  work.published = 12;
  work.stock = 8;
  work.mask = 127;
  return state;
}

describe("deterministic life and daily commits", () => {
  it("[FR-PLAY-001][FR-PLAY-003][FR-EVENT-001] separates origin from the daily slot", () => {
    const start = product.createLife(42);
    expect(product.getAuthorView(start).day).toBe(0);
    expect(product.advance(start, 50).state).toBe(start);
    expect(start.works).toHaveLength(0);
    const first = select(product, start);
    expect(first.day).toBe(0);
    expect(first.works).toHaveLength(1);
    expect(first.archive[0][0]).toBe("origin");
    const played = play(product, first, 100);
    expect(played.archive).toHaveLength(101);
    expect(
      Object.values(played.eventCount).reduce((total, n) => total + n, 0),
    ).toBe(101);
  });

  it("[NFR-002][TC-NFR-002] reproduces events, works, ledger and save state", () => {
    const start = product.createLife(712);
    const first = play(product, start, 180);
    const second = play(product, product.createLife(712), 180);
    expect(product.serialize(first)).toBe(product.serialize(second));
    expect(product.serialize(first)).not.toBe(
      product.serialize(play(product, product.createLife(713), 180)),
    );
    const midpoint = play(product, start, 70);
    const loaded = product.deserialize(product.serialize(midpoint));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(product.serialize(play(product, loaded.state, 180))).toBe(
      product.serialize(first),
    );
    expect(start.day).toBe(0);
  });

  it("[FR-SAVE-002][FR-TIME-002][IT-07] resumes a fixed work choice and commits it once", () => {
    const engine = createEngine(withEvents("critique"));
    const initial = published(engine);
    const waiting = engine.advance(initial, 10).state;
    const event = engine.getPending(waiting)!;
    expect(waiting.day).toBe(0);
    expect(event.day).toBe(1);
    expect(event.target).toBe(initial.works[0].title);
    expect(engine.advance(waiting, 5).state).toBe(waiting);
    expect(engine.choose(waiting, event.id, "missing").ok).toBe(false);
    expect(waiting.archive).toHaveLength(1);
    const load = engine.deserialize(engine.serialize(waiting));
    if (!load.ok) throw new Error(load.error);
    expect(engine.getPending(load.state)).toEqual(event);
    const result = select(engine, waiting, "take");
    expect(engine.serialize(select(engine, load.state, "take"))).toBe(
      engine.serialize(result),
    );
    expect(result.day).toBe(1);
    expect(result.archive).toHaveLength(2);
    expect(engine.choose(result, event.id, "take")).toMatchObject({
      ok: false,
      state: result,
      error: "E_NO_PENDING",
    });
    expect(result.works[0].quality).toBeGreaterThan(initial.works[0].quality);
  });

  it("[FR-SAVE-003] rejects corrupt and stale snapshots", () => {
    const state = ready();
    const saved = product.serialize(state);
    expect(product.deserialize("{")).toEqual({
      ok: false,
      error: "E_SAVE_CORRUPT",
    });
    const current = '"schemaVersion":' + state.schemaVersion;
    expect(
      product.deserialize(
        saved.replace(current, '"schemaVersion":' + (state.schemaVersion + 1)),
      ),
    ).toEqual({ ok: false, error: "E_SAVE_VERSION" });
    // A prototype (schema 1, rules 0.1.0) save is refused, not misread.
    const prototype = JSON.parse(saved);
    prototype.schemaVersion = 1;
    prototype.rulesVersion = "0.1.0";
    delete prototype.state.ledgerCarry;
    delete prototype.state.ledgerSeq;
    expect(product.deserialize(JSON.stringify(prototype))).toEqual({
      ok: false,
      error: "E_SAVE_VERSION",
    });
    const broken = JSON.parse(saved);
    broken.state.works[0].platformId = "missing";
    expect(product.deserialize(JSON.stringify(broken))).toEqual({
      ok: false,
      error: "E_SAVE_CORRUPT",
    });
    expect(product.serialize(state)).toBe(saved);
  });

  it("[FR-EVENT-001][FR-STATE-001] applies due and forced priorities in one slot with a regular reprieve", () => {
    const engine = createEngine(
      withEvents("copy-discussion", "takedown", "critique", "forced-hiatus"),
    );
    const start = published(engine);
    start.author.condition.health = 40;
    start.followUps.push({
      id: "reserved",
      defId: "copy-discussion",
      from: "EV-0",
      dueDay: 1,
      expiresDay: 3,
      target: { scope: "WORK", id: start.works[0].id },
    });
    const due = engine.advance(start).state;
    expect(due.pending?.tier).toBe("FOLLOW_UP");
    expect(due.pending?.target.id).toBe(start.works[0].id);
    expect(due.pending?.defId).toBe("copy-discussion");
    const picked = select(engine, due, "ignore");
    expect(picked.archive[1][0]).toBe("copy-discussion");
    expect(
      picked.followUps.find((entry) => entry.id === "reserved"),
    ).toBeUndefined();
    const respite = structuredClone(start);
    respite.priorityStreak = defaultContent.balance.events.maxPriorityStreak;
    const regular = engine.advance(respite).state;
    expect(regular.pending?.tier).toBe("REGULAR");
  });

  it("[FR-EVENT-005] preserves the reserved plagiarism chain over save and work takedown", () => {
    const engine = createEngine(
      withEvents("copy-comment", "copy-discussion", "takedown"),
    );
    const state = published(engine);
    state.works[0].startPath = "PLAGIARISM";
    const first = engine.advance(state).state;
    expect(first.archive[1][0]).toBe("copy-comment");
    const loaded = engine.deserialize(engine.serialize(first));
    if (!loaded.ok) throw new Error(loaded.error);
    const pending = engine.advance(loaded.state, 4).state;
    expect(engine.getPending(pending)?.title).toBe(
      text("event.copy-discussion.title"),
    );
    const last = play(engine, select(engine, pending, "ignore"), 8);
    expect(last.works[0].status).toBe("TAKEN_DOWN");
    expect(last.works[0].stats.newReaders).toBe(0);
    expect(last.works[0].stats.views).toBe(0);
  });
});

describe("production systems", () => {
  it("[IT-05][FR-WORK-003][FR-LIFE-002] preserves work isolation and shares bounded time", () => {
    const single = published();
    const double = structuredClone(single);
    double.works.push({
      ...structuredClone(double.works[0]),
      id: "W-2",
      title: "두 번째 작품",
      stock: 2,
    });
    const one = quiet.advance(single).state;
    const two = quiet.advance(double).state;
    const firstRoutine = quiet.getDailySummary(one)!.time;
    const secondRoutine = quiet.getDailySummary(two)!.time;
    expect(secondRoutine.writing["W-1"]).toBeLessThan(
      firstRoutine.writing["W-1"],
    );
    expect(secondRoutine.writing["W-2"]).toBeGreaterThan(0);
    const allocated = [
      secondRoutine.work,
      secondRoutine.living,
      secondRoutine.sleep,
      secondRoutine.community,
      secondRoutine.ego,
      secondRoutine.rest,
      secondRoutine.unused,
      ...Object.values(secondRoutine.plot),
      ...Object.values(secondRoutine.writing),
    ];
    expect(allocated.reduce((a, b) => a + b, 0)).toBe(48);
    const eventEngine = createEngine(withEvents("forced-hiatus"));
    const pressure = published(eventEngine);
    pressure.works.push({
      ...structuredClone(pressure.works[0]),
      id: "W-2",
      title: "두 번째 작품",
      status: "PLANNING",
    });
    pressure.author.condition.health = 31;
    const result = eventEngine.advance(pressure).state;
    expect(result.works[0].status).toBe("HIATUS");
    expect(result.works[1].status).toBe("SERIAL_FREE");
    expect(result.archive[1]).toEqual(["forced-hiatus", "W-1", null]);
  });

  it("[IT-01][FR-PLATFORM-003] loses update exposure and new readers on hiatus", () => {
    const engine = createEngine(withEvents("forced-hiatus"));
    const healthy = published(engine);
    const exhausted = structuredClone(healthy);
    exhausted.author.condition.health = 34;
    const baseline = engine.advance(healthy).state;
    const resting = engine.advance(exhausted).state;
    expect(resting.works[0].status).toBe("HIATUS");
    expect(resting.works[0].stats.newBySource.UPDATE).toBe(0);
    expect(resting.works[0].stats.newReaders).toBeLessThan(
      baseline.works[0].stats.newReaders,
    );
    expect(resting.works[0].stats.latestViews).toBe(0);
  });

  it("[FR-AUTHOR-003] sustains a sleep, health and stress penalty from deadline pressure", () => {
    const relaxed = published();
    relaxed.author.condition.drive = 100;
    relaxed.author.traits.deadlineTolerance = 100;
    const rushed = structuredClone(relaxed);
    rushed.works[0].stock = 0;
    const baseline = quiet.advance(relaxed).state;
    const overtime = quiet.advance(rushed).state;
    expect(overtime.author.lastRoutine!.sleep).toBeLessThan(
      baseline.author.lastRoutine!.sleep,
    );
    expect(overtime.author.condition.health).toBeLessThan(
      baseline.author.condition.health,
    );
    expect(overtime.author.condition.stress).toBeGreaterThan(
      baseline.author.condition.stress,
    );
  });

  it("[FR-READER-001][FR-READER-002] preserves reader cohort totals and separates latest from earlier views", () => {
    const before = quiet.advance(published(), 2).state;
    const after = quiet.advance(before).state;
    const work = after.works[0];
    const previous = before.works[0];
    const audience = (entry: typeof work) =>
      [...entry.readers.flat(), ...entry.caughtUp].reduce(
        (total, value) => total + value,
        0,
      );
    expect(audience(work)).toBeCloseTo(
      audience(previous) + work.stats.newReaders - work.stats.lost,
      8,
    );
    expect(work.stats.latestViews).toBeLessThanOrEqual(
      work.stats.views + 0.000001,
    );
    expect(
      Object.values(work.stats.newBySource).reduce((a, b) => a + b, 0),
    ).toBeCloseTo(work.stats.newReaders, 8);
    const uiWork = quiet.getWorkViews(after)[0];
    expect(uiWork.newByAge.reduce((a, b) => a + b.count, 0)).toBe(
      uiWork.newReaders,
    );
  });

  it("[FR-WORK-002][FR-ECONOMY-002/004] charges eligible chapters and pays outstanding earnings once", () => {
    const state = published();
    state.works[0].published = 24;
    state.works[0].stats.favorites = 1300;
    state.works[0].targetChapters = 95;
    const first = quiet.advance(state).state;
    expect(first.works[0].status).toBe("SERIAL_FREE");
    const second = quiet.advance(first).state;
    expect(second.works[0].status).toBe("SERIAL_PAID");
    expect(second.works[0].paidFrom).toBe(27);
    const before = play(quiet, second, 29);
    expect(before.works[0].revenue.accrued).toBeGreaterThan(0);
    expect(before.works[0].revenue.paid).toBe(0);
    const paid = quiet.advance(before).state;
    expect(paid.ledger.filter((entry) => entry.kind === "PAYOUT")).toHaveLength(
      1,
    );
    expect(paid.works[0].revenue.paid).toBe(paid.works[0].revenue.accrued);
    const loaded = quiet.deserialize(quiet.serialize(paid));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(
      quiet
        .advance(loaded.state)
        .state.ledger.filter((entry) => entry.kind === "PAYOUT"),
    ).toHaveLength(1);
  });

  it("[FR-GROWTH-001][IT-04] pays the growth effect once and keeps a backlist", () => {
    const start = published();
    start.works[0].published = 0;
    start.works[0].targetChapters = 1;
    const done = quiet.advance(start).state;
    expect(done.works[0].end).toMatchObject({
      rewarded: true,
      reason: "COMPLETED",
      day: 1,
      chapters: 1,
    });
    expect(done.author.abilities.style).toBeGreaterThan(
      start.author.abilities.style,
    );
    const loaded = quiet.deserialize(quiet.serialize(done));
    if (!loaded.ok) throw new Error(loaded.error);
    const later = quiet.advance(loaded.state, 2).state;
    expect(later.works[0].end).toEqual(done.works[0].end);
    expect(later.works[0].stats.newReaders).toBeGreaterThan(0);
    expect(later.author.abilities.style).toBe(done.author.abilities.style);
  });

  it("[FR-CONTRACT-001/002/003][IT-03] gates an offer on demand and publishes terms without hidden traits", () => {
    const data = withEvents("contract-offer");
    data.world.companies = [data.world.companies[0]];
    const engine = createEngine(parseContent(data));
    const before = published(engine);
    before.author.social.demand = 5;
    expect(engine.advance(before).state.pending).toBeNull();
    before.author.social.demand = 66;
    const offered = engine.advance(before).state;
    expect(engine.getPending(offered)?.offer).toMatchObject({
      name: text("entity.company.neulpom.name"),
      share: 0.71,
    });
    const decline = select(engine, offered, "decline");
    const accept = select(engine, offered, "accept");
    expect(decline.contracts).toHaveLength(0);
    expect(accept.contracts).toHaveLength(1);
    expect(
      accept.ledger.filter((entry) => entry.kind === "ADVANCE"),
    ).toHaveLength(1);
    const shown = JSON.stringify(engine.getContractViews(accept));
    expect(shown).not.toMatch(/companyId|honesty|interference|skill/);
    const promoted = play(engine, accept, 5);
    expect(promoted.works[0].stats.newBySource.PROMOTION).toBeGreaterThan(0);
  });

  it("[FR-APTITUDE-001/002][NFR-006] discovers public aptitude without revealing raw values", () => {
    const initial = published();
    expect(
      quiet
        .getAptitudeView(initial)
        .every((item) => item.stage === "UNKNOWN" && item.estimate === null),
    ).toBe(true);
    const later = play(quiet, initial, 42);
    const result = quiet.getAptitudeView(later);
    expect(
      result.some((item) => item.stage === "GUESS" || item.stage === "CERTAIN"),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/trueValue|lastEvidence/);
  });
});

describe("content and long-run stability", () => {
  it("[NFR-004][NFR-009] rejects invalid references and keeps valid authored data", () => {
    const daily = defaultContent.events.filter(
      (entry) => entry.tier !== "ORIGIN",
    );
    expect(daily.length).toBeGreaterThanOrEqual(144);
    for (const category of eventCategories)
      expect(
        defaultContent.events.some((entry) => entry.category === category),
      ).toBe(true);
    expect(defaultContent.platforms).toHaveLength(6);
    const unknownSpecial = structuredClone(defaultContent);
    unknownSpecial.events
      .find((event) => event.id === "quiet-desk")!
      .effects!.push({ kind: "special", key: "없는병", days: 3 });
    expect(() => parseContent(unknownSpecial)).toThrow(/Unknown special/);
    const broken = structuredClone(defaultContent);
    broken.events
      .find((event) => event.id === "copy-comment")!
      .effects!.push({ kind: "schedule", id: "missing", delay: 1, window: 1 });
    expect(() => parseContent(broken)).toThrow(/Invalid follow-up/);
  });

  it("[NFR-003] keeps time, audience bounds, event counts and ledger consistent across seeds", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4294967295 }), (seed) => {
        const initial = product.createLife(seed);
        const result = play(product, initial, 110);
        expect(result.archive).toHaveLength(111);
        for (const summary of result.summaries) {
          const { time } = summary;
          expect(
            time.work +
              time.living +
              time.sleep +
              time.community +
              time.ego +
              time.rest +
              time.unused +
              Object.values(time.plot).reduce((a, b) => a + b, 0) +
              Object.values(time.writing).reduce((a, b) => a + b, 0),
          ).toBe(48);
        }
        for (const platform of defaultContent.platforms) {
          const works = result.works.filter(
            (work) => work.platformId === platform.id,
          );
          expect(
            works
              .flatMap((work) => [
                work.stats.views,
                ...work.readers.flat(),
                ...work.caughtUp,
              ])
              .every((n) => n >= 0 && Number.isFinite(n)),
          ).toBe(true);
          expect(
            works.reduce((total, work) => total + work.stats.newReaders, 0),
          ).toBeLessThanOrEqual(
            platform.visitors * defaultContent.balance.market.reach + 0.000001,
          );
        }
        expect(
          initial.author.cash +
            result.ledger.reduce((total, entry) => total + entry.amount, 0),
        ).toBe(result.author.cash);
        expect(new Set(result.ledger.map((entry) => entry.id)).size).toBe(
          result.ledger.length,
        );
      }),
      { numRuns: 24, seed: 20261125 },
    );
  });

  it("[NFR-005][TC-NFR-005] plays 7,300 product days with bounded recent view history", () => {
    const start = performance.now();
    const state = play(product, product.createLife(42), 7300);
    const elapsed = performance.now() - start;
    const stored = product.serialize(state);
    expect(state.day).toBe(7300);
    expect(state.archive).toHaveLength(7301);
    expect(state.summaries.length).toBe(
      defaultContent.balance.events.summaryKeep,
    );
    expect(product.deserialize(stored).ok).toBe(true);
    console.log(
      "Long run: " +
        state.works.length +
        " works, " +
        Buffer.byteLength(stored) +
        " bytes, " +
        (elapsed / 7300).toFixed(3) +
        " ms/day",
    );
  }, 60_000);

  it("[NFR-005][C-13] measures a 10-work, 20-year product load", () => {
    const initial = published();
    const open = initial.works[0];
    open.status = "HIATUS";
    open.hiatusUntil = 7301;
    open.resumeTo = "SERIAL_FREE";
    for (let index = 2; index <= 10; index += 1) {
      const work = structuredClone(open);
      work.id = "W-" + index;
      work.status = "COMPLETED";
      work.published = 60;
      work.hiatusUntil = null;
      work.resumeTo = null;
      work.end = {
        day: 0,
        reason: "COMPLETED",
        favorites: 53,
        views: 219,
        chapters: 60,
        rewarded: true,
      };
      initial.works.push(work);
    }
    const start = performance.now();
    const state = quiet.advance(initial, 7300).state;
    const average = (performance.now() - start) / 7300;
    const bytes = Buffer.byteLength(quiet.serialize(state));
    expect(state.works).toHaveLength(10);
    expect(state.day).toBe(7300);
    expect(bytes).toBeLessThanOrEqual(
      defaultContent.balance.limits.saveMaxBytes,
    );
    console.log(
      "C-13 load: " + bytes + " bytes, " + average.toFixed(3) + " ms/day",
    );
  });
});

describe("content expansion and balance safeguards", () => {
  it("[FR-STATE-002] applies special-state modifiers to writing and stress until expiry", () => {
    const base = published();
    base.works[0].stock = 0;
    const ill = structuredClone(base);
    ill.author.specialStates.push({
      key: "내글구려병",
      until: 3,
      since: 0,
      cause: null,
    });
    const plain = quiet.advance(base, 1).state;
    const sick = quiet.advance(ill, 1).state;
    expect(sick.works[0].stock).toBeLessThan(plain.works[0].stock);
    expect(sick.author.condition.stress).toBeGreaterThan(
      plain.author.condition.stress,
    );
    expect(sick.author.lastRoutine!.ego).toBeGreaterThanOrEqual(
      plain.author.lastRoutine!.ego,
    );
    const later = quiet.advance(sick, 3).state;
    expect(later.author.specialStates).toHaveLength(0);
    expect(quiet.getAuthorView(sick).states[0].name).toBe("내글구려병");
  });

  it("[FR-READER-003][NFR-003] fades backlist discovery after an ending", () => {
    const state = published();
    const work = state.works[0];
    work.status = "COMPLETED";
    work.stats.favorites = 2000;
    work.end = {
      day: 0,
      reason: "COMPLETED",
      favorites: 2000,
      views: 0,
      chapters: 12,
      rewarded: true,
    };
    const fresh = quiet.advance(state, 1).state.works[0].stats.newReaders;
    const old = play(quiet, state, 400).works[0].stats.newReaders;
    expect(fresh).toBeGreaterThan(0);
    expect(old).toBeLessThan(fresh * 0.3);
    const obscure = structuredClone(state);
    obscure.works[0].stats.favorites = 20;
    expect(
      quiet.advance(obscure, 1).state.works[0].stats.newReaders,
    ).toBeLessThan(fresh);
  });

  it("[FR-ECONOMY-001][FR-ECONOMY-004] compacts old ledger entries without losing cash or IDs", () => {
    const initial = product.createLife(42);
    const start = initial.author.cash;
    const state = play(product, initial, 900);
    const keep = defaultContent.balance.economy.ledgerKeepDays;
    expect(
      state.ledger.every((entry) => entry.day >= state.day - keep - 30),
    ).toBe(true);
    const carried = Object.values(state.ledgerCarry).reduce((a, b) => a + b, 0);
    const retained = state.ledger.reduce((a, entry) => a + entry.amount, 0);
    expect(start + carried + retained).toBe(state.author.cash);
    expect(new Set(state.ledger.map((entry) => entry.id)).size).toBe(
      state.ledger.length,
    );
    expect(state.ledgerSeq).toBeGreaterThan(state.ledger.length);
    const view = product.getLedgerView(state);
    expect(view.carried).toEqual(state.ledgerCarry);
    const load = product.deserialize(product.serialize(state));
    expect(load.ok).toBe(true);
  });

  it("[FR-WORK-001][C-15] rests between works before planning the next one", () => {
    const state = published();
    const work = state.works[0];
    work.status = "COMPLETED";
    work.end = {
      day: 0,
      reason: "COMPLETED",
      favorites: 0,
      views: 0,
      chapters: 12,
      rewarded: true,
    };
    const { restMin, restMax } = defaultContent.balance.life;
    expect(quiet.advance(state, restMin - 1).state.works).toHaveLength(1);
    expect(settleWork(quiet, quiet.advance(state, restMax + 1).state).works).toHaveLength(2);
  });

  it("[FR-EVENT-004][T-08] never targets backlist works with serial-only events", () => {
    const engine = createEngine(withEvents("writers-block"));
    const state = published(engine);
    const ended = structuredClone(state.works[0]);
    ended.id = "W-9";
    ended.status = "COMPLETED";
    state.works.push(ended);
    let life = state;
    for (let day = 0; day < 20; day += 1) {
      life = engine.advance(life, 1).state;
      const last = life.archive[life.archive.length - 1];
      if (last[0] === "writers-block") expect(last[1]).toBe(state.works[0].id);
    }
    expect(life.archive.some((entry) => entry[0] === "writers-block")).toBe(
      true,
    );
  });

  it("[FR-CONTRACT-003] applies contract events and promotions only to the contracted work", () => {
    const engine = createEngine(withEvents("promotion-confirmed"));
    const state = published(engine);
    const other = structuredClone(state.works[0]);
    other.id = "W-2";
    other.contractId = null;
    state.works.push(other);
    state.contracts.push({
      id: "C-1",
      workId: "W-1",
      companyId: defaultContent.world.companies[0].id,
      signedDay: 0,
      expiresDay: 200,
      share: 0.6,
      advance: 0,
      promise: "test",
      promotionStart: 500,
      promotionEnd: 501,
      status: "ACTIVE",
      editorId: null,
      settlementCycle: 30,
      record: {
        contracts: 0,
        settlements: 0,
        delays: 0,
        lastDelayDay: null,
        promo: "PENDING",
        feedback: 0,
        pressure: 0,
        editorChanges: 0,
      },
    });
    state.works[0].contractId = "C-1";
    const next = engine.advance(state, 1).state;
    expect(next.archive[1][0]).toBe("promotion-confirmed");
    expect(next.works[0].stats.promotionUntil).toBeGreaterThan(1);
    expect(next.works[1].stats.promotionUntil).toBe(-1);
    expect(next.works[0].stats.newBySource.PROMOTION).toBeGreaterThan(0);
    expect(next.works[1].stats.newBySource.PROMOTION).toBe(0);
  });

  it("[FR-EVENT-002][C-08] paces regular choices without blocking the daily slot", () => {
    const engine = createEngine(withEvents("critique"));
    const state = published(engine);
    state.eventLast["choice:global"] = 0;
    const result = engine.advance(state, 1).state;
    expect(result.pending).toBeNull();
    expect(result.archive[1][0]).toBe("fallback");
    const gaps: number[] = [];
    for (let seed = 0; seed < 12; seed += 1) {
      const life = play(product, product.createLife(seed), 240);
      let last = 0;
      for (const [day, entry] of life.archive.entries()) {
        if (day === 0 || entry[2] === null) continue;
        if (last) gaps.push(day - last);
        last = day;
      }
    }
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    expect(median).toBeGreaterThanOrEqual(5);
    expect(median).toBeLessThanOrEqual(14);
  });

  it("[NFR-005][C-13] keeps the real 20-year product life within the save budget", () => {
    const state = play(product, product.createLife(42), 7300);
    const bytes = Buffer.byteLength(product.serialize(state));
    expect(bytes).toBeLessThanOrEqual(
      defaultContent.balance.limits.saveMaxBytes,
    );
    expect(state.works.length).toBeLessThan(150);
    const cash = state.author.cash;
    expect(Number.isSafeInteger(cash)).toBe(true);
  }, 60_000);
});
