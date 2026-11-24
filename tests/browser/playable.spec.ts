import { expect, test } from "@playwright/test";

test("[FR-UI-001/003/005] starts at day 0 and accepts choice, day and speed controls", async ({
  page,
}) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "0일차", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "왜 하필 웹소설인가" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "하루 진행" })).toBeDisabled();
  await page.locator(".event-options button").first().click();
  await expect(page.locator("[data-work]")).toHaveCount(1);
  await page.getByRole("button", { name: "하루 진행" }).click();
  await expect(page.getByTestId("phase")).toHaveText("선택 대기");
  await page.locator(".event-options button").first().click();
  await expect(
    page.getByRole("heading", { name: "1일차", level: 1 }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "진행 속도" }).selectOption("10");
  await page.getByRole("button", { name: "자동 진행" }).click();
  // Auto play runs through ordinary days and stops at the next major choice
  // (seed 42 with first options: day 9). The confirmed day stays frozen.
  await expect(page.getByTestId("phase")).toHaveText("선택 대기", {
    timeout: 15_000,
  });
  const dayHeading = page.getByRole("heading", { level: 1 });
  const waitingDay = (await dayHeading.textContent()) ?? "";
  expect(waitingDay).not.toBe("1일차");
  await page.waitForTimeout(500);
  await expect(dayHeading).toHaveText(waitingDay);
  await page.locator(".event-options button").first().click();
  await expect(dayHeading).not.toHaveText(waitingDay);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  await expect(page.getByTestId("phase")).toHaveText("일시정지");
  await expect(page.getByRole("combobox", { name: "진행 속도" })).toHaveValue(
    "10",
  );
  expect(errors).toEqual([]);
});

test("[FR-SAVE-001/002] saves a pending choice, restores across reload and preserves file round trip", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  const slot = page.locator(".slot").filter({ hasText: "슬롯 1" });
  await slot.getByRole("button", { name: "저장", exact: true }).click();
  await expect(slot).toContainText("0일차");
  await page.locator(".event-options button").first().click();
  await page.getByRole("button", { name: "하루 진행" }).click();
  await page.locator(".event-options button").first().click();
  await expect(
    page.getByRole("heading", { name: "1일차", level: 1 }),
  ).toBeVisible();
  await slot.getByRole("button", { name: "불러오기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "왜 하필 웹소설인가" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "하루 진행" })).toBeDisabled();

  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "파일 내보내기" }).click();
  const download = await downloadReady;
  const exported = info.outputPath("life.json");
  await download.saveAs(exported);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("자동 저장을 복원");
  await page.locator(".event-options button").first().click();
  await expect(
    page.getByRole("heading", { name: "왜 하필 웹소설인가" }),
  ).toHaveCount(0);
  await page.locator("#import-file").setInputFiles(exported);
  await expect(
    page.getByRole("heading", { name: "왜 하필 웹소설인가" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "저장 파일을 불러왔습니다.",
  );
  await page.locator("#import-file").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{"),
  });
  await expect(page.getByRole("status")).toContainText(
    "저장 파일을 읽을 수 없습니다",
  );
  await expect(
    page.getByRole("heading", { name: "왜 하필 웹소설인가" }),
  ).toBeVisible();
});

test("[FR-UI-002/004] renders independent works, aggregate readership, aptitude, contract and cash", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.locator(".event-options button").first().click();
  for (let day = 0; day < 32; day += 1) {
    const choice = page.locator(".event-options button").first();
    if (await choice.count()) await choice.click();
    await page.getByRole("button", { name: "하루 진행" }).click();
  }
  const work = page.locator("[data-work]").first();
  expect(await page.locator("[data-work]").count()).toBeGreaterThanOrEqual(2);
  await work.getByRole("button", { name: "작품 통계 보기" }).click();
  await expect(
    work.getByRole("heading", { name: "신규 독자 유입 경로" }),
  ).toBeVisible();
  await expect(work.getByText("신규 독자 연령대")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("dashboard.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "적성", exact: true }).click();
  await expect(page.getByText("적성 기록", { exact: true })).toBeVisible();
  expect(await page.locator("#game").innerText()).not.toMatch(
    /trueValue|honesty/,
  );
  await page.getByRole("button", { name: "계약", exact: true }).click();
  await expect(page.getByLabel("계약", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "경제", exact: true }).click();
  await expect(page.getByText("보유 자산", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "사건 일지", exact: true }).click();
  await expect(page.locator(".list-row").first()).toBeVisible();
});
