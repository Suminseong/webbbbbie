import type { Content } from "@webbbbbie/content";
import { text } from "@webbbbbie/content";
import { clamp, record, sum, workTitle } from "./author";
import { blankRecord, editorOf, observe, traitsOf } from "./contracts";
import { rand, stream } from "./rng";
import type { EngineEvent, LedgerEntry, LifeState, Work } from "./model";

export function transaction(
  state: LifeState,
  day: number,
  kind: LedgerEntry["kind"],
  amount: number,
  ref: string,
  workId: string | null = null,
) {
  if (!amount) return;
  state.ledgerSeq += 1;
  state.ledger.push({
    id: "TX-" + day + "-" + state.ledgerSeq,
    day,
    kind,
    amount,
    workId,
    ref,
  });
  state.author.cash += amount;
}

/**
 * Rolls ledger entries older than the retention window into per-kind totals.
 * Cash stays equal to the starting cash plus carry plus retained entries, and
 * per-work settlement totals remain in each work's revenue record.
 */
export function compactLedger(state: LifeState, content: Content, day: number) {
  const horizon = day - content.balance.economy.ledgerKeepDays;
  if (!state.ledger.length || state.ledger[0].day >= horizon) return;
  const keep = state.ledger.findIndex((entry) => entry.day >= horizon);
  const old = keep < 0 ? state.ledger : state.ledger.slice(0, keep);
  for (const entry of old)
    state.ledgerCarry[entry.kind] =
      (state.ledgerCarry[entry.kind] ?? 0) + entry.amount;
  state.ledger = keep < 0 ? [] : state.ledger.slice(keep);
}

/**
 * Formats won amounts in log messages with comma grouping (13,048), matching
 * the screen. Locale-independent so saved logs stay identical on every runtime.
 */
export function groupDigits(value: number) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function activeContract(state: LifeState, work: Work, day: number) {
  return state.contracts.find(
    (contract) =>
      contract.id === work.contractId &&
      contract.status === "ACTIVE" &&
      day <= contract.expiresDay,
  );
}

export function updateContracts(
  state: LifeState,
  content: Content,
  day: number,
  events: EngineEvent[],
) {
  for (const contract of state.contracts) {
    if (contract.status !== "ACTIVE") continue;
    const work = state.works.find(
      (candidate) => candidate.id === contract.workId,
    )!;
    if (work.status === "TAKEN_DOWN" || contract.expiresDay < day) {
      contract.status = work.status === "TAKEN_DOWN" ? "TERMINATED" : "EXPIRED";
      record(
        events,
        "STATE_CHANGED",
        day,
        text(
          contract.status === "EXPIRED"
            ? "engine.log.contract-expired"
            : "engine.log.contract-ended",
          {
            work_title: workTitle(work),
          },
        ),
        work.id,
      );
      continue;
    }
    const traits = traitsOf(content, contract.companyId);
    const { skill, interference, warmth } = editorOf(content, contract);
    if (day === contract.promotionStart) {
      const honored = traits.promoPower >= 0.5;
      contract.record.promo = honored ? "KEPT" : "DELAYED";
      const history = (state.companyRecords[contract.companyId] ??=
        blankRecord());
      history.promo = honored ? "KEPT" : "DELAYED";
      record(
        events,
        "STATE_CHANGED",
        day,
        text(
          honored
            ? "engine.log.promotion-started"
            : "engine.log.promotion-delayed",
          {
            work_title: workTitle(work),
          },
        ),
        work.id,
      );
    }
    // A warmer editor checks in more often; the outcome depends on the
    // editor's hidden skill and interference (observed, never listed).
    const interval = 8 + Math.round((100 - warmth) / 12);
    const age = day - contract.signedDay;
    if (age > 0 && age % interval === 0) {
      if (interference >= 65) {
        state.author.condition.stress = clamp(
          state.author.condition.stress + 2,
        );
        observe(state, contract, "pressure");
        record(
          events,
          "STATE_CHANGED",
          day,
          text("engine.log.editor-pressure", {
            work_title: workTitle(work),
          }),
          work.id,
        );
      } else if (skill >= 60) {
        work.quality = clamp(work.quality + 1.5);
        if (warmth >= 70)
          state.author.condition.drive = clamp(
            state.author.condition.drive + 1,
          );
        observe(state, contract, "feedback");
        record(
          events,
          "STATE_CHANGED",
          day,
          text("engine.log.editor-feedback", {
            work_title: workTitle(work),
          }),
          work.id,
        );
      }
    }
  }
}

