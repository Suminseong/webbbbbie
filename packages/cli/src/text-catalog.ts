import {
  appliedTexts,
  defaultContent,
  originalTexts,
  sourceText,
  textIdPattern,
  textIssue,
  textTemplate,
  variablesIn,
} from "@webbbbbie/content";
import type { Condition, Effect, EventDef } from "@webbbbbie/content";
import definitions from "../../content/events.json";
import world from "../../content/world.json";
import platforms from "../../content/platforms.json";
import staticContext from "../../content/text-context.ko.json";

export const columns = [
  "text_id",
  "category",
  "group_id",
  "context",
  "source_text",
  "revised_text",
  "variables",
  "constraints",
  "status",
  "notes",
] as const;
export const statuses = [
  "PENDING",
  "REVISED",
  "IMPORTED",
  "REVIEW_REQUIRED",
] as const;
export type Row = Record<(typeof columns)[number], string>;
type Context = Pick<Row, "category" | "group_id" | "context" | "constraints">;

const scopes = {
  AUTHOR: "작가 전체",
  WORK: "조건에 맞아 선정된 한 작품",
  CONTRACT: "선정된 유효 계약",
  NONE: "별도 대상 없음",
};
const tiers = {
  ORIGIN: "0일차 시작 경로 선택",
  REGULAR: "일과 시작 시 일반 사건의 가중 추첨",
  FORCED: "일과 시작 시 상태 조건과 재발 제한을 충족하면 강제 처리",
  FOLLOW_UP: "선행 사건에서 예약한 기한 내 일과 시작 시",
  FALLBACK: "다른 적격 사건이 없는 일과 시작 시",
};
const conditionNames: Record<Condition["key"], string> = {
  health: "건강",
  fatigue: "피로",
  stress: "멘헤라",
  drive: "창작 의욕",
  cash: "현금",
  job: "직업",
  jobSlots: "근무 슬롯",
  paid: "누적 지급 정산액",
  published: "대상 작품의 등록 회차",
  maxPublished: "활성작 중 최다 등록 회차",
  activeWorks: "활성 작품 수",
  canAddWork: "추가 작품 생성 가능",
  canContract: "대상 작품의 계약 가능",
  demand: "작가 수요",
  egoUse: "전날 에고서칭 슬롯",
  communityUse: "전날 커뮤니티 활동 슬롯",
  path: "창작 경로",
  targetFlag: "사건 이력 표식",
};
const workStatus = (key: string) =>
  sourceText("label.work-status." + key.toLowerCase().replaceAll("_", "-"));
const pathLabel = (key: string) =>
  sourceText("label.creation-path." + key.toLowerCase());
const sided = (amount: number) => (amount < 0 ? String(amount) : "+" + amount);
function conditionText(rule: Condition) {
  const value =
    rule.key === "path"
      ? pathLabel(String(rule.value))
      : rule.key === "job"
        ? (defaultContent.world.jobs.find((item) => item.id === rule.value)
            ?.name ?? rule.value)
        : rule.value;
  return (
    conditionNames[rule.key] +
    " " +
    value +
    (rule.op === "gte" ? " 이상" : rule.op === "lte" ? " 이하" : " 일치")
  );
}

