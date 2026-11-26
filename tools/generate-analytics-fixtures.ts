import { readFileSync, writeFileSync } from "node:fs";
import {
  advance,
  choose,
  createLife,
  deserialize,
  getContractViews,
  getPending,
  getWorkViews,
  serialize,
} from "@webbbbbie/engine";

// Product simulation with the first available choice, including an accepted offer.
let life = createLife(1);
while (life.day < 500 && !getContractViews(life).length) {
  const pending = getPending(life);
  if (pending) {
    const choice = pending.offer
      ? pending.choices.find((item) => item.id === "accept")
      : pending.choices[0];
    if (!choice) throw new Error("Expected an available choice");
    const result = choose(life, pending.id, choice.id);
    if (!result.ok) throw new Error(result.error);
    life = result.state;
  } else {
    life = advance(life, 500 - life.day).state;
  }
}
const contract = getContractViews(life)[0];
const work = getWorkViews(life).find((item) => item.funnel.rows.length >= 5);
if (!contract || !work)
  throw new Error("Expected a contract and chapter history");
const path = new URL("../tests/fixtures/", import.meta.url);
writeFileSync(new URL("save-v0.3.2-analytics.json", path), serialize(life));
writeFileSync(
  new URL("analytics-expected.json", path),
  JSON.stringify(
    {
      contract: {
        company: contract.company,
        title: contract.title,
        promise: contract.promise,
        settlementCycle: contract.settlementCycle,
        editor: contract.editor,
        observed: { promo: contract.observed.promo },
      },
      work: {
        id: work.id,
        funnel: { rows: work.funnel.rows.map(({ reads }) => ({ reads })) },
      },
    },
    null,
    2,
  ) + "\n",
);

// Exercise migrated partial history and the zero/small/over-100% boundaries.
const legacy = deserialize(
  readFileSync(new URL("save-v0.3.0.json", path), "utf8"),
);
if (!legacy.ok) throw new Error(legacy.error);
legacy.state.works[0].chapters = {
  complete: false,
  since: legacy.state.day + 1,
  reads: [0, 0.01, 0.02],
  drops: [0, 0, 0],
};
writeFileSync(
  new URL("save-v0.3.2-partial.json", path),
  serialize(legacy.state),
);
console.log(
  JSON.stringify({
    day: life.day,
    work: work.id,
    chapters: work.funnel.rows.length,
    contract: contract.company,
  }),
);
