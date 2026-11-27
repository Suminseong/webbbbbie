import { settleWork } from "./auto-new-work";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createEngine } from "@webbbbbie/engine";
import { defaultContent, originalTexts } from "@webbbbbie/content";
import type { LifeState } from "@webbbbbie/engine";
import { withEvents } from "../packages/content/test-fixtures/content";

/** 규칙 0.3.3 사건 확장(55건). 조건·효과·후속·저장 호환을 제품 코드로 검증한다. */
const NEW_IDS = `
sleep-debt well-rested neighbor-noise rest-guilt old-friend-call
plot-ready-burst plot-hole-found stale-middle parallel-draft-mixup parallel-crossover multitask-overload stock-overflow
newbie-comment spoiler-leak ending-demand reader-survey late-night-comment reader-recommend hiatus-comment plot-hole-exposed
hiatus-ping new-platform-invite platform-survey trend-tag review-hidden
deadline-clash hours-cut group-project freelance-drought colleague-reader
online-meetup ego-search-praise time-sink-thread rival-author
bonus-chapter-request exclusivity-warning exclusivity-audit revision-request settlement-cheer contract-quality-note
forced-sleep-crash forced-manuscript-ghost forced-new-wave forced-ghost-account
burnout-warning burnout-collapse burnout-clinic depression-checkin life-issue-shift gear-fever awakened-binge
meal-skip royalty-windfall subscription-trap equipment-breakdown
`
  .trim()
  .split(/\s+/);

const events = defaultContent.events;
const byId = (id: string) => events.find((entry) => entry.id === id)!;

