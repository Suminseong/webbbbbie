import type { Content, SpecialDef } from "@webbbbbie/content";
import { displayName, text } from "@webbbbbie/content";
import {
  activeWork,
  requestNewWork,
  record,
  serial,
  workTitle,
} from "./author";
import type { EngineEvent, LifeState } from "./model";
import { rand, stream } from "./rng";
import { transitionWork } from "./work";

type Rule = NonNullable<SpecialDef["release"]>[number];

function metric(state: LifeState, key: Rule["metric"]) {
  return key === "cash" ? state.author.cash : state.author.condition[key];
}
const holds = (state: LifeState, rules: readonly Rule[]) =>
  rules.every((rule) =>
    rule.op === "gte"
      ? metric(state, rule.metric) >= rule.value
      : metric(state, rule.metric) <= rule.value,
  );
const stateName = (def: SpecialDef) => displayName("entity.special", def.name);

/**
 * Starts and ends sustained states from the author's condition (16번 §7).
 * Onset needs the onset rules and a daily chance; relief needs the minimum
 * duration and every release rule, so a state does not flicker on and off.
 * The maximum duration guarantees an eventual recovery.
 */
export function updateStates(
  state: LifeState,
  content: Content,
  day: number,
  events: EngineEvent[],
) {
  const { author } = state;
  for (const [index, def] of content.specials.entries()) {
    const active = author.specialStates.find((item) => item.key === def.key);
    if (active) {
      if (
        def.release &&
        day - active.since >= (def.min ?? 0) &&
        holds(state, def.release)
      ) {
        author.specialStates = author.specialStates.filter(
          (item) => item !== active,
        );
        record(
          events,
          "STATE_CHANGED",
          day,
          text("engine.log.state-relief", { state_name: stateName(def) }),
        );
      }
      continue;
    }
    if (
      def.onset &&
      holds(state, def.onset.when) &&
      rand(state.seed, day, stream.EVENT, 400 + index) < def.onset.chance
    ) {
      author.specialStates.push({
        key: def.key,
        until: day + (def.max ?? 60),
        since: day,
        cause: def.cause ?? null,
      });
      record(
        events,
        "STATE_CHANGED",
        day,
        text("engine.log.state-onset", {
          state_name: stateName(def),
          cause: def.cause
            ? text(def.cause)
            : text("label.state-cause.unknown"),
        }),
      );
    }
  }
}

/** Behavior changes caused by active states: forced hiatus, new work, rush end. */
export function applyStateBehaviors(
  state: LifeState,
  content: Content,
  day: number,
  events: EngineEvent[],
) {
  const { author } = state;
  for (const [index, active] of author.specialStates.entries()) {
    const def = content.specials.find((item) => item.key === active.key);
    if (!def) continue;
    const name = stateName(def);
    for (const [slot, work] of state.works.entries()) {
      if (!serial(work)) continue;
      const roll = rand(state.seed, day, stream.EVENT, 500 + index * 16 + slot);
      if (def.hiatusChance && roll < def.hiatusChance) {
        transitionWork(work, "HIATUS", day, events, 7);
        work.hiatusKind = "RECOVER";
        record(
          events,
          "STATE_CHANGED",
          day,
          text("engine.log.forced-hiatus", {
            state_name: name,
            work_title: workTitle(work),
          }),
          work.id,
        );
      } else if (
        def.rushEndChance &&
        work.published >= work.targetChapters * 0.4 &&
        roll > 1 - def.rushEndChance
      ) {
        transitionWork(work, "RUSHED_END", day, events);
        record(
          events,
          "STATE_CHANGED",
          day,
          text("engine.log.forced-rush-end", {
            state_name: name,
            work_title: workTitle(work),
          }),
          work.id,
        );
      }
    }
    if (
      def.newWorkChance &&
      author.startPath &&
      state.works.filter(activeWork).length <
        content.balance.life.maxActiveWorks &&
      rand(state.seed, day, stream.EVENT, 700 + index) < def.newWorkChance
    ) {
      if (
        requestNewWork(
          state,
          content,
          day,
          author.startPath,
          name,
          "system.new-work.state",
        )
      )
        record(
          events,
          "STATE_CHANGED",
          day,
          text("engine.log.new-work-request", { source: name }),
        );
    }
  }
}
