# 사건 콘텐츠 작성 안내

규칙 0.3.8: 강제 1·계약 11·특수 8·소비 11건 추가, **300/300건 달성**. 분야별 누계는 시작 1·생활 34·집필 37·독자 36·플랫폼 28·직업 29·커뮤니티 33·강제 18·계약 31·특수 25·소비 28이다. 직전 0.3.7 고정 해시 `cae23b88`, 현재 해시 `19918655`. 실제 이전 저장 8종을 로드해 60일 진행·왕복한다. 고유한 조건·효과 조합 95건, 모든 분기·대상 격리·재발생 제한·계약 로그의 작품 연결을 검사한다.

최종 `npm run profile -- 100 730`(mixed): 전체 269/300건·신규 90/95건 발생, 선택 간격 p25 4/중앙 7/p75 9일, 음수 독자·수용량 초과·초과 지급 0. 미발생 신규는 `blackout-evening`, `reference-source-note`, `forced-annotation-spree`, `forced-voice-rewrite`, `special-burnout-boundary`이며 모두 구성한 상태로 발생·효과를 검사한다. 드문 상태·사용자 시간 방침을 자동 정책이 모두 밟는다고 가정하지 않는다. 대표 시드는 0(다작·강제 휴재·완결), 1(계약·급완결), 5(비공개)이며 최초 선택만 따르는 경우와 혼합 정책의 결과는 다를 수 있다. 필수 신작 모달 브라우저 재현 파일은 규칙 0.3.4 당시 시드 1/9일차 `forced-multi`, 시드 4/130일차 `new-title-illness`의 첫 선택 경로를 보관한 파일이다. 현재 사건 풀에서도 그 날짜가 같다고 주장하지 않는다.

규칙 0.3.7: 독자 1·플랫폼 10·직업 9·커뮤니티 10·강제 2건을 추가해 269건. 강제 신작은 기존 필수 설정 대기 인터페이스를 사용한다. 100시드×730일에서 이번 묶음 32/32건 발생(누적 신규 62/64건), 선택 간격 중앙값 7일, 독자·수용량·지급 경계 위반 0. 직전 0.3.6 해시 `4a557dbd` 및 실제 저장을 마이그레이션 목록에 추가했다. 계약 사건 기록의 대상이 계약 ID로 남아 작품 이력에서 빠지는 결함을 실제 작품 ID로 연결하고, 정산 지연 같은 작품 상태 기록도 이력 필터에 포함했다. 시장 계수는 그대로다.

Notion 17번 확장 기록(규칙 0.3.6): 생활·집필·독자 32건을 추가해 237건. `tests/fixtures/events300-ids.json`은 이번 95건의 누적 ID 목록이며 조건·모든 선택·효과·고정 대상·재발생 제한은 `tests/events300.test.ts`가 제품 선정/효과 코드로 검증한다. 타이머→스트레칭, 백업→이름표, 지도 답변→독자 회신은 예약 후속이다. `npm run profile -- 100 730`에서 신규 30/32건 발생, 자동 생활 방침에 없는 휴식 ≤1 슬롯(`blackout-evening`)·플롯 ≥3 슬롯(`reference-source-note`)은 구성한 상태로 발생/효과를 검증했다. 선택 간격 중앙값 7일, 음수 독자·수용량 초과·미수익 초과 지급 모두 0. 기존 시장·계약사·지속 상태 계수는 변경하지 않았다. 0.3.5 고정 해시 `0ead2bf0`를 이전 버전 목록에 추가했으며 실제 0.3.0/0.3.2/0.3.4 대기/0.3.5 저장에서 60일 진행·왕복을 검사한다. `tools/capture-save.ts <새 경로>`로 변경 전 실제 버전 저장을 보관할 수 있다(기존 파일 덮어쓰기 금지).

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
- `conditions`(모두 충족)과 `any`(하나 이상). 수치 키는 `gte`·`lte`·`eq`, 문자열 키(job·path·targetFlag·special)는 `eq`만 씁니다. `special`은 `"내글구려병:true"` 형식입니다. 작품 조건(favorites·quality·stock·contracted·workAge·prep·consistency·attachment)은 WORK·CONTRACT 범위에서만 씁니다. 시간 배분 조건 sleepSlots·restSlots·plotSlots·writingSlots는 전날 실제 슬롯, hiatusWorks는 휴재 작품 수입니다(0.3.3). 선호작·지급액은 0.3 시장에서 분포가 낮으니(활성 작품 선호작 중앙값 1 미만) 문턱을 `npm run profile`의 coverage로 확인하세요.
- `effects` 또는 `choices[].effects`(둘 중 하나). 효과 종류: condition, social, ability, special, clearSpecial, transition, stock, quality, consistency, attachment, readerShock, promotion, evidence, cash, job, createWork, contract(제안 사건만), flag, schedule(후속 예약), origin(0일차만).
- 특수 상태 키는 `packages/content/specials.json`에 정의돼 있어야 합니다. 정의의 `writing`(집필 배율), `stressDaily`, `driveDaily`, `egoBonus`, `communityBonus`가 매일 적용됩니다(FR-STATE-002).

## 작성 기준

- 문구 변형은 별도 사건으로 세지 않습니다. 고유 상황·조건·효과가 다를 때만 새 ID를 씁니다.
- 실제 플랫폼·회사·인물·작품명은 쓰지 않습니다(NFR-007, 제품 제외 범위).
- 멘헤라(stress)를 올리는 사건과 내리는 사건의 균형을 함께 맞추고, 변경 후 `npm run profile`로 선택 간격 중앙값(7~14일), 고스트레스 비율, 특정 사건 반복을 확인합니다.
- `npm run validate`는 참조 무결성(후속 사건·직업·특수 상태)과 분야·계층 규칙을 검사하고 분야별 수와 출시 기준까지 남은 수를 출력합니다.
