import { test, expect } from "./diagnostics";

async function serviceWorkerScripts(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return [];
    const registrations = await navigator.serviceWorker.getRegistrations();
    return registrations.map((registration) => ({
      scope: registration.scope,
      scripts: [registration.active, registration.waiting, registration.installing]
        .map((worker) => worker?.scriptURL ?? null)
        .filter(Boolean),
    }));
  });
}

async function unregisterAllServiceWorkers(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  });
}

test.describe("service-worker hardening", () => {
  test.afterEach(async ({ page }) => {
    await unregisterAllServiceWorkers(page).catch(() => undefined);
  });

  test("root service-worker assets are served with the expected ownership split", async ({ request }) => {
    const oneSignalSw = await request.get("/OneSignalSDK.sw.js");
    expect(oneSignalSw.ok()).toBeTruthy();
    expect(oneSignalSw.headers()["content-type"] ?? "").toMatch(/javascript|text\/plain/);
    const oneSignalSwText = await oneSignalSw.text();
    expect(oneSignalSwText).toContain("cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
    expect(oneSignalSwText).toContain("importScripts");

    const oneSignalWorker = await request.get("/OneSignalSDKWorker.js");
    expect(oneSignalWorker.ok()).toBeTruthy();
    const oneSignalWorkerText = await oneSignalWorker.text();
    expect(oneSignalWorkerText).toContain("cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

    const legacySw = await request.get("/sw.js");
    expect(legacySw.ok()).toBeTruthy();
    const legacySwText = await legacySw.text();
    expect(legacySwText).toContain("Legacy custom service worker shim");
    expect(legacySwText).not.toContain("OneSignalSDK");
    expect(legacySwText).toContain("skipWaiting");
    expect(legacySwText).toContain("clients.claim");
  });

  test("normal app load does not register the legacy custom worker", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const registrations = await serviceWorkerScripts(page);
    const scripts = registrations.flatMap((registration) => registration.scripts);
    expect(scripts.some((script) => new URL(script).pathname === "/sw.js")).toBe(false);
  });

  test("app boot unregisters a stale legacy /sw.js worker before mocked OneSignal init", async ({ page }) => {
    await page.goto("/sw.js");
    await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) throw new Error("service workers unavailable");
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      if (!registration.active) {
        await new Promise<void>((resolve) => {
          const worker = registration.installing ?? registration.waiting;
          if (!worker) {
            resolve();
            return;
          }
          worker.addEventListener("statechange", () => {
            if (worker.state === "activated") resolve();
          });
        });
      }
      await navigator.serviceWorker.ready;
    });

    await expect
      .poll(async () => {
        const registrations = await serviceWorkerScripts(page);
        return registrations.flatMap((registration) => registration.scripts).some((script) => new URL(script).pathname === "/sw.js");
      })
      .toBe(true);

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect
      .poll(async () => {
        const registrations = await serviceWorkerScripts(page);
        return registrations.flatMap((registration) => registration.scripts).some((script) => new URL(script).pathname === "/sw.js");
      })
      .toBe(false);
  });
});
