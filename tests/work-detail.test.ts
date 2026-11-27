import { expect, it } from "vitest";
import { createEngine } from "@webbbbbie/engine";
import { defaultContent } from "@webbbbbie/content";
import { settleWork } from "./auto-new-work";

const engine = createEngine();
function play(days: number) {
  let state = engine.createLife(42);
  state = engine.choose(state, state.pending!.id, "original").state;
  while (state.day < days) {
    state = settleWork(engine, state);
    if (state.pending)
      state = engine.choose(
        state,
        state.pending.id,
        state.pending.choiceIds[0],
      ).state;
    else state = engine.advance(state, 1).state;
  }
  return settleWork(engine, state);
}
it("exposes actual paid reads, source shares, quality, stability and settlement without hidden traits", () => {
  const state = play(60);
  for (const work of state.works) {
    const view = engine.getWorkView(state, work.id)!;
    expect(view.duration).toBe((work.end?.day ?? state.day) - work.startDay);
    expect(view.detail.paidReads).toBe(work.detail!.paidReads);
    expect(view.detail.history.at(-1)?.quality).toBe(
      work.detail!.history.at(-1)?.[1],
    );
    expect(view.detail.stability).toBe(
      view.detail.expected
        ? view.detail.fulfilled / view.detail.expected
        : null,
    );
    expect(view.sources.reduce((n, s) => n + s.share, 0)).toBeCloseTo(
      work.stats.newReaders > 0 ? 1 : 0,
      10,
    );
    for (const span of [7, 14, 30] as const)
      expect(view.trend[`d${span}`].views).toBe(
        Math.floor(work.history.slice(-span).reduce((n, row) => n + row[1], 0)),
      );
    const tx = state.ledger
      .filter((row) => row.kind === "PAYOUT" && row.workId === work.id)
      .at(-1);
    expect(view.latestSettlement).toEqual(
      tx ? { day: tx.day, amount: tx.amount } : null,
    );
    expect(JSON.stringify(view)).not.toMatch(/trueValue|interference|warmth/);
  }
  expect(engine.deserialize(engine.serialize(state))).toMatchObject({
    ok: true,
    state,
  });
});
it("prepares a real ending without creating chapters or granting rewards; preserves common plot budget", () => {
  let state = play(5);
  const work = state.works[0];
  work.stock = 2;
  work.status = "SERIAL_FREE";
  const bad = engine.prepareEnding(state, work.id, 1);
  expect(bad.ok).toBe(false);
  expect(bad.state).toEqual(state);
  const result = engine.prepareEnding(state, work.id, 10);
  expect(result.ok).toBe(true);
  const after = result.state.works[0];
  expect(after.targetChapters).toBe(work.published + 10);
  expect(after.published).toBe(work.published);
  expect(after.stock).toBe(work.stock);
  expect(after.quality).toBe(work.quality);
  expect(after.end).toBeNull();
  expect(result.state.author.abilities).toEqual(state.author.abilities);
  state = settleWork(engine, engine.advance(result.state, 1).state);
  if (state.pending)
    state = engine.choose(
      state,
      state.pending.id,
      state.pending.choiceIds[0],
    ).state;
  const routine = state.author.lastRoutine!;
  const total =
    routine.work +
    routine.living +
    routine.sleep +
    routine.community +
    routine.ego +
    routine.rest +
    routine.unused +
    Object.values(routine.plot).reduce((a, b) => a + b, 0) +
    Object.values(routine.writing).reduce((a, b) => a + b, 0);
  expect(total).toBe(defaultContent.balance.time.day);
});
it("retains a bounded per-work journal independently of the small global log", () => {
  let state = play(5);
  const id = state.works[0].id;
  for (let n = 0; n < 230; n++)
    state = engine.setWorkPolicy(state, id, {
      title: "이력",
      perWeek: 5,
      stockTarget: 5,
      priority: (n % 3) + 1,
    }).state;
  expect(state.log.length).toBeLessThanOrEqual(
    defaultContent.balance.events.logKeep,
  );
  expect(engine.getWorkView(state, id)!.journal).toHaveLength(200);
  expect(engine.deserialize(engine.serialize(state))).toMatchObject({
    ok: true,
    state,
  });
});