function effectText(effect: Effect): { description: string; tone: -1 | 0 | 1 } {
  const amountTone = (amount: number): -1 | 0 | 1 =>
    amount > 0 ? 1 : amount < 0 ? -1 : 0;
  switch (effect.kind) {
    case "condition":
      return {
        description:
          conditionNames[effect.stat] +
          " " +
          sided(effect.amount) +
          (effect.stat === "stress" ? "(내구도 보정 적용)" : ""),
        tone: amountTone(
          effect.stat === "stress" || effect.stat === "fatigue"
            ? -effect.amount
            : effect.amount,
        ),
      };
    case "social": {
      const names = {
        recognition: "인지도",
        reputation: "평판",
        completionTrust: "완결 신뢰도",
        expectation: "차기작 기대감",
        demand: "작가 수요",
        fandom: "팬덤",
      };
      return {
        description: names[effect.stat] + " " + sided(effect.amount),
        tone: amountTone(effect.amount),
      };
    }
    case "special":
      return {
        description: effect.key + " 상태 " + effect.days + "일 부여 또는 갱신",
        tone: effect.key === "보상심리" ? 0 : -1,
      };
    case "origin":
      return {
        description:
          pathLabel(effect.path) + "로 창작 경로 확정, 첫 작품 기획 생성",
        tone: 0,
      };
    case "transition":
      return {
        description:
          "대상 작품을 " +
          workStatus(effect.to) +
          " 상태로 전환" +
          (effect.days ? " (" + effect.days + "일)" : ""),
        tone: ["HIATUS", "RUSHED_END", "DROPPED", "TAKEN_DOWN"].includes(
          effect.to,
        )
          ? -1
          : 1,
      };
    case "stock":
      return {
        description: "대상 작품 비축 " + sided(effect.amount) + "화",
        tone: amountTone(effect.amount),
      };
    case "quality":
      return {
        description: "대상 작품 품질 " + sided(effect.amount),
        tone: amountTone(effect.amount),
      };
    case "readerShock":
      return {
        description:
          "대상 작품의 진행 중인 독자와 최신화 대기 독자 " +
          Math.round(effect.amount * 100) +
          "% 이탈",
        tone: -1,
      };
    case "createWork":
      return {
        description:
          "작가가 순수 창작 신작을 하나 기획. 집필 자원을 기존 작품과 공유",
        tone: 0,
      };
    case "cash":
      return {
        description: "현금 원장 " + sided(effect.amount) + "원",
        tone: amountTone(effect.amount),
      };
    case "job":
      return {
        description:
          "직업을 " +
          (defaultContent.world.jobs.find((job) => job.id === effect.id)
            ?.name ?? effect.id) +
          "로 전환",
        tone: 0,
      };
    case "evidence":
      return {
        description:
          "대상 작품 관련 적성 근거 " +
          sided(effect.amount) +
          " 시도. 같은 날에는 중복 적립하지 않음",
        tone: 1,
      };
    case "contract":
      return {
        description:
          "대상 작품의 공개 조건으로 계약 체결 및 선인세 입금. 지원 이행에는 비공개 회사 특성이 영향",
        tone: 0,
      };
    case "flag":
      return {
        description: "사건 이력에 " + effect.key + " 표식 기록",
        tone: 0,
      };
    case "schedule":
      return {
        description:
          effect.delay +
          "일 뒤부터 후속 사건 " +
          effect.id +
          "의 후보가 열림. 추가 " +
          effect.window +
          "일 동안 유효",
        tone: 0,
      };
  }
}

function effectSummary(effects: readonly Effect[]) {
  if (!effects.length) return "수치와 상태를 바꾸는 별도 효과 없음.";
  const meaning = effects.map(effectText);
  const good = meaning.some((item) => item.tone > 0);
  const bad = meaning.some((item) => item.tone < 0);
  const tone =
    good && bad
      ? "득실 혼합"
      : good
        ? "긍정"
        : bad
          ? "부정"
          : "중립 또는 상황에 따라 달라짐";
  return tone + ". " + meaning.map((item) => item.description).join(", ") + ".";
}

