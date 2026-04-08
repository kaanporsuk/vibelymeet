import { mkdtemp, readFile, mkdir, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const CHROME_DEFAULT_PROFILE = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "Default",
);

const PROFILE_COPY_ITEMS = [
  "Local Storage",
  "Cookies",
  "Preferences",
  "Network",
  "IndexedDB",
  "Session Storage",
];

const SUPABASE_PROJECT_REF = "schdyxcunwcvddlcshwd";
const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
const SUPABASE_STORAGE_KEY = `sb-${SUPABASE_PROJECT_REF}-auth-token`;
const ARTIFACT_DIR =
  process.env.BROWSER_AUTH_PROOF_DIR ??
  path.join(os.tmpdir(), "browser-auth-runtime-proof");
const CHROME_EXECUTABLE =
  process.env.GOOGLE_CHROME_BIN ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function getTodaySlotDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function readPublishableKey() {
  if (process.env.SUPABASE_PUBLISHABLE_KEY) {
    return process.env.SUPABASE_PUBLISHABLE_KEY;
  }

  const envLocal = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
  for (const line of envLocal.split("\n")) {
    if (line.startsWith("VITE_SUPABASE_PUBLISHABLE_KEY=")) {
      return line.split("=", 2)[1].trim().replace(/^['"]|['"]$/g, "");
    }
    if (line.startsWith("VITE_SUPABASE_ANON_KEY=")) {
      return line.split("=", 2)[1].trim().replace(/^['"]|['"]$/g, "");
    }
  }

  throw new Error("Could not resolve Supabase publishable key from env.");
}

async function prepareProfileCopy() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibely-browser-auth-"));
  const defaultDir = path.join(root, "Default");
  await mkdir(defaultDir, { recursive: true });

  for (const item of PROFILE_COPY_ITEMS) {
    const source = path.join(CHROME_DEFAULT_PROFILE, item);
    const destination = path.join(defaultDir, item);
    await cp(source, destination, { recursive: true, force: true }).catch(() => {});
  }

  return root;
}

async function createBrowserContext() {
  const userDataDir = await prepareProfileCopy();
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: CHROME_EXECUTABLE,
    headless: true,
  });
  return { context, userDataDir };
}

async function collectEvents(page, action) {
  const events = [];
  const push = (type, text) => {
    if (events.length < 30) {
      events.push({ type, text });
    }
  };

  const onConsole = (msg) => push(`console:${msg.type()}`, msg.text());
  const onPageError = (err) => push("pageerror", String(err));
  const onRequestFailed = (req) =>
    push("requestfailed", `${req.failure()?.errorText ?? "failed"} ${req.url()}`);
  const onResponse = (res) => {
    if (res.status() >= 400) {
      push("response", `${res.status()} ${res.request().method()} ${res.url()}`);
    }
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);

  try {
    return { result: await action(), events };
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("requestfailed", onRequestFailed);
    page.off("response", onResponse);
  }
}

async function getCurrentSession(page) {
  return page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  }, SUPABASE_STORAGE_KEY);
}

