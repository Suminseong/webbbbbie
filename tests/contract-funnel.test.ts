import { settleWork } from "./auto-new-work";
import { describe, expect, it } from "vitest";
import { createEngine } from "@webbbbbie/engine";
import type { LifeState } from "@webbbbbie/engine";
import { withEvents } from "../packages/content/test-fixtures/content";

const product = createEngine();
const quiet = createEngine(withEvents());

function pick(engine: ReturnType<typeof createEngine>, state: LifeState) {
  const pending = engine.getPending(state)!;
  const result = engine.choose(state, pending.id, pending.choices[0].id);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
function play(
  engine: ReturnType<typeof createEngine>,
  state: LifeState,
  day: number,
) {
  let next = state;
  while (next.day < day)
    next = next.pendingNewWork ? settleWork(engine, next) : next.pending
      ? pick(engine, next)
      : engine.advance(next, day - next.day).state;
  return next;
}
/** A published work with an active contract of the given company. */
function contracted(companyId: string, editorId: string | null, seed = 42) {
  const state = pick(quiet, quiet.createLife(seed));
  const work = state.works[0];
  work.status = "SERIAL_PAID";
  work.paidFrom = 1;
  work.platformId = "series";
  work.published = 12;
  work.stock = 60;
  work.mask = 127;
  state.contracts.push({
    id: "C-1",
    workId: work.id,
    companyId,
    signedDay: 0,
    expiresDay: 900,
    share: 0.6,
    advance: 0,
    promise: "test",
    promotionStart: 4,
    promotionEnd: 14,
    status: "ACTIVE",
    editorId,
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
  work.contractId = "C-1";
  return state;
}

describe("[17번 §2] chapter funnel", () => {
  it("records actual per-chapter reads with a clear numerator and denominator", () => {
    // A known incoming aggregate cohort exercises nonzero chapter reads;
    // the low-volume market can legitimately round tiny observations to zero.
    const begin = () => {
      const state = pick(quiet, quiet.createLife(42));
      state.works[0].readers[0] = [10];
      return state;
    };
    const state = play(quiet, begin(), 90);
    const work = state.works.find((item) => item.published >= 5)!;
    const view = quiet
      .getWorkViews(state)
      .find((item) => item.id === work.id)!;
    expect(view.funnel.known).toBe(true);
    expect(view.funnel.partial).toBe(false);
    expect(view.funnel.firstReads).toBeGreaterThan(0);
    // A first-chapter read count is not the cumulative inflow label.
    expect(view.funnel.firstReads).not.toBeNull();
    for (const row of view.funnel.rows.slice(1)) {
      if (row.rate === null) continue;
      expect(row.rate).toBeGreaterThanOrEqual(0);
      expect(row.rate).toBeCloseTo(row.reads / row.previous!, 10);
    }
    const again = play(quiet, begin(), 90);
    expect(quiet.serialize(again)).toBe(quiet.serialize(state));
  });

  it("reports unknown, not zero, for a work whose log predates the feature", () => {
    const state = play(product, pick(product, product.createLife(42)), 30);
    const work = state.works[0];
    work.chapters = null;
    const before = product.getWorkViews(state)[0].funnel;
    expect(before.known).toBe(false);
    expect(before.firstReads).toBeNull();
    // Settle any waiting choice while advancing, so the test does not depend on
    // which event the seed happens to select.
    let next = state;
    while (next.day < state.day + 5)
      next = next.pendingNewWork ? settleWork(product, next) : next.pending
        ? pick(product, next)
        : product.advance(next, state.day + 5 - next.day).state;
    const view = product.getWorkViews(next)[0].funnel;
    expect(view.partial).toBe(true);
    expect(view.since).toBe(state.day + 1);
  });
});

describe("[17번 §1] company and editor traits", () => {
  it("keeps hidden traits out of every view", () => {
    const state = contracted("rush", "rush-gang");
    const json = JSON.stringify(quiet.getContractViews(state));
    for (const key of [
      "payPunctuality",
      "promoPower",
      "skill",
      "interference",
      "warmth",
    ])
      expect(json).not.toContain(key);
    const view = quiet.getContractViews(state)[0];
    expect(view.settlementCycle).toBe(30);
    expect(view.editor?.name).toBeTruthy();
  });

  it("delays payouts by hidden punctuality, shows only observed counts, and pays later", () => {
    const rush = play(quiet, contracted("rush", "rush-gang", 7), 360);
    const record = rush.contracts[0].record;
    expect(record.delays).toBeGreaterThan(0);
    expect(record.settlements).toBeGreaterThan(0);
    expect(rush.companyRecords.rush.delays).toBe(record.delays);
    expect(rush.works[0].revenue.paid).toBeLessThanOrEqual(
      rush.works[0].revenue.accrued,
    );
    const view = quiet.getContractViews(rush)[0];
    expect(view.observed.delays).toBe(record.delays);
    // 60-day cycle companies pay on their own cycle: fewer payouts than months.
    expect(record.settlements + record.delays).toBeLessThanOrEqual(12);
  });

  it("applies the editor change effect and counts it", () => {
    const engine = createEngine(withEvents("pd-change"));
    const state = engine.advance(contracted("letter", "letter-seo"), 1).state;
    const contract = state.contracts[0];
    expect(contract.editorId).toBe("letter-baek");
    expect(contract.record.editorChanges).toBe(1);
    expect(state.companyRecords.letter.editorChanges).toBe(1);
  });
});

describe("[17번 §3] saves", () => {
  it("round-trips chapter logs and contract records", () => {
    const state = play(quiet, contracted("letter", "letter-baek"), 70);
    const loaded = quiet.deserialize(quiet.serialize(state));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.state).toEqual(state);
    expect(loaded.state.works[0].chapters?.reads.length).toBeGreaterThan(0);
  });

  it("loads a 0.3.1 save, filling unknown history instead of inventing it", () => {
    const state = contracted("letter", "letter-baek");
    const envelope = JSON.parse(quiet.serialize(state));
    envelope.rulesVersion = "0.3.1";
    envelope.contentHash = "3916f2ee";
    envelope.state.rulesVersion = "0.3.1";
    envelope.state.contentHash = "3916f2ee";
    delete envelope.state.companyRecords;
    for (const work of envelope.state.works) delete work.chapters;
    for (const contract of envelope.state.contracts) {
      delete contract.editorId;
      delete contract.settlementCycle;
      delete contract.record;
    }
    const loaded = quiet.deserialize(JSON.stringify(envelope));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.state.works[0].chapters).toBeNull();
    expect(loaded.state.contracts[0].editorId).toBeNull();
    expect(quiet.getContractViews(loaded.state)[0].editor).toBeNull();
    expect(quiet.getWorkViews(loaded.state)[0].funnel.firstReads).toBeNull();
  });
});

describe("[17번 §1] offer screen", () => {
  it("shows public terms and a named editor, and signing stores them", () => {
    const engine = createEngine(withEvents("contract-offer"));
    const start = pick(engine, engine.createLife(42));
    const work = start.works[0];
    work.status = "SERIAL_FREE";
    work.platformId = "series";
    work.published = 12;
    start.author.social.demand = 60;
    const waiting = engine.advance(start, 1).state;
    const offer = engine.getPending(waiting)!.offer!;
    expect(offer.settlementCycle).toBeGreaterThanOrEqual(30);
    expect(offer.editor?.name).toBeTruthy();
    expect(offer.history).toBeNull();
    expect(JSON.stringify(offer)).not.toMatch(/skill|warmth|interference/);
    const signed = pick(engine, waiting);
    const contract = signed.contracts[0];
    expect(contract.editorId).not.toBeNull();
    expect(contract.settlementCycle).toBe(offer.settlementCycle);
    expect(signed.companyRecords[contract.companyId].contracts).toBe(1);
  });
});
