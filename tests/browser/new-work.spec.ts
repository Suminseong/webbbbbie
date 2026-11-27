import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

for (const id of ["forced-multi", "new-title-illness"]) {
  test(`${id} requires an accessible new-work form, restores it and creates once`, async ({
    page,
  }, info) => {
    await page.goto("/");
    await page
      .locator("#import-file")
      .setInputFiles(
        fileURLToPath(
          new URL(`../fixtures/pending-${id}.json`, import.meta.url),
        ),
      );
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await page.keyboard.press("Escape");
    await page.mouse.click(2, 2);
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
    }
    await dialog.locator("#plan-title").fill("");
    await expect(dialog.locator('button[type="submit"]')).toBeDisabled();
    await expect(dialog.locator("#plan-title")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(dialog.locator("#required-title-error")).not.toBeEmpty();
    await page.reload();
    await expect(dialog).toBeVisible();
    await dialog.locator("#plan-title").fill("모달에서 정한 신작");
    await page.setViewportSize({ width: 320, height: 700 });
    expect(
      await page
        .locator("html")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await dialog.screenshot({ path: info.outputPath(id + ".png") });
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "모달에서 정한 신작", exact: true }),
    ).toHaveCount(1);
    await expect(page.locator('[data-action="step"]')).toBeEnabled();
    await page.reload();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "모달에서 정한 신작", exact: true }),
    ).toHaveCount(1);
  });
}
