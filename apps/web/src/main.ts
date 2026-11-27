import { text } from "@webbbbbie/content";
import type { TextVariables } from "@webbbbbie/content";
import "./style.css";
import {
  abilityNames,
  advance,
  confirmNewWork,
  getPendingNewWork,
  cadences,
  choose,
  conditionNames,
  createLife,
  deserialize,
  dropWork,
  extraWrite,
  getAptitudeView,
  getAuthorView,
  getContractViews,
  getDailySummary,
  getEventLog,
  getLedgerView,
  getLifeSettings,
  getLifeSummary,
  getPending,
  getPlanOptions,
  getWorkViews,
  hiatusWork,
  ledgerNames,
  planWork,
  prepareEnding,
  purchase,
  resumeWork,
  retire,
  reviseWork,
  rushWork,
  serialize,
  setAutoPlan,
  setSpendPolicy,
  setTimePolicy,
  setWorkPolicy,
} from "@webbbbbie/engine";
import type { LifeState, SpendPolicy, TimePolicy } from "@webbbbbie/engine";
import { getSlots, putSlot, slotIds } from "./storage";
import type { SavedLife, SlotId } from "./storage";

const app = document.querySelector<HTMLDivElement>("#app")!;
const number = new Intl.NumberFormat("ko-KR");
const count = (amount: number) => number.format(Math.floor(amount));
const won = (amount: number) =>
  text("ui.format.won", { amount: count(amount) });
