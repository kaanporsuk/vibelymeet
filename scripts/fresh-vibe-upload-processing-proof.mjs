import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import * as tus from "tus-js-client";

const ROOT = process.cwd();
const LOCAL_ENV_PATH = path.join(ROOT, ".env.local");
const CURSOR_ENV_PATH = path.join(ROOT, ".env.cursor.local");
const ARTIFACT_DIR =
  process.env.VIBE_UPLOAD_PROOF_ARTIFACT_DIR ??
  path.join(os.tmpdir(), "fresh-vibe-upload-processing-proof");
const CHROME_EXECUTABLE =
  process.env.GOOGLE_CHROME_BIN ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const SUPABASE_PROJECT_REF = "schdyxcunwcvddlcshwd";
const SUPABASE_STORAGE_KEY = `sb-${SUPABASE_PROJECT_REF}-auth-token`;
const DEFAULT_ORIGIN = "https://www.vibelymeet.com";
const ORIGINS = ["https://vibelymeet.com", DEFAULT_ORIGIN];

const PRIMARY = {
  id: "2cf4a5af-acc7-4450-899d-0c7dc85139e2",
  email: "kaanporsuk@gmail.com",
  envKey: "SMOKE_PROOF_PRIMARY_PASSWORD",
  label: "primary_ready_control",
};

const PARTNER = {
  id: "2a0995e1-8ec8-4a11-bdfe-0877c3383f5c",
  email: "direklocal@gmail.com",
  envKey: "SMOKE_PROOF_PARTNER_PASSWORD",
  label: "partner_reversible_target",
};

const POLL_INTERVAL_MS = 1000;
const READY_TIMEOUT_MS = 10 * 60 * 1000;

function parseEnvFile(contents) {
  const map = new Map();
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    map.set(key, value);
  }
  return map;
}

async function readEnvFileSafe(filePath) {
  try {
    return parseEnvFile(await readFile(filePath, "utf8"));
  } catch {
    return new Map();
  }
}

async function ensureCursorEnv() {
  const existingText = await readFile(CURSOR_ENV_PATH, "utf8").catch(() => "");
  const existing = parseEnvFile(existingText);

  const required = {
    SMOKE_PROOF_PRIMARY_EMAIL: PRIMARY.email,
    SMOKE_PROOF_PRIMARY_USER_ID: PRIMARY.id,
    SMOKE_PROOF_PARTNER_EMAIL: PARTNER.email,
    SMOKE_PROOF_PARTNER_USER_ID: PARTNER.id,
  };

  const missingPasswordKey =
    !existing.get(PRIMARY.envKey) || !existing.get(PARTNER.envKey);
  if (missingPasswordKey) {
    throw new Error(
      `Missing ${PRIMARY.envKey} or ${PARTNER.envKey} in ${CURSOR_ENV_PATH}. Run npm run proof:smoke-bootstrap first.`,
    );
  }

  const merged = new Map(existing);
  for (const [key, value] of Object.entries(required)) {
    merged.set(key, value);
  }

  const lines = Array.from(merged.entries()).map(([key, value]) => `${key}=${value}`);
  await writeFile(CURSOR_ENV_PATH, `${lines.join("\n")}\n`, "utf8");

  return {
    primaryPassword: merged.get(PRIMARY.envKey),
    partnerPassword: merged.get(PARTNER.envKey),
  };
}

async function readPublicConfig() {
  const env = await readEnvFileSafe(LOCAL_ENV_PATH);
  const supabaseUrl =
    env.get("VITE_SUPABASE_URL") ?? `https://${SUPABASE_PROJECT_REF}.supabase.co`;
  const publishableKey =
    env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? env.get("VITE_SUPABASE_ANON_KEY");

  if (!publishableKey) {
    throw new Error("Missing VITE_SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_ANON_KEY in .env.local");
  }

  return { supabaseUrl, publishableKey };
}

async function signInWithPassword({ email, password }, { supabaseUrl, publishableKey }) {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token || !body.refresh_token) {
    throw new Error(
      `Could not sign in ${email}: ${body.error_description || body.msg || body.error || response.status}`,
    );
  }
  return body;
}

function buildAuthHeaders(session, config, extra = {}) {
  return {
    apikey: config.publishableKey,
    Authorization: `Bearer ${session.access_token}`,
    ...extra,
  };
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const json = await response.json().catch(() => null);
  return { response, json };
}

