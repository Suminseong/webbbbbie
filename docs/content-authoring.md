# 사건 콘텐츠 작성 안내

사건은 `packages/content/events/<분야>.json`에 데이터로 추가합니다(NFR-004·009). 엔진 코드는 기존 조건·효과로 표현할 수 없는 새 규칙이 필요할 때만 바꿉니다. 파일은 `packages/content/src/index.ts`가 정한 순서로 이어 붙이며, 이 순서와 내용이 콘텐츠 해시를 정합니다.

## 분야와 계층

| 분야 `category` | 내용                                        |
| --------------- | ------------------------------------------- |
| `origin`        | 0일차 시작 경로 선택(정확히 1건)            |
| `life`          | 일상·건강·가족                              |
| `writing`       | 집필·퇴고·비축                              |
| `reader`        | 독자 반응·댓글·선작                         |
| `platform`      | 노출·기획전·공모전·플랫폼 운영              |
| `job`           | 본업·직업 전환                              |
| `community`     | 커뮤질·감평·에고서칭                        |
| `forced`        | 상태가 일으키는 강제 행동(`tier: FORCED`만) |
| `contract`      | 계약 제안과 계약 이행(`scope: CONTRACT`)    |
| `special`       | 특수 상태의 발동·해소                       |
| `money`         | 소비·사치·세금·생활비                       |

`tier`는 선정 계층입니다. `FOLLOW_UP`(예약 후속) → `FORCED` → `REGULAR` → `FALLBACK` 순으로 하루 1건을 고릅니다(T-07). 선택지가 있는 `REGULAR` 사건은 직전 선택에서 `choiceGapFloor`일 안이면 제외되고, `choiceIntervalMin` 전에는 0.3배, `choiceIntervalMax` 이후에는 3배 가중됩니다(C-08).

## 필드

- `scope` AUTHOR·WORK·CONTRACT·NONE. WORK는 조건과 `statuses`로 적격 작품을 거른 뒤 가중 추첨하고, 대상은 선정 시 고정됩니다(T-08). `targetBias`(views·newest·stock)로 대상 가중을 바꿀 수 있습니다. CONTRACT는 활성 계약 하나를 대상으로 하며, 작품 효과는 그 계약 작품에만 적용됩니다.
- `weight`, `cooldown`(일), `minDay`, `once`.
- `title`, `text`, `choices[].label`은 `text.ko.json`의 `event.<event_id>.title`, `.body`, `.choice.<choice_id>`를 참조합니다. 효과가 있는 사건에는 기존 결과 포맷 `{{event_title}} · 결과 반영`을 `.result`로 등록합니다. 임시 문구도 안정 ID를 사용하며 최종 한국어 라이팅은 Gemini가 담당합니다.
- `conditions`(모두 충족)과 `any`(하나 이상). 수치 키는 `gte`·`lte`·`eq`, 문자열 키(job·path·targetFlag·special)는 `eq`만 씁니다. `special`은 `"내글구려병:true"` 형식입니다. 작품 조건(favorites·quality·stock·contracted·workAge)은 WORK·CONTRACT 범위에서만 씁니다.
- `effects` 또는 `choices[].effects`(둘 중 하나). 효과 종류: condition, social, ability, special, clearSpecial, transition, stock, quality, consistency, attachment, readerShock, promotion, evidence, cash, job, createWork, contract(제안 사건만), flag, schedule(후속 예약), origin(0일차만).
- 특수 상태 키는 `packages/content/specials.json`에 정의돼 있어야 합니다. 정의의 `writing`(집필 배율), `stressDaily`, `driveDaily`, `egoBonus`, `communityBonus`가 매일 적용됩니다(FR-STATE-002).

## 작성 기준

- 문구 변형은 별도 사건으로 세지 않습니다. 고유 상황·조건·효과가 다를 때만 새 ID를 씁니다.
- 실제 플랫폼·회사·인물·작품명은 쓰지 않습니다(NFR-007, 제품 제외 범위).
- 멘헤라(stress)를 올리는 사건과 내리는 사건의 균형을 함께 맞추고, 변경 후 `npm run profile`로 선택 간격 중앙값(7~14일), 고스트레스 비율, 특정 사건 반복을 확인합니다.
- `npm run validate`는 참조 무결성(후속 사건·직업·특수 상태)과 분야·계층 규칙을 검사하고 분야별 수와 출시 기준까지 남은 수를 출력합니다.
