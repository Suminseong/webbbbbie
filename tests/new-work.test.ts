import { describe, it, expect } from "vitest";
import { createEngine } from "@webbbbbie/engine";
import { withEvents } from "../packages/content/test-fixtures/content";

function scenario(id = "forced-multi", stateAction = false) {
  const content = withEvents(id);
  const def = content.events.find((item) => item.id === id)!;
  def.minDay = 1;
  def.conditions = [];
  delete def.any;
  if (stateAction)
    content.specials.find((item) => item.key === "신작병")!.newWorkChance = 1;
  const engine = createEngine(content);
  const origin = engine.createLife(42);
  const event = engine.getPending(origin)!;
  const choice = engine.choose(origin, event.id, event.choices[0].id);
  if (!choice.ok) throw new Error(choice.error);
  if (stateAction)
    choice.state.author.specialStates.push({
      key: "신작병",
      since: 0,
      until: 99,
      cause: null,
    });
  return { engine, content, state: choice.state };
}

describe("[17번] mandatory new-work transaction", () => {
  it.each(["forced-multi", "new-title-illness", "forced-new-wave"])(
    "%s closes one day then waits without creating an automatic work",
    (id) => {
      const { engine, state } = scenario(id);
      const stopped = engine.advance(state, 100);
      expect(stopped.stoppedReason).toBe("AWAITING_WORK");
      const waiting = stopped.state;
      expect(waiting.day).toBe(1);
      expect(waiting.works).toHaveLength(1);
      expect(waiting.archive).toHaveLength(2);
      expect(engine.advance(waiting, 50).state).toBe(waiting);
      const request = engine.getPendingNewWork(waiting)!;
      const invalid = engine.confirmNewWork(waiting, request.id, {
        ...request.defaultPlan,
        title: " ",
      });
      expect(invalid.ok).toBe(false);
      expect(invalid.state).toBe(waiting);
      const load = engine.deserialize(engine.serialize(waiting));
      if (!load.ok) throw new Error(load.error);
      expect(engine.getPendingNewWork(load.state)).toEqual(request);
      const done = engine.confirmNewWork(load.state, request.id, {
        ...request.defaultPlan,
        title: "내가 정한 제목",
      });
      if (!done.ok) throw new Error(done.reason);
      expect(done.state.works).toHaveLength(2);
      expect(done.state.works[1].title).toBe("내가 정한 제목");
      expect(done.state.works[1].startPath).toBe("ORIGINAL");
      expect(done.state.author.condition).toEqual(waiting.author.condition);
      expect(done.state.archive).toEqual(waiting.archive);
      expect(
        engine.confirmNewWork(done.state, request.id, request.defaultPlan).ok,
      ).toBe(false);
      expect(engine.planWork(waiting, request.defaultPlan).ok).toBe(false);
    },
  );
  it("merges event and state requests into one pending work", () => {
    const { engine, state } = scenario("forced-multi", true);
    const waiting = engine.advance(state).state;
    expect(waiting.pendingNewWork?.reasonId).toBe("system.new-work.event");
    const request = engine.getPendingNewWork(waiting)!;
    const made = engine.confirmNewWork(
      waiting,
      request.id,
      request.defaultPlan,
    );
    if (!made.ok) throw new Error(made.reason);
    expect(made.state.works).toHaveLength(2);
  });
  it("waits for a state-driven new work and preserves its original path", () => {
    const content = withEvents();
    content.specials.find((item) => item.key === "신작병")!.newWorkChance = 1;
    const engine = createEngine(content),
      initial = engine.createLife(1),
      p = engine.getPending(initial)!;
    const first = engine.choose(initial, p.id, "parody");
    if (!first.ok) throw new Error(first.error);
    first.state.author.specialStates.push({
      key: "신작병",
      since: 0,
      until: 99,
      cause: null,
    });
    const waiting = engine.advance(first.state).state;
    expect(waiting.pendingNewWork?.path).toBe("PARODY");
    const request = engine.getPendingNewWork(waiting)!;
    const made = engine.confirmNewWork(
      waiting,
      request.id,
      request.defaultPlan,
    );
    if (!made.ok) throw new Error(made.reason);
    expect(made.state.works[1].startPath).toBe("PARODY");
  });
  it("automatically guards future createWork events at the active-work limit", () => {
    const { engine, state, content } = scenario();
    content.balance.life.maxActiveWorks = 1;
    const capped = createEngine(content);
    const advanced = capped.advance(state, 2).state;
    expect(advanced.pendingNewWork).toBeNull();
    expect(
      advanced.archive.slice(1).every(([id]) => id !== "forced-multi"),
    ).toBe(true);
    expect(engine.getPendingNewWork(state)).toBeNull();
  });
  it("rejects corrupted waiting-phase relationships", () => {
    const { engine, state } = scenario();
    const waiting = engine.advance(state).state;
    const save = JSON.parse(engine.serialize(waiting));
    save.state.pendingNewWork = null;
    expect(engine.deserialize(JSON.stringify(save))).toEqual({
      ok: false,
      error: "E_SAVE_CORRUPT",
    });
  });
});