const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escape = (value: string | number) =>
  String(value).replace(/[&<>"']/g, (glyph) => entities[glyph]);
const ui = (id: string, variables?: TextVariables) =>
  escape(text(id, variables));
document.title = text("ui.app.title");
document.querySelector<HTMLMetaElement>('meta[name="description"]')!.content =
  text("ui.app.description");
const tabs = [
  ["works", text("ui.tab.works")],
  ["life", text("ui.tab.life")],
  ["log", text("ui.tab.log")],
  ["aptitude", text("ui.tab.aptitude")],
  ["contracts", text("ui.tab.contracts")],
  ["money", text("ui.tab.money")],
  ["save", text("ui.tab.save")],
] as const;
type Tab = (typeof tabs)[number][0];
const speeds = [
  [1, text("ui.clock.speed-value", { speed: 1 }), 900],
  [2, text("ui.clock.speed-value", { speed: 2 }), 450],
  [5, text("ui.clock.speed-value", { speed: 5 }), 180],
  [10, text("ui.clock.speed-value", { speed: 10 }), 90],
] as const;
const saveErrors = {
  E_SAVE_CORRUPT: text("system.save.corrupt"),
  E_SAVE_VERSION: text("system.save.version"),
};

let state: LifeState = createLife(42);
let tab: Tab = "works";
let speed = 1;
let timer: number | undefined;
let resumeAfterChoice = false;
let revision = 0;
let slots: Partial<Record<SlotId, SavedLife>> = {};
let seedDraft = "42";
let selectedWork: string | null = null;
const journalFilters = new Map<string, string>();
let storageAvailable = true;
type PlanDraft = {
  editing: string | null;
  title: string;
  genre: string;
  material: string;
  tags: string[];
  platformId: string;
  perWeek: number;
};
let planDraft: PlanDraft | null = null;
let confirmDrop: string | null = null;
let confirmRetire = false;
let dirty = false;
let requiredWorkId: string | null = null;

app.innerHTML = `
<header class="top">
  <div class="top-inner">
    <a class="brand" href="./" aria-label="${ui("ui.header.home")}"><span class="brand-mark" aria-hidden="true">ㅈ</span><span>${ui("ui.app.title")}</span></a>
    <form id="new-life" class="new-life">
      <label for="seed">${ui("ui.header.seed")}</label>
      <input name="seed" id="seed" aria-label="${ui("ui.header.seed")}" type="number" min="0" max="4294967295" step="1" required value="42">
      <button type="submit" class="small">${ui("ui.header.new-life")}</button>
      <button type="button" data-action="random" class="icon" aria-label="${ui("ui.header.random-seed")}">↻</button>
    </form>
  </div>
</header>
<main id="game" class="shell"></main>
<input id="import-file" type="file" accept=".json,application/json" hidden>
<div id="feedback" class="feedback" role="status" hidden></div>`;
app.insertAdjacentHTML(
  "beforeend",
  `<dialog id="required-work" role="dialog" aria-modal="true" aria-labelledby="required-work-title" aria-describedby="required-work-reason"></dialog>`,
);
const requiredDialog =
  document.querySelector<HTMLDialogElement>("#required-work")!;
requiredDialog.addEventListener("cancel", (event) => event.preventDefault());
requiredDialog.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const inputs = Array.from(
    requiredDialog.querySelectorAll<HTMLElement>(
      "input:not(:disabled), select:not(:disabled), button:not(:disabled)",
    ),
  );
  const first = inputs[0],
    last = inputs[inputs.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
});
const game = document.querySelector<HTMLElement>("#game")!;
const feedback = document.querySelector<HTMLElement>("#feedback")!;
const seedInput = document.querySelector<HTMLInputElement>("#seed")!;
const fileInput = document.querySelector<HTMLInputElement>("#import-file")!;

function feedbackText(text: string) {
  feedback.textContent = text;
  feedback.hidden = !text;
}

function renderAuthor(author: ReturnType<typeof getAuthorView>) {
  return `<aside class="author panel">
    <div class="section-label">${ui("ui.author.heading")}</div>
    <h2>${escape(author.penName)}</h2>
    <p class="small-muted">${ui("ui.author.profile", { age: author.age, job: author.job, home: author.home })}</p>
    <p class="motive">“${escape(author.motive)}”</p>
    <dl class="conditions">${Object.entries(author.condition)
      .map(
        ([key, value]) => `
      <div class="meter-row">
        <dt>${escape(conditionNames[key as keyof typeof conditionNames])}</dt><dd>${count(value)}</dd>
        <div class="meter ${key}" aria-hidden="true"><i style="width:${value}%"></i></div>
      </div>`,
      )
      .join("")}</dl>
    ${
      author.states.length
        ? `<ul class="state-list" aria-label="${ui("ui.state.heading")}">${author.states
            .map(
              (item) => `<li><strong>${escape(item.name)}</strong>
          <span class="small-muted">${ui("ui.state.since", { days: item.days })}${item.cause ? " · " + ui("ui.state.cause", { cause: item.cause }) : ""}</span>
          ${item.hint ? `<p class="small-muted">${escape(item.hint)}</p>` : ""}</li>`,
            )
            .join("")}</ul>`
        : ""
    }
    <dl class="skills money-skills">
      <div><dt>${ui("ui.author.cash")}</dt><dd>${escape(won(author.cash))}</dd></div>
      <div><dt>${ui("ui.author.pending-income")}</dt><dd>${escape(won(author.pendingIncome))}</dd></div>
      <div><dt>${ui("ui.author.spend-due")}</dt><dd>${escape(won(author.spendDue))}</dd></div>
    </dl>
    <div class="line"></div>
    <dl class="skills">${Object.entries(author.abilities)
      .map(
        ([key, value]) =>
          `<div><dt>${escape(abilityNames[key as keyof typeof abilityNames])}</dt><dd>${count(value)}</dd></div>`,
      )
      .join("")}</dl>
    <div class="line"></div>
    <dl class="skills">
      <div><dt>${ui("ui.author.recognition")}</dt><dd>${count(author.social.recognition)}</dd></div>
      <div><dt>${ui("ui.author.reputation")}</dt><dd>${count(author.social.reputation)}</dd></div>
      <div><dt>${ui("ui.author.completion-trust")}</dt><dd>${count(author.social.completionTrust)}</dd></div>
      <div><dt>${ui("ui.author.demand")}</dt><dd>${count(author.social.demand)}</dd></div>
    </dl>
  </aside>`;
}

function renderClock(author: ReturnType<typeof getAuthorView>) {
  const pending = getPending(state);
  const label = pending
    ? ui("ui.clock.waiting")
    : author.phase === "ENDED"
      ? ui("ui.clock.ended")
      : timer
        ? ui("ui.clock.running")
        : ui("ui.clock.paused");
  return `<div class="clock">
    <div class="clock-date"><span class="section-label">${ui("ui.clock.life")}</span><h1>${author.day}<span>${ui("ui.clock.day-unit")}</span></h1></div>
    <div class="clock-actions">
      <span class="phase ${pending ? "waiting" : ""}" data-testid="phase">${escape(label)}</span>
      <button data-action="step" ${pending || author.phase === "ENDED" ? "disabled" : ""}>${ui("ui.clock.step")}</button>
      <button class="primary" data-action="play" ${pending || author.phase === "ENDED" ? "disabled" : ""}>${ui(timer ? "ui.clock.paused" : "ui.clock.play")}</button>
      <label class="speed"><span>${ui("ui.clock.speed")}</span><select id="speed" aria-label="${ui("ui.clock.speed-label")}">
        ${speeds.map(([value, text]) => `<option value="${value}" ${speed === value ? "selected" : ""}>${escape(text)}</option>`).join("")}
      </select></label>
    </div>
  </div>`;
}

function renderCurrentEvent() {
  if (getAuthorView(state).phase === "ENDED") return renderSummary();
  const pending = getPending(state);
  if (pending)
    return `<section class="decision panel" aria-labelledby="event-title">
    <div class="section-label">${ui("ui.event.decision", { day: pending.day })}</div>
    <h2 id="event-title">${escape(pending.title)}</h2>
    <p>${escape(pending.text)}${pending.target ? " · " + escape(pending.target) : ""}</p>
    ${
      pending.offer
        ? `<dl class="offer">
      <div><dt>${ui("ui.offer.company")}</dt><dd>${escape(pending.offer.name)}</dd></div>
      <div><dt>${ui("ui.offer.share")}</dt><dd>${count(pending.offer.share * 100)}%</dd></div>
      <div><dt>${ui("ui.offer.advance")}</dt><dd>${escape(won(pending.offer.advance))}</dd></div>
      <div><dt>${ui("ui.offer.duration")}</dt><dd>${ui("ui.offer.duration-value", { days: pending.offer.duration })}</dd></div>
      <div><dt>${ui("ui.offer.promise")}</dt><dd>${escape(pending.offer.promise)}</dd></div>
      <div><dt>${ui("ui.offer.cycle")}</dt><dd>${ui("ui.offer.cycle-value", { days: pending.offer.settlementCycle })}</dd></div>
      <div><dt>${ui("ui.offer.editor")}</dt><dd>${pending.offer.editor ? ui("ui.offer.editor-value", { name: pending.offer.editor.name, pitch: pending.offer.editor.pitch }) : ui("ui.offer.editor-none")}</dd></div>
      <div><dt>${ui("ui.offer.history")}</dt><dd>${
        pending.offer.history
          ? ui("ui.offer.history-value", {
              contracts: pending.offer.history.contracts,
              settlements: pending.offer.history.settlements,
              delays: pending.offer.history.delays,
              promo: pending.offer.history.promo,
            })
          : ui("ui.offer.history-none")
      }</dd></div>
    </dl>
    <p class="small-muted">${ui("ui.offer.hidden-note")}</p>`
        : ""
    }
    <div class="event-options">${pending.choices
      .map(
        (choice) => `
      <button class="choice" data-action="choose" data-event="${escape(pending.id)}" data-choice="${escape(choice.id)}">
        ${escape(choice.label)}<span aria-hidden="true">→</span>
      </button>`,
      )
      .join("")}</div>
  </section>`;
  const day = getDailySummary(state);
  return day
    ? `<section class="today panel" aria-label="${ui("ui.today.heading")}">
     <div><span class="section-label">${ui("ui.today.event", { day: day.day })}</span><h2>${escape(day.eventTitle)}</h2></div>
     <dl><div><dt>${ui("ui.today.posted")}</dt><dd>${ui("ui.format.chapter", { count: day.posted })}</dd></div><div><dt>${ui("ui.today.new-readers")}</dt><dd>${ui("ui.format.reader", { count: count(day.newReaders) })}</dd></div>
     <div><dt>${ui("ui.today.income")}</dt><dd>${escape(won(day.gained))}</dd></div></dl>
  </section>`
    : `<section class="today panel"><div><span class="section-label">${ui("ui.today.day-zero")}</span><h2>${ui("ui.today.first-draft")}</h2></div></section>`;
}

function workPanel(
  work: ReturnType<typeof getWorkViews>[number],
  expanded: boolean,
) {
  const isClosed = !!work.end;
  return `<article class="work-card panel" data-work="${escape(work.id)}">
    <div class="work-head">
      <div><div class="work-sub">${escape(work.platform)} <span>· ${escape(work.model)}</span></div><h3>${escape(work.title)}</h3></div>
      <span class="work-status ${isClosed || work.status === "HIATUS" ? "muted" : ""}">${escape(work.statusLabel)}${work.hiatusKind ? " · " + ui(work.hiatusKind === "STOCK" ? "ui.work.hiatus-stock" : "ui.work.hiatus-recover") : ""}${work.rush ? " · " + ui("ui.work.rush-badge", { days: work.rush }) : ""}</span>
    </div>
    <p class="tags">${escape(work.genre)} · ${escape(work.material)} ${work.tags.map((tag) => " <span>#" + escape(tag) + "</span>").join("")}</p>
    <dl class="work-stats">
      <div><dt>${ui("ui.work.chapter-progress")}</dt><dd>${ui("ui.work.chapter-progress-value", { published: work.published, target: work.target })}</dd></div>
      <div><dt>${ui("ui.work.stock")}</dt><dd>${ui("ui.format.chapter", { count: work.stock.toFixed(1) })}</dd></div>
      <div><dt>${ui("ui.work.new-readers")}</dt><dd>${ui("ui.format.reader", { count: count(work.newReaders) })}</dd></div>
      <div><dt>${ui("ui.work.views")}</dt><dd>${count(work.views)}</dd></div>
      <div><dt>${ui("ui.work.favorites")}</dt><dd>${count(work.favorites)}</dd></div>
      <div><dt>${ui("ui.work.income")}</dt><dd>${escape(won(work.accrued))}</dd></div>
    </dl>
    <button class="details-toggle" data-action="work" data-work-id="${escape(work.id)}" aria-expanded="${expanded}">${ui(expanded ? "ui.work.details-close" : "ui.work.details-open")} <span aria-hidden="true">${expanded ? "−" : "+"}</span></button>
    ${
      expanded
        ? `<div class="work-details">
      <dl class="work-extra">
        <div><dt>${ui("ui.work.duration")}</dt><dd>${ui("ui.work.duration-value", { start: work.startDay, days: work.duration })}</dd></div>
        <div><dt>${ui("ui.work.paid-reads")}</dt><dd>${work.detail.paidReads === null ? "–" : fraction(work.detail.paidReads)}</dd></div>
        <div><dt>${ui("ui.work.settlement")}</dt><dd>${work.latestSettlement ? ui("ui.work.settlement-value", { day: work.latestSettlement.day, amount: won(work.latestSettlement.amount) }) : ui("ui.work.settlement-empty")}</dd></div>
        <div><dt>${ui("ui.work.exposure")}</dt><dd>${work.exposure.length ? escape(work.exposure.join(", ")) : ui("ui.work.exposure-none")}</dd></div>
        <div><dt>${ui("ui.work.stability")}</dt><dd>${work.detail.stability === null ? "–" : ui("ui.work.stability-value", { percent: fraction(work.detail.stability * 100), kept: work.detail.fulfilled, due: work.detail.expected })}</dd></div>
        <div><dt>${ui("ui.work.total-views")}</dt><dd>${count(work.totalViews)}</dd></div>
        <div><dt>${ui("ui.work.latest-views")}</dt><dd>${count(work.latestViews)}</dd></div>
        <div><dt>${ui("ui.work.lost")}</dt><dd>${ui("ui.format.reader", { count: count(work.lost) })}</dd></div>
        <div><dt>${ui("ui.work.paid")}</dt><dd>${escape(won(work.paid))}</dd></div>
        <div><dt>${ui("ui.work.first-views")}</dt><dd>${work.funnel.firstReads === null ? "–" : fraction(work.funnel.firstReads)}</dd></div>
        <div><dt>${ui("ui.work.active-readers")}</dt><dd>${count(work.activeReaders)}</dd></div>
        <div><dt>${ui("ui.work.retention")}</dt><dd>${count(work.latestPerInflow * 100)}%</dd></div>
        <div><dt>${ui("ui.work.trend-7")}</dt><dd>${ui("ui.work.trend-value", { views: count(work.trend.d7.views), readers: count(work.trend.d7.newReaders) })}</dd></div>
        <div><dt>${ui("ui.work.trend-14")}</dt><dd>${ui("ui.work.trend-value", { views: count(work.trend.d14.views), readers: count(work.trend.d14.newReaders) })}</dd></div>
        <div><dt>${ui("ui.work.trend-30")}</dt><dd>${ui("ui.work.trend-value", { views: count(work.trend.d30.views), readers: count(work.trend.d30.newReaders) })}</dd></div>
        <div><dt>${ui("ui.work.prep")}</dt><dd>${work.prep}</dd></div>
        <div><dt>${ui("ui.work.consistency")}</dt><dd>${work.consistency}</dd></div>
        <div><dt>${ui("ui.work.attachment")}</dt><dd>${work.attachment}</dd></div>
        <div><dt>${ui("ui.work.quality")}</dt><dd>${count(work.quality)}</dd></div>
      </dl>
      ${renderSpark(work.history)}
      ${work.detail.partial ? `<p class="small-muted">${ui("ui.work.detail-partial", { day: work.detail.since ?? state.day + 1 })}</p>` : ""}
      <h4>${ui("ui.work.quality-trend")}</h4>
      ${work.detail.history.length ? `<div class="spark" role="img" aria-label="${ui("ui.work.quality-trend")}">${work.detail.history.map((row) => `<i style="height:${row.quality}%" title="${ui("ui.work.quality-point", { day: row.day, quality: fraction(row.quality) })}"></i>`).join("")}</div><p class="small-muted">${ui("ui.work.quality-range", { first: fraction(work.detail.history[0].quality), last: fraction(work.detail.history.at(-1)!.quality) })}</p>` : `<p class="small-muted">${ui("ui.work.detail-empty")}</p>`}
      ${renderFunnel(work.funnel)}
      ${work.end ? "" : workCommands(work)}
      ${renderWorkJournal(work)}
      ${work.end ? `<p class="small-muted">${ui("ui.work.ending", { day: work.end.day, reason: work.end.reason, chapters: work.end.chapters, favorites: count(work.end.favorites) })}</p>` : ""}
      ${work.missedReason ? `<p class="small-muted">${ui("ui.work.missed", { reason: text(work.missedReason === "HIATUS" ? "ui.work.miss-hiatus" : "ui.work.miss-stock") })}</p>` : ""}
      <div class="breakdown"><div><h4>${ui("ui.work.source-title")}</h4>
        ${
          work.sources
            .filter((source) => source.count > 0)
            .map(
              (source) =>
                `<div class="source-row"><span>${escape(source.label)}</span><i style="width:${source.share * 100}%"></i><b>${fraction(source.share * 100)}%</b></div>`,
            )
            .join("") ||
          `<p class="small-muted">${ui("ui.work.source-empty")}</p>`
        }
      </div><div><h4>${ui("ui.work.age-title")}</h4>
        ${work.newByAge.map((age) => `<div class="age-row"><span>${escape(age.label)}</span><b>${fraction(age.share * 100)}%</b></div>`).join("")}
      </div></div>
    </div>`
        : ""
    }
  </article>`;
}

function renderWorkJournal(work: ReturnType<typeof getWorkViews>[number]) {
  const filter = journalFilters.get(work.id) ?? "all";
  const types: Record<string, string[]> = {
    events: ["EFFECT_APPLIED"],
    status: ["WORK_STATUS_CHANGED"],
    commands: ["COMMAND", "WORK_ORDER"],
    settlement: ["PAYOUT"],
    exposure: ["WORK_EXPOSURE"],
  };
  const rows = work.journal.filter(
    (row) => filter === "all" || types[filter]?.includes(row.type),
  );
  return `<section class="work-journal"><h4>${ui("ui.work.journal")}</h4><label>${ui("ui.work.journal-filter")}<select data-journal="${escape(work.id)}">${["all", ...Object.keys(types)].map((key) => `<option value="${key}" ${filter === key ? "selected" : ""}>${ui("ui.work.journal-" + key)}</option>`).join("")}</select></label><p class="small-muted">${ui("ui.work.journal-summary", { count: rows.length })}</p><ol class="journal-rows">${rows
    .slice()
    .reverse()
    .map(
      (row) =>
        `<li>${ui("ui.format.day", { day: row.day })} · ${escape(row.message)}</li>`,
    )
    .join("")}</ol></section>`;
}

function renderSpark(history: { day: number; views: number }[]) {
  if (history.length < 2) return "";
  const top = Math.max(1, ...history.map((item) => item.views));
  return `<div class="spark" role="img" aria-label="${ui("ui.work.spark-label", { days: history.length })}">${history
    .map(
      (item) =>
        `<i style="height:${Math.max(2, (item.views / top) * 100)}%" title="${ui("ui.format.day", { day: item.day })} · ${count(item.views)}"></i>`,
    )
    .join("")}</div>`;
}

/** The aggregate chapter log retains expected counts to two decimal places. */
const fraction = (amount: number) =>
  new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
  }).format(amount);

