import { expect, test } from "@playwright/test";

const enabled = process.env.VIBELY_E2E_TWO_USER_WEB === "1";
const userAStorageState = process.env.VIBELY_E2E_USER_A_STATE;
const userBStorageState = process.env.VIBELY_E2E_USER_B_STATE;
const eventId = process.env.VIBELY_E2E_EVENT_ID;

test.describe("staging web video date two-user harness", () => {
  test.skip(!enabled, "Set VIBELY_E2E_TWO_USER_WEB=1 to run the staging-only two-user video-date harness.");

  test("ready gate handoff reaches a real two-user video date and post-date survey", async ({ browser, baseURL }) => {
    test.skip(
      !userAStorageState || !userBStorageState || !eventId,
      "Requires VIBELY_E2E_USER_A_STATE, VIBELY_E2E_USER_B_STATE, and VIBELY_E2E_EVENT_ID.",
    );

    const contextA = await browser.newContext({
      baseURL,
      storageState: userAStorageState,
      permissions: ["camera", "microphone"],
    });
    const contextB = await browser.newContext({
      baseURL,
      storageState: userBStorageState,
      permissions: ["camera", "microphone"],
    });

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    try {
      await Promise.all([
        pageA.goto(`/event/${encodeURIComponent(eventId!)}/lobby`),
        pageB.goto(`/event/${encodeURIComponent(eventId!)}/lobby`),
      ]);

      await Promise.all([
        pageA.getByRole("button", { name: /ready/i }).click({ timeout: 60_000 }),
        pageB.getByRole("button", { name: /ready/i }).click({ timeout: 60_000 }),
      ]);

      await Promise.all([
        expect(pageA).toHaveURL(/\/date\//, { timeout: 90_000 }),
        expect(pageB).toHaveURL(/\/date\//, { timeout: 90_000 }),
      ]);

      await expect(pageA.getByRole("button", { name: /^Vibe$/ })).toBeVisible({ timeout: 90_000 });
      await expect(pageB.getByRole("button", { name: /^Pass$/ })).toBeVisible({ timeout: 90_000 });
      await Promise.all([
        pageA.getByRole("button", { name: /^Vibe$/ }).click(),
        pageB.getByRole("button", { name: /^Pass$/ }).click(),
      ]);

      await pageA.getByRole("button", { name: /end date/i }).click({ timeout: 180_000 });
      await expect(pageA.getByText(/Keep the vibe|Awaiting your match|How was/i).first()).toBeVisible({
        timeout: 60_000,
      });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