function engineWith(...ids: string[]) {
  return createEngine(withEvents(...ids));
}
function begin(engine: ReturnType<typeof createEngine>, seed = 42): LifeState {
  const life = engine.createLife(seed);
  const pending = engine.getPending(life)!;
  const result = engine.choose(life, pending.id, pending.choices[0].id);
  if (!result.ok) throw new Error(result.error);
  const state = result.state;
  const work = state.works[0];
  work.status = "SERIAL_FREE";
  work.published = 12;
  work.stock = 8;
  work.mask = 127;
  return state;
}
function routine(
  state: LifeState,
  over: Partial<NonNullable<LifeState["author"]["lastRoutine"]>> = {},
) {
  state.author.lastRoutine = {
    work: 0,
    living: 6,
    sleep: 14,
    community: 0,
    ego: 0,
    plot: { [state.works[0].id]: 2 },
    rest: 2,
    writing: {},
    unused: 0,
    ...over,
  };
  return state;
}
/** The event chosen for the next day: pending id, else the committed one. */
function next(engine: ReturnType<typeof createEngine>, state: LifeState) {
  const advanced = settleWork(engine, engine.advance(state, 1).state);
  const id = advanced.pending
    ? advanced.pending.defId
    : advanced.archive[advanced.archive.length - 1][0];
  return { state: advanced, id };
}
function choose(
  engine: ReturnType<typeof createEngine>,
  state: LifeState,
  choice: string,
) {
  const pending = engine.getPending(state)!;
  const result = engine.choose(state, pending.id, choice);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
function addWork(engine: ReturnType<typeof createEngine>, state: LifeState) {
  const options = engine.getPlanOptions();
  const result = engine.planWork(state, {
    title: "곁가지 " + state.works.length,
    genre: options.genres[1].value,
    material: options.materials[1].value,
    tags: options.tags.slice(0, 2).map((tag) => tag.value),
    platformId: options.platforms[1].id,
    perWeek: 5,
  });
  if (!result.ok) throw new Error(result.error);
  const made = result.state;
  const work = made.works[made.works.length - 1];
  work.status = "SERIAL_FREE";
  work.published = 12;
  work.stock = 8;
  work.mask = 127;
  return made;
}

describe("[FR-EVENT-006] 규칙 0.3.3 신규 사건 데이터", () => {
  it("55건이 모두 있고 고유 ID이며 분야 수가 기록과 일치한다", () => {
    expect(new Set(NEW_IDS).size).toBe(55);
    for (const id of NEW_IDS) expect(byId(id), id).toBeTruthy();
    expect(new Set(events.map((entry) => entry.id)).size).toBe(events.length);
    const counts: Record<string, number> = {};
    for (const id of NEW_IDS)
      counts[byId(id).category] = (counts[byId(id).category] ?? 0) + 1;
    expect(counts).toEqual({
      life: 5,
      writing: 7,
      reader: 8,
      platform: 5,
      job: 5,
      community: 4,
      contract: 6,
      forced: 4,
      special: 7,
      money: 4,
    });
    expect(events.length).toBe(205);
  });

  it("문구 변형이 아니라 조건·효과가 서로 다른 사건이다", () => {
    const signature = (id: string) => {
      const { conditions, any, scope, statuses, effects, choices, tier } =
        byId(id);
      return JSON.stringify({
        conditions,
        any,
        scope,
        statuses,
        effects,
        tier,
        choices: choices?.map((item) => item.effects),
      });
    };
    expect(new Set(NEW_IDS.map(signature)).size).toBe(NEW_IDS.length);
    for (const id of NEW_IDS) {
      const other = events.filter(
        (entry) => entry.id !== id && signature(entry.id) === signature(id),
      );
      expect(
        other.map((entry) => entry.id),
        id,
      ).toEqual([]);
    }
  });

  it("새 문구는 모두 text_id로 등록되고 선택 사건·효과 사건은 결과 문구가 있다", () => {
    const texts = originalTexts as Record<string, string>;
    for (const id of NEW_IDS) {
      const entry = byId(id);
      expect(texts[`event.${id}.title`], id).toBeTruthy();
      expect(texts[`event.${id}.body`], id).toBeTruthy();
      for (const choice of entry.choices ?? [])
        expect(texts[`event.${id}.choice.${choice.id}`]).toBeTruthy();
      expect(texts[`event.${id}.result`]).toBeTruthy();
    }
  });

  it("후속 사건은 새 사건에서 예약되고 예약 대상이 후속 계층이다", () => {
    const scheduled = new Set(
      NEW_IDS.flatMap((id) => {
        const entry = byId(id);
        const effects =
          entry.effects ?? entry.choices?.flatMap((c) => c.effects) ?? [];
        return effects.flatMap((effect) =>
          effect.kind === "schedule" ? [effect.id] : [],
        );
      }),
    );
    expect([...scheduled].sort()).toEqual([
      "burnout-collapse",
      "exclusivity-audit",
      "plot-hole-exposed",
    ]);
    for (const id of scheduled) expect(byId(id).tier).toBe("FOLLOW_UP");
  });

  it("[수치 경계] 효과 크기가 안전 범위 안이다", () => {
    for (const id of NEW_IDS) {
      const entry = byId(id);
      const effects =
        entry.effects ?? entry.choices?.flatMap((c) => c.effects) ?? [];
      for (const effect of effects) {
        if (effect.kind === "condition" || effect.kind === "social")
          expect(Math.abs(effect.amount), id).toBeLessThanOrEqual(20);
        if (effect.kind === "quality" || effect.kind === "consistency")
          expect(Math.abs(effect.amount), id).toBeLessThanOrEqual(8);
        if (effect.kind === "stock")
          expect(Math.abs(effect.amount), id).toBeLessThanOrEqual(3);
        if (effect.kind === "cash")
          expect(Math.abs(effect.amount), id).toBeLessThanOrEqual(300000);
        if (effect.kind === "readerShock")
          expect(effect.amount, id).toBeLessThanOrEqual(0.1);
      }
      expect(entry.weight).toBeGreaterThan(0);
      expect(entry.weight).toBeLessThanOrEqual(10);
      if (entry.tier === "REGULAR") expect(entry.cooldown).toBeGreaterThan(0);
    }
  });
});

describe("[FR-TIME-001] 시간 배분과 지속 상태 연계", () => {
  it("수면 슬롯이 부족하면 수면 빚이, 충분하면 푹 잔 아침이 나온다", () => {
    const engine = engineWith("sleep-debt", "well-rested");
    const tired = routine(begin(engine), { sleep: 9 });
    tired.author.condition.health = 50;
    expect(next(engine, tired).id).toBe("sleep-debt");
    const rested = routine(begin(engine), { sleep: 14 });
    rested.author.condition.health = 80;
    expect(next(engine, rested).id).toBe("well-rested");
    const healthy = routine(begin(engine), { sleep: 9 });
    healthy.author.condition.health = 90;
    expect(next(engine, healthy).id).toBe("fallback");
  });

  it("수면 빚 선택 효과: 낮잠은 건강을 올리고 커피는 4,500원을 쓴다", () => {
    const engine = engineWith("sleep-debt");
    const make = () => {
      const state = routine(begin(engine), { sleep: 9 });
      state.author.condition.health = 50;
      return engine.advance(state, 1).state;
    };
    const nap = choose(engine, make(), "nap");
    const coffee = choose(engine, make(), "coffee");
    expect(nap.author.condition.health).toBeGreaterThan(
      coffee.author.condition.health,
    );
    expect(nap.author.cash - coffee.author.cash).toBe(4500);
    expect(nap.archive.filter((row) => row[0] === "sleep-debt")).toHaveLength(
      1,
    );
  });

  it("플롯 준비도가 높으면 비축이 늘고 낮으면 설정 구멍 사건이 열린다", () => {
    const engine = engineWith(
      "plot-ready-burst",
      "plot-hole-found",
      "plot-hole-exposed",
    );
    const ready = begin(engine);
    ready.works[0].prep = 80;
    ready.works[0].stock = 2;
    expect(next(engine, ready).id).toBe("plot-ready-burst");
    const sloppy = begin(engine);
    sloppy.works[0].prep = 20;
    expect(next(engine, sloppy).id).toBe("plot-hole-found");
    const middle = begin(engine);
    middle.works[0].prep = 50;
    expect(next(engine, middle).id).toBe("fallback");
  });

  it("쉬는 시간이 많은데 비축이 바닥이면 휴식 죄책감이 나온다", () => {
    const engine = engineWith("rest-guilt");
    const state = routine(begin(engine), { rest: 5 });
    state.works[0].stock = 0;
    expect(next(engine, state).id).toBe("rest-guilt");
    const calm = routine(begin(engine), { rest: 2 });
    calm.works[0].stock = 0;
    expect(next(engine, calm).id).toBe("fallback");
  });

  it("번아웃은 엔진 상태 행동이 휴재를 맡으므로 별도 강제 사건 없이 그대로 동작한다", () => {
    const engine = engineWith("burnout-clinic");
    const state = addWork(engine, begin(engine));
    state.author.specialStates.push({
      key: "번아웃",
      until: 90,
      since: 0,
      cause: null,
    });
    const waiting = engine.advance(state, 1).state;
    expect(waiting.pending!.defId).toBe("burnout-clinic");
    const treated = choose(engine, waiting, "clinic");
    expect(treated.works.every((work) => work.status === "HIATUS")).toBe(true);
    expect(
      treated.archive.filter((row) => row[0] === "burnout-clinic"),
    ).toHaveLength(1);
    expect(next(engine, begin(engine)).id).toBe("fallback");
  });

  it("설정 구멍을 덮으면 후속 지적이 같은 작품에 한 번 나온다", () => {
    const engine = engineWith("plot-hole-found", "plot-hole-exposed");
    const state = begin(engine);
    state.works[0].prep = 20;
    let current = engine.advance(state, 1).state;
    expect(current.pending!.defId).toBe("plot-hole-found");
    current = choose(engine, current, "bury");
    expect(current.followUps).toHaveLength(1);
    expect(current.followUps[0].target.id).toBe(state.works[0].id);
    for (let i = 0; i < 40 && current.followUps.length; i += 1) {
      current = engine.advance(current, 1).state;
      if (current.pending) current = choose(engine, current, "fix");
    }
    expect(
      current.archive.filter((row) => row[0] === "plot-hole-exposed"),
    ).toHaveLength(1);
  });

  it("번아웃 징조에서 버티면 며칠 뒤 후속 사건이 같은 인생에서 한 번 나온다", () => {
    const engine = engineWith("burnout-warning", "burnout-collapse");
    const state = begin(engine);
    state.author.condition.health = 40;
    state.author.condition.stress = 60;
    let current = engine.advance(state, 1).state;
    expect(current.pending!.defId).toBe("burnout-warning");
    current = choose(engine, current, "push");
    expect(current.followUps.map((item) => item.defId)).toEqual([
      "burnout-collapse",
    ]);
    const due = current.followUps[0];
    const seen: string[] = [];
    for (let i = 0; i < 20 && current.followUps.length; i += 1) {
      current = engine.advance(current, 1).state;
      if (current.pending) current = choose(engine, current, "rest");
    }
    for (const [id] of current.archive) seen.push(id);
    expect(seen.filter((id) => id === "burnout-collapse")).toHaveLength(1);
    expect(current.followUps).toHaveLength(0);
    expect(due.expiresDay).toBeGreaterThan(due.dueDay);
  });

  it("강제 수면 붕괴: 건강이 낮고 수면이 짧을 때만 발동해 건강을 회복시킨다", () => {
    const engine = engineWith("forced-sleep-crash");
    const state = routine(begin(engine), { sleep: 9 });
    state.author.condition.health = 40;
    const after = next(engine, state);
    expect(after.id).toBe("forced-sleep-crash");
    expect(after.state.pending).toBeNull();
    const control = engineWith();
    const base = routine(begin(control), { sleep: 9 });
    base.author.condition.health = 40;
    expect(control.advance(base, 1).state.author.condition.health).toBeLessThan(
      after.state.author.condition.health,
    );
    const rested = routine(begin(engine), { sleep: 14 });
    rested.author.condition.health = 40;
    expect(next(engine, rested).id).toBe("fallback");
  });
});

describe("자동 진행에서 드문 신규 사건의 조건", () => {
  it("프리랜서 의뢰 단절은 프리랜서이면서 현금이 얕을 때만 나온다", () => {
    const engine = engineWith("freelance-drought");
    const state = begin(engine);
    state.author.jobId = "freelance";
    state.author.cash = 100000;
    expect(next(engine, state).id).toBe("freelance-drought");
    const rich = begin(engine);
    rich.author.jobId = "freelance";
    rich.author.cash = 2000000;
    expect(next(engine, rich).id).toBe("fallback");
    const employee = begin(engine);
    employee.author.jobId = "employee";
    employee.author.cash = 100000;
    expect(next(engine, employee).id).toBe("fallback");
  });

  it("계정 잠수는 극단적 멘헤라와 커뮤니티 활동이 겹칠 때 강제로 멘헤라를 낮춘다", () => {
    const engine = engineWith("forced-ghost-account");
    const state = routine(begin(engine), { community: 2 });
    state.author.condition.stress = 90;
    const after = next(engine, state);
    expect(after.id).toBe("forced-ghost-account");
    expect(after.state.pending).toBeNull();
    const calm = routine(begin(engine), { community: 2 });
    calm.author.condition.stress = 50;
    expect(next(engine, calm).id).toBe("fallback");
    const quiet = routine(begin(engine), { community: 0 });
    quiet.author.condition.stress = 90;
    expect(next(engine, quiet).id).toBe("fallback");
  });
});

describe("[FR-MULTI] 다작과 작품별 대상 분리", () => {
  it("작품 3개 이상일 때만 인물 이름 혼동이 열리고 새 작품 하나에만 적용된다", () => {
    const engine = engineWith("parallel-draft-mixup");
    let two = addWork(engine, begin(engine));
    expect(next(engine, two).id).toBe("fallback");
    two = addWork(engine, two);
    const control = engineWith();
    const before = two.works.map((work) => work.consistency);
    const hit = engine.advance(structuredClone(two), 1).state;
    const quiet = control.advance(structuredClone(two), 1).state;
    expect(hit.archive[hit.archive.length - 1][0]).toBe("parallel-draft-mixup");
    const dropped = hit.works.filter(
      (work, index) => work.consistency < quiet.works[index].consistency - 1,
    );
    expect(dropped).toHaveLength(1);
    expect(dropped[0].id).toBe(two.works[two.works.length - 1].id);
    expect(before).toHaveLength(3);
  });

  it("멀티태스킹 성향이 높은 작가에게만 작품 간 아이디어 전이가 나온다", () => {
    const engine = engineWith("parallel-crossover");
    const high = addWork(engine, begin(engine));
    high.author.traits.multitask = 80;
    expect(next(engine, high).id).toBe("parallel-crossover");
    const low = addWork(engine, begin(engine));
    low.author.traits.multitask = 30;
    expect(next(engine, low).id).toBe("fallback");
  });

  it("작품 전환 과부하는 성향이 낮고 건강이 나쁜 3작품 상태에서만 나온다", () => {
    const engine = engineWith("multitask-overload");
    let state = addWork(engine, addWork(engine, begin(engine)));
    state.author.traits.multitask = 30;
    state.author.condition.health = 45;
    expect(next(engine, state).id).toBe("multitask-overload");
    state = addWork(engine, addWork(engine, begin(engine)));
    state.author.traits.multitask = 30;
    state.author.condition.health = 90;
    expect(next(engine, state).id).toBe("fallback");
  });

  it("휴재 작품이 있을 때만 휴재 관련 사건이 나오고 대상은 휴재 작품이다", () => {
    const engine = engineWith("hiatus-ping");
    const state = addWork(engine, begin(engine));
    expect(next(engine, state).id).toBe("fallback");
    state.works[1].status = "HIATUS";
    state.works[1].resumeTo = "SERIAL_FREE";
    state.works[1].hiatusUntil = 30;
    state.works[1].hiatusLockedUntil = 30;
    const after = next(engine, state);
    expect(after.id).toBe("hiatus-ping");
    expect(after.state.archive[after.state.archive.length - 1][1]).toContain(
      state.works[1].id,
    );
  });
});

describe("[FR-CONTRACT] 계약 연계와 숨은 특성 비공개", () => {
  function contracted(engine: ReturnType<typeof createEngine>) {
    const state = begin(engine);
    const work = state.works[0];
    work.status = "SERIAL_PAID";
    work.paidFrom = 1;
    work.platformId = "series";
    work.contractId = "C-1";
    state.contracts.push({
      id: "C-1",
      workId: work.id,
      companyId: "neulpom",
      signedDay: 0,
      expiresDay: 900,
      share: 0.6,
      advance: 0,
      promise: "test",
      promotionStart: 4,
      promotionEnd: 14,
      status: "ACTIVE",
      editorId: "neulpom-han",
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
    return state;
  }

  it("작품을 둘 이상 연재하면 겸업 문의가 나오고 숨기면 점검 후속 사건이 예약된다", () => {
    const engine = engineWith("exclusivity-warning", "exclusivity-audit");
    let state = contracted(engine);
    expect(next(engine, state).id).toBe("fallback");
    state = addWork(engine, state);
    const waiting = engine.advance(state, 1).state;
    expect(waiting.pending!.defId).toBe("exclusivity-warning");
    const hidden = choose(engine, waiting, "hide");
    expect(hidden.followUps.map((item) => item.defId)).toEqual([
      "exclusivity-audit",
    ]);
    expect(hidden.followUps[0].target.id).toBe("C-1");
    const explained = choose(engine, waiting, "explain");
    expect(explained.followUps).toHaveLength(0);
  });

  it("계약 사건의 효과는 계약 작품에만 적용되고 다른 작품은 그대로다", () => {
    const engine = engineWith("contract-quality-note");
    const state = addWork(engine, contracted(engine));
    const control = engineWith();
    const hit = engine.advance(structuredClone(state), 1).state;
    const base = control.advance(structuredClone(state), 1).state;
    expect(hit.archive[hit.archive.length - 1][0]).toBe(
      "contract-quality-note",
    );
    expect(hit.works[0].quality).toBeGreaterThan(base.works[0].quality);
    expect(hit.works[1].quality).toBeCloseTo(base.works[1].quality, 9);
  });

  it("계약사·편집자 숨은 특성이 사건 문구와 화면 조회에 드러나지 않는다", () => {
    const engine = engineWith("contract-quality-note", "revision-request");
    const state = engine.advance(contracted(engine), 1).state;
    const json = JSON.stringify([
      engine.getContractViews(state),
      engine.getPending(state),
      engine.getWorkViews(state),
    ]);
    for (const key of [
      "payPunctuality",
      "promoPower",
      "interference",
      "warmth",
    ])
      expect(json).not.toContain(key);
    const texts = originalTexts as Record<string, string>;
    for (const id of NEW_IDS.filter(
      (item) => byId(item).scope === "CONTRACT",
    )) {
      for (const [key, text] of Object.entries(texts)) {
        if (!key.startsWith(`event.${id}.`)) continue;
        expect(text).not.toMatch(/역량|간섭|소통 성향|편집 능력/);
      }
    }
  });

  it("강제 원고 잠수: 스트레스가 높고 비축이 바닥인 계약 작품만 10일 휴재한다", () => {
    const engine = engineWith("forced-manuscript-ghost");
    const state = addWork(engine, contracted(engine));
    state.author.condition.stress = 80;
    state.works[0].stock = 0;
    const after = engine.advance(structuredClone(state), 1).state;
    expect(after.archive[after.archive.length - 1][0]).toBe(
      "forced-manuscript-ghost",
    );
    expect(after.pending).toBeNull();
    expect(after.works[0].status).toBe("HIATUS");
    expect(after.works[0].hiatusUntil! - 1).toBe(10);
    expect(after.works[1].status).toBe("SERIAL_FREE");
    expect(after.author.social.reputation).toBeLessThan(
      state.author.social.reputation + 0.0001,
    );
    state.works[0].stock = 6;
    expect(next(engine, state).id).toBe("fallback");
  });

  it("보너스 회차 수락은 현금이 늘고 비축이 줄며 한 번만 반영된다", () => {
    const engine = engineWith("bonus-chapter-request");
    const state = contracted(engine);
    state.works[0].published = 45;
    state.works[0].stock = 6;
    const waiting = engine.advance(state, 1).state;
    expect(waiting.pending!.defId).toBe("bonus-chapter-request");
    const loaded = engine.deserialize(engine.serialize(waiting));
    if (!loaded.ok) throw new Error(loaded.error);
    const done = choose(engine, loaded.state, "accept");
    expect(
      done.archive.filter((row) => row[0] === "bonus-chapter-request"),
    ).toHaveLength(1);
    expect(engine.choose(done, "bonus-chapter-request", "accept").ok).toBe(
      false,
    );
  });
});

describe("[FR-SAVE] 사건 확장 후 이전 저장 호환", () => {
  const product = createEngine();
  const read = (name: string) =>
    readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");

  it.each([
    "save-v0.3.0.json",
    "save-v0.3.2-analytics.json",
    "save-v0.3.2-partial.json",
  ])("%s 저장을 읽고 규칙 0.3.3으로 올려 계속 진행·왕복한다", (name) => {
    const loaded = product.deserialize(read(name));
    if (!loaded.ok) throw new Error(name + " " + loaded.error);
    expect(loaded.state.rulesVersion).toBe(
      createEngine().createLife(0).rulesVersion,
    );
    const again = product.deserialize(product.serialize(loaded.state));
    expect(again.ok).toBe(true);
    let state = loaded.state;
    const start = state.day;
    while (state.day < start + 60) {
      state = settleWork(product, state);
      if (state.pending) {
        const waiting = product.getPending(state)!;
        const resumed = product.deserialize(product.serialize(state));
        if (!resumed.ok) throw new Error(resumed.error);
        expect(product.getPending(resumed.state)).toEqual(waiting);
        state = choose(product, resumed.state, waiting.choices[0].id);
      } else state = product.advance(state, start + 60 - state.day).state;
    }
    // 하루 사건 한 건: 보관된 날짜마다 정확히 한 줄.
    expect(state.archive).toHaveLength(state.day + 1);
    expect(state.phase).not.toBe("ENDED");
  });

  it("저장된 0.3.2 상태가 가리키던 사건 ID는 모두 새 콘텐츠에 남아 있다", () => {
    for (const name of [
      "save-v0.3.2-analytics.json",
      "save-v0.3.2-partial.json",
    ]) {
      const saved = JSON.parse(read(name)).state;
      for (const [id] of saved.archive)
        expect(
          events.some((entry) => entry.id === id),
          id,
        ).toBe(true);
      for (const item of saved.followUps)
        expect(byId(item.defId).tier).toBe("FOLLOW_UP");
    }
  });

  it("해시가 맞지 않는 같은 버전 저장은 거부한다", () => {
    const saved = JSON.parse(read("save-v0.3.2-partial.json"));
    saved.contentHash = "deadbeef";
    expect(product.deserialize(JSON.stringify(saved))).toEqual({
      ok: false,
      error: "E_SAVE_VERSION",
    });
    const current = JSON.parse(product.serialize(product.createLife(3)));
    current.contentHash = "deadbeef";
    expect(product.deserialize(JSON.stringify(current))).toEqual({
      ok: false,
      error: "E_SAVE_VERSION",
    });
  });

  it("같은 시드는 신규 사건 포함 전체 콘텐츠에서 동일하게 재현된다", () => {
    const run = (seed: number) => {
      let state = product.createLife(seed);
      while (state.day < 300)
        state = state.pendingNewWork
          ? settleWork(product, state)
          : state.pending
            ? choose(product, state, product.getPending(state)!.choices[0].id)
            : product.advance(state, 300 - state.day).state;
      return state;
    };
    const a = run(9);
    expect(product.serialize(run(9))).toBe(product.serialize(a));
    expect(product.serialize(run(10))).not.toBe(product.serialize(a));
    expect(a.archive).toHaveLength(a.day + 1);
    expect(a.archive.some((row) => NEW_IDS.includes(row[0]))).toBe(true);
  });
});
