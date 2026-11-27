import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const copy: Record<string, string> = JSON.parse(
  readFileSync(
    new URL("../../packages/content/text.ko.json", import.meta.url),
    "utf8",
  ),
);
const edits: Record<string, string> = JSON.parse(
  readFileSync(
    new URL("../../packages/content/text-edits.ko.json", import.meta.url),
    "utf8",
  ),
);
const t = (key: string) => edits[key] ?? copy[key];
for (const width of [320, 390])
  test(`work management at ${width}px supports ending preparation and journal filters`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await page.locator('#start-form button[type="submit"]').click();
    for (let i = 0; i < 5; i++) {
      await page.locator('[data-action="step"]').click();
      if (await page.locator(".event-options button").count())
        await page.locator(".event-options button").first().click();
      if (await page.getByRole("dialog").isVisible())
        await page.locator('#required-work-form button[type="submit"]').click();
    }
    const work = page.locator("[data-work]").first();
    await work.locator(".details-toggle").click();
    await expect(
      work.getByText(t("ui.work.trend-14"), { exact: true }),
    ).toBeVisible();
    await expect(
      work.getByRole("img", { name: t("ui.work.quality-trend") }),
    ).toBeVisible();
    await work.locator('[data-field="ending-remaining"]').fill("20");
    await work.locator('[data-action="prepare-ending"]').click();
    await work.locator("[data-journal]").selectOption("commands");
    await expect(work.locator(".work-journal")).toContainText("20");
    await page.keyboard.press("Tab");
    expect(
      await page
        .locator("html")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await work.screenshot({
      path: info.outputPath(`work-detail-${width}.png`),
    });
    await page.reload();
    await page
      .locator("[data-work]")
      .first()
      .locator(".details-toggle")
      .click();
    await expect(page.locator("[data-work]").first()).toContainText(
      t("ui.cmd.ending-target").split("{{")[0],
    );
  });