export function accrue(
  state: LifeState,
  work: Work,
  day: number,
  views: number,
  paidViews: number,
  content: Content,
) {
  const { economy } = content.balance;
  const platform = content.platforms.find(
    (candidate) => candidate.id === work.platformId,
  )!;
  const terms = activeContract(state, work, day);
  const revenue =
    platform.model === "SUBSCRIPTION"
      ? views *
        economy.subscriptionWon *
        (terms ? terms.share / economy.authorShare : 1)
      : paidViews *
        economy.purchaseRate *
        economy.chapterPrice *
        (terms?.share ?? economy.authorShare);
  const earned = Math.floor(revenue);
  work.revenue.accrued += earned;
  return earned;
}

export function settle(
  state: LifeState,
  content: Content,
  day: number,
  events: EngineEvent[],
) {
  if (day % content.balance.economy.settlementDays !== 0) return;
  const job = content.world.jobs.find(
    (candidate) => candidate.id === state.author.jobId,
  )!;
  transaction(state, day, "SALARY", job.income, job.id);
  transaction(
    state,
    day,
    "LIVING",
    -Math.floor(
      content.balance.economy.livingExpense * state.author.home.expense,
    ),
    "living",
  );
  const spent = Math.floor(state.author.spendAccrued);
  state.author.spendAccrued -= spent;
  transaction(state, day, "SPEND", -spent, "spending");
  for (const [index, work] of state.works.entries()) {
    if (work.status === "TAKEN_DOWN") continue;
    const payout = work.revenue.accrued - work.revenue.paid;
    if (payout <= 0) continue;
    const contract = activeContract(state, work, day);
    if (contract) {
      // A contract pays on its own public cycle; an unpunctual company
      // (hidden) may postpone one payout but never two in a row.
      const months = Math.max(1, Math.round(contract.settlementCycle / 30));
      const month = Math.round(day / content.balance.economy.settlementDays);
      const postponed =
        contract.record.lastDelayDay ===
        day - content.balance.economy.settlementDays;
      if (!postponed && month % months !== 0) continue;
      const { payPunctuality } = traitsOf(content, contract.companyId);
      const late =
        !postponed &&
        rand(state.seed, day, stream.ECONOMY, 60 + index) > payPunctuality;
      if (late) {
        contract.record.lastDelayDay = day;
        observe(state, contract, "delays");
        record(
          events,
          "STATE_CHANGED",
          day,
          text("engine.log.payout-delayed", { work_title: workTitle(work) }),
          work.id,
        );
        continue;
      }
      observe(state, contract, "settlements");
    }
    work.revenue.paid += payout;
    transaction(state, day, "PAYOUT", payout, "settlement:" + work.id, work.id);
    record(
      events,
      "PAYOUT",
      day,
      text("engine.log.payout", {
        work_title: workTitle(work),
        amount: groupDigits(payout),
      }),
      work.id,
    );
  }
}

export function updateDemand(state: LifeState) {
  const social = state.author.social;
  const recentAudience = sum(state.works.map((work) => work.stats.newReaders));
  const favorites = sum(state.works.map((work) => work.stats.favorites));
  social.demand = clamp(
    (social.reputation - 25) * 0.18 +
      social.completionTrust * 0.4 +
      social.recognition * 0.32 +
      Math.sqrt(recentAudience) * 0.42 +
      Math.sqrt(favorites) * 0.31,
  );
}
