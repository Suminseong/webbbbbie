import type { Content } from "@webbbbbie/content";
import { displayWorkTitle, text } from "@webbbbbie/content";
import { clamp, record, sum } from "./author";
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
  state.ledger.push({
    id: "TX-" + day + "-" + (state.ledger.length + 1),
    day,
    kind,
    amount,
    workId,
    ref,
  });
  state.author.cash += amount;
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
            work_title: displayWorkTitle(work.title),
          },
        ),
        work.id,
      );
      continue;
    }
    const company = content.world.companies.find(
      (candidate) => candidate.id === contract.companyId,
    )!;
    if (day === contract.promotionStart) {
      const honored = company.honesty >= 45;
      record(
        events,
        "STATE_CHANGED",
        day,
        text(
          honored
            ? "engine.log.promotion-started"
            : "engine.log.promotion-delayed",
          {
            work_title: displayWorkTitle(work.title),
          },
        ),
        work.id,
      );
    }
    if (day - contract.signedDay > 0 && (day - contract.signedDay) % 12 === 0) {
      if (company.interference >= 65) {
        state.author.condition.stress = clamp(
          state.author.condition.stress + 2,
        );
        record(
          events,
          "STATE_CHANGED",
          day,
          text("engine.log.editor-pressure", {
            work_title: displayWorkTitle(work.title),
          }),
          work.id,
        );
      } else if (company.skill >= 60) {
        work.quality = clamp(work.quality + 1.5);
        record(
          events,
          "STATE_CHANGED",
          day,
          text("engine.log.editor-feedback", {
            work_title: displayWorkTitle(work.title),
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
  for (const work of state.works) {
    if (work.status === "TAKEN_DOWN") continue;
    const payout = work.revenue.accrued - work.revenue.paid;
    if (payout <= 0) continue;
    work.revenue.paid += payout;
    transaction(state, day, "PAYOUT", payout, "settlement:" + work.id, work.id);
    record(
      events,
      "PAYOUT",
      day,
      text("engine.log.payout", {
        work_title: displayWorkTitle(work.title),
        amount: payout,
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