async function selectSingle(session, config, relation, select, filter) {
  const { response, json } = await fetchJson(
    `${config.supabaseUrl}/rest/v1/${relation}?select=${encodeURIComponent(select)}&${filter}`,
    {
      headers: buildAuthHeaders(session, config, {
        Accept: "application/json",
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Could not read ${relation}: ${json?.message || json?.error || JSON.stringify(json)}`,
    );
  }

  return Array.isArray(json) ? json[0] ?? null : json;
}

async function invokeFunction(session, config, fnName, body = {}) {
  const { response, json } = await fetchJson(`${config.supabaseUrl}/functions/v1/${fnName}`, {
    method: "POST",
    headers: buildAuthHeaders(session, config, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `${fnName} failed (${response.status}): ${
        json?.error || json?.message || JSON.stringify(json)
      }`,
    );
  }

  return json;
}

async function getOwnProfile(session, config) {
  return selectSingle(
    session,
    config,
    "profiles",
    "id,name,bunny_video_uid,bunny_video_status,vibe_caption",
    `id=eq.${encodeURIComponent(session.user.id)}`,
  );
}

async function getMediaSession(session, config, sessionId) {
  return selectSingle(
    session,
    config,
    "draft_media_sessions",
    "id,status,provider_id,context,error_detail,created_at,updated_at,published_at",
    `id=eq.${encodeURIComponent(sessionId)}`,
  );
}

async function createFreshContext() {
  const userDataDir = await mkdtemp(path.join(ARTIFACT_DIR, "browser-"));

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: CHROME_EXECUTABLE,
    headless: true,
  });
  return { context, userDataDir };
}

async function injectSessionIntoContext(context, session) {
  const page = await context.newPage();
  const serialized = JSON.stringify(session);
  for (const origin of ORIGINS) {
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.evaluate(
      ({ storageKey, value }) => window.localStorage.setItem(storageKey, value),
      { storageKey: SUPABASE_STORAGE_KEY, value: serialized },
    );
  }
  await page.close();
}

async function dismissMaybeLaterPrompt(page) {
  const maybeLater = page.getByRole("button", { name: /Maybe Later/i }).first();
  const visible = await maybeLater.isVisible().catch(() => false);
  if (visible) {
    await maybeLater.click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);
  }
}

async function captureReadyRoute(session, label, expectedCaption) {
  const { context, userDataDir } = await createFreshContext();
  await injectSessionIntoContext(context, session);
  const page = await context.newPage();
  const screenshot = path.join(ARTIFACT_DIR, `${label}-ready-route.png`);

  try {
    await page.goto(`${DEFAULT_ORIGIN}/vibe-studio`, {
      waitUntil: "load",
      timeout: 120_000,
    });
    await page.waitForTimeout(6000);
    await dismissMaybeLaterPrompt(page);

    const bodyText = await page.locator("body").innerText();
    await page.screenshot({ path: screenshot, fullPage: true });

    return {
      url: page.url(),
      textSample: bodyText.slice(0, 700),
      readyVisible:
        bodyText.includes("Ready") || bodyText.includes("Your Vibe Video is live"),
      captionVisible:
        typeof expectedCaption === "string" && expectedCaption.trim().length > 0
          ? bodyText.includes(expectedCaption.trim())
          : null,
      screenshot,
      userDataDir,
    };
  } finally {
    await context.close();
  }
}

async function generateSyntheticVideoAsset(spec) {
  const browser = await chromium.launch({
    executablePath: CHROME_EXECUTABLE,
    headless: true,
  });
  const page = await browser.newPage();

  try {
    return await page.evaluate(async ({ label, accentA, accentB }) => {
      const mimeType =
        [
          "video/webm;codecs=vp9",
          "video/webm;codecs=vp8",
          "video/webm",
        ].find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null;

      if (!mimeType) {
        throw new Error("No supported MediaRecorder mime type found for synthetic upload asset.");
      }

      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 854;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not create 2D context.");

      const durationMs = 4200;
      const fps = 30;
      const frameCount = Math.round((durationMs / 1000) * fps);

      const drawFrame = (frame) => {
        const progress = frame / Math.max(frameCount - 1, 1);
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, accentA);
        gradient.addColorStop(1, accentB);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.beginPath();
        ctx.arc(110 + progress * 180, 150 + progress * 40, 100, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "700 44px Arial";
        ctx.fillText("Vibely Proof", 44, 120);

        ctx.font = "600 28px Arial";
        ctx.fillText(label, 44, 170);

        ctx.font = "500 22px Arial";
        ctx.fillText("Real tus upload smoke asset", 44, 220);

        ctx.strokeStyle = "rgba(255,255,255,0.65)";
        ctx.lineWidth = 10;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(44, 300);
        ctx.lineTo(44 + progress * 360, 300);
        ctx.stroke();

        ctx.fillStyle = "rgba(12,14,22,0.28)";
        ctx.fillRect(44, 640, 392, 120);
        ctx.fillStyle = "#ffffff";
        ctx.font = "700 24px Arial";
        ctx.fillText("upload -> processing -> ready", 64, 700);
        ctx.font = "500 20px Arial";
        ctx.fillText(`frame ${frame + 1} / ${frameCount}`, 64, 736);
      };

      drawFrame(0);
      const stream = canvas.captureStream(fps);
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 2_200_000,
      });

      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      const finished = new Promise((resolve, reject) => {
        recorder.onerror = () => reject(new Error("Synthetic video recorder failed."));
        recorder.onstop = async () => {
          try {
            stream.getTracks().forEach((track) => track.stop());
            const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
            const base64 = await new Promise((resolveDataUrl, rejectDataUrl) => {
              const reader = new FileReader();
              reader.onerror = () => rejectDataUrl(new Error("Could not serialize synthetic asset."));
              reader.onloadend = () => {
                const result = typeof reader.result === "string" ? reader.result : "";
                const commaIdx = result.indexOf(",");
                resolveDataUrl(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
              };
              reader.readAsDataURL(blob);
            });
            resolve({
              label,
              mimeType: blob.type || mimeType.split(";")[0],
              base64,
              size: blob.size,
              durationMs,
              width: canvas.width,
              height: canvas.height,
            });
          } catch (error) {
            reject(error);
          }
        };
      });

      recorder.start(250);
      for (let frame = 1; frame < frameCount; frame += 1) {
        await new Promise((resolve) => setTimeout(resolve, durationMs / frameCount));
        drawFrame(frame);
      }
      recorder.stop();

      return finished;
    }, spec);
  } finally {
    await browser.close();
  }
}

async function uploadBinaryToBunny(asset, credentials) {
  const payload = Buffer.from(asset.base64, "base64");
  const progress = [];

  await new Promise((resolve, reject) => {
    const upload = new tus.Upload(payload, {
      endpoint: "https://video.bunnycdn.com/tusupload",
      retryDelays: [0, 3000, 5000, 10000],
      chunkSize: 5 * 1024 * 1024,
      headers: {
        AuthorizationSignature: credentials.signature,
        AuthorizationExpire: String(credentials.expirationTime),
        VideoId: credentials.videoId,
        LibraryId: String(credentials.libraryId),
      },
      metadata: {
        filetype: asset.mimeType,
        title: `proof-${asset.label}-${Date.now()}`,
      },
      onError: (error) => reject(error),
      onProgress: (bytesUploaded, bytesTotal) => {
        const pct = Math.round((bytesUploaded / Math.max(bytesTotal, 1)) * 100);
        const last = progress.at(-1);
        if (!last || last.pct !== pct) {
          progress.push({ bytesUploaded, bytesTotal, pct });
        }
      },
      onSuccess: () => resolve(),
    });
    upload.start();
  });

  return {
    mimeType: asset.mimeType,
    sizeBytes: payload.byteLength,
    progress,
  };
}

async function waitForReadyTransition(label, session, config, expectedSessionId, expectedVideoId) {
  const startedAt = Date.now();
  const timeline = [];
  let lastProfileStatus = null;
  let lastSessionStatus = null;
  let lastProfileUid = null;
  let latestProfile = null;
  let latestMediaSession = null;

  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    const [profile, mediaSession] = await Promise.all([
      getOwnProfile(session, config),
      getMediaSession(session, config, expectedSessionId),
    ]);

    latestProfile = profile;
    latestMediaSession = mediaSession;

    const timestampIso = new Date().toISOString();
    const profileStatus = profile?.bunny_video_status ?? null;
    const profileUid = profile?.bunny_video_uid ?? null;
    const sessionStatus = mediaSession?.status ?? null;

    if (profileStatus !== lastProfileStatus || profileUid !== lastProfileUid) {
      timeline.push({
        timestampIso,
        source: "profile",
        status: profileStatus,
        bunnyVideoUid: profileUid,
      });
      lastProfileStatus = profileStatus;
      lastProfileUid = profileUid;
    }

    if (sessionStatus !== lastSessionStatus) {
      timeline.push({
        timestampIso,
        source: "draft_media_session",
        status: sessionStatus,
        sessionId: mediaSession?.id ?? expectedSessionId,
        providerId: mediaSession?.provider_id ?? null,
      });
      lastSessionStatus = sessionStatus;
    }

    if (profileUid !== expectedVideoId) {
      throw new Error(
        `${label}: profile bunny_video_uid drifted away from expected ${expectedVideoId} to ${profileUid ?? "null"}`,
      );
    }

    if (profileStatus === "failed" || sessionStatus === "failed") {
      throw new Error(
        `${label}: upload failed (profile=${profileStatus ?? "null"}, session=${sessionStatus ?? "null"})`,
      );
    }

    if (profileStatus === "ready" && sessionStatus === "ready") {
      return {
        finalProfile: profile,
        finalSession: mediaSession,
        timeline,
        observedProfileStatuses: Array.from(
          new Set(timeline.filter((step) => step.source === "profile").map((step) => step.status)),
        ),
        observedSessionStatuses: Array.from(
          new Set(
            timeline
              .filter((step) => step.source === "draft_media_session")
              .map((step) => step.status),
          ),
        ),
        observedProcessing:
          timeline.some((step) => step.status === "processing"),
      };
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `${label}: timed out waiting for ready state on video ${expectedVideoId} ` +
      `(profileStatus=${latestProfile?.bunny_video_status ?? "null"}, ` +
      `sessionStatus=${latestMediaSession?.status ?? "null"})`,
  );
}

async function ensurePartnerClean(session, config) {
  const before = await getOwnProfile(session, config);
  if (!before?.bunny_video_uid) {
    return { before, cleanupInvoked: false, after: before, cleanupResult: null };
  }

  const cleanupResult = await invokeFunction(session, config, "delete-vibe-video");
  let after = null;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    after = await getOwnProfile(session, config);
    if (!after?.bunny_video_uid && after?.bunny_video_status === "none") {
      return { before, cleanupInvoked: true, after, cleanupResult };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("Partner cleanup did not restore the expected no-video state.");
}

async function createUpload(session, config, context = "profile_studio") {
  return invokeFunction(session, config, "create-video-upload", { context });
}

async function runFreshUploadProof(partnerSession, config, asset) {
  const before = await getOwnProfile(partnerSession, config);
  const createResult = await createUpload(partnerSession, config, "profile_studio");
  const afterCreate = await getOwnProfile(partnerSession, config);
  const mediaSessionAfterCreate = await getMediaSession(partnerSession, config, createResult.sessionId);
  const upload = await uploadBinaryToBunny(asset, createResult);
  const ready = await waitForReadyTransition(
    "fresh-upload",
    partnerSession,
    config,
    createResult.sessionId,
    createResult.videoId,
  );
  const routeProof = await captureReadyRoute(
    partnerSession,
    "fresh-upload-partner",
    afterCreate?.vibe_caption ?? null,
  );

  return {
    account: PARTNER,
    asset: {
      label: asset.label,
      mimeType: asset.mimeType,
      sizeBytes: asset.size,
      durationMs: asset.durationMs,
      width: asset.width,
      height: asset.height,
    },
    before,
    createResult,
    afterCreate,
    mediaSessionAfterCreate,
    upload,
    ready,
    routeProof,
  };
}

async function runReplaceProof(partnerSession, config, asset, currentReadyVideoId, currentReadySessionId) {
  const before = await getOwnProfile(partnerSession, config);
  const createResult = await createUpload(partnerSession, config, "profile_studio");
  const afterCreate = await getOwnProfile(partnerSession, config);
  const previousSessionAfterReplace = await getMediaSession(
    partnerSession,
    config,
    currentReadySessionId,
  );
  const newSessionAfterCreate = await getMediaSession(partnerSession, config, createResult.sessionId);
  const upload = await uploadBinaryToBunny(asset, createResult);
  const ready = await waitForReadyTransition(
    "replace-upload",
    partnerSession,
    config,
    createResult.sessionId,
    createResult.videoId,
  );
  const routeProof = await captureReadyRoute(
    partnerSession,
    "replace-upload-partner",
    ready.finalProfile?.vibe_caption ?? null,
  );

  return {
    account: PARTNER,
    asset: {
      label: asset.label,
      mimeType: asset.mimeType,
      sizeBytes: asset.size,
      durationMs: asset.durationMs,
      width: asset.width,
      height: asset.height,
    },
    previousReadyVideoId: currentReadyVideoId,
    previousReadySessionId: currentReadySessionId,
    before,
    createResult,
    afterCreate,
    previousSessionAfterReplace,
    newSessionAfterCreate,
    upload,
    ready,
    routeProof,
  };
}

async function runCleanup(partnerSession, config, latestVideoId, latestSessionId) {
  const before = await getOwnProfile(partnerSession, config);
  const deleteResult = await invokeFunction(partnerSession, config, "delete-vibe-video");

  let after = null;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    after = await getOwnProfile(partnerSession, config);
    if (!after?.bunny_video_uid && after?.bunny_video_status === "none" && after?.vibe_caption == null) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!after || after.bunny_video_uid || after.bunny_video_status !== "none") {
    throw new Error("Cleanup did not restore partner to the no-video state.");
  }

  const sessionAfterCleanup = await getMediaSession(partnerSession, config, latestSessionId);

  return {
    account: PARTNER,
    latestVideoId,
    before,
    deleteResult,
    after,
    sessionAfterCleanup,
    deletedSessionId: latestSessionId,
  };
}

async function main() {
  await rm(ARTIFACT_DIR, { recursive: true, force: true }).catch(() => {});
  await mkdir(ARTIFACT_DIR, { recursive: true });

  const passwords = await ensureCursorEnv();
  if (!passwords.primaryPassword || !passwords.partnerPassword) {
    throw new Error(`Missing smoke proof passwords in ${CURSOR_ENV_PATH}.`);
  }
  const config = await readPublicConfig();

  const primarySession = await signInWithPassword(
    { email: PRIMARY.email, password: passwords.primaryPassword },
    config,
  );
  const partnerSession = await signInWithPassword(
    { email: PARTNER.email, password: passwords.partnerPassword },
    config,
  );

  const primaryControlBefore = await getOwnProfile(primarySession, config);
  const partnerPreparation = await ensurePartnerClean(partnerSession, config);

  const freshAsset = await generateSyntheticVideoAsset({
    label: "fresh upload",
    accentA: "#FF6B6B",
    accentB: "#7C3AED",
  });
  const replaceAsset = await generateSyntheticVideoAsset({
    label: "replace upload",
    accentA: "#0EA5E9",
    accentB: "#14B8A6",
  });

  const freshUpload = await runFreshUploadProof(partnerSession, config, freshAsset);
  const replaceUpload = await runReplaceProof(
    partnerSession,
    config,
    replaceAsset,
    freshUpload.ready.finalProfile?.bunny_video_uid ?? freshUpload.createResult.videoId,
    freshUpload.createResult.sessionId,
  );
  const cleanup = await runCleanup(
    partnerSession,
    config,
    replaceUpload.ready.finalProfile?.bunny_video_uid ?? replaceUpload.createResult.videoId,
    replaceUpload.createResult.sessionId,
  );
  const primaryControlAfter = await getOwnProfile(primarySession, config);

  const report = {
    artifactDir: ARTIFACT_DIR,
    accounts: {
      primaryControl: {
        id: PRIMARY.id,
        email: PRIMARY.email,
        before: primaryControlBefore,
        after: primaryControlAfter,
        intentionallyUntouched: true,
      },
      reversiblePartner: {
        id: PARTNER.id,
        email: PARTNER.email,
      },
    },
    assetStrategy: {
      kind: "synthetic_webm_via_headless_chromium_mediarecorder",
      note:
        "Assets are generated at runtime inside headless Chromium via MediaRecorder, matching the real web upload format without external files or ffmpeg.",
    },
    partnerPreparation,
    freshUpload,
    replaceUpload,
    cleanup,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
