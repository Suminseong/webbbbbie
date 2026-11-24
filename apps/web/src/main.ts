import { text } from "@webbbbbie/content";
import type { TextVariables } from "@webbbbbie/content";
import "./style.css";
import {
  abilityNames,
  advance,
  choose,
  conditionNames,
  createLife,
  deserialize,
  getAptitudeView,
  getAuthorView,
  getContractViews,
  getDailySummary,
  getEventLog,
  getLedgerView,
  getPending,
  getWorkViews,
  ledgerNames,
  serialize,
} from "@webbbbbie/engine";
import type { LifeState } from "@webbbbbie/engine";
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
let storageAvailable = true;

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
    ${author.states.length ? `<div class="states">${author.states.map((item) => `<span>${escape(item.name)}</span>`).join("")}</div>` : ""}
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
    </dl>`
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
  const top = Math.max(1, ...work.newBySource.map((source) => source.count));
  const isClosed = !!work.end;
  return `<article class="work-card panel" data-work="${escape(work.id)}">
    <div class="work-head">
      <div><div class="work-sub">${escape(work.platform)} <span>· ${escape(work.model)}</span></div><h3>${escape(work.title)}</h3></div>
      <span class="work-status ${isClosed || work.status === "HIATUS" ? "muted" : ""}">${escape(work.statusLabel)}</span>
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
        <div><dt>${ui("ui.work.total-views")}</dt><dd>${count(work.totalViews)}</dd></div>
        <div><dt>${ui("ui.work.latest-views")}</dt><dd>${count(work.latestViews)}</dd></div>
        <div><dt>${ui("ui.work.lost")}</dt><dd>${ui("ui.format.reader", { count: count(work.lost) })}</dd></div>
        <div><dt>${ui("ui.work.paid")}</dt><dd>${escape(won(work.paid))}</dd></div>
      </dl>
      ${work.end ? `<p class="small-muted">${ui("ui.work.ending", { day: work.end.day, reason: work.end.reason, chapters: work.end.chapters, favorites: count(work.end.favorites) })}</p>` : ""}
      ${work.missedReason ? `<p class="small-muted">${ui("ui.work.missed", { reason: text(work.missedReason === "HIATUS" ? "ui.work.miss-hiatus" : "ui.work.miss-stock") })}</p>` : ""}
      <div class="breakdown"><div><h4>${ui("ui.work.source-title")}</h4>
        ${
          work.newBySource
            .filter((source) => source.count > 0)
            .map(
              (source) =>
                `<div class="source-row"><span>${escape(source.label)}</span><i style="width:${(source.count / top) * 100}%"></i><b>${count(source.count)}</b></div>`,
            )
            .join("") ||
          `<p class="small-muted">${ui("ui.work.source-empty")}</p>`
        }
      </div><div><h4>${ui("ui.work.age-title")}</h4>
        ${work.newByAge.map((age) => `<div class="age-row"><span>${escape(age.label)}</span><b>${ui("ui.format.reader", { count: count(age.count) })}</b></div>`).join("")}
      </div></div>
    </div>`
        : ""
    }
  </article>`;
}

const empty = (message: string) => `<p class="empty panel">${message}</p>`;
function tabContent() {
  if (tab === "works") {
    const works = getWorkViews(state).slice().reverse();
    return works.length
      ? `<div class="works">${works.map((work) => workPanel(work, work.id === selectedWork)).join("")}</div>`
      : empty(ui("ui.work.empty"));
  }
  if (tab === "log") {
    const log = getEventLog(state)
      .filter((event) =>
        [
          "EVENT_SELECTED",
          "CHOICE_RESOLVED",
          "WORK_STATUS_CHANGED",
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
      ? `<div class="panel listing">${contracts
          .map(
            (contract) => `
      <div class="list-row"><span class="small-muted">${ui(contract.status === "ACTIVE" ? "ui.contract.active" : contract.status === "EXPIRED" ? "ui.contract.expired" : "ui.contract.terminated")}</span>
      <strong>${escape(contract.company)} · ${escape(contract.title)}</strong>
      <span>${ui("ui.contract.terms", { share: count(contract.share * 100), advance: won(contract.advance), day: contract.expiresDay })}</span></div>`,
          )
          .join("")}</div>`
      : empty(ui("ui.contract.empty"));
  }
  if (tab === "money") {
    const ledger = getLedgerView(state);
    return `<section class="panel listing">
      <div class="money-head"><div><span class="section-label">${ui(ledger.debt ? "ui.money.debt" : "ui.money.cash")}</span><h2>${escape(won(ledger.cash))}</h2></div>
      <div><span class="small-muted">${ui("ui.money.income")}</span><strong>${escape(won(ledger.accrued))}</strong></div>
      <div><span class="small-muted">${ui("ui.money.paid")}</span><strong>${escape(won(ledger.paid))}</strong></div></div>
      ${ledger.entries
        .slice(-20)
        .reverse()
        .map(
          (entry) =>
            `<div class="list-row"><span class="small-muted">${ui("ui.format.day", { day: entry.day })}</span><strong>${escape(ledgerNames[entry.kind])}</strong><span class="numeric">${entry.amount > 0 ? "+" : ""}${escape(won(entry.amount))}</span></div>`,
        )
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
  </div>`;
}

function render() {
  const author = getAuthorView(state);
  game.innerHTML = `${renderClock(author)}<div class="layout">
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
  render();
  void saveSlot("auto");
}

function auto() {
  if (getPending(state) || getAuthorView(state).phase === "ENDED") return;
  const delay = speeds.find(([value]) => value === speed)?.[2] ?? 900;
  timer = window.setInterval(advanceDay, delay);
}

function loadLife(text: string, label: string) {
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
      render();
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
