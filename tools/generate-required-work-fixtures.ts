import { writeFileSync } from "node:fs";
import {
  createLife,
  advance,
  choose,
  getPending,
  getPendingNewWork,
  confirmNewWork,
  serialize,
} from "@webbbbbie/engine";
const found = new Set<string>();
for (let seed = 1; seed <= 200 && found.size < 2; seed++) {
  let state = createLife(seed);
  while (state.day < 180) {
    const waiting = getPendingNewWork(state);
    if (waiting) {
      const id = state.archive.at(-1)![0];
      if (
        ["forced-multi", "new-title-illness"].includes(id) &&
        !found.has(id)
      ) {
        writeFileSync(
          new URL(`../tests/fixtures/pending-${id}.json`, import.meta.url),
          serialize(state),
        );
        found.add(id);
        console.log(
          JSON.stringify({
            id,
            seed,
            day: state.day,
            choices: "first",
            hash: state.contentHash,
          }),
        );
      }
      const made = confirmNewWork(state, waiting.id, waiting.defaultPlan);
      if (!made.ok) throw new Error(made.reason);
      state = made.state;
    } else {
      const pending = getPending(state);
      if (pending) {
        const next = choose(state, pending.id, pending.choices[0].id);
        if (!next.ok) throw new Error(next.error);
        state = next.state;
      } else state = advance(state, 180 - state.day).state;
    }
  }
}
if (found.size !== 2) throw new Error("Missing reproduction");