function renderFunnel(
  funnel: ReturnType<typeof getWorkViews>[number]["funnel"],
) {
  const rowText = (row: (typeof funnel.rows)[number]) => {
    const rate =
      row.chapter === 1
        ? text("ui.work.funnel-rate-none")
        : row.rate === null
          ? text("ui.work.funnel-rate-unknown")
          : text("ui.work.funnel-rate", {
              percent: fraction(row.rate * 100),
              reads: fraction(row.reads),
              previous: fraction(row.previous ?? 0),
            });
    return ui("ui.work.funnel-row", {
      chapter: row.chapter,
      reads: fraction(row.reads),
      drops: fraction(row.drops),
      rate,
    });
  };
  const rows = funnel.rows.map((row) => `<li>${rowText(row)}</li>`).join("");
  const maxReads = Math.max(0, ...funnel.rows.map((row) => row.reads));
  const chart = funnel.rows
    .map((row, index) => {
      const label = rowText(row);
      const showChapter =
        index === 0 ||
        index === funnel.rows.length - 1 ||
        row.chapter % 5 === 0;
      const height = maxReads ? (row.reads / maxReads) * 100 : 0;
      return `<div class="chapter-bar" data-chapter="${row.chapter}" title="${label}"><div class="chapter-bar-track"><i style="height:${height}%"></i></div><span>${showChapter ? row.chapter : ""}</span></div>`;
    })
    .join("");
  return `<div class="funnel"><h4>${ui("ui.work.funnel-title")}</h4>
    <p><strong>${ui(funnel.partial ? "ui.work.funnel-first-partial" : "ui.work.funnel-first")}</strong> ${funnel.firstReads === null ? ui("ui.work.funnel-first-unknown") : fraction(funnel.firstReads)}</p>
    ${funnel.partial && funnel.since !== null ? `<p class="small-muted">${ui("ui.work.funnel-partial", { day: funnel.since })}</p>` : ""}
    ${
      funnel.known
        ? `<figure class="chapter-chart"><figcaption><strong>${ui("ui.work.chart-heading")}</strong><span>${ui("ui.work.chart-scale", { count: fraction(maxReads) })}</span></figcaption>
          <div class="chapter-chart-scroll" role="region" aria-label="${ui("ui.work.chart-scroll")}" tabindex="0"><div class="chapter-bars" aria-hidden="true" style="width:max(100%, ${funnel.rows.length * 24}px)">${chart}</div></div>
          <p class="small-muted">${ui("ui.work.chart-note")}</p></figure>
          <p class="small-muted">${ui("ui.work.funnel-note")}</p><p class="small-muted">${ui("ui.work.funnel-over-100")}</p><ol class="funnel-rows">${rows}</ol>`
        : `<p class="small-muted">${ui("ui.work.funnel-empty")}</p>`
    }
  </div>`;
}

