import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const loadCopy = (name: string): Record<string, string> =>
  JSON.parse(
    readFileSync(
      new URL("../../packages/content/" + name, import.meta.url),
      "utf8",
    ),
  );
const originals = loadCopy("text.ko.json");
const edits = loadCopy("text-edits.ko.json");
function text(id: string, values: Record<string, string | number> = {}) {
  const label = edits[id] ?? originals[id];
  return label.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_, name: string) =>
    String(values[name]),
  );
}

test("[FR-UI-001/003/005] starts at day 0 and accepts choice, day and speed controls", async ({
  page,
}) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: 0 + text("ui.clock.day-unit"),
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: text("event.origin.title") }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: text("ui.clock.step") }),
  ).toBeDisabled();
  await page.locator(".event-options button").first().click();
  await expect(page.locator("[data-work]")).toHaveCount(1);
  await page.getByRole("button", { name: text("ui.clock.step") }).click();
  await expect(page.getByTestId("phase")).toHaveText(text("ui.clock.waiting"));
  await page.locator(".event-options button").first().click();
  await expect(
    page.getByRole("heading", {
      name: 1 + text("ui.clock.day-unit"),
      level: 1,
    }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: text("ui.clock.speed-label") })
    .selectOption("10");
  await page.getByRole("button", { name: text("ui.clock.play") }).click();
  // Auto play runs through ordinary days and stops at the next major choice
  // (seed 42 with first options: day 9). The confirmed day stays frozen.
  await expect(page.getByTestId("phase")).toHaveText(text("ui.clock.waiting"), {
    timeout: 15_000,
  });
  const dayHeading = page.getByRole("heading", { level: 1 });
  const waitingDay = (await dayHeading.textContent()) ?? "";
  expect(waitingDay).not.toBe(1 + text("ui.clock.day-unit"));
  await page.waitForTimeout(500);
  await expect(dayHeading).toHaveText(waitingDay);
  await page.locator(".event-options button").first().click();
  await expect(dayHeading).not.toHaveText(waitingDay);
  await page
    .getByRole("button", { name: text("ui.clock.paused"), exact: true })
    .click();
  await expect(page.getByTestId("phase")).toHaveText(text("ui.clock.paused"));
  await expect(
    page.getByRole("combobox", { name: text("ui.clock.speed-label") }),
  ).toHaveValue("10");
  expect(errors).toEqual([]);
});

