import { expect, it } from "vitest";
import { createEngine } from "@webbbbbie/engine";
import { defaultContent } from "@webbbbbie/content";
import type { LifeState } from "@webbbbbie/engine";
import { settleWork } from "./auto-new-work";
const e = createEngine();
function input(state: LifeState) {
  const view = e.getStartSetup(state)!;
  return {
    profile: {
      penName: "내 필명",
      message: "독자에게 남기는 말\n두 번째 줄",
      motive: "직접 적은 집필 이유",
    },
    choiceId: view.choices[0].id,
    work: {
      ...view.defaultPlan,
      title: "직접 정한 첫 작품",
      description: "나만의 줄거리\n아직 펼치지 않은 이야기",
    },
  };
}
it("previews real initial background and public stats without consuming a choice or exposing hidden values", () => {
  const state = e.createLife(42),
    before = e.serialize(state),
    v = e.getStartSetup(state)!;
  expect(v.author.abilities).toEqual(state.author.abilities);
  expect(v.author.condition).toEqual(state.author.condition);
  const job = defaultContent.world.jobs.find(
    (j) => j.id === state.author.jobId,
  )!;
  expect(v.background.jobIncome).toBe(job.income);
  expect(v.background.jobHours).toBe((job.slots + job.irregularity) / 2);
  expect(v.background.livingExpense).toBe(
    Math.floor(
      defaultContent.balance.economy.livingExpense * state.author.home.expense,
    ),
  );
  v.author.abilities.style = 100;
  v.defaultPlan.tags = [];
  expect(e.serialize(state)).toBe(before);
  expect(JSON.stringify(v)).not.toMatch(
    /trueValue|interference|warmth|aptitudes/,
  );
});
it.each([1, 4, 42])(
  "%s starts at day zero with one custom author and work, preserves every allowed origin path and round-trips",
  (seed) => {
    const state = e.createLife(seed),
      before = e.serialize(state);
    for (const c of e.getStartSetup(state)!.choices) {
      const setup = { ...input(state), choiceId: c.id };
      const done = e.configureStart(state, setup);
      expect(done.ok).toBe(true);
      expect(done.state.day).toBe(0);
      expect(done.state.phase).toBe("READY");
      expect(done.state.works).toHaveLength(1);
      expect(done.state.archive).toHaveLength(1);
      expect(done.state.author.identity).toEqual(setup.profile);
      expect(done.state.works[0].description).toBe(setup.work.description);
      expect(e.getAuthorView(done.state)).toMatchObject(setup.profile);
      expect(e.getWorkViews(done.state)[0]).toMatchObject({
        title: setup.work.title,
        description: setup.work.description,
      });
      expect(e.deserialize(e.serialize(done.state))).toMatchObject({
        ok: true,
        state: done.state,
      });
      expect(e.configureStart(done.state, setup)).toMatchObject({
        ok: false,
        state: done.state,
      });
    }
    expect(e.serialize(state)).toBe(before);
  },
);
it("rejects invalid profiles, work plans and origin choices atomically", () => {
  const state = e.createLife(42),
    before = e.serialize(state),
    v = input(state);
  const variants = [
    { ...v, profile: { ...v.profile, penName: "  " } },
    { ...v, profile: { ...v.profile, message: "x".repeat(161) } },
    { ...v, profile: { ...v.profile, motive: "" } },
    { ...v, work: { ...v.work, description: "x".repeat(601) } },
    { ...v, work: { ...v.work, tags: [] } },
    { ...v, choiceId: "unknown" },
  ];
  for (const item of variants) {
    expect(e.configureStart(state, item)).toMatchObject({ ok: false, state });
    expect(e.serialize(state)).toBe(before);
  }
});
it("author copy, title and description never influence 120 days of simulation", () => {
  const state = e.createLife(42),
    a = input(state),
    b = {
      ...a,
      profile: {
        penName: "다른 이름",
        message: "다른 한마디",
        motive: "이유도 다름",
      },
      work: { ...a.work, title: "완전히 다른 제목", description: "다른 소개" },
    };
  function play(setup: typeof a) {
    let s = e.configureStart(state, setup).state;
    while (s.day < 120) {
      s = settleWork(e, s);
      s = s.pending
        ? e.choose(s, s.pending.id, s.pending.choiceIds[0]).state
        : e.advance(s, 1).state;
    }
    return settleWork(e, s);
  }
  function gameplay(s: LifeState) {
    const copy = structuredClone(s);
    copy.author.identity = null;
    copy.works[0].title = "title";
    copy.works[0].description = "";
    for (const row of copy.log) row.message = "";
    for (const w of copy.works)
      for (const row of w.detail?.journal ?? []) row.message = "";
    return copy;
  }
  expect(gameplay(play(a))).toEqual(gameplay(play(b)));
});
it("preserves optional descriptions when older clients revise a work", () => {
  const state = e.createLife(42),
    v = input(state),
    s = e.configureStart(state, v).state;
  const { description, ...plan } = v.work;
  expect(description).toBeTruthy();
  const revised = e.reviseWork(s, s.works[0].id, plan);
  expect(revised.ok).toBe(true);
  expect(revised.state.works[0].description).toBe(description);
});
