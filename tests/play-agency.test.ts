import { describe, expect, it } from "vitest";
import { createEngine } from "@webbbbbie/engine";
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

  it("rushes extra chapters from stock and costs health", () => {
    const base = serializing();
    base.works[0].mask = 1;
    const rushed = ok(quiet.rushWork(base, "W-1", 3)).state;
    const normal = quiet.advance(base, 3).state;
    const fast = quiet.advance(rushed, 3).state;
    expect(fast.works[0].published).toBeGreaterThan(normal.works[0].published);
    expect(fast.author.condition.fatigue).toBeGreaterThan(
      normal.author.condition.fatigue,
    );
    expect(fast.works[0].rush).toBe(0);
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