test("[FR-SAVE-001/002] saves a pending choice, restores across reload and preserves file round trip", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: text("ui.tab.save"), exact: true })
    .click();
  const slot = page
    .locator(".slot")
    .filter({ hasText: text("ui.save.slot", { slot: 1 }) });
  await slot
    .getByRole("button", { name: text("ui.save.write"), exact: true })
    .click();
  await expect(
    slot.getByRole("button", { name: text("ui.save.load"), exact: true }),
  ).toBeEnabled();
  await page.locator(".event-options button").first().click();
  await page.getByRole("button", { name: text("ui.clock.step") }).click();
  await page.locator(".event-options button").first().click();
  await expect(
    page.getByRole("heading", {
      name: 1 + text("ui.clock.day-unit"),
      level: 1,
    }),
  ).toBeVisible();
  await slot
    .getByRole("button", { name: text("ui.save.load"), exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: text("event.origin.title") }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: text("ui.clock.step") }),
  ).toBeDisabled();

  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: text("ui.save.export") }).click();
  const download = await downloadReady;
  const exported = info.outputPath("life.json");
  await download.saveAs(exported);
  await page.reload();
  await expect(page.getByRole("status")).toContainText(
    text("system.save.auto-restored"),
  );
  await page.locator(".event-options button").first().click();
  await expect(
    page.getByRole("heading", { name: text("event.origin.title") }),
  ).toHaveCount(0);
  await page.locator("#import-file").setInputFiles(exported);
  await expect(
    page.getByRole("heading", { name: text("event.origin.title") }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    text("system.save.imported"),
  );
  await page.locator("#import-file").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{"),
  });
  await expect(page.getByRole("status")).toContainText(
    text("system.save.file-read-error"),
  );
  await expect(
    page.getByRole("heading", { name: text("event.origin.title") }),
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
    await page.getByRole("button", { name: text("ui.clock.step") }).click();
  }
  const work = page.locator("[data-work]").first();
  expect(await page.locator("[data-work]").count()).toBeGreaterThanOrEqual(2);
  await work
    .getByRole("button", { name: text("ui.work.details-open") })
    .click();
  await expect(
    work.getByRole("heading", { name: text("ui.work.source-title") }),
  ).toBeVisible();
  await expect(work.getByText(text("ui.work.age-title"))).toBeVisible();
  await page.screenshot({
    path: info.outputPath("dashboard.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: text("ui.tab.aptitude"), exact: true })
    .click();
  await expect(
    page.getByText(text("ui.aptitude.title"), { exact: true }),
  ).toBeVisible();
  expect(await page.locator("#game").innerText()).not.toMatch(
    /trueValue|honesty/,
  );
  await page
    .getByRole("button", { name: text("ui.tab.contracts"), exact: true })
    .click();
  await expect(
    page.getByLabel(text("ui.tab.contracts"), { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: text("ui.tab.money"), exact: true })
    .click();
  await expect(
    page.getByText(text("ui.money.cash"), { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: text("ui.tab.log"), exact: true })
    .click();
  await expect(page.locator(".list-row").first()).toBeVisible();
});

test("[16번 §3,§10] plans a work with a free title, shows time policy and ends the life", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".event-options button").first().click();
  await page.getByRole("button", { name: text("ui.plan.open") }).click();
  await page.fill("#plan-title", "<i>자유 제목</i>");
  await page.locator("#plan-tag-0").check({ force: true });
  await page.getByRole("button", { name: text("ui.plan.create") }).click();
  // The title is rendered as text, never as markup.
  await expect(page.locator("[data-work]")).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "<i>자유 제목</i>" }),
  ).toBeVisible();
  await page.getByRole("button", { name: text("ui.tab.life") }).click();
  await expect(page.locator("#life-sleep")).toBeVisible();
  await page.getByRole("button", { name: text("ui.tab.save") }).click();
  await page.getByRole("button", { name: text("ui.retire.button") }).click();
  await page.getByRole("button", { name: text("ui.retire.yes") }).click();
  await expect(
    page.getByRole("heading", { name: text("ui.summary.title", { days: 0 }) }),
  ).toBeVisible();
});

