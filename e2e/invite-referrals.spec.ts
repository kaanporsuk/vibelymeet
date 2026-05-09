import { expect, test } from "./diagnostics";

const REFERRER_ID = "2cf4a5af-acc7-4450-899d-0c7dc85139e2";

test.describe("invite referrals", () => {
  test("invite landing redirects to auth, stores referral, and records growth events", async ({ page }) => {
    const growthBodies: unknown[] = [];

    await page.route("**/functions/v1/record-growth-attribution", async (route) => {
      growthBodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, recorded: true }),
      });
    });

    const response = await page.goto(`/invite?ref=${REFERRER_ID}`);
    expect(response?.ok()).toBeTruthy();
    await expect(page).toHaveURL(new RegExp(`/auth\\?ref=${REFERRER_ID}`));

    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("vibely_referrer_id")))
      .toBe(REFERRER_ID);

    await expect.poll(() => growthBodies.length).toBe(2);
    expect(growthBodies.map((body) => (body as { event_type: string }).event_type)).toEqual([
      "landing",
      "invite_click",
    ]);
    expect(growthBodies.every((body) => (body as { referral_token: string }).referral_token === REFERRER_ID)).toBe(
      true,
    );
    expect(growthBodies.every((body) => !(body as { context?: Record<string, unknown> }).context?.referral_token)).toBe(
      true,
    );
  });
});
