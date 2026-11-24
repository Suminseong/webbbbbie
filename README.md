# 작가인생체험게임

0일차 망생이로 시작해 웹소설을 연재하는 브라우저 인생 시뮬레이션입니다. 작가는 시간과 상태에 따라 생활·집필을 진행하며, 플레이어는 초기 창작 경로와 주요 사건에 개입합니다.

## 실행

Node.js 20.12.2 이상과 npm이 필요합니다.

```sh
npm ci
npm run dev
```

터미널에 표시된 브라우저 주소를 엽니다. 새 인생의 시드를 정하고 0일차 선택을 하면 첫 작품이 생깁니다. 하루 진행 또는 자동 진행을 시작할 수 있습니다. 저장 탭에서 브라우저 슬롯과 파일 가져오기·내보내기를 사용할 수 있습니다.

## 검증

```sh
npm run lint
npm run build
npm test
npm run validate
npm run golden
npm run sim -- 42 60
npm run profile -- 100 730
npm run bench
npx playwright install chromium
npm run test:browser
```

`profile [시드 수] [일수] [mixed|first]`는 시드 표본의 선택 간격·사건 분포·정산 경계를 집계합니다. `bench`는 20년 진행의 일일 처리 시간·저장 크기·공개 조회 비용을 측정합니다. 규칙이나 콘텐츠를 의도적으로 바꿨다면 `npx tsx packages/cli/src/main.ts golden update "<이유>"`로 골든 해시를 갱신하고 이유를 남깁니다.

Playwright는 빌드된 브라우저 앱을 실행합니다. 기존 Chromium 계열 브라우저 실행 파일을 사용하려면 WEBBBBBIE_BROWSER_EXECUTABLE에 절대 경로를 지정합니다. Firefox 테스트는 Playwright Firefox 설치 후 WEBBBBBIE_BROWSER_KIND를 firefox로 지정합니다.

## 구조

- packages/engine — 입출력과 화면이 없는 결정적 TypeScript 엔진.
- packages/content — 직업, 작가 설정, 플랫폼 6곳, 특수 상태 10종, 분야별 사건 파일(events/*.json, 고유 사건 145건), 계수와 데이터 검증.
- packages/cli — 데이터 검증, 시드 재생 및 골든 상태 검증.
- apps/web — 기능 검증용 브라우저 UI와 IndexedDB 어댑터.
- docs — [기술 설계](docs/design.md), [화면 연동 계약](docs/view-model.md), [사건 콘텐츠 작성 안내](docs/content-authoring.md), [검증 기록](docs/verification/2026-11-25-rules-0.2.md).

요구사항은 Notion의 v0.2 기준을 따릅니다. 편결·구독, 작품별 연재·통계, 다작, 강제 사건, 적성, 계약 및 경제의 초도 구현을 포함합니다. 콘텐츠 확장과 제품 밸런스, 시각 디자인 고도화는 후속 범위입니다. 인생 종료 정책은 현재 계속 진행입니다.
