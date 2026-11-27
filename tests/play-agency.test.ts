import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createEngine } from "@webbbbbie/engine";
import { appliedTexts, originalTexts } from "@webbbbbie/content";
import type { LifeState } from "@webbbbbie/engine";
import { withEvents } from "../packages/content/test-fixtures/content";

const quiet = createEngine(withEvents());
function started(seed = 42): LifeState {
  const life = quiet.createLife(seed);
  const pending = quiet.getPending(life)!;
  const result = quiet.choose(life, pending.id, pending.choices[0].id);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
function ok<T extends { ok: boolean }>(result: T) {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
}
function serializing(seed = 42) {
  const state = started(seed);
  const work = state.works[0];
  work.status = "SERIAL_FREE";
  work.published = 12;
  work.stock = 8;
  work.mask = 127;
  return state;
}
const options = quiet.getPlanOptions();
const plan = (title: string) => ({
  title,
  genre: options.genres[1].value,
  material: options.materials[1].value,
  tags: options.tags.slice(0, 2).map((tag) => tag.value),
  platformId: options.platforms[1].id,
  perWeek: 5,
});

describe("[16번 §3] player commands", () => {
  it("plans a work with a free title and chosen tags, and rejects bad input", () => {
    const state = started();
    const made = ok(quiet.planWork(state, plan("내 마음대로 제목")));
    const work = made.state.works.at(-1)!;
    expect(work.title).toBe("내 마음대로 제목");
    expect(work.platformId).toBe(options.platforms[1].id);
    expect(work.manual).toBe(true);
    const bad = quiet.planWork(state, { ...plan("x"), tags: ["없는 태그"] });
    expect(bad.ok).toBe(false);
    expect(quiet.planWork(state, { ...plan("x"), title: "   " }).ok).toBe(
      false,
    );
    // The original state is untouched by a rejected or accepted command.
    expect(state.works).toHaveLength(1);
  });

  it("never lets the title change the simulation", () => {
    const run = (title: string) => {
      let state = ok(quiet.planWork(started(7), plan(title))).state;
      state = quiet.advance(state, 120).state;
      return state.works.map((work) => [
        work.stats.totalViews,
        work.quality,
        work.published,
      ]);
    };
    expect(run("가나다")).toEqual(run("완전히 다른 아주 긴 제목 ABC 123"));
  });

  it("keeps an explicitly entered title even when a matching generated title has an edited translation", () => {
    const titleId = Object.keys(originalTexts).find((id) =>
      id.startsWith("entity.work."),
    )!;
    const original = originalTexts[titleId];
    const edits = appliedTexts as Record<string, string>;
    const previous = edits[titleId];
    try {
      edits[titleId] = "교정된 자동 생성 제목";
      const automatic = started();
      automatic.works[0].title = original;
      expect(quiet.getWorkViews(automatic)[0].title).toBe(
        "교정된 자동 생성 제목",
      );
      const named = ok(
        quiet.setWorkPolicy(automatic, "W-1", { title: original }),
      ).state;
      expect(named.works[0].manual).toBe(true);
      expect(quiet.getWorkViews(named)[0].title).toBe(original);
    } finally {
      if (previous === undefined) delete edits[titleId];
      else edits[titleId] = previous;
    }
  });

  it("changes tags and platform effects but only before the first chapter", () => {
    const state = ok(quiet.planWork(started(), plan("원본"))).state;
    const id = state.works.at(-1)!.id;
    const changed = ok(
      quiet.reviseWork(state, id, { ...plan("수정"), perWeek: 3 }),
    ).state;
    expect(changed.works.at(-1)!.mask).toBe(21);
    const later = quiet.advance(changed, 2).state;
    expect(quiet.reviseWork(later, id, plan("늦음")).ok).toBe(false);
  });

  it("unlocks additional tags by completed episode count without exposing aptitude", () => {
    const base = started();
    const available = quiet.getPlanOptions(base);
    const locked = available.tags.find((item) => item.required === 10)!;
    expect(locked).toMatchObject({ unlocked: false, label: "느린 성장" });
    expect(
      quiet.planWork(base, { ...plan("새 태그"), tags: [locked.value] }),
    ).toMatchObject({ ok: false, state: base, error: "E_NOT_ALLOWED" });
    const experienced = structuredClone(base);
    experienced.works[0].published = 10;
    const next = quiet.getPlanOptions(experienced);
    expect(
      next.tags.find((item) => item.value === locked.value)?.unlocked,
    ).toBe(true);
    expect(
      next.platforms.find((platform) => platform.id === "read")?.tags,
    ).toContain(locked.label);
    const created = ok(
      quiet.planWork(experienced, {
        ...plan("열린 태그"),
        tags: [locked.value],
        platformId: "read",
      }),
    ).state;
    expect(created.works.at(-1)?.tags).toContain(locked.value);
    const publicAptitude = quiet
      .getAptitudeView(created)
      .find((item) => item.key === locked.label);
    expect(publicAptitude).toMatchObject({ stage: "UNKNOWN", estimate: null });
    expect(publicAptitude).not.toHaveProperty("trueValue");
    const schedules = created.author.aptitudes
      .filter((item) => item.kind === "SCHEDULE")
      .map((item) => item.key);
    expect(schedules).toEqual(
      expect.arrayContaining(["1", "17", "21", "85", "31", "63", "127"]),
    );
  });

  it("posts extra chapters from existing stock without charging writing time or fatigue", () => {
    const base = serializing();
    base.works[0].mask = 1;
    const rushed = ok(quiet.rushWork(base, "W-1", 3)).state;
    const normal = quiet.advance(base, 3).state;
    const fast = quiet.advance(rushed, 3).state;
    expect(fast.works[0].published).toBeGreaterThan(normal.works[0].published);
    expect(fast.author.condition.fatigue).toBe(normal.author.condition.fatigue);
    expect(fast.works[0].rush).toBe(0);
  });

  it("does not count a newly written chapter as previously stockpiled", () => {
    const base = serializing();
    base.works[0].stock = 0;
    base.works[0].mask = 0;
    const result = quiet.advance(
      ok(quiet.rushWork(base, "W-1", 1)).state,
    ).state;
    expect(result.works[0].published).toBe(base.works[0].published);
    expect(result.works[0].stock).toBeGreaterThan(0);
    expect(
      result.log.some(
        (event) =>
          event.type === "WORK_ORDER" && event.message.includes("부족"),
      ),
    ).toBe(true);
  });

  it("spends one shared hour for extra writing and processes it once across save and reload", () => {
    const base = serializing();
    const policy = quiet.getLifeSettings(base).time;
    const planned = ok(quiet.setTimePolicy(base, { ...policy, rest: 6 })).state;
    const queued = ok(quiet.extraWrite(planned, "W-1", true)).state;
    expect(quiet.extraWrite(queued, "W-1", true).ok).toBe(false);
    const load = quiet.deserialize(quiet.serialize(queued));
    if (!load.ok) throw new Error(load.error);
    const done = quiet.advance(queued).state;
    const restored = quiet.advance(load.state).state;
    const normal = quiet.advance(planned).state;
    expect(quiet.serialize(done)).toBe(quiet.serialize(restored));
    expect(done.author.lastRoutine!.writing["W-1"]).toBe(
      normal.author.lastRoutine!.writing["W-1"] + 2,
    );
    expect(
      done.author.lastRoutine!.rest + done.author.lastRoutine!.unused,
    ).toBe(
      normal.author.lastRoutine!.rest + normal.author.lastRoutine!.unused - 2,
    );
    expect(done.works[0].extraWriting).toBe(false);
    expect(
      done.log.filter(
        (event) =>
          event.type === "WORK_ORDER" && event.message.includes("추가 집필"),
      ),
    ).toHaveLength(1);
  });

  it("records an actual failure when poor health blocks a scheduled writing attempt", () => {
    const base = serializing();
    base.author.condition.health = 10;
    const queued = ok(quiet.extraWrite(base, "W-1", true)).state;
    const result = quiet.advance(queued).state;
    expect(result.works[0].stock).toBeLessThanOrEqual(base.works[0].stock);
    expect(result.works[0].extraWriting).toBe(false);
    expect(result.author.deviations).toContain("label.deviation.write-health");
    expect(
      result.log.some(
        (event) =>
          event.type === "WORK_ORDER" && event.message.includes("건강"),
      ),
    ).toBe(true);
  });

  it("rejects a queued extra session if no shared free time remains", () => {
    const base = serializing();
    const { free } = quiet.getLifeSettings(base);
    const plan = { sleep: 8, plot: free - 8, community: 0, ego: 0, rest: 0 };
    const planned = ok(quiet.setTimePolicy(base, plan)).state;
    const scheduled = ok(quiet.extraWrite(planned, "W-1", true)).state;
    const done = quiet.advance(scheduled).state;
    expect(done.works[0].extraWriting).toBe(false);
    expect(
      done.log.some(
        (event) =>
          event.type === "WORK_ORDER" && event.message.includes("시간"),
      ),
    ).toBe(true);
    const time = done.author.lastRoutine!;
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
  });

  it("preserves a forced hiatus against an immediate resume and reports an interrupted order", () => {
    const engine = createEngine(withEvents("forced-hiatus"));
    const start = engine.createLife(42);
    const pending = engine.getPending(start)!;
    let state = ok(
      engine.choose(start, pending.id, pending.choices[0].id),
    ).state;
    state.works[0].status = "SERIAL_FREE";
    state.works[0].published = 12;
    state.works[0].stock = 8;
    state.author.condition.health = 30;
    state = ok(engine.rushWork(state, "W-1", 1)).state;
    state = ok(engine.extraWrite(state, "W-1", true)).state;
    const day = engine.advance(state).state;
    expect(day.works[0].status).toBe("HIATUS");
    expect(day.works[0].rush).toBe(0);
    expect(day.works[0].extraWriting).toBe(false);
    expect(day.log.filter((event) => event.type === "WORK_ORDER")).toHaveLength(
      2,
    );
    expect(engine.resumeWork(day, "W-1")).toMatchObject({
      ok: false,
      error: "E_NOT_ALLOWED",
    });
  });

  it("blocks management while an event choice is pending", () => {
    const engine = createEngine(withEvents("critique"));
    let state = engine.createLife(42);
    const first = engine.getPending(state)!;
    state = ok(engine.choose(state, first.id, first.choices[0].id)).state;
    state.works[0].status = "SERIAL_FREE";
    state.works[0].published = 12;
    state.works[0].stock = 5;
    state = engine.advance(state).state;
    expect(state.phase).toBe("AWAITING_CHOICE");
    expect(engine.dropWork(state, "W-1")).toMatchObject({
      ok: false,
      state,
      error: "E_NOT_ALLOWED",
    });
    expect(engine.extraWrite(state, "W-1", true)).toMatchObject({
      ok: false,
      state,
    });
    const loaded = engine.deserialize(engine.serialize(state));
    if (!loaded.ok) throw new Error(loaded.error);
    const pending = engine.getPending(loaded.state)!;
    const choice = ok(
      engine.choose(loaded.state, pending.id, pending.choices[0].id),
    ).state;
    expect(choice.archive).toHaveLength(2);
    expect(engine.choose(choice, pending.id, pending.choices[0].id).ok).toBe(
      false,
    );
  });

  it("keeps a voluntary hiatus for its requested duration and permits early recovery", () => {
    const base = serializing();
    const paused = ok(quiet.hiatusWork(base, "W-1", "STOCK", 2)).state;
    expect(quiet.advance(paused, 2).state.works[0].status).toBe("HIATUS");
    expect(quiet.advance(paused, 3).state.works[0].status).toBe("SERIAL_FREE");
    expect(ok(quiet.resumeWork(paused, "W-1")).state.works[0].status).toBe(
      "SERIAL_FREE",
    );
  });

  it("loads a real deployed 0.3.0 save and preserves its queued command", () => {
    const fixture = readFileSync(
      new URL("./fixtures/save-v0.3.0.json", import.meta.url),
      "utf8",
    );
    const product = createEngine();
    const loaded = product.deserialize(fixture);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.state.rulesVersion).toBe("0.3.4");
    expect(loaded.state.day).toBe(5);
    expect(loaded.state.works[0].rush).toBe(2);
    expect(loaded.state.works[0].extraWriting).toBe(false);
    expect(
      product
        .getAptitudeView(loaded.state)
        .find((item) => item.key === "느린 성장"),
    ).toMatchObject({ stage: "UNKNOWN", estimate: null });
    expect(product.deserialize(product.serialize(loaded.state)).ok).toBe(true);
    expect(product.advance(loaded.state).state.phase).not.toBe("ENDED");
  });

  it("hiatus stops posting; a stock hiatus keeps writing, a recovery hiatus rests", () => {
    const base = serializing();
    const stock = ok(quiet.hiatusWork(base, "W-1", "STOCK", 5)).state;
    const recover = ok(quiet.hiatusWork(base, "W-1", "RECOVER", 5)).state;
    const a = quiet.advance(stock, 3).state;
    const b = quiet.advance(recover, 3).state;
    expect(a.works[0].published).toBe(12);
    expect(b.works[0].published).toBe(12);
    expect(a.works[0].stock).toBeGreaterThan(b.works[0].stock - 0.0001);
    const resumed = ok(quiet.resumeWork(stock, "W-1")).state;
    expect(resumed.works[0].status).toBe("SERIAL_FREE");
  });

  it("drops a work for good with a reputation cost", () => {
    const base = serializing();
    const dropped = ok(quiet.dropWork(base, "W-1")).state;
    expect(dropped.works[0].status).toBe("DROPPED");
    expect(dropped.author.social.reputation).toBeLessThan(
      base.author.social.reputation,
    );
    expect(quiet.dropWork(dropped, "W-1").ok).toBe(false);
  });
});

