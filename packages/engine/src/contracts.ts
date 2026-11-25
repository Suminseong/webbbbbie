import { companyTraits } from "@webbbbbie/content";
import type { Content } from "@webbbbbie/content";
import type { Contract, ContractRecord, LifeState } from "./model";

export type EditorTrait = {
  id: string;
  name: string;
  pitch: string;
  skill: number;
  interference: number;
  warmth: number;
};

/**
 * Hidden contract-company traits. A company missing from the trait data (for
 * example a custom test fixture) falls back to values derived from its
 * existing honesty, skill and interference so every contract stays playable.
 */
export function traitsOf(content: Content, companyId: string) {
  const company = content.world.companies.find(
    (entry) => entry.id === companyId,
  );
  const data = (
    companyTraits as Record<string, (typeof companyTraits)[string] | undefined>
  )[companyId];
  if (data) return data;
  const honesty = company?.honesty ?? 50;
  return {
    settlementCycle: 30 as const,
    payPunctuality: 0.5 + honesty / 200,
    promoPower: honesty / 100,
    editors: [] as EditorTrait[],
  };
}

/** Editor assigned to a contract, or the company's own traits for old saves. */
export function editorOf(content: Content, contract: Contract) {
  const traits = traitsOf(content, contract.companyId);
  const editor = traits.editors.find((item) => item.id === contract.editorId);
  const company = content.world.companies.find(
    (entry) => entry.id === contract.companyId,
  );
  return {
    editor: editor ?? null,
    skill: editor?.skill ?? company?.skill ?? 50,
    interference: editor?.interference ?? company?.interference ?? 50,
    warmth: editor?.warmth ?? 50,
  };
}

export const blankRecord = (): ContractRecord => ({
  contracts: 0,
  settlements: 0,
  delays: 0,
  lastDelayDay: null,
  promo: "PENDING",
  feedback: 0,
  pressure: 0,
  editorChanges: 0,
});

/** Counts an observation on both the contract and the company's history. */
export function observe(
  state: LifeState,
  contract: Contract,
  key: "settlements" | "delays" | "feedback" | "pressure" | "editorChanges",
) {
  contract.record[key] += 1;
  const history = (state.companyRecords[contract.companyId] ??= blankRecord());
  history[key] += 1;
}
