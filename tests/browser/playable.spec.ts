import { readFileSync } from "node:fs";
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
    .selectOption("2");
  await page.getByRole("button", { name: text("ui.clock.play") }).click();
  await expect(page.getByTestId("phase")).toHaveText(text("ui.clock.waiting"));
  await expect(
    page.getByRole("heading", {
      name: 1 + text("ui.clock.day-unit"),
      level: 1,
    }),
  ).toBeVisible();
  await page.locator(".event-options button").first().click();
  await expect(
    page.getByRole("heading", {
      name: 2 + text("ui.clock.day-unit"),
      level: 1,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: text("ui.clock.paused"), exact: true })
    .click();
  await expect(page.getByTestId("phase")).toHaveText(text("ui.clock.paused"));
  await expect(
    page.getByRole("combobox", { name: text("ui.clock.speed-label") }),
  ).toHaveValue("2");
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