describe("[16번 §4,§6] time and spending", () => {
  it("charges and records one-time purchases exactly once with cash and cooldown checks", () => {
    const base = serializing();
    base.author.cash = 200000;
    base.author.condition.health = 60;
    base.author.condition.fatigue = 30;
    const receipt = ok(quiet.purchase(base, "medical")).state;
    expect(base.author.cash).toBe(200000);
    expect(receipt.author.cash).toBe(120000);
    expect(receipt.author.condition.health).toBe(68);
    expect(receipt.author.condition.fatigue).toBe(24);
    expect(receipt.ledger.at(-1)).toMatchObject({
      kind: "SPEND",
      amount: -80000,
      ref: "purchase:medical",
    });
    expect(quiet.purchase(receipt, "medical")).toMatchObject({
      ok: false,
      state: receipt,
    });
    const loaded = quiet.deserialize(quiet.serialize(receipt));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(quiet.purchase(loaded.state, "medical").ok).toBe(false);
    const broke = structuredClone(receipt);
    broke.author.cash = 1;
    expect(quiet.purchase(broke, "leisure")).toMatchObject({
      ok: false,
      state: broke,
    });
    expect(broke.ledger).toEqual(receipt.ledger);
    const later = quiet.advance(receipt, 14).state;
    expect(quiet.purchase(later, "medical").ok).toBe(true);
  });

  it("reports real ledger amounts in monthly income, expense and carried totals", () => {
    let state = serializing();
    state.author.cash = 200000;
    state = ok(quiet.purchase(state, "medical")).state;
    state = quiet.advance(state, 30).state;
    const ledger = quiet.getLedgerView(state);
    const first = ledger.months.find((month) => month.month === 1)!;
    const entries = ledger.entries.filter((entry) => entry.day <= 30);
    const income = entries
      .filter((entry) => entry.amount > 0)
      .reduce((sum, entry) => sum + entry.amount, 0);
    const expense = -entries
      .filter((entry) => entry.amount < 0)
      .reduce((sum, entry) => sum + entry.amount, 0);
    expect(first).toMatchObject({ income, expense, net: income - expense });
    expect(expense).toBeGreaterThanOrEqual(80000);
  });

  it("rejects plans over 24 hours and keeps every day at exactly 48 units", () => {
    const state = serializing();
    const info = quiet.getLifeSettings(state);
    expect(
      quiet.setTimePolicy(state, { ...info.time, rest: info.free }).ok,
    ).toBe(false);
    const changed = ok(
      quiet.setTimePolicy(state, {
        sleep: 12,
        plot: 6,
        community: 0,
        ego: 0,
        rest: 0,
      }),
    ).state;
    const next = quiet.advance(changed, 1).state;
    const time = next.author.lastRoutine!;
    const total =
      time.work +
      time.living +
      time.sleep +
      time.community +
      time.ego +
      time.rest +
      time.unused +
      Object.values(time.plot).reduce((a, b) => a + b, 0) +
      Object.values(time.writing).reduce((a, b) => a + b, 0);
    expect(total).toBe(48);
  });

  it("keeps the completed day's plan when tomorrow's policy changes", () => {
    const initial = serializing();
    const firstPolicy = { ...quiet.getLifeSettings(initial).time, rest: 2 };
    const first = ok(quiet.setTimePolicy(initial, firstPolicy)).state;
    const completed = quiet.advance(first).state;
    const previousPlan = quiet.getAuthorView(completed).plan!;
    const updated = ok(
      quiet.setTimePolicy(completed, { ...firstPolicy, rest: 8 }),
    ).state;
    expect(quiet.getAuthorView(updated).plan).toEqual(previousPlan);
    expect(quiet.getLifeSettings(updated).time.rest).toBe(8);
    previousPlan.writing.total = -1;
    expect(
      quiet.getAuthorView(updated).plan!.writing.total,
    ).toBeGreaterThanOrEqual(0);
  });

  it("trades writing today for plot preparation and long-run quality", () => {
    const heavyPlot = {
      sleep: 14,
      plot: 8,
      community: 0,
      ego: 0,
      rest: 0,
    };
    const noPlot = { sleep: 14, plot: 0, community: 0, ego: 0, rest: 8 };
    const run = (policy: typeof heavyPlot) => {
      const base = serializing();
      base.works[0].prep = 10;
      const state = ok(quiet.setTimePolicy(base, policy)).state;
      return quiet.advance(state, 20).state.works[0];
    };
    const a = run(heavyPlot);
    const b = run(noPlot);
    expect(a.prep).toBeGreaterThan(b.prep);
    expect(a.consistency).toBeGreaterThan(b.consistency);
  });

  it("charges spending monthly and applies its effects only while solvent", () => {
    const base = serializing();
    const spend = ok(
      quiet.setSpendPolicy(base, {
        meals: 3,
        gear: 3,
        health: 3,
        research: 3,
        leisure: 3,
        promo: 3,
      }),
    ).state;
    const after = quiet.advance(spend, 30).state;
    const charged = after.ledger.find((entry) => entry.kind === "SPEND");
    expect(charged!.amount).toBeLessThan(0);
    const broke = structuredClone(spend);
    broke.author.cash = -1000;
    const view = quiet.getLifeSettings(broke);
    expect(view.spendCut).toBe(true);
    expect(view.spend.every((item) => item.effective === 0)).toBe(true);
  });
});