function contractPanel(contract: ReturnType<typeof getContractViews>[number]) {
  const observed = contract.observed;
  const times = (value: number) =>
    ui("ui.format.times", { count: count(value) });
  const item = (label: string, value: string) =>
    `<div><dt>${ui(label)}</dt><dd>${value}</dd></div>`;
  return `<article class="contract-card panel">
    <header class="contract-head"><div><span class="section-label">${ui("ui.offer.company")}</span><h3>${escape(contract.company)}</h3><p>${escape(contract.title)}</p></div>
      <span class="contract-status ${contract.status === "ACTIVE" ? "" : "muted"}">${ui(contract.status === "ACTIVE" ? "ui.contract.active" : contract.status === "EXPIRED" ? "ui.contract.expired" : "ui.contract.terminated")}</span></header>
    <dl class="contract-terms">
      ${item("ui.offer.share", `${count(contract.share * 100)}%`)}
      ${item("ui.offer.advance", escape(won(contract.advance)))}
      ${item("ui.offer.cycle", ui("ui.offer.cycle-value", { days: contract.settlementCycle }))}
      ${item("ui.offer.duration", ui("ui.contract.period-value", { start: contract.signedDay, end: contract.expiresDay }))}
    </dl>
    <div class="contract-people"><div><span class="small-muted">${ui("ui.offer.editor")}</span>${contract.editor ? `<strong>${escape(contract.editor.name)}</strong><p>${escape(contract.editor.pitch)}</p>` : `<strong>${ui("ui.contract.editor-value-unknown")}</strong>`}</div>
      <div><span class="small-muted">${ui("ui.offer.promise")}</span><strong>${escape(contract.promise)}</strong></div></div>
    <div class="contract-record"><h4>${ui("ui.contract.record-heading")}</h4><dl>
      ${item("ui.contract.record-settlements", times(observed.settlements))}
      ${item("ui.contract.record-delays", times(observed.delays))}
      ${item("ui.contract.record-promo", escape(observed.promo))}
      ${item("ui.contract.record-feedback", times(observed.feedback))}
      ${item("ui.contract.record-pressure", times(observed.pressure))}
      ${item("ui.contract.record-changes", times(observed.editorChanges))}
    </dl></div>
  </article>`;
}

const cadenceOptions = (selected: number) =>
  cadences
    .map(
      (item) =>
        `<option value="${item.perWeek}" ${item.perWeek === selected ? "selected" : ""}>${ui("ui.plan.cadence-value", { count: item.perWeek })}</option>`,
    )
    .join("");

function workCommands(work: ReturnType<typeof getWorkViews>[number]) {
  const id = escape(work.id);
  if (getPending(state))
    return `<p class="notice">${ui("system.command.choice-pending")}</p>`;
  if (confirmDrop === work.id)
    return `<div class="work-commands"><p>${ui("ui.cmd.drop-confirm", { title: work.title })}</p>
      <p>${ui("ui.cmd.drop-impact", { status: work.statusLabel, stock: work.stock.toFixed(1), contract: text(work.contractId ? "ui.cmd.contract-yes" : "ui.cmd.contract-no") })}</p>
      <button class="danger" data-action="drop-yes" data-work-id="${id}">${ui("ui.cmd.drop-yes")}</button>
      <button data-action="drop-no">${ui("ui.cmd.drop-no")}</button></div>`;
  return `<div class="work-commands" data-commands="${id}">
    <h4>${ui("ui.cmd.heading")}</h4>
    <p class="small-muted">${ui("ui.cmd.extra-cost")}</p>
    <p class="small-muted">${ui("ui.cmd.policy-cost")}</p>
    ${work.canPrepareEnding ? `<div class="cmd-row"><label>${ui("ui.cmd.ending-remaining")}<input data-field="ending-remaining" type="number" min="${Math.max(1, Math.ceil(work.stock))}" max="${getPlanOptions().endingMaxRemaining}" value="${Math.min(getPlanOptions().endingMaxRemaining, Math.max(1, Math.ceil(work.stock), Math.min(20, work.target - work.published)))}"></label><button data-action="prepare-ending" data-work-id="${id}">${ui("ui.cmd.prepare-ending")}</button></div><p class="small-muted">${ui("ui.cmd.ending-cost", { max: getPlanOptions().endingMaxRemaining, weight: getPlanOptions().endingPlotWeight })}${work.endingTarget === null ? "" : " " + ui("ui.cmd.ending-target", { chapter: work.endingTarget })}</p>` : ""}
    ${(() => {
      const outcomes = getEventLog(state)
        .filter(
          (event) => event.type === "WORK_ORDER" && event.workId === work.id,
        )
        .slice(-3);
      return outcomes.length
        ? `<div class="small-muted"><strong>${ui("ui.cmd.order-results")}</strong><ul>${outcomes.map((event) => `<li>${escape(event.message)}</li>`).join("")}</ul></div>`
        : "";
    })()}
    <div class="cmd-row">
      ${
        work.canRush
          ? `<label>${ui("ui.cmd.rush-days")}<select data-field="rush">${[1, 2, 3].map((day) => `<option value="${day}" ${day === (work.rush || 1) ? "selected" : ""}>${ui("ui.cmd.days-value", { days: day })}</option>`).join("")}</select></label>
      <button data-action="rush" data-work-id="${id}">${ui("ui.cmd.rush")}</button>
      ${work.rush ? `<button data-action="rush-cancel" data-work-id="${id}">${ui("ui.cmd.rush-cancel")}</button>` : ""}`
          : ""
      }
    </div>
    <div class="cmd-row">${
      work.extraWriting
        ? `<button data-action="extra-write-cancel" data-work-id="${id}">${ui("ui.cmd.extra-cancel")}</button>`
        : work.canExtraWrite
          ? `<button data-action="extra-write" data-work-id="${id}">${ui("ui.cmd.extra-writing")}</button>`
          : ""
    }
    </div>
    <div class="cmd-row">
      ${
        work.canHiatus
          ? `<label>${ui("ui.cmd.hiatus-kind")}<select data-field="hiatus-kind"><option value="RECOVER">${ui("ui.work.hiatus-recover")}</option><option value="STOCK">${ui("ui.work.hiatus-stock")}</option></select></label>
      <label>${ui("ui.cmd.hiatus-days")}<input data-field="hiatus-days" type="number" min="1" max="60" value="7"></label>
      <button data-action="hiatus" data-work-id="${id}">${ui("ui.cmd.hiatus")}</button>`
          : ""
      }
      ${work.canResume ? `<button data-action="resume" data-work-id="${id}">${ui("ui.cmd.resume")}</button>` : ""}
      ${work.canDrop ? `<button class="danger" data-action="drop" data-work-id="${id}">${ui("ui.cmd.drop")}</button>` : ""}
      ${work.canRevise ? `<button data-action="revise" data-work-id="${id}">${ui("ui.cmd.revise")}</button>` : ""}
    </div>
    <div class="cmd-row">
      <label>${ui("ui.cmd.title")}<input data-field="title" type="text" maxlength="${getPlanOptions().maxTitle}" value="${escape(work.title)}"></label>
      <label>${ui("ui.cmd.cadence")}<select data-field="cadence">${cadenceOptions(work.perWeek)}</select></label>
      <label>${ui("ui.cmd.stock-target")}<input data-field="stock" type="number" min="0" max="${getPlanOptions().stockTargetMax}" value="${work.stockTarget}"></label>
      <label>${ui("ui.cmd.priority")}<select data-field="priority">${[1, 2, 3].map((value) => `<option value="${value}" ${value === work.priority ? "selected" : ""}>${ui("ui.cmd.priority-" + value)}</option>`).join("")}</select></label>
      <button data-action="policy" data-work-id="${id}">${ui("ui.cmd.policy-save")}</button>
    </div>
  </div>`;
}

function blankDraft(editing: string | null = null): PlanDraft {
  const options = getPlanOptions();
  return {
    editing,
    title: "",
    genre: options.genres[0].value,
    material: options.materials[0].value,
    tags: [],
    platformId: options.platforms[0].id,
    perWeek: 5,
  };
}

