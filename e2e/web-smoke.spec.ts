import { test, expect } from "@playwright/test";

/**
 * Minimum viable automated proof: app shell renders without JS crash on trust-critical routes.
 * No auth secrets — does not prove Supabase flows (see manual golden-path runbook).
 */
test.describe("web shell smoke", () => {
  test("landing route renders", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.ok()).toBeTruthy();
    await expect(page.locator("body")).toBeVisible();
  });

  test("auth route shell loads", async ({ page }) => {
    const res = await page.goto("/auth");
    expect(res?.ok()).toBeTruthy();
    await expect(page).toHaveURL(/\/auth/);
    await expect(page.locator("body")).toBeVisible();
  });
});