describe("[16번 §7] sustained states", () => {
  it("starts 현생이슈 when cash runs out and relieves it when money returns", () => {
    const base = serializing();
    base.author.cash = 0;
    let state = base;
    for (let i = 0; i < 40 && !state.author.specialStates.length; i += 1)
      state = quiet.advance(state, 1).state;
    expect(state.author.specialStates.map((item) => item.key)).toContain(
      "현생이슈",
    );
    const sick = state.author.specialStates.find(
      (item) => item.key === "현생이슈",
    )!;
    expect(sick.cause).not.toBeNull();
    const view = quiet.getAuthorView(state).states[0];
    expect(view.cause).toBeTruthy();
    state.author.cash = 5_000_000;
    for (let i = 0; i < 12; i += 1) state = quiet.advance(state, 1).state;
    expect(
      state.author.specialStates.some((item) => item.key === "현생이슈"),
    ).toBe(false);
  });

  it("starts 우울 under sustained stress and low drive, and it lasts until relieved", () => {
    let state = serializing();
    for (let i = 0; i < 60; i += 1) {
      state.author.condition.stress = 70;
      state.author.condition.drive = 30;
      state = quiet.advance(state, 1).state;
      if (state.author.specialStates.some((item) => item.key === "우울")) break;
    }
    expect(state.author.specialStates.some((item) => item.key === "우울")).toBe(
      true,
    );
    state.author.condition.stress = 20;
    state.author.condition.drive = 80;
    const early = quiet.advance(state, 3).state;
    // The minimum duration keeps the state from flickering off at once.
    expect(early.author.specialStates.some((item) => item.key === "우울")).toBe(
      true,
    );
    const later = quiet.advance(state, 14).state;
    expect(later.author.specialStates.some((item) => item.key === "우울")).toBe(
      false,
    );
  });

  it("forces a recovery hiatus during burnout and records why", () => {
    const base = serializing();
    let state = base;
    for (let i = 0; i < 10; i += 1) {
      state.author.condition.fatigue = 98;
      state = quiet.advance(state, 1).state;
    }
    const burned = state.author.specialStates.some((s) => s.key === "번아웃");
    expect(burned).toBe(true);
    expect(["HIATUS", "SERIAL_FREE"]).toContain(state.works[0].status);
    expect(state.log.some((item) => item.message.includes("번아웃"))).toBe(
      true,
    );
  });
});

describe("[16번 §10] life ending", () => {
  it("ends the life voluntarily once and refuses further days or commands", () => {
    const state = serializing();
    const done = ok(quiet.retire(state)).state;
    expect(done.phase).toBe("ENDED");
    const summary = quiet.getLifeSummary(done);
    expect(summary.ended).toBe(true);
    expect(quiet.advance(done, 5).state.day).toBe(done.day);
    expect(quiet.retire(done).ok).toBe(false);
    expect(quiet.rushWork(done, "W-1", 1).ok).toBe(false);
    const loaded = quiet.deserialize(quiet.serialize(done));
    expect(loaded.ok).toBe(true);
  });

  it("does not end the life by saving and loading", () => {
    const state = serializing();
    const loaded = quiet.deserialize(quiet.serialize(state));
    expect(loaded.ok && loaded.state.phase).toBe("READY");
  });
});
