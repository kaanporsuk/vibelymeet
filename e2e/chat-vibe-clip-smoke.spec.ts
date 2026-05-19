import { statSync } from "node:fs";

import { test, expect } from "./diagnostics";
import {
  CHAT_VIBE_CLIP_SMOKE_MATRIX,
  CHAT_VIBE_CLIP_WEB_SMOKE_ENV,
  type ChatVibeClipSmokeRow,
} from "../shared/chat/vibeClipSmokeMatrix";

const webRows = CHAT_VIBE_CLIP_SMOKE_MATRIX.filter((row) => row.platform === "web");
const liveSmokeEnabled = process.env.VIBELY_CVC_SMOKE === "1";
const storageState = process.env.VIBELY_CVC_WEB_STORAGE_STATE;

// Matrix scenario ids: happy-path, 4g-throttle, kill-mid-tus, webhook-delayed,
// signed-url-mid-expiry, app-launch-stuck-processing-nudge.

function requiredEnv(name: (typeof CHAT_VIBE_CLIP_WEB_SMOKE_ENV)[number]) {
  const value = process.env[name]?.trim();
  test.skip(!value, `Set ${name} to run the live Chat Vibe Clip smoke matrix.`);
  return value!;
}

async function openVibeClipLibraryPicker(page: import("@playwright/test").Page) {
  await expect(page.getByTestId("chat-attachment-toggle")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("chat-attachment-toggle").click();
  await expect(page.getByTestId("chat-attachment-tray")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("chat-add-vibe-clip").click();
  await expect(page.getByTestId("vibe-clip-send-options")).toBeVisible({ timeout: 10_000 });
}

async function enableFourGThrottle(page: import("@playwright/test").Page) {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: 1_600_000 / 8,
    uploadThroughput: 750_000 / 8,
  });
  return session;
}

async function runLibraryUploadScenario(
  row: ChatVibeClipSmokeRow,
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
) {
  testInfo.setTimeout(row.timeoutMs);
  const chatUrl = requiredEnv("VIBELY_CVC_WEB_CHAT_URL");
  const fixtureVideo = requiredEnv("VIBELY_CVC_FIXTURE_VIDEO");
  test.skip(
    row.id === "kill-mid-tus" && process.env.VIBELY_CVC_DISRUPTION_SMOKE !== "1",
    "Set VIBELY_CVC_DISRUPTION_SMOKE=1 on staging to inject the kill-mid-TUS reload.",
  );
  test.skip(
    row.id === "app-launch-stuck-processing-nudge",
    "app-launch-stuck-processing-nudge uses the stale-row mount path, not a fresh library upload.",
  );
  statSync(fixtureVideo);

  const evidence: Record<string, unknown> = {
    row_id: row.rowId,
    scenario: row.id,
    required_evidence: row.requiredEvidence,
    started_at: new Date().toISOString(),
  };

  let cdpSession: Awaited<ReturnType<typeof enableFourGThrottle>> | null = null;
  if (row.id === "4g-throttle") {
    cdpSession = await enableFourGThrottle(page);
    evidence.network_throttle = "chromium 4g-ish latency/throughput";
  }

  await page.goto(chatUrl);
  await openVibeClipLibraryPicker(page);

  const createResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/functions/v1/create-chat-vibe-clip-upload") &&
    response.request().method() === "POST"
  );
  const completeResponsePromise = row.id === "kill-mid-tus"
    ? null
    : page.waitForResponse((response) =>
      response.url().includes("/functions/v1/complete-chat-vibe-clip-upload") &&
      response.request().method() === "POST"
    );

  await page.getByTestId("vibe-clip-library-input").setInputFiles(fixtureVideo);
  const createResponse = await createResponsePromise;
  evidence.create_status = createResponse.status();
  expect(createResponse.ok(), "create-chat-vibe-clip-upload returned 2xx").toBeTruthy();

  if (row.id === "kill-mid-tus") {
    await page.reload({ waitUntil: "domcontentloaded" });
    evidence.disruption = "page reload injected after create response";
    await expect(page.getByTestId("chat-attachment-toggle")).toBeVisible({ timeout: 30_000 });
  } else {
    const completeResponse = await completeResponsePromise!;
    evidence.complete_status = completeResponse.status();
    expect(completeResponse.ok(), "complete-chat-vibe-clip-upload returned 2xx").toBeTruthy();
  }

  const bubble = page.getByTestId("vibe-clip-bubble").last();
  await expect(bubble).toBeVisible({ timeout: 60_000 });
  evidence.bubble_processing_status = await bubble.getAttribute("data-processing-status");

  if (row.id === "webhook-delayed" && process.env.VIBELY_CVC_EXPECT_READY === "1") {
    await expect(bubble).toHaveAttribute("data-processing-status", /ready|failed/, { timeout: row.timeoutMs / 2 });
    evidence.final_processing_status = await bubble.getAttribute("data-processing-status");
  }

  if (row.id === "signed-url-mid-expiry") {
    const video = bubble.locator("video").first();
    await video.evaluate((node) => node.dispatchEvent(new Event("error"))).catch(() => undefined);
    await expect(bubble).toBeVisible({ timeout: 5_000 });
    evidence.signed_url_refresh_probe = "video error dispatched; bubble stayed mounted for refresh path";
  }

  if (cdpSession) {
    await cdpSession.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await cdpSession.detach();
  }

  evidence.finished_at = new Date().toISOString();
  await testInfo.attach(`${row.id}-evidence`, {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
}

async function runStuckProcessingNudgeScenario(
  row: ChatVibeClipSmokeRow,
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
) {
  testInfo.setTimeout(row.timeoutMs);
  const chatUrl = requiredEnv("VIBELY_CVC_WEB_CHAT_URL");
  const clientRequestId = requiredEnv("VIBELY_CVC_STUCK_CLIENT_REQUEST_ID");
  const evidence: Record<string, unknown> = {
    row_id: row.rowId,
    scenario: row.id,
    required_evidence: row.requiredEvidence,
    client_request_id: clientRequestId,
    started_at: new Date().toISOString(),
  };

  const syncResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/functions/v1/sync-chat-vibe-clip-status") &&
    response.request().method() === "POST",
  );
  await page.goto(chatUrl);
  const syncResponse = await syncResponsePromise;
  evidence.sync_status = syncResponse.status();
  expect(syncResponse.ok(), "sync-chat-vibe-clip-status returned 2xx").toBeTruthy();
  await expect(
    page.getByTestId("vibe-clip-recovery-panel").or(page.getByTestId("vibe-clip-bubble")).last(),
  ).toBeVisible({ timeout: 5_000 });
  evidence.finished_at = new Date().toISOString();
  await testInfo.attach(`${row.id}-evidence`, {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
}

test.describe("@chat-vibe-clip Chat Vibe Clip live smoke matrix", () => {
  test.skip(!liveSmokeEnabled, "Set VIBELY_CVC_SMOKE=1 to run live staging Chat Vibe Clip smoke.");
  if (storageState) test.use({ storageState });

  for (const row of webRows) {
    test(`${row.id}: ${row.title}`, async ({ page }, testInfo) => {
      if (row.id === "app-launch-stuck-processing-nudge") {
        await runStuckProcessingNudgeScenario(row, page, testInfo);
      } else {
        await runLibraryUploadScenario(row, page, testInfo);
      }
    });
  }
});
