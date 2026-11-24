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
const won = (amount: number) => count(amount) + "원";
const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escape = (value: string | number) =>
  String(value).replace(/[&<>"']/g, (glyph) => entities[glyph]);
const tabs = [
  ["works", "작품"],
  ["log", "사건 일지"],
  ["aptitude", "적성"],
  ["contracts", "계약"],
  ["money", "경제"],
  ["save", "저장"],
] as const;
type Tab = (typeof tabs)[number][0];
const speeds = [
  [1, "1×", 900],
  [2, "2×", 450],
  [5, "5×", 180],
  [10, "10×", 90],
] as const;
const saveErrors = {
  E_SAVE_CORRUPT: "저장 파일을 읽을 수 없습니다. 현재 인생을 유지합니다.",
  E_SAVE_VERSION: "현재 버전과 호환되지 않는 저장입니다.",
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
    <a class="brand" href="./" aria-label="작가인생체험게임 홈"><span class="brand-mark" aria-hidden="true">ㅈ</span><span>작가인생체험게임</span></a>
    <form id="new-life" class="new-life">
      <label for="seed">시드</label>
      <input name="seed" id="seed" aria-label="시드" type="number" min="0" max="4294967295" step="1" required value="42">
      <button type="submit" class="small">새 인생</button>
      <button type="button" data-action="random" class="icon" aria-label="무작위 시드">↻</button>
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
    <div class="section-label">작가</div>
    <h2>${escape(author.penName)}</h2>
    <p class="small-muted">${author.age}세 · ${escape(author.job)} · ${escape(author.home)}</p>
    <p class="motive">“${escape(author.motive)}”</p>
    <dl class="conditions">${Object.entries(author.condition)
      .map(
        ([key, value]) => `
      <div class="meter-row">
        <dt>${conditionNames[key as keyof typeof conditionNames]}</dt><dd>${count(value)}</dd>
        <div class="meter ${key}" aria-hidden="true"><i style="width:${value}%"></i></div>
      </div>`,
      )
      .join("")}</dl>
    ${author.states.length ? `<div class="states">${author.states.map((item) => `<span>${escape(item.name)}</span>`).join("")}</div>` : ""}
    <div class="line"></div>
    <dl class="skills">${Object.entries(author.abilities)
      .map(
        ([key, value]) =>
          `<div><dt>${abilityNames[key as keyof typeof abilityNames]}</dt><dd>${count(value)}</dd></div>`,
      )
      .join("")}</dl>
    <div class="line"></div>
    <dl class="skills">
      <div><dt>인지도</dt><dd>${count(author.social.recognition)}</dd></div>
      <div><dt>평판</dt><dd>${count(author.social.reputation)}</dd></div>
      <div><dt>완결 신뢰도</dt><dd>${count(author.social.completionTrust)}</dd></div>
      <div><dt>작가 수요</dt><dd>${count(author.social.demand)}</dd></div>
    </dl>
  </aside>`;
}

function renderClock(author: ReturnType<typeof getAuthorView>) {
  const pending = getPending(state);
  const label = pending
    ? "선택 대기"
    : author.phase === "ENDED"
      ? "종료"
      : timer
        ? "진행 중"
        : "일시정지";
  return `<div class="clock">
    <div class="clock-date"><span class="section-label">작가 생활</span><h1>${author.day}<span>일차</span></h1></div>
    <div class="clock-actions">
      <span class="phase ${pending ? "waiting" : ""}" data-testid="phase">${label}</span>
      <button data-action="step" ${pending || author.phase === "ENDED" ? "disabled" : ""}>하루 진행</button>
      <button class="primary" data-action="play" ${pending || author.phase === "ENDED" ? "disabled" : ""}>${timer ? "일시정지" : "자동 진행"}</button>
      <label class="speed"><span>속도</span><select id="speed" aria-label="진행 속도">
        ${speeds.map(([value, text]) => `<option value="${value}" ${speed === value ? "selected" : ""}>${text}</option>`).join("")}
      </select></label>
    </div>
  </div>`;
}

function renderCurrentEvent() {
  const pending = getPending(state);
  if (pending)
    return `<section class="decision panel" aria-labelledby="event-title">
    <div class="section-label">${pending.day}일차 · 결정할 사건</div>
    <h2 id="event-title">${escape(pending.title)}</h2>
    <p>${escape(pending.text)}${pending.target ? " · " + escape(pending.target) : ""}</p>
    ${
      pending.offer
        ? `<dl class="offer">
      <div><dt>제안사</dt><dd>${escape(pending.offer.name)}</dd></div>
      <div><dt>정산 비율</dt><dd>${count(pending.offer.share * 100)}%</dd></div>
      <div><dt>선인세</dt><dd>${won(pending.offer.advance)}</dd></div>
      <div><dt>기간</dt><dd>${pending.offer.duration}일</dd></div>
      <div><dt>지원 약속</dt><dd>${escape(pending.offer.promise)}</dd></div>
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
    ? `<section class="today panel" aria-label="오늘의 결과">
     <div><span class="section-label">${day.day}일차 사건</span><h2>${escape(day.eventTitle)}</h2></div>
     <dl><div><dt>등록</dt><dd>${day.posted}화</dd></div><div><dt>신규 유입</dt><dd>${count(day.newReaders)}명</dd></div>
     <div><dt>발생 수익</dt><dd>${won(day.gained)}</dd></div></dl>
  </section>`
    : `<section class="today panel"><div><span class="section-label">0일차</span><h2>첫 원고를 준비했습니다</h2></div></section>`;
}

function workPanel(
  work: ReturnType<typeof getWorkViews>[number],
  expanded: boolean,
) {
  const top = Math.max(1, ...work.newBySource.map((source) => source.count));
  const isClosed = !!work.end;
  return `<article class="work-card panel" data-work="${escape(work.id)}">
    <div class="work-head">
      <div><div class="work-sub">${escape(work.platform)} <span>· ${work.model}</span></div><h3>${escape(work.title)}</h3></div>
      <span class="work-status ${isClosed || work.status === "HIATUS" ? "muted" : ""}">${work.statusLabel}</span>
    </div>
    <p class="tags">${escape(work.genre)} · ${escape(work.material)} ${work.tags.map((tag) => " <span>#" + escape(tag) + "</span>").join("")}</p>
    <dl class="work-stats">
      <div><dt>등록 / 목표</dt><dd>${work.published} / ${work.target}화</dd></div>
      <div><dt>비축 원고</dt><dd>${work.stock.toFixed(1)}화</dd></div>
      <div><dt>신규 독자</dt><dd>${count(work.newReaders)}명</dd></div>
      <div><dt>오늘 조회</dt><dd>${count(work.views)}</dd></div>
      <div><dt>선호작</dt><dd>${count(work.favorites)}</dd></div>
      <div><dt>누적 수익</dt><dd>${won(work.accrued)}</dd></div>
    </dl>
    <button class="details-toggle" data-action="work" data-work-id="${escape(work.id)}" aria-expanded="${expanded}">${expanded ? "통계 접기" : "작품 통계 보기"} <span aria-hidden="true">${expanded ? "−" : "+"}</span></button>
    ${
      expanded
        ? `<div class="work-details">
      <dl class="work-extra">
        <div><dt>누적 조회</dt><dd>${count(work.totalViews)}</dd></div>
        <div><dt>최신화 열람</dt><dd>${count(work.latestViews)}</dd></div>
        <div><dt>오늘 이탈</dt><dd>${count(work.lost)}명</dd></div>
        <div><dt>지급된 정산</dt><dd>${won(work.paid)}</dd></div>
      </dl>
      ${work.end ? `<p class="small-muted">${work.end.day}일차 ${work.end.reason} · ${work.end.chapters}화 · 종료 당시 선호작 ${count(work.end.favorites)}</p>` : ""}
      ${work.missedReason ? `<p class="small-muted">오늘 미게시 · ${work.missedReason === "HIATUS" ? "휴재" : "비축 원고 부족"}</p>` : ""}
      <div class="breakdown"><div><h4>신규 독자 유입 경로</h4>
        ${
          work.newBySource
            .filter((source) => source.count > 0)
            .map(
              (source) =>
                `<div class="source-row"><span>${source.label}</span><i style="width:${(source.count / top) * 100}%"></i><b>${count(source.count)}</b></div>`,
            )
            .join("") || '<p class="small-muted">오늘 신규 유입이 없습니다.</p>'
        }
      </div><div><h4>신규 독자 연령대</h4>
        ${work.newByAge.map((age) => `<div class="age-row"><span>${age.label}</span><b>${count(age.count)}명</b></div>`).join("")}
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
      : empty("시작 경로를 결정하면 첫 작품이 생깁니다.");
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
              `<div class="list-row"><span class="small-muted">${item.day}일차</span><strong>${escape(item.message)}</strong></div>`,
          )
          .join("")}</div>`
      : empty("아직 기록된 사건이 없습니다.");
  }
  if (tab === "aptitude") {
    const aptitudes = getAptitudeView(state);
    const labels = { UNKNOWN: "미발견", GUESS: "추측", CERTAIN: "확신" };
    const observed = aptitudes.filter((item) => item.stage !== "UNKNOWN");
    const unknown = aptitudes.length - observed.length;
    const rows = (items: typeof aptitudes) =>
      items
        .map(
          (item) =>
            `<div class="list-row"><span class="small-muted">${escape(item.kind)}</span><strong>${escape(item.key)}</strong><span>${labels[item.stage]}${item.estimate ? " · " + escape(item.estimate) : ""}</span></div>`,
        )
        .join("");
    return `<div class="panel listing"><div class="list-row"><strong>적성 기록</strong><span class="small-muted">${observed.length}건 발견 · ${unknown}건 미발견</span></div>
      ${rows(observed)}<details><summary>미발견 적성 보기</summary>${rows(aptitudes.filter((item) => item.stage === "UNKNOWN"))}</details></div>`;
  }
  if (tab === "contracts") {
    const contracts = getContractViews(state).slice().reverse();
    return contracts.length
      ? `<div class="panel listing">${contracts
          .map(
            (contract) => `
      <div class="list-row"><span class="small-muted">${contract.status === "ACTIVE" ? "이행 중" : contract.status === "EXPIRED" ? "만료" : "종료"}</span>
      <strong>${escape(contract.company)} · ${escape(contract.title)}</strong>
      <span>${count(contract.share * 100)}% · ${won(contract.advance)} · ${contract.expiresDay}일차까지</span></div>`,
          )
          .join("")}</div>`
      : empty(
          "현재 계약이 없습니다. 작가 수요와 연재 성적에 따라 제안이 도착합니다.",
        );
  }
  if (tab === "money") {
    const ledger = getLedgerView(state);
    return `<section class="panel listing">
      <div class="money-head"><div><span class="section-label">${ledger.debt ? "잔액 · 부채 상태" : "보유 자산"}</span><h2>${won(ledger.cash)}</h2></div>
      <div><span class="small-muted">발생 수익</span><strong>${won(ledger.accrued)}</strong></div>
      <div><span class="small-muted">지급 정산</span><strong>${won(ledger.paid)}</strong></div></div>
      ${ledger.entries
        .slice(-20)
        .reverse()
        .map(
          (entry) =>
            `<div class="list-row"><span class="small-muted">${entry.day}일차</span><strong>${ledgerNames[entry.kind]}</strong><span class="numeric">${entry.amount > 0 ? "+" : ""}${won(entry.amount)}</span></div>`,
        )
        .join("")}
    </section>`;
  }
  return `<div class="panel listing">
    ${slotIds
      .map(
        (slot) => `<div class="list-row slot">
      <div><strong>${slot === "auto" ? "자동 저장" : "슬롯 " + slot}</strong>
      <p class="small-muted">${slots[slot] ? escape(slots[slot]!.penName) + " · " + slots[slot]!.day + "일차" : "비어 있음"}</p></div>
      <div class="slot-actions">${slot !== "auto" ? `<button data-action="save" data-slot="${slot}" ${!storageAvailable ? "disabled" : ""}>저장</button>` : ""}
      <button data-action="load" data-slot="${slot}" ${slots[slot] ? "" : "disabled"}>불러오기</button></div>
    </div>`,
      )
      .join("")}
    <div class="list-row"><button data-action="export">파일 내보내기</button><button data-action="import">파일 불러오기</button></div>
  </div>`;
}

function render() {
  const author = getAuthorView(state);
  game.innerHTML = `${renderClock(author)}<div class="layout">
    ${renderAuthor(author)}
    <div class="workspace">
      ${renderCurrentEvent()}
      <nav class="tabs" aria-label="기록">${tabs
        .map(
          ([id, label]) => `<button data-action="tab" data-tab="${id}"
        aria-current="${tab === id ? "page" : "false"}">${label}${id === "works" ? "<span>" + getWorkViews(state).length + "</span>" : ""}</button>`,
        )
        .join("")}</nav>
      <section class="tab-content" aria-label="${tabs.find(([id]) => id === tab)?.[1]}">${tabContent()}</section>
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
    if (announce) feedbackText("슬롯 " + id + " 저장 완료");
    if (tab === "save" && (announce || !timer)) render();
  } catch {
    storageAvailable = false;
    feedbackText(
      "브라우저 저장소에 접근할 수 없습니다. 파일 내보내기를 이용할 수 있습니다.",
    );
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
      if (save) loadLife(save.text, "저장된 인생을 불러왔습니다.");
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
      (text) => loadLife(text, "저장 파일을 불러왔습니다."),
      () => feedbackText("저장 파일을 읽을 수 없습니다."),
    );
  fileInput.value = "";
});
render();
void getSlots().then(
  (initial) => {
    slots = initial;
    if (revision === 0 && initial.auto) {
      loadLife(initial.auto.text, "자동 저장을 복원했습니다.");
    } else if (tab === "save") {
      render();
    }
  },
  () => {
    storageAvailable = false;
    feedbackText(
      "브라우저 저장소에 접근할 수 없습니다. 파일 내보내기를 이용할 수 있습니다.",
    );
    if (tab === "save") render();
  },
);