function eventFrame(event: EventDef) {
  const when = event.minDay > 0 ? "최소 " + event.minDay + "일차." : "0일차.";
  const statuses = event.statuses?.map(workStatus).join(", ");
  const required = event.conditions?.map(conditionText).join(", ");
  const alternatives = event.any?.map(conditionText).join(" 또는 ");
  return [
    tiers[event.tier] + ".",
    when,
    "대상은 " + scopes[event.scope] + ".",
    statuses ? "대상 상태 " + statuses + "." : "",
    required ? "필수 조건 " + required + "." : "",
    alternatives ? "추가 조건 중 하나 " + alternatives + "." : "",
    event.cooldown > 0 ? "재발 제한 " + event.cooldown + "일." : "",
    event.once ? "인생당 한 번." : "",
    event.offer
      ? "선택 시 제안사·정산 비율·선인세·기간·지원 약속만 공개. 회사 성향과 실제 지원 이행은 불확실."
      : event.choices
        ? "선택 전에 사건 설명과 현재 대상이 공개됨. 선택 결과와 내부 수치는 아직 미확정."
        : "사건 선정 조건과 내부 수치는 본문으로 공개하지 않음.",
  ]
    .filter(Boolean)
    .join(" ");
}

function eventContexts(out: Map<string, Context>) {
  const tone = "웹소설 작가 커뮤니티 문체. 엔진에서 정한 조건과 효과를 유지.";
  for (const raw of definitions) {
    const event = defaultContent.events.find((item) => item.id === raw.id)!;
    const group = "event." + event.id;
    const frame = eventFrame(event);
    const branches = event.choices
      ?.map((choice) => choice.label + " → " + effectSummary(choice.effects))
      .join(" ");
    const overview =
      frame +
      " " +
      (branches ? "선택 결과 " + branches : effectSummary(event.effects ?? []));
    out.set(raw.title, {
      category: "EVENTS",
      group_id: group,
      context: "사건 제목. " + overview,
      constraints: "짧은 제목. " + tone,
    });
    out.set(raw.text, {
      category: "EVENTS",
      group_id: group,
      context: "사건 본문. " + overview,
      constraints:
        "보이지 않는 결과와 비공개 특성을 미리 단정하지 않음. " + tone,
    });
    for (const option of raw.choices ?? []) {
      const choice = event.choices!.find((item) => item.id === option.id)!;
      out.set(option.label, {
        category: "CHOICES",
        group_id: group,
        context:
          "선택 버튼과 확정 후 일지에 표시됨. " +
          frame +
          " 행동은 ‘" +
          choice.label +
          "’. 실제 결과 " +
          effectSummary(choice.effects),
        constraints: "한 줄 버튼 우선. 선택의 의도와 효과가 어긋나지 않게.",
      });
    }
    if (
      event.effects?.length ||
      event.choices?.some((choice) => choice.effects.length)
    ) {
      out.set(group + ".result", {
        category: "RESULTS",
        group_id: group,
        context:
          "효과 적용 완료 후 공개 엔진 이벤트에 발생하는 기존 결과 포맷. 선택지별 새 결과 본문은 없다. " +
          overview,
        constraints:
          "사건 제목 변수를 유지. 각 효과가 모두 일어났다고 단정하지 않음.",
      });
    }
  }
}