test("[TC-UI-006] manages works, a shared schedule, orders, expenses and saved state", async ({
  page,
}, info) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.goto("/");
  await page.locator(".event-options button").first().click();
  await page.getByRole("button", { name: text("ui.plan.open") }).click();
  await page.locator("#plan-title").fill("직접 정한 새 작품");
  await page.locator("#plan-genre").selectOption({ index: 1 });
  await page.locator("#plan-material").selectOption({ index: 1 });
  await page.locator("#plan-platform").selectOption("nopia");
  await expect(
    page
      .locator(".chip")
      .filter({ hasText: "느린 성장" })
      .getByRole("checkbox"),
  ).toBeDisabled();
  await expect(
    page.getByText(text("ui.plan.tag-locked", { chapters: 10 })),
  ).toBeVisible();
  await page.locator("#plan-tag-0").check({ force: true });
  await page.getByRole("button", { name: text("ui.plan.create") }).click();
  const first = page.locator('[data-work="W-1"]');
  const second = page.locator('[data-work="W-2"]');
  await expect(
    second.getByRole("heading", { name: "직접 정한 새 작품" }),
  ).toBeVisible();
  await expect(second.locator(".work-sub")).toContainText(
    text("entity.platform.nopia.name"),
  );
  await expect(second.locator(".tags span")).toHaveCount(1);

  await page
    .getByRole("button", { name: text("ui.tab.life"), exact: true })
    .click();
  await page.locator("#life-rest").fill("8");
  await page
    .locator("#time-form")
    .getByRole("button", { name: text("ui.life.apply") })
    .click();
  await page.screenshot({
    path: info.outputPath("life-controls.png"),
    fullPage: true,
  });
  const medical = page
    .locator(".purchase-row")
    .filter({ hasText: text("entity.purchase.medical.name") });
  await medical
    .getByRole("button", { name: text("ui.life.purchase-button") })
    .click();
  await expect(page.getByRole("status")).toContainText(
    text("ui.life.purchase-done", {
      item: text("entity.purchase.medical.name"),
    }),
  );
  await expect(medical.getByRole("button")).toBeDisabled();
  await page.locator('button[data-action="tab"][data-tab="works"]').click();

  const step = async (day: number) => {
    await page.getByRole("button", { name: text("ui.clock.step") }).click();
    const choice = page.locator(".event-options button").first();
    if (await choice.count()) await choice.click();
    await expect(
      page.getByRole("heading", {
        name: day + text("ui.clock.day-unit"),
        level: 1,
      }),
    ).toBeVisible();
  };
  await step(1);
  await first
    .getByRole("button", { name: text("ui.work.details-open") })
    .click();
  await first
    .getByRole("button", { name: text("ui.cmd.extra-writing") })
    .click();
  await first
    .getByRole("button", { name: text("ui.cmd.rush"), exact: true })
    .click();
  await expect(
    first.getByRole("button", { name: text("ui.cmd.extra-cancel") }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: text("ui.tab.save"), exact: true })
    .click();
  const slot = page
    .locator(".slot")
    .filter({ hasText: text("ui.save.slot", { slot: 1 }) });
  await slot
    .getByRole("button", { name: text("ui.save.write"), exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    text("system.save.saved", { slot: 1 }),
  );
  await step(2);
  await page.locator('button[data-action="tab"][data-tab="works"]').click();
  await expect(first.getByText(text("ui.cmd.order-results"))).toBeVisible();
  await expect(first.locator(".work-commands")).toContainText("추가 집필");
  await expect(first.locator(".work-commands")).toContainText("추가 등록");
  await first.locator('[data-field="hiatus-kind"]').selectOption("STOCK");
  await first.locator('[data-field="hiatus-days"]').fill("2");
  await first
    .getByRole("button", { name: text("ui.cmd.hiatus"), exact: true })
    .click();
  await expect(first.locator(".work-status")).toContainText(
    text("label.work-status.hiatus"),
  );
  await step(3);
  await first
    .getByRole("button", { name: text("ui.cmd.resume"), exact: true })
    .click();
  await second
    .getByRole("button", { name: text("ui.work.details-open") })
    .click();
  await second
    .getByRole("button", { name: text("ui.cmd.drop"), exact: true })
    .click();
  await second
    .getByRole("button", { name: text("ui.cmd.drop-yes"), exact: true })
    .click();
  await expect(second.locator(".work-status")).toHaveText(
    text("label.work-status.dropped"),
  );

  await page
    .getByRole("button", { name: text("ui.tab.save"), exact: true })
    .click();
  await slot
    .getByRole("button", { name: text("ui.save.load"), exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: 1 + text("ui.clock.day-unit"),
      level: 1,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: text("ui.tab.life"), exact: true })
    .click();
  await expect(page.locator("#life-rest")).toHaveValue("8");
  await expect(medical.getByRole("button")).toBeDisabled();
  await page
    .getByRole("button", { name: text("ui.tab.money"), exact: true })
    .click();
  await page.getByText(text("ui.money.month-heading")).click();
  await expect(page.getByText(/80,000원/).first()).toBeVisible();
  await page.screenshot({
    path: info.outputPath("economy.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page
      .locator("html")
      .evaluate((root) => root.scrollWidth <= root.clientWidth),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("[FR-SAVE-001] imports a deployed 0.3.0 save and keeps its queued work", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: text("ui.tab.save"), exact: true })
    .click();
  await page
    .locator("#import-file")
    .setInputFiles(
      fileURLToPath(new URL("../fixtures/save-v0.3.0.json", import.meta.url)),
    );
  await expect(page.getByRole("status")).toContainText(
    text("system.save.imported"),
  );
  await expect(
    page.getByRole("heading", {
      name: 5 + text("ui.clock.day-unit"),
      level: 1,
    }),
  ).toBeVisible();
  await page.locator('button[data-action="tab"][data-tab="works"]').click();
  const first = page.locator('[data-work="W-1"]');
  await expect(first.locator(".work-status")).toContainText(
    text("ui.work.rush-badge", { days: 2 }),
  );
  await first
    .getByRole("button", { name: text("ui.work.details-open") })
    .click();
  await expect(
    first.getByRole("button", { name: text("ui.cmd.rush-cancel") }),
  ).toBeVisible();
});