async function fetchSlot(page, publishableKey, slotKey) {
  return page.evaluate(
    async ({ storageKey, slotKey: key, publishableKey: apikey, supabaseUrl }) => {
      const raw = window.localStorage.getItem(storageKey);
      const session = raw ? JSON.parse(raw) : null;
      const accessToken = session?.access_token;
      const url = `${supabaseUrl}/rest/v1/user_schedules?select=slot_key,slot_date,time_block,status&slot_key=eq.${encodeURIComponent(key)}`;
      const response = await fetch(url, {
        headers: {
          apikey,
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
      return {
        status: response.status,
        json: await response.json().catch(() => null),
      };
    },
    {
      storageKey: SUPABASE_STORAGE_KEY,
      slotKey,
      publishableKey,
      supabaseUrl: SUPABASE_URL,
    },
  );
}

async function runScheduleProof(context, publishableKey) {
  const page = await context.newPage();
  const screenshotBase = path.join(ARTIFACT_DIR, "schedule");

  const { result, events } = await collectEvents(page, async () => {
    await page.goto("https://www.vibelymeet.com/schedule", {
      waitUntil: "load",
      timeout: 120_000,
    });
    await page.waitForTimeout(8_000);

    const morning = page.locator("button").nth(5);
    const afternoon = page.locator("button").nth(6);
    const slotDate = getTodaySlotDate();
    const morningKey = `${slotDate}_morning`;
    const afternoonKey = `${slotDate}_afternoon`;

    await page.screenshot({ path: `${screenshotBase}-initial.png`, fullPage: true });

    await morning.click();
    await page.waitForTimeout(3_000);
    const morningSaved = await fetchSlot(page, publishableKey, morningKey);
    await page.screenshot({ path: `${screenshotBase}-saved.png`, fullPage: true });

    let forcedFailureHit = false;
    await page.route("**/rest/v1/user_schedules*", async (route) => {
      const request = route.request();
      if (!forcedFailureHit && request.method() === "POST") {
        forcedFailureHit = true;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            code: "proof_forced_failure",
            message: "forced rollback proof",
          }),
        });
        return;
      }
      await route.continue();
    });

    await afternoon.click();
    await page.waitForTimeout(3_000);
    await page.unroute("**/rest/v1/user_schedules*");
    const afternoonAfterFailure = await fetchSlot(page, publishableKey, afternoonKey);
    await page.screenshot({ path: `${screenshotBase}-rollback.png`, fullPage: true });

    await morning.click();
    await page.waitForTimeout(3_000);
    const morningAfterCleanup = await fetchSlot(page, publishableKey, morningKey);
    await page.screenshot({ path: `${screenshotBase}-cleanup.png`, fullPage: true });

    return {
      slotDate,
      morningKey,
      afternoonKey,
      textSample: await page.locator("body").innerText(),
      morningSaved,
      afternoonAfterFailure,
      morningAfterCleanup,
      buttonTexts: {
        morning: (await morning.textContent())?.trim() ?? null,
        afternoon: (await afternoon.textContent())?.trim() ?? null,
      },
      forcedFailureHit,
      screenshots: {
        initial: `${screenshotBase}-initial.png`,
        saved: `${screenshotBase}-saved.png`,
        rollback: `${screenshotBase}-rollback.png`,
        cleanup: `${screenshotBase}-cleanup.png`,
      },
    };
  });

  await page.close();
  return { ...result, events };
}

async function runReferralsProof(context) {
  const page = await context.newPage();
  const screenshot = path.join(ARTIFACT_DIR, "referrals.png");

  const { result, events } = await collectEvents(page, async () => {
    await page.goto("https://www.vibelymeet.com/settings/referrals", {
      waitUntil: "load",
      timeout: 120_000,
    });
    await page.waitForTimeout(8_000);

    await page.evaluate(() => {
      window.__vibelyCopied = null;
      navigator.clipboard.writeText = async (text) => {
        window.__vibelyCopied = text;
      };
    });

    await page.getByRole("button", { name: "Copy link" }).click();
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: screenshot, fullPage: true });

    return page.evaluate(() => ({
      url: window.location.href,
      textSample: document.body.innerText.slice(0, 400),
      inviteLink:
        Array.from(document.querySelectorAll("p"))
          .map((element) => element.textContent?.trim())
          .find((value) => value?.includes("/invite?ref=")) ?? null,
      copied: window.__vibelyCopied ?? null,
      hasLinkedStatus:
        document.body.innerText.includes("No invite linked yet") ||
        document.body.innerText.includes("You joined from"),
      screenshot: null,
    }));
  });

  result.screenshot = screenshot;
  await page.close();
  return { ...result, events };
}

async function runInviteLandingProof(userId) {
  const browser = await chromium.launch({
    executablePath: CHROME_EXECUTABLE,
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const screenshot = path.join(ARTIFACT_DIR, "invite-landing.png");

  const { result, events } = await collectEvents(page, async () => {
    await page.goto(`https://www.vibelymeet.com/invite?ref=${userId}`, {
      waitUntil: "load",
      timeout: 120_000,
    });
    await page.waitForTimeout(8_000);
    await page.screenshot({ path: screenshot, fullPage: true });
    return page.evaluate(() => ({
      url: window.location.href,
      textSample: document.body.innerText.slice(0, 400),
      storedRef: window.localStorage.getItem("vibely_referrer_id"),
      screenshot: null,
    }));
  });

  result.screenshot = screenshot;
  await browser.close();
  return { ...result, events };
}

async function runOneSignalProof(context) {
  const page = await context.newPage();
  const screenshot = path.join(ARTIFACT_DIR, "onesignal-dashboard.png");

  const { result, events } = await collectEvents(page, async () => {
    await page.goto("https://www.vibelymeet.com/dashboard", {
      waitUntil: "load",
      timeout: 120_000,
    });
    await page.waitForTimeout(10_000);
    await page.screenshot({ path: screenshot, fullPage: true });

    return page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const session = JSON.parse(window.localStorage.getItem("sb-schdyxcunwcvddlcshwd-auth-token") || "null");
      const oneSignal = window.OneSignal;
      let pushSubscriptionId = null;
      let pushOptedIn = null;
      let oneSignalUserId = null;

      try {
        pushSubscriptionId = await oneSignal?.User?.PushSubscription?.id;
        pushOptedIn = oneSignal?.User?.PushSubscription?.optedIn ?? null;
        oneSignalUserId = oneSignal?.User?.onesignalId ?? null;
      } catch {
        // ignore
      }

      return {
        url: window.location.href,
        userId: session?.user?.id ?? null,
        notificationPermission: Notification.permission,
        hasOneSignalDeferred: Array.isArray(window.OneSignalDeferred),
        hasOneSignal: Boolean(oneSignal),
        pushSubscriptionId,
        pushOptedIn,
        oneSignalUserId,
        serviceWorkers: registrations.map((registration) => ({
          scope: registration.scope,
          activeScript: registration.active?.scriptURL ?? null,
          waitingScript: registration.waiting?.scriptURL ?? null,
        })),
        textSample: document.body.innerText.slice(0, 200),
        screenshot: null,
      };
    });
  });

  result.screenshot = screenshot;
  await page.close();
  return { ...result, events };
}

