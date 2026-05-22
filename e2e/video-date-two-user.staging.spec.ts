import { attachBrowserDiagnostics, expect, test } from "./diagnostics";

const enabled = process.env.VIBELY_E2E_TWO_USER_WEB === "1";
const userAStorageState = process.env.VIBELY_E2E_USER_A_STATE;
const userBStorageState = process.env.VIBELY_E2E_USER_B_STATE;
const eventId = process.env.VIBELY_E2E_EVENT_ID;

test.describe("staging web video date two-user harness", () => {
  test.skip(!enabled, "Set VIBELY_E2E_TWO_USER_WEB=1 to run the staging-only two-user video-date harness.");

  test("ready gate, early continue, reload recovery, and survey all work for two real users", async ({ browser, baseURL }, testInfo) => {
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
    const diagnosticsA = await attachBrowserDiagnostics(pageA, testInfo, "user-a");
    const diagnosticsB = await attachBrowserDiagnostics(pageB, testInfo, "user-b");
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

      const continueA = pageA.getByRole("button", { name: /continue when ready/i }).first();
      const continueB = pageB.getByRole("button", { name: /continue when ready/i }).first();
      await Promise.all([
        expect(continueA).toBeVisible({ timeout: 90_000 }),
        expect(continueB).toBeVisible({ timeout: 90_000 }),
      ]);
      await Promise.all([
        continueA.click(),
        continueB.click(),
      ]);

      await expect(pageA.getByText(/Ready to continue|Keep the vibe|Vibe|Pass/i).first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(pageB.getByText(/Ready to continue|Keep the vibe|Vibe|Pass/i).first()).toBeVisible({
        timeout: 10_000,
      });

      await pageA.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
      await expect(pageA).toHaveURL(/\/date\//, { timeout: 60_000 });

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
      await diagnosticsA.finalize();
      await diagnosticsB.finalize();
      expect([...diagnosticsA.unexpected, ...diagnosticsB.unexpected], "unexpected browser diagnostics").toEqual([]);
      await contextA.close();
      await contextB.close();
    }
  });
});
