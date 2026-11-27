import { writeFileSync } from "node:fs";
import { createEngine } from "@webbbbbie/engine";
/** Capture a genuine version before changing content. Never relabel an old save. */
const engine = createEngine();
let state = engine.createLife(42);
while (state.day < 30) {
  const work = engine.getPendingNewWork(state);
  if (work)
    state = engine.confirmNewWork(state, work.id, work.defaultPlan).state;
  else if (state.pending)
    state = engine.choose(
      state,
      state.pending.id,
      state.pending.choiceIds[0],
    ).state;
  else state = engine.advance(state, 1).state;
}
const path = process.argv[2];
if (path) writeFileSync(path, engine.serialize(state), { flag: "wx" });
console.log(
  JSON.stringify({
    rulesVersion: state.rulesVersion,
    contentHash: state.contentHash,
    day: state.day,
    path,
  }),
);