function entityContexts(out: Map<string, Context>) {
  function add(
    id: string,
    context: string,
    group = id.replace(/\.[^.]+$/, ""),
    constraints = "기존 명칭의 의미를 유지.",
  ) {
    if (!out.has(id))
      out.set(id, {
        category: "DESCRIPTIONS",
        group_id: group,
        context,
        constraints,
      });
  }
  for (const item of world.jobs)
    add(
      item.name,
      "작가 프로필의 직업명. 기본 근무 " +
        item.slots +
        "슬롯, 월 본업 수입 " +
        item.income +
        "원. 수치는 별도 게임 규칙이다.",
    );
  for (const item of world.homes)
    add(
      item.name,
      "작가 프로필에서 나이·직업과 함께 표시하는 거주·작업 공간명.",
    );
  for (const item of world.motives)
    add(
      item.text,
      "작가 프로필의 첫 집필 동기. 새 게임 시작 때 정해지고 " +
        item.paths.map(pathLabel).join(", ") +
        " 경로가 선택지로 제시될 수 있다.",
      "entity.motive",
      "인용부호는 UI가 붙인다. 가능한 경로는 변경하지 않음.",
    );
  for (const id of world.penNames)
    add(
      id,
      "시드로 초기에 부여되는 작가 필명. 작가 프로필과 저장 슬롯에 표시.",
      "entity.pen",
    );
  for (const item of world.works) {
    add(
      item.title,
      "작품 카드와 사건 일지에 나오는 자동 생성 작품 제목. 장르 " +
        sourceText(item.genre) +
        ", 소재 " +
        sourceText(item.material) +
        ".",
    );
    add(
      item.genre,
      "작품 카드 분류와 같은 장르의 적성 항목에 같이 표시하는 이름.",
      "entity.genre",
    );
    add(
      item.material,
      "작품 카드의 소재 분류와 소재 적성 항목에 같이 표시.",
      "entity.material",
    );
    for (const tag of item.tags)
      add(
        tag,
        "작품 카드의 해시태그와 태그 적성에 표시. 플랫폼 선호 매칭에서도 같은 내부 식별자로 사용됨.",
        "entity.tag",
        "#은 UI가 붙인다.",
      );
  }
  for (const item of platforms)
    add(
      item.name,
      "작품 카드와 플랫폼 적성에 표시하는 가상 플랫폼명. 결제 유형 " +
        (item.model === "EPISODE" ? "편결" : "구독") +
        ". 선호 태그 " +
        item.tags.map(sourceText).join(", ") +
        ".",
    );
  for (const item of world.companies) {
    add(
      item.name,
      "계약 제안 카드와 수락한 계약 목록의 가상 매니지먼트사명. 이름만으로 내부 성향을 확정할 수 없음.",
    );
    add(
      item.promise,
      "해당 회사의 제안 카드에 보이는 프로모션·편집 지원 약속. 계약 체결 후 실제 이행과 구별.",
    );
  }
  for (const raw of definitions) {
    const effects = [
      ...(raw.effects ?? []),
      ...(raw.choices ?? []).flatMap((choice) => choice.effects),
    ];
    for (const effect of effects) {
      if (
        effect.kind === "special" &&
        "key" in effect &&
        typeof effect.key === "string" &&
        "days" in effect
      ) {
        add(
          effect.key,
          "조건을 충족한 사건에서 부여·갱신되어 작가 패널에 표시되는 특수 상태 이름. 이 정의의 지속 기간 " +
            effect.days +
            "일.",
          "entity.special",
        );
      }
    }
  }
}

export function catalogRows(
  edits: Readonly<Record<string, string>> = appliedTexts,
): Row[] {
  const contexts = new Map<string, Context>();
  eventContexts(contexts);
  entityContexts(contexts);
  for (const [id, ctx] of Object.entries(staticContext)) contexts.set(id, ctx);
  // A platform tag may be a matching-only key with no implemented display.
  const internalTags = new Set(
    platforms
      .flatMap((platform) => platform.tags)
      .filter((id) => !contexts.has(id)),
  );
  for (const [id, value] of Object.entries(originalTexts)) {
    if (!textIdPattern.test(id) || textIssue(value, value))
      throw new Error("Invalid source resource: " + id);
    if (!contexts.has(id) && !internalTags.has(id))
      throw new Error("Missing display context: " + id);
  }
  for (const [id, value] of Object.entries(edits)) {
    const issue = textIssue(sourceText(id), value);
    if (issue) throw new Error("Invalid text override " + id + ": " + issue);
  }
  return [...contexts].map(([id, info]) => ({
    text_id: id,
    ...info,
    source_text: textTemplate(id, edits),
    revised_text: "",
    variables: variablesIn(sourceText(id))
      .map((key) => "{{" + key + "}}")
      .join(", "),
    status: Object.hasOwn(edits, id) ? "IMPORTED" : "PENDING",
    notes: "",
  }));
}
