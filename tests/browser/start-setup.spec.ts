import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
for (const width of [1440, 390, 320])
  test(`custom author and first work at ${width}px keep initial stats and survive reload`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const start = page.locator("#start-form"),
      background = page.locator(".start-background");
    await expect(start).toBeVisible();
    await expect(page.locator('[data-action="step"]')).toHaveCount(0);
    const conditions = await background
      .locator(".start-scores dd")
      .allTextContents();
    expect(conditions).toHaveLength(12);
    const original = await background.innerText();
    const penName =
      width === 320 ? "abcdefghijklmnopqrstuvwxyzABCD" : "<b>나의 필명</b>";
    await page.locator("#start-penName").fill(penName);
    await page.locator("#start-message").fill("오늘도 한 문장.\n<img src=x>");
    await page
      .locator("#start-motive")
      .fill("내가 읽고 싶은 이야기를 쓰려고.\n두 번째 이유도 있다.");
    await page.locator("#plan-title").fill("<i>직접 정한 첫 작품</i>");
    await page
      .locator("#plan-description")
      .fill("첫 작품의 줄거리\n<b>소개는 수치와 무관</b>");
    await page.locator("#plan-platform").selectOption("nopia");
    while (await page.locator(".tag-picker input:checked").count())
      await page
        .locator(".tag-picker input:checked")
        .first()
        .uncheck({ force: true });
    await page.locator("#plan-tag-0").check({ force: true });
    await page.locator("#plan-tag-1").check({ force: true });
    expect(await background.innerText()).toBe(original);
    expect(
      await page
        .locator("html")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`start-${width}.png`),
      fullPage: true,
    });
    await start.locator('button[type="submit"]').click();
    await expect(start).toHaveCount(0);
    await expect(page.locator("[data-work]")).toHaveCount(1);
    await expect(page.locator(".author h2")).toHaveText(penName);
    expect(
      await page
        .locator("html")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await expect(page.locator(".author .motive")).toContainText("<img src=x>");
    await expect(page.locator(".work-description")).toContainText(
      "<b>소개는 수치와 무관</b>",
    );
    expect(
      await page.locator(".author img,.author b,.work-description b").count(),
    ).toBe(0);
    await page.locator('[data-action="tab"][data-tab="save"]').click();
    const awaited = page.waitForEvent("download");
    await page.locator('[data-action="export"]').click();
    const downloaded = await awaited;
    const file = info.outputPath("custom-start.json");
    await downloaded.saveAs(file);
    const save = JSON.parse(readFileSync(file, "utf8"));
    expect(save.state.day).toBe(0);
    expect(save.state.archive).toHaveLength(1);
    expect(save.state.works).toHaveLength(1);
    expect(
      [
        ...Object.values(save.state.author.condition),
        ...Object.values(save.state.author.abilities),
      ].map(Number),
    ).toEqual(conditions.map(Number));
    expect(save.state.author.identity.penName).toBe(penName);
    expect(save.state.works[0]).toMatchObject({
      description: "첫 작품의 줄거리\n<b>소개는 수치와 무관</b>",
      platformId: "nopia",
    });
    expect(save.state.works[0].tags).toHaveLength(2);
    await page.reload();
    await expect(page.locator("#start-form")).toHaveCount(0);
    await expect(page.locator(".author h2")).toHaveText(penName);
    await expect(page.locator(".work-description")).toContainText(
      "첫 작품의 줄거리",
    );
    expect(errors).toEqual([]);
  });
test("new-start preview can be cancelled without replacing the current life or auto save", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#start-penName").fill("유지할 작가");
  await page.locator('#start-form button[type="submit"]').click();
  await page.locator("#seed").fill("99");
  await page.locator('#new-life button[type="submit"]').click();
  await expect(page.locator("#start-form")).toBeVisible();
  await page.locator("#start-penName").fill("취소할 작가");
  await page.locator('[data-action="start-cancel"]').click();
  await expect(page.locator(".author h2")).toHaveText("유지할 작가");
  await expect(page.locator("#seed")).toHaveValue("42");
  await page.reload();
  await expect(page.locator(".author h2")).toHaveText("유지할 작가");
  await expect(page.locator("#start-form")).toHaveCount(0);
});
test("required profile and work inputs block an empty start and remain keyboard accessible", async ({
  page,
}) => {
  await page.goto("/");
  const begin = page.locator('#start-form button[type="submit"]');
  await page.locator("#start-penName").fill("  ");
  await expect(begin).toBeDisabled();
  await expect(page.locator("#start-error")).not.toBeEmpty();
  await page.locator("#start-penName").fill("새 작가");
  await page.keyboard.press("Tab");
  await expect(page.locator("#start-message")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#start-motive")).toBeFocused();
  await page.locator("#start-motive").fill("");
  await expect(begin).toBeDisabled();
  await page.locator("#start-motive").fill("직접 적은 이유");
  await page.locator("#plan-title").fill("");
  await expect(begin).toBeDisabled();
  await page.locator("#plan-title").fill("새 제목");
  await expect(begin).toBeEnabled();
});