async function runVibeStudioProof(context) {
  const page = await context.newPage();
  const screenshot = path.join(ARTIFACT_DIR, "vibe-studio.png");

  const { result, events } = await collectEvents(page, async () => {
    await page.goto("https://www.vibelymeet.com/vibe-studio", {
      waitUntil: "load",
      timeout: 120_000,
    });
    await page.waitForTimeout(8_000);
    await page.screenshot({ path: screenshot, fullPage: true });
    return page.evaluate(() => ({
      url: window.location.href,
      textSample: document.body.innerText.slice(0, 300),
      screenshot: null,
    }));
  });

  result.screenshot = screenshot;
  await page.close();
  return { ...result, events };
}

async function runFreshPermissionAttempt(validSession) {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "vibely-browser-auth-fresh-"));
  await mkdir(path.join(userDataDir, "Default"), { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: CHROME_EXECUTABLE,
    headless: true,
  });
  const page = await context.newPage();

  const { result, events } = await collectEvents(page, async () => {
    for (const origin of ["https://vibelymeet.com", "https://www.vibelymeet.com"]) {
      await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.evaluate(
        ({ storageKey, session }) => window.localStorage.setItem(storageKey, session),
        { storageKey: SUPABASE_STORAGE_KEY, session: validSession },
      );
    }

    await page.goto("https://www.vibelymeet.com/schedule", {
      waitUntil: "load",
      timeout: 120_000,
    });
    await page.waitForTimeout(10_000);

    const before = await page.evaluate(() => ({
      permission: Notification.permission,
      userId: JSON.parse(window.localStorage.getItem("sb-schdyxcunwcvddlcshwd-auth-token") || "null")?.user?.id ?? null,
      textSample: document.body.innerText.slice(0, 250),
    }));

    const bellButton = page.locator("header button").nth(1);
    await bellButton.click();
    await page.waitForTimeout(1_000);
    const enableButton = page.getByRole("button", { name: "Enable Notifications" });
    const enableVisible = await enableButton.isVisible().catch(() => false);

    let after = null;
    if (enableVisible) {
      await enableButton.click();
      await page.waitForTimeout(5_000);
      after = await page.evaluate(() => ({
        permission: Notification.permission,
        textSample: document.body.innerText.slice(0, 350),
      }));
    }

    return { before, enableVisible, after };
  });

  await context.close();
  return { ...result, events };
}

async function main() {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const publishableKey = await readPublishableKey();
  const { context, userDataDir } = await createBrowserContext();

  try {
    const sessionPage = await context.newPage();
    await sessionPage.goto("https://www.vibelymeet.com/dashboard", {
      waitUntil: "load",
      timeout: 120_000,
    });
    await sessionPage.waitForTimeout(5_000);
    const currentSession = await getCurrentSession(sessionPage);
    await sessionPage.close();

    const result = {
      artifactDir: ARTIFACT_DIR,
      userDataDir,
      currentSession: {
        userId: currentSession?.user?.id ?? null,
        email: currentSession?.user?.email ?? null,
      },
      schedule: await runScheduleProof(context, publishableKey),
      referrals: await runReferralsProof(context),
      inviteLanding: await runInviteLandingProof(currentSession?.user?.id ?? ""),
      oneSignal: await runOneSignalProof(context),
      vibeStudio: await runVibeStudioProof(context),
      freshPermissionAttempt: await runFreshPermissionAttempt(
        JSON.stringify(currentSession),
      ),
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