function renderPlanForm(required = false) {
  if (getPendingNewWork(state) && !required) return "";
  if (!planDraft) return "";
  const options = getPlanOptions(state);
  if (required) options.tags = options.tags.filter((tag) => tag.unlocked);
  const draft = planDraft;
  const choices = (
    list: { value: string; label: string }[],
    selected: string,
  ) =>
    list
      .map(
        (item) =>
          `<option value="${escape(item.value)}" ${item.value === selected ? "selected" : ""}>${escape(item.label)}</option>`,
      )
      .join("");
  return `<form id="${required ? "required-work-form" : "plan-form"}" class="panel plan-form" aria-label="${ui("ui.plan.heading")}">
    <div class="section-label">${ui(draft.editing ? "ui.plan.edit-heading" : "ui.plan.heading")}</div>
    <p class="small-muted">${ui("ui.plan.intro")}</p>
    <label class="field">${ui("ui.plan.title")}<input id="plan-title" data-draft="title" type="text" maxlength="${options.maxTitle}" required value="${escape(draft.title)}" placeholder="${ui("ui.plan.title-placeholder")}"></label>
    <div class="field-grid">
      <label class="field">${ui("ui.plan.genre")}<select id="plan-genre" data-draft="genre">${choices(options.genres, draft.genre)}</select></label>
      <label class="field">${ui("ui.plan.material")}<select id="plan-material" data-draft="material">${choices(options.materials, draft.material)}</select></label>
      <label class="field">${ui("ui.plan.platform")}<select id="plan-platform" data-draft="platformId">${options.platforms.map((item) => `<option value="${escape(item.id)}" ${item.id === draft.platformId ? "selected" : ""}>${escape(item.label)}</option>`).join("")}</select></label>
      <label class="field">${ui("ui.plan.cadence")}<select id="plan-cadence" data-draft="perWeek">${cadenceOptions(draft.perWeek)}</select></label>
    </div>
    <p class="small-muted" id="plan-platform-tags">${ui("ui.plan.platform-tags", { tags: options.platforms.find((item) => item.id === draft.platformId)!.tags.join(", ") })}</p>
    <fieldset class="tag-picker"><legend>${ui("ui.plan.tags", { max: options.maxTags })}</legend>
      ${options.tags.map((tag, index) => `<label class="chip ${tag.unlocked || draft.tags.includes(tag.value) ? "" : "locked"}"><input type="checkbox" data-tag="${escape(tag.value)}" id="plan-tag-${index}" ${draft.tags.includes(tag.value) ? "checked" : ""} ${tag.unlocked || draft.tags.includes(tag.value) ? "" : "disabled"}><span>#${escape(tag.label)}${tag.unlocked || draft.tags.includes(tag.value) ? "" : " · " + ui("ui.plan.tag-locked", { chapters: tag.required })}</span></label>`).join("")}
    </fieldset>
    <p class="small-muted">${ui("ui.plan.title-note")}</p>
    <div class="cmd-row"><button class="primary" type="submit">${ui(draft.editing ? "ui.plan.save" : "ui.plan.create")}</button>
    ${required ? "" : `<button type="button" data-action="plan-cancel">${ui("ui.plan.cancel")}</button>`}</div>
    ${required ? `<p id="required-work-error" class="notice" aria-live="polite"></p>` : ""}
  </form>`;
}

function validateRequiredForm() {
  if (!requiredDialog.open || !planDraft) return;
  const valid =
    !!planDraft.title.trim() &&
    planDraft.tags.length > 0 &&
    planDraft.tags.length <= getPlanOptions(state).maxTags;
  requiredDialog.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )!.disabled = !valid;
  requiredDialog.querySelector("#required-work-error")!.textContent = valid
    ? ""
    : text("ui.new-work.invalid");
}

function syncRequiredWork() {
  const waiting = getPendingNewWork(state);
  if (!waiting) {
    if (requiredDialog.open) requiredDialog.close();
    requiredDialog.innerHTML = "";
    requiredWorkId = null;
    return;
  }
  stop();
  resumeAfterChoice = false;
  if (requiredWorkId === waiting.id && requiredDialog.open) return;
  requiredWorkId = waiting.id;
  planDraft = {
    ...waiting.defaultPlan,
    tags: [...waiting.defaultPlan.tags],
    editing: null,
  };
  requiredDialog.innerHTML = `<h2 id="required-work-title">${escape(waiting.title)}</h2><p id="required-work-reason">${escape(waiting.reason)}</p><p class="small-muted">${ui("ui.new-work.path", { path: waiting.path })}</p>${renderPlanForm(true)}<button type="button" data-action="export">${ui("ui.new-work.export")}</button>`;
  requiredDialog.showModal();
  requiredDialog.querySelector<HTMLInputElement>("#plan-title")!.focus();
  validateRequiredForm();
}

function renderLife() {
  const info = getLifeSettings(state);
  const author = getAuthorView(state);
  const draft = lifeDraft ?? { time: info.time, spend: null };
  const time = draft.time;
  const planned =
    time.sleep + time.plot + time.community + time.ego + time.rest;
  const remain = info.free - planned;
  const field = (key: keyof TimePolicy) =>
    `<label class="field">${ui("ui.life.time-" + key)}<input data-life="${key}" id="life-${key}" type="number" min="0" max="${info.free}" step="1" value="${time[key]}"></label>`;
  const spendDraft = lifeDraft?.spend;
  const spendRows = info.spend
    .map((item) => {
      const level = spendDraft?.[item.key] ?? item.level;
      return `<div class="spend-row"><label for="spend-${item.key}">${ui("ui.life.spend-" + item.key)}</label>
        <select data-spend="${item.key}" id="spend-${item.key}">${item.costs.map((cost, index) => `<option value="${index}" ${index === level ? "selected" : ""}>${ui("ui.life.spend-level", { level: index, cost: won(cost) })}</option>`).join("")}</select>
        <span class="small-muted">${ui("ui.life.spend-effect-" + item.key)}</span></div>`;
    })
    .join("");
  const plan = author.plan;
  const actual = author.routine;
  const locked = !!getPending(state) || author.phase === "ENDED";
  const row = (
    key: string,
    planned: number | undefined,
    used: number | undefined,
  ) =>
    `<div class="list-row"><span>${ui("ui.life.actual-" + key)}</span><strong>${planned ?? "–"}</strong><span class="numeric">${used ?? "–"}</span></div>`;
  const sumRecord = (value: Record<string, number> | undefined) =>
    value ? Object.values(value).reduce((a, b) => a + b, 0) : undefined;
  return `<div class="life">
    <form id="time-form" class="panel plan-form">
      ${locked ? `<p class="notice">${ui(author.phase === "ENDED" ? "system.command.ended" : "system.command.choice-pending")}</p>` : ""}
      <fieldset class="life-fields" ${locked ? "disabled" : ""}>
      <div class="section-label">${ui("ui.life.time-heading")}</div>
      <p class="small-muted">${ui("ui.life.time-intro", { job: info.jobUnits, living: info.living, free: info.free })}</p>
      <div class="field-grid">${(["sleep", "plot", "community", "ego", "rest"] as const).map(field).join("")}
        <div class="field"><span>${ui("ui.life.time-writing")}</span><strong class="${remain < 0 ? "bad" : ""}" id="life-remain">${Math.max(0, remain)}</strong></div></div>
      <p class="small-muted">${ui(remain < 0 ? "ui.life.time-over" : "ui.life.time-hint", { over: -remain, min: info.minSleep })}</p>
      <div class="cmd-row"><button class="primary" type="submit">${ui("ui.life.apply")}</button>
      <label class="check"><input type="checkbox" id="auto-plan" ${info.autoPlan ? "checked" : ""}> ${ui("ui.life.auto-plan")}</label></div>
      </fieldset>
    </form>
    <form id="spend-form" class="panel plan-form">
      <fieldset class="life-fields" ${locked ? "disabled" : ""}>
      <div class="section-label">${ui("ui.life.spend-heading")}</div>
      <p class="small-muted">${ui("ui.life.spend-intro", { monthly: won(info.monthly) })}</p>
      ${info.spendCut ? `<p class="notice">${ui("ui.life.spend-cut")}</p>` : ""}
      ${spendRows}
      <div class="cmd-row"><button class="primary" type="submit">${ui("ui.life.apply")}</button></div>
      </fieldset>
    </form>
    <section class="panel plan-form">
      <div class="section-label">${ui("ui.life.purchase-heading")}</div>
      ${info.purchases
        .map(
          (item) => `<div class="purchase-row">
        <div><strong>${escape(item.name)}</strong><p class="small-muted">${escape(item.description)}</p></div>
        <div class="small-muted">${ui("ui.life.purchase-meta", { cost: won(item.cost), days: item.cooldownDays })}
          ${state.day < item.availableDay ? `<p>${ui("ui.life.purchase-cooldown", { day: item.availableDay })}</p>` : !item.affordable ? `<p>${ui("ui.life.purchase-insufficient")}</p>` : ""}
        </div>
        <button type="button" data-action="purchase" data-purchase-id="${escape(item.id)}" ${locked || !item.available ? "disabled" : ""}>${ui("ui.life.purchase-button")}</button>
      </div>`,
        )
        .join("")}
    </section>
    <section class="panel listing">
      <div class="list-row"><strong>${ui("ui.life.actual-heading")}</strong><strong>${ui("ui.life.actual-planned")}</strong><strong>${ui("ui.life.actual-used")}</strong></div>
      ${
        plan && actual
          ? [
              row("sleep", plan.sleep, actual.sleep),
              row("community", plan.community, actual.community),
              row("ego", plan.ego, actual.ego),
              row("plot", sumRecord(plan.plot), sumRecord(actual.plot)),
              row("rest", plan.rest, actual.rest),
              row(
                "writing",
                sumRecord(plan.writing),
                sumRecord(actual.writing),
              ),
              row("work", plan.work, actual.work),
              row("living", plan.living, actual.living),
            ].join("")
          : `<p class="small-muted">${ui("ui.life.actual-empty")}</p>`
      }
      ${author.deviations.length ? `<h4>${ui("ui.life.deviation-heading")}</h4><ul class="deviations">${author.deviations.map((reason) => `<li>${escape(reason)}</li>`).join("")}</ul>` : ""}
      ${
        actual
          ? `<h4>${ui("ui.life.work-allocation-heading")}</h4>${getWorkViews(
              state,
            )
              .filter(
                (work) =>
                  (actual.writing[work.id] ?? 0) || (actual.plot[work.id] ?? 0),
              )
              .map(
                (work) =>
                  `<div class="list-row"><strong>${escape(work.title)}</strong><span>${ui("ui.life.work-allocation", { writing: actual.writing[work.id] ?? 0, plot: actual.plot[work.id] ?? 0 })}</span></div>`,
              )
              .join("")}`
          : ""
      }
    </section>
  </div>`;
}

function renderSummary() {
  const summary = getLifeSummary(state);
  const item = (label: string, value: string) =>
    `<div><dt>${ui(label)}</dt><dd>${escape(value)}</dd></div>`;
  return `<section class="decision panel summary" aria-labelledby="summary-title">
    <div class="section-label">${ui("ui.summary.label")}</div>
    <h2 id="summary-title">${ui("ui.summary.title", { days: summary.days })}</h2>
    <dl class="offer">
      ${item("ui.summary.works", ui("ui.summary.works-value", { total: summary.works, completed: summary.completed, rushed: summary.rushed, dropped: summary.dropped }))}
      ${item("ui.summary.chapters", count(summary.chapters))}
      ${item("ui.summary.views", count(summary.totalViews))}
      ${item("ui.summary.best", summary.bestTitle ? ui("ui.summary.best-value", { title: summary.bestTitle, views: count(summary.bestViews) }) : "–")}
      ${item("ui.summary.favorites", count(summary.bestFavorites))}
      ${item("ui.summary.earned", won(summary.earned))}
      ${item("ui.summary.cash", won(summary.cash))}
      ${item("ui.summary.contracts", count(summary.contracts))}
      ${item("ui.summary.job", summary.job)}
    </dl>
    <p class="small-muted">${ui("ui.summary.restart")}</p>
  </section>`;
}

let lifeDraft: { time: TimePolicy; spend: SpendPolicy | null } | null = null;

const empty = (message: string) => `<p class="empty panel">${message}</p>`;
function tabContent() {
  if (tab === "life") return renderLife();
  if (tab === "works") {
    const works = getWorkViews(state).slice().reverse();
    const options = getPlanOptions();
    const open = works.filter((work) => !work.end).length;
    const canPlan =
      getAuthorView(state).phase === "READY" &&
      open < options.maxActiveWorks &&
      getAuthorView(state).path !== null;
    return `${
      canPlan && !planDraft
        ? `<div class="panel plan-bar"><button class="primary" data-action="plan-open">${ui("ui.plan.open")}</button><span class="small-muted">${ui("ui.plan.slots", { open, max: options.maxActiveWorks })}</span></div>`
        : ""
    }${renderPlanForm()}${
      works.length
        ? `<div class="works">${works.map((work) => workPanel(work, work.id === selectedWork)).join("")}</div>`
        : empty(ui("ui.work.empty"))
    }`;
  }
  if (tab === "log") {
    const log = getEventLog(state)
      .filter((event) =>
        [
          "EVENT_SELECTED",
          "CHOICE_RESOLVED",
          "WORK_STATUS_CHANGED",
          "WORK_ORDER",
          "COMMAND",
          "PAYOUT",
          "STATE_CHANGED",
        ].includes(event.type),
      )
      .slice(-28)
      .reverse();
    return log.length
      ? `<div class="panel listing">${log
          .map(
            (item) =>
              `<div class="list-row"><span class="small-muted">${ui("ui.format.day", { day: item.day })}</span><strong>${escape(item.message)}</strong></div>`,
          )
          .join("")}</div>`
      : empty(ui("ui.log.empty"));
  }
  if (tab === "aptitude") {
    const aptitudes = getAptitudeView(state);
    const labels = {
      UNKNOWN: ui("ui.aptitude.unknown"),
      GUESS: ui("ui.aptitude.guess"),
      CERTAIN: ui("ui.aptitude.certain"),
    };
    const observed = aptitudes.filter((item) => item.stage !== "UNKNOWN");
    const unknown = aptitudes.length - observed.length;
    const rows = (items: typeof aptitudes) =>
      items
        .map(
          (item) =>
            `<div class="list-row"><span class="small-muted">${escape(item.kind)}</span><strong>${escape(item.key)}</strong><span>${labels[item.stage]}${item.estimate ? " · " + escape(item.estimate) : ""}</span></div>`,
        )
        .join("");
    return `<div class="panel listing"><div class="list-row"><strong>${ui("ui.aptitude.title")}</strong><span class="small-muted">${ui("ui.aptitude.counts", { observed: observed.length, unknown })}</span></div>
      ${rows(observed)}<details><summary>${ui("ui.aptitude.expand")}</summary>${rows(aptitudes.filter((item) => item.stage === "UNKNOWN"))}</details></div>`;
  }
  if (tab === "contracts") {
    const contracts = getContractViews(state).slice().reverse();
    return contracts.length
      ? `<div class="contract-list">${contracts.map(contractPanel).join("")}</div>`
      : empty(ui("ui.contract.empty"));
  }
  if (tab === "money") {
    const ledger = getLedgerView(state);
    const purchaseNames = new Map(
      getLifeSettings(state).purchases.map((item) => [item.id, item.name]),
    );
    return `<section class="panel listing">
      <div class="money-head"><div><span class="section-label">${ui(ledger.debt ? "ui.money.debt" : "ui.money.cash")}</span><h2>${escape(won(ledger.cash))}</h2></div>
      <div><span class="small-muted">${ui("ui.money.income")}</span><strong>${escape(won(ledger.accrued))}</strong></div>
      <div><span class="small-muted">${ui("ui.money.paid")}</span><strong>${escape(won(ledger.paid))}</strong></div></div>
      <details><summary>${ui("ui.money.month-heading")}</summary>
        ${ledger.months.map((month) => `<div class="list-row"><strong>${ui("ui.money.month-value", { month: month.month })}${month.current ? " · " + ui("ui.money.month-current") : ""}</strong><span>${ui("ui.money.month-amounts", { income: won(month.income), expense: won(month.expense), net: won(month.net) })}</span></div>`).join("")}
      </details>
      ${
        Object.keys(ledger.carried).length
          ? `<details><summary>${ui("ui.money.carry-heading")}</summary>${Object.entries(
              ledger.carried,
            )
              .map(
                ([kind, amount]) =>
                  `<div class="list-row"><strong>${escape(ledgerNames[kind as keyof typeof ledgerNames])}</strong><span>${escape(won(amount))}</span></div>`,
              )
              .join("")}</details>`
          : ""
      }
      ${ledger.entries
        .slice(-20)
        .reverse()
        .map((entry) => {
          const purchaseId = entry.ref.startsWith("purchase:")
            ? entry.ref.slice("purchase:".length)
            : "";
          const name = purchaseNames.get(purchaseId) ?? ledgerNames[entry.kind];
          return `<div class="list-row ledger-entry"><span class="small-muted">${ui("ui.format.day", { day: entry.day })}</span><strong>${escape(name)}</strong><span class="numeric">${entry.amount > 0 ? "+" : ""}${escape(won(entry.amount))}</span></div>`;
        })
        .join("")}
    </section>`;
  }
  return `<div class="panel listing">
    ${slotIds
      .map(
        (slot) => `<div class="list-row slot">
      <div><strong>${slot === "auto" ? ui("ui.save.auto") : ui("ui.save.slot", { slot })}</strong>
      <p class="small-muted">${slots[slot] ? ui("ui.save.slot-information", { pen_name: slots[slot]!.penName, day: slots[slot]!.day }) : ui("ui.save.empty")}</p></div>
      <div class="slot-actions">${slot !== "auto" ? `<button data-action="save" data-slot="${slot}" ${!storageAvailable ? "disabled" : ""}>${ui("ui.save.write")}</button>` : ""}
      <button data-action="load" data-slot="${slot}" ${slots[slot] ? "" : "disabled"}>${ui("ui.save.load")}</button></div>
    </div>`,
      )
      .join("")}
    <div class="list-row"><button data-action="export">${ui("ui.save.export")}</button><button data-action="import">${ui("ui.save.import")}</button></div>
    <div class="list-row retire"><div><strong>${ui("ui.retire.heading")}</strong><p class="small-muted">${ui("ui.retire.note")}</p></div>
      ${
        getAuthorView(state).phase === "ENDED"
          ? `<span class="small-muted">${ui("ui.retire.done")}</span>`
          : confirmRetire
            ? `<div class="slot-actions"><button class="danger" data-action="retire-yes">${ui("ui.retire.yes")}</button><button data-action="retire-no">${ui("ui.retire.no")}</button></div>`
            : `<button class="danger" data-action="retire">${ui("ui.retire.button")}</button>`
      }</div>
  </div>`;
}

const editing = () => {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    game.contains(active) &&
    active.matches(
      "input:not([type=checkbox]), select, textarea, .chapter-chart-scroll",
    )
  );
};

function render(force = true) {
  if (getPendingNewWork(state)) stop();
  if (!force && editing()) {
    dirty = true;
    return;
  }
  dirty = false;
  const author = getAuthorView(state);
  const layout = `<div class="layout">
    ${renderAuthor(author)}
    <div class="workspace">
      ${renderCurrentEvent()}
      <nav class="tabs" aria-label="${ui("ui.tab.navigation")}">${tabs
        .map(
          ([id, label]) => `<button data-action="tab" data-tab="${id}"
        aria-current="${tab === id ? "page" : "false"}">${escape(label)}${id === "works" ? "<span>" + getWorkViews(state).length + "</span>" : ""}</button>`,
        )
        .join("")}</nav>
      <section class="tab-content" aria-label="${escape(tabs.find(([id]) => id === tab)![1])}">${tabContent()}</section>
    </div>
  </div>`;
  const clock = game.querySelector<HTMLElement>(".clock");
  const previousLayout = game.querySelector<HTMLElement>(".layout");
  if (!force && clock && previousLayout) {
    const date = clock.querySelector(".clock-date h1");
    if (date)
      date.innerHTML = `${author.day}<span>${ui("ui.clock.day-unit")}</span>`;
    const phase = clock.querySelector('[data-testid="phase"]');
    const play = clock.querySelector<HTMLButtonElement>('[data-action="play"]');
    if (phase)
      phase.textContent = text(
        timer === undefined ? "ui.clock.paused" : "ui.clock.running",
      );
    if (play)
      play.textContent = text(
        timer === undefined ? "ui.clock.play" : "ui.clock.paused",
      );
    previousLayout.outerHTML = layout;
  } else {
    game.innerHTML = renderClock(author) + layout;
  }
  syncRequiredWork();
}

function snapshot(): SavedLife {
  const current = getAuthorView(state);
  return { text: serialize(state), day: current.day, penName: current.penName };
}

async function saveSlot(id: SlotId, announce = false) {
  if (!storageAvailable) return;
  const save = snapshot();
  try {
    await putSlot(id, save);
    slots[id] = save;
    if (announce) feedbackText(text("system.save.saved", { slot: id }));
    if (tab === "save" && (announce || !timer)) render();
  } catch {
    storageAvailable = false;
    feedbackText(text("system.save.storage-unavailable"));
    if (tab === "save") render();
  }
}

function stop() {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}

function advanceDay() {
  const next = advance(state);
  if (next.state === state) return;
  revision += 1;
  state = next.state;
  if (next.stoppedReason !== "DAYS_DONE") {
    resumeAfterChoice =
      next.stoppedReason === "AWAITING_CHOICE" && timer !== undefined;
    stop();
  }
  render(next.stoppedReason !== "DAYS_DONE");
  void saveSlot("auto");
}

function auto() {
  if (getPending(state) || getAuthorView(state).phase === "ENDED") return;
  const delay = speeds.find(([value]) => value === speed)?.[2] ?? 900;
  timer = window.setInterval(advanceDay, delay);
}

function loadLife(text: string, label: string) {
  if (state.pendingNewWork && requiredDialog.open) return;
  const loaded = deserialize(text);
  if (!loaded.ok) {
    feedbackText(
      loaded.error === "E_SAVE_VERSION"
        ? saveErrors.E_SAVE_VERSION
        : saveErrors.E_SAVE_CORRUPT,
    );
    return;
  }
  stop();
  resumeAfterChoice = false;
  state = loaded.state;
  revision += 1;
  seedDraft = String(getAuthorView(state).seed);
  seedInput.value = seedDraft;
  selectedWork = null;
  planDraft = null;
  lifeDraft = null;
  feedbackText(label);
  render();
  void saveSlot("auto");
}

function startLife() {
  stop();
  resumeAfterChoice = false;
  state = createLife(Number(seedDraft));
  tab = "works";
  selectedWork = null;
  planDraft = null;
  lifeDraft = null;
  revision += 1;
  feedbackText("");
  render();
  void saveSlot("auto");
}

seedInput.addEventListener("input", () => {
  seedDraft = seedInput.value;
});
document
  .querySelector<HTMLFormElement>("#new-life")!
  .addEventListener("submit", (event) => {
    event.preventDefault();
    if (seedInput.checkValidity()) startLife();
  });

type Outcome = { ok: true; state: LifeState } | { ok: false; reason: string };
function commit(result: Outcome) {
  if (!result.ok) {
    feedbackText(result.reason);
    return false;
  }
  state = result.state;
  revision += 1;
  feedbackText("");
  render();
  void saveSlot("auto");
  return true;
}
const field = (root: Element | null, name: string) =>
  root?.querySelector<HTMLInputElement | HTMLSelectElement>(
    '[data-field="' + name + '"]',
  );

function draftFromWork(id: string): PlanDraft | null {
  const work = getWorkViews(state).find((item) => item.id === id);
  if (!work) return null;
  return {
    editing: id,
    title: work.title,
    genre: work.rawGenre,
    material: work.rawMaterial,
    tags: [...work.rawTags],
    platformId: work.platformId,
    perWeek: work.perWeek,
  };
}

function workAction(action: string, button: HTMLButtonElement) {
  const id = button.dataset.workId!;
  const root = button.closest("[data-work]");
  switch (action) {
    case "prepare-ending":
      return commit(
        prepareEnding(
          state,
          id,
          Number(field(root, "ending-remaining")?.value),
        ),
      );
    case "rush":
      return commit(rushWork(state, id, Number(field(root, "rush")?.value)));
    case "rush-cancel":
      return commit(rushWork(state, id, 0));
    case "extra-write":
      return commit(extraWrite(state, id, true));
    case "extra-write-cancel":
      return commit(extraWrite(state, id, false));
    case "hiatus":
      return commit(
        hiatusWork(
          state,
          id,
          field(root, "hiatus-kind")?.value === "STOCK" ? "STOCK" : "RECOVER",
          Number(field(root, "hiatus-days")?.value),
        ),
      );
    case "resume":
      return commit(resumeWork(state, id));
    case "drop":
      confirmDrop = id;
      render();
      return true;
    case "drop-yes":
      confirmDrop = null;
      return commit(dropWork(state, id));
    case "revise":
      planDraft = draftFromWork(id);
      tab = "works";
      render();
      return true;
    case "policy":
      return commit(
        setWorkPolicy(state, id, {
          title: field(root, "title")?.value ?? "",
          perWeek: Number(field(root, "cadence")?.value),
          stockTarget: Number(field(root, "stock")?.value),
          priority: Number(field(root, "priority")?.value),
        }),
      );
  }
  return false;
}

app.addEventListener("input", (event) => {
  const target = event.target;
  if (!(
    target instanceof HTMLInputElement || target instanceof HTMLSelectElement
  ))
    return;
  if (target.dataset.journal) {
    journalFilters.set(target.dataset.journal, target.value);
    render();
    app
      .querySelector<HTMLSelectElement>(
        '[data-journal="' + target.dataset.journal + '"]',
      )
      ?.focus();
    return;
  }
  if (target.dataset.draft && planDraft) {
    const key = target.dataset.draft as keyof PlanDraft;
    if (key === "perWeek") planDraft.perWeek = Number(target.value);
    else if (key !== "tags" && key !== "editing") planDraft[key] = target.value;
    if (key === "platformId") {
      const info = getPlanOptions(state).platforms.find(
        (item) => item.id === target.value,
      );
      const note = document.querySelector("#plan-platform-tags");
      if (info && note)
        note.textContent = text("ui.plan.platform-tags", {
          tags: info.tags.join(", "),
        });
    }
  }
  validateRequiredForm();
  if (target.dataset.life && lifeDraft) {
    const key = target.dataset.life as keyof TimePolicy;
    lifeDraft.time[key] = Math.max(0, Math.floor(Number(target.value) || 0));
    const info = getLifeSettings(state);
    const remain =
      info.free - Object.values(lifeDraft.time).reduce((a, b) => a + b, 0);
    const out = document.querySelector("#life-remain");
    if (out) {
      out.textContent = String(Math.max(0, remain));
      out.classList.toggle("bad", remain < 0);
    }
  }
  if (target.dataset.spend && lifeDraft?.spend) {
    lifeDraft.spend[target.dataset.spend as keyof SpendPolicy] = Number(
      target.value,
    );
  }
});
app.addEventListener("focusin", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const isField =
    target instanceof HTMLInputElement || target instanceof HTMLSelectElement;
  if (!(isField || target.classList.contains("chapter-chart-scroll"))) return;
  if (timer !== undefined && game.contains(target)) {
    stop();
    resumeAfterChoice = false;
    const phase = game.querySelector('[data-testid="phase"]');
    const play = game.querySelector<HTMLButtonElement>('[data-action="play"]');
    if (phase) phase.textContent = text("ui.clock.paused");
    if (play) play.textContent = text("ui.clock.play");
  }
  if (isField && (target.dataset.life || target.dataset.spend)) {
    const info = getLifeSettings(state);
    lifeDraft ??= {
      time: { ...info.time },
      spend: Object.fromEntries(
        info.spend.map((item) => [item.key, item.level]),
      ) as SpendPolicy,
    };
  }
});
app.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.dataset.tag && planDraft) {
    const max = getPlanOptions().maxTags;
    const tag = target.dataset.tag;
    if (target.checked) {
      if (planDraft.tags.length >= max) {
        target.checked = false;
        feedbackText(text("system.command.tags-invalid"));
        return;
      }
      planDraft.tags.push(tag);
    } else planDraft.tags = planDraft.tags.filter((item) => item !== tag);
    feedbackText("");
    validateRequiredForm();
  }
  if (target.id === "auto-plan") commit(setAutoPlan(state, target.checked));
});
app.addEventListener("focusout", () => {
  window.setTimeout(() => {
    if (dirty && !editing()) render();
  }, 0);
});
app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === "required-work-form" && planDraft && requiredWorkId) {
    const result = confirmNewWork(state, requiredWorkId, planDraft);
    if (!result.ok)
      requiredDialog.querySelector("#required-work-error")!.textContent =
        result.reason;
    else {
      planDraft = null;
      requiredWorkId = null;
      commit(result);
    }
    return;
  }
  if (form.id === "plan-form" && planDraft) {
    const { editing: target, ...plan } = planDraft;
    const done = commit(
      target ? reviseWork(state, target, plan) : planWork(state, plan),
    );
    if (done) planDraft = null;
    render();
  } else if (form.id === "time-form" && lifeDraft) {
    if (commit(setTimePolicy(state, lifeDraft.time))) lifeDraft = null;
  } else if (form.id === "spend-form" && lifeDraft?.spend) {
    if (commit(setSpendPolicy(state, lifeDraft.spend)))
      lifeDraft = { ...lifeDraft, spend: null };
  }
});
app.addEventListener("change", (event) => {
  if (
    !(event.target instanceof HTMLSelectElement) ||
    event.target.id !== "speed"
  )
    return;
  speed = Number(event.target.value);
  if (timer !== undefined) {
    stop();
    auto();
  }
});
app.addEventListener("click", (event) => {
  if (!(event.target instanceof HTMLElement)) return;
  const button = event.target.closest<HTMLButtonElement>("button[data-action]");
  if (!button) return;
  const { action } = button.dataset;
  if (!action) return;
  switch (action) {
    case "random": {
      seedDraft = String(crypto.getRandomValues(new Uint32Array(1))[0]);
      seedInput.value = seedDraft;
      break;
    }
    case "step":
      stop();
      advanceDay();
      break;
    case "play":
      if (timer !== undefined) stop();
      else auto();
      render();
      break;
    case "choose": {
      const next = choose(state, button.dataset.event!, button.dataset.choice!);
      if (!next.ok) return;
      revision += 1;
      state = next.state;
      if (resumeAfterChoice) auto();
      resumeAfterChoice = false;
      feedbackText("");
      render();
      void saveSlot("auto");
      break;
    }
    case "tab":
      tab = button.dataset.tab as Tab;
      lifeDraft = null;
      render();
      break;
    case "plan-open":
      stop();
      planDraft = blankDraft();
      render();
      break;
    case "plan-cancel":
      planDraft = null;
      render();
      break;
    case "purchase": {
      stop();
      const item = getLifeSettings(state).purchases.find(
        (entry) => entry.id === button.dataset.purchaseId,
      );
      if (item && commit(purchase(state, item.id)))
        feedbackText(text("ui.life.purchase-done", { item: item.name }));
      break;
    }
    case "drop-no":
      confirmDrop = null;
      render();
      break;
    case "rush":
    case "rush-cancel":
    case "prepare-ending":
    case "extra-write":
    case "extra-write-cancel":
    case "hiatus":
    case "resume":
    case "drop":
    case "drop-yes":
    case "revise":
    case "policy":
      stop();
      workAction(action, button);
      break;
    case "retire":
      confirmRetire = true;
      render();
      break;
    case "retire-no":
      confirmRetire = false;
      render();
      break;
    case "retire-yes":
      confirmRetire = false;
      stop();
      commit(retire(state));
      break;
    case "work":
      selectedWork =
        selectedWork === button.dataset.workId ? null : button.dataset.workId!;
      render();
      break;
    case "save":
      void saveSlot(button.dataset.slot as SlotId, true);
      break;
    case "load": {
      const save = slots[button.dataset.slot as SlotId];
      if (save) loadLife(save.text, text("system.save.loaded"));
      break;
    }
    case "export": {
      const current = snapshot();
      const url = URL.createObjectURL(
        new Blob([current.text], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "webbbbbie-day-" + current.day + ".json";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      break;
    }
    case "import":
      fileInput.click();
      break;
  }
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file)
    void file.text().then(
      (contents) => loadLife(contents, text("system.save.imported")),
      () => feedbackText(text("system.save.file-read-error")),
    );
  fileInput.value = "";
});
render();
void getSlots().then(
  (initial) => {
    slots = initial;
    if (revision === 0 && initial.auto) {
      loadLife(initial.auto.text, text("system.save.auto-restored"));
    } else if (tab === "save") {
      render();
    }
  },
  () => {
    storageAvailable = false;
    feedbackText(text("system.save.storage-unavailable"));
    if (tab === "save") render();
  },
);
