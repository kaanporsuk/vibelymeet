import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { chromium } from "playwright";

const execFileAsync = promisify(execFile);

const ROOT = process.cwd();
const LOCAL_ENV_PATH = path.join(ROOT, ".env.local");
const CURSOR_ENV_PATH = path.join(ROOT, ".env.cursor.local");
const ARTIFACT_DIR =
  process.env.SMOKE_PROOF_ARTIFACT_DIR ??
  path.join(os.tmpdir(), "fresh-smoke-proof-bootstrap");
const CHROME_EXECUTABLE =
  process.env.GOOGLE_CHROME_BIN ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const SUPABASE_PROJECT_REF = "schdyxcunwcvddlcshwd";
const SUPABASE_STORAGE_KEY = `sb-${SUPABASE_PROJECT_REF}-auth-token`;
const PROOF_TAG = "[fresh-smoke-proof-bootstrap]";
const DEFAULT_ORIGIN = "https://www.vibelymeet.com";
const ORIGINS = ["https://vibelymeet.com", DEFAULT_ORIGIN];

const PRIMARY = {
  id: "2cf4a5af-acc7-4450-899d-0c7dc85139e2",
  email: "kaanporsuk@gmail.com",
  envKey: "SMOKE_PROOF_PRIMARY_PASSWORD",
  label: "primary",
};

const PARTNER = {
  id: "2a0995e1-8ec8-4a11-bdfe-0877c3383f5c",
  email: "direklocal@gmail.com",
  envKey: "SMOKE_PROOF_PARTNER_PASSWORD",
  label: "partner",
};

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

function upsertEnvContent(existing, updates) {
  const lines = existing ? existing.split("\n") : [];
  const indexByKey = new Map();

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    indexByKey.set(trimmed.slice(0, idx).trim(), i);
  }

  for (const [key, value] of Object.entries(updates)) {
    const nextLine = `${key}=${value}`;
    if (indexByKey.has(key)) {
      lines[indexByKey.get(key)] = nextLine;
    } else {
      lines.push(nextLine);
    }
  }

  return `${lines.filter(Boolean).join("\n")}\n`;
}

function generatePassword() {
  return randomBytes(18).toString("base64url");
}

async function ensureCursorEnv() {
  const existingText = await readFile(CURSOR_ENV_PATH, "utf8").catch(() => "");
  const existing = parseEnvFile(existingText);
  const updates = {
    SMOKE_PROOF_PRIMARY_PASSWORD:
      existing.get("SMOKE_PROOF_PRIMARY_PASSWORD") ?? generatePassword(),
    SMOKE_PROOF_PARTNER_PASSWORD:
      existing.get("SMOKE_PROOF_PARTNER_PASSWORD") ?? generatePassword(),
    SMOKE_PROOF_PRIMARY_EMAIL: PRIMARY.email,
    SMOKE_PROOF_PRIMARY_USER_ID: PRIMARY.id,
    SMOKE_PROOF_PARTNER_EMAIL: PARTNER.email,
    SMOKE_PROOF_PARTNER_USER_ID: PARTNER.id,
    SMOKE_PROOF_TAG: PROOF_TAG,
  };

  const next = upsertEnvContent(existingText, updates);
  await writeFile(CURSOR_ENV_PATH, next, "utf8");
  return updates;
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

function extractJsonEnvelope(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Could not parse Supabase CLI JSON output: ${stdout}`);
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

async function runLinkedSql(sql) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "fresh-smoke-sql-"));
  const sqlFile = path.join(tempDir, "query.sql");
  await writeFile(sqlFile, sql, "utf8");
  try {
    const { stdout, stderr } = await execFileAsync(
      "supabase",
      ["db", "query", "--linked", "--file", sqlFile, "--output", "json"],
      {
        cwd: ROOT,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    const parsed = extractJsonEnvelope(stdout);
    if (stderr?.trim()) {
      parsed.stderr = stderr.trim();
    }
    return parsed.rows ?? [];
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
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

function flattenVibeLabels(vibeRows) {
  const rows = Array.isArray(vibeRows) ? vibeRows : [];
  return rows.flatMap((row) => {
    const vibeTags = row?.vibe_tags;
    if (!vibeTags) return [];
    if (Array.isArray(vibeTags)) {
      return vibeTags
        .map((tag) => (typeof tag?.label === "string" ? tag.label.trim() : ""))
        .filter(Boolean);
    }
    return typeof vibeTags?.label === "string" && vibeTags.label.trim()
      ? [vibeTags.label.trim()]
      : [];
  });
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const json = await response.json().catch(() => null);
  return { response, json };
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

async function invokeRpc(session, config, rpcName, body) {
  const { response, json } = await fetchJson(`${config.supabaseUrl}/rest/v1/rpc/${rpcName}`, {
    method: "POST",
    headers: buildAuthHeaders(session, config, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `${rpcName} failed (${response.status}): ${
        json?.message || json?.error || JSON.stringify(json)
      }`,
    );
  }

  return json;
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

function isoAt(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function buildRevision(label, startsAt, endsAt) {
  return {
    date_type_key: "video_date",
    time_choice_key: "pick_a_time",
    place_mode_key: "custom_venue",
    venue_text: `${PROOF_TAG} ${label} venue`,
    optional_message: `${PROOF_TAG} ${label}`,
    schedule_share_enabled: false,
    starts_at: startsAt,
    ends_at: endsAt,
    time_block: null,
  };
}

async function sendProposal(session, config, matchId, label, startsAt, endsAt) {
  const result = await invokeFunction(session, config, "date-suggestion-actions", {
    action: "send_proposal",
    payload: {
      match_id: matchId,
      revision: buildRevision(label, startsAt, endsAt),
    },
  });

  if (result?.ok === false || !result?.suggestion_id) {
    throw new Error(
      `send_proposal failed for ${label}: ${result?.error || JSON.stringify(result)}`,
    );
  }

  return result;
}

async function acceptProposal(session, config, suggestionId) {
  const result = await invokeFunction(session, config, "date-suggestion-actions", {
    action: "accept",
    payload: {
      suggestion_id: suggestionId,
    },
  });

  if (result?.ok === false) {
    throw new Error(`accept failed for ${suggestionId}: ${result?.error || JSON.stringify(result)}`);
  }

  return result;
}

async function getLatestSmokeMatchId() {
  const rows = await runLinkedSql(`
    select id
    from public.matches
    where (
      profile_id_1 = '${PRIMARY.id}' and profile_id_2 = '${PARTNER.id}'
    ) or (
      profile_id_1 = '${PARTNER.id}' and profile_id_2 = '${PRIMARY.id}'
    )
    order by matched_at desc
    limit 1;
  `);

  if (!rows[0]?.id) {
    throw new Error("Could not resolve the smoke match id for the proof accounts.");
  }

  return rows[0].id;
}

async function resetLinkedState(passwords, matchId) {
  const rows = await runLinkedSql(`
    update auth.users
    set encrypted_password = extensions.crypt('${passwords.primary}', extensions.gen_salt('bf')),
        updated_at = now()
    where id = '${PRIMARY.id}';

    update auth.users
    set encrypted_password = extensions.crypt('${passwords.partner}', extensions.gen_salt('bf')),
        updated_at = now()
    where id = '${PARTNER.id}';

    update public.profiles
    set referred_by = null
    where id in ('${PRIMARY.id}', '${PARTNER.id}');

    do $$
    declare
      v_suggestion_ids uuid[] := '{}';
      v_plan_ids uuid[] := '{}';
    begin
      select
        coalesce(array_agg(distinct ds.id), '{}'::uuid[]),
        coalesce(
          array_agg(distinct coalesce(ds.date_plan_id, dp.id))
          filter (where coalesce(ds.date_plan_id, dp.id) is not null),
          '{}'::uuid[]
        )
      into v_suggestion_ids, v_plan_ids
      from public.date_suggestions ds
      left join public.date_plans dp
        on dp.date_suggestion_id = ds.id
      where ds.id in (
        select distinct tagged.id
        from (
          select ds1.id
          from public.date_suggestions ds1
          join public.date_suggestion_revisions dr1
            on dr1.date_suggestion_id = ds1.id
          where ds1.match_id = '${matchId}'
            and (
              coalesce(dr1.optional_message, '') like '${PROOF_TAG}%'
              or coalesce(dr1.venue_text, '') like '${PROOF_TAG}%'
            )

          union

          select ds2.id
          from public.date_suggestions ds2
          where ds2.match_id = '${matchId}'
            and ds2.current_revision_id is null
            and ds2.updated_at > now() - interval '2 days'
        ) tagged
      );

      if coalesce(array_length(v_plan_ids, 1), 0) > 0 then
        delete from public.date_plan_participants
        where date_plan_id = any(v_plan_ids);

        delete from public.date_plans
        where id = any(v_plan_ids)
           or date_suggestion_id = any(v_suggestion_ids);
      end if;

      if coalesce(array_length(v_suggestion_ids, 1), 0) > 0 then
        delete from public.messages
        where ref_id = any(v_suggestion_ids);

        delete from public.date_suggestion_revisions
        where date_suggestion_id = any(v_suggestion_ids);

        delete from public.date_suggestions
        where id = any(v_suggestion_ids);
      end if;
    end $$;

    select
      '${PRIMARY.id}'::uuid as primary_user_id,
      '${PARTNER.id}'::uuid as partner_user_id,
      '${matchId}'::uuid as match_id;
  `);

  return rows[0] ?? null;
}

async function seedScheduleProofData(primarySession, partnerSession, config, matchId) {
  const upcomingStart = isoAt(20 * 60 * 1000);
  const upcomingEnd = isoAt(50 * 60 * 1000);
  const historyStart = isoAt(-2 * 60 * 60 * 1000);
  const historyEnd = isoAt(-(90 * 60 * 1000));
  const pendingStart = isoAt(2 * 24 * 60 * 60 * 1000);
  const pendingEnd = isoAt(2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000);

  const upcoming = await sendProposal(
    primarySession,
    config,
    matchId,
    "upcoming",
    upcomingStart,
    upcomingEnd,
  );
  await acceptProposal(partnerSession, config, upcoming.suggestion_id);

  const history = await sendProposal(
    primarySession,
    config,
    matchId,
    "history",
    historyStart,
    historyEnd,
  );
  await acceptProposal(partnerSession, config, history.suggestion_id);

  const pending = await sendProposal(
    primarySession,
    config,
    matchId,
    "pending",
    pendingStart,
    pendingEnd,
  );

  return {
    upcomingSuggestionId: upcoming.suggestion_id,
    historySuggestionId: history.suggestion_id,
    pendingSuggestionId: pending.suggestion_id,
  };
}

async function createFreshContext() {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "fresh-smoke-browser-"));
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

async function collectEvents(page, action) {
  const events = [];
  const push = (type, text) => {
    if (events.length < 40) {
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

async function dismissMaybeLaterPrompt(page) {
  const maybeLater = page.getByRole("button", { name: /Maybe Later/i }).first();
  const visible = await maybeLater.isVisible().catch(() => false);
  if (visible) {
    await maybeLater.click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);
  }
}

async function captureScheduleProof(primarySession, config) {
  const { context, userDataDir } = await createFreshContext();
  await injectSessionIntoContext(context, primarySession);
  const page = await context.newPage();
  const screenshot = path.join(ARTIFACT_DIR, "smoke-schedule.png");

  try {
    const { result, events } = await collectEvents(page, async () => {
      await page.goto(`${DEFAULT_ORIGIN}/schedule`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      await page.waitForTimeout(6_000);
      await dismissMaybeLaterPrompt(page);

      const tabTexts = await page.locator('[role="tab"]').allTextContents();
      const reminderVisible = await page.locator("text=Upcoming Dates").isVisible().catch(() => false);
      const reminderText = reminderVisible
        ? await page.locator("text=Upcoming Dates").locator("..").innerText().catch(() => null)
        : null;

      const captureTab = async (name) => {
        const tab = page
          .locator('[role="tab"]')
          .filter({ hasText: new RegExp(`^${name}\\s*\\(`, "i") })
          .first();
        await tab.scrollIntoViewIfNeeded().catch(() => {});
        await tab.click({ force: true });
        await page.waitForTimeout(800);
        return page.locator("body").innerText();
      };

      const pendingText = await captureTab("Pending");
      const upcomingText = await captureTab("Upcoming");
      const historyText = await captureTab("History");

      await page.screenshot({ path: screenshot, fullPage: true });

      return {
        url: page.url(),
        tabTexts,
        reminderVisible,
        reminderText,
        pendingHasTag: pendingText.includes(`${PROOF_TAG} pending`),
        upcomingHasTag: upcomingText.includes(`${PROOF_TAG} upcoming`),
        historyHasTag: historyText.includes(`${PROOF_TAG} history`),
        pendingTextSample: pendingText.slice(0, 500),
        upcomingTextSample: upcomingText.slice(0, 500),
        historyTextSample: historyText.slice(0, 500),
        screenshot,
      };
    });

    const dashboardPage = await context.newPage();
    const dashboard = await collectEvents(dashboardPage, async () => {
      await dashboardPage.goto(`${DEFAULT_ORIGIN}/dashboard`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      await dashboardPage.waitForTimeout(5_000);
      await dismissMaybeLaterPrompt(dashboardPage);
      return {
        url: dashboardPage.url(),
        bodyText: (await dashboardPage.locator("body").innerText()).slice(0, 400),
        countdownText: await dashboardPage
          .locator("button")
          .filter({ hasText: /Direk|Kaan/ })
          .first()
          .textContent()
          .catch(() => null),
      };
    });
    await dashboardPage.close();

    return { ...result, dashboard: dashboard.result, dashboardEvents: dashboard.events, events, userDataDir };
  } finally {
    await context.close();
  }
}

async function getOwnProfile(session, config) {
  return selectSingle(
    session,
    config,
    "profiles",
    "id,referred_by,bunny_video_uid,bunny_video_status,vibe_caption,name",
    `id=eq.${encodeURIComponent(session.user.id)}`,
  );
}

async function fetchPublicProfileSnapshot(session, config, profileId) {
  const profile = await selectSingle(
    session,
    config,
    "profiles",
    "id,name,age,tagline,about_me,location,relationship_intent,looking_for,photo_verified,bunny_video_uid,bunny_video_status,vibe_caption",
    `id=eq.${encodeURIComponent(profileId)}`,
  );

  if (!profile?.id) {
    throw new Error(`Could not load public-profile snapshot for ${profileId}`);
  }

  const { response, json } = await fetchJson(
    `${config.supabaseUrl}/rest/v1/profile_vibes?select=vibe_tags(label)&profile_id=eq.${encodeURIComponent(profileId)}`,
    {
      headers: buildAuthHeaders(session, config, {
        Accept: "application/json",
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Could not load profile vibes for ${profileId}: ${
        json?.message || json?.error || JSON.stringify(json)
      }`,
    );
  }

  return {
    ...profile,
    vibes: flattenVibeLabels(json),
  };
}

async function captureReferralProof(sourceSession, targetSession, config) {
  const selfContext = await createFreshContext();
  await injectSessionIntoContext(selfContext.context, sourceSession);
  const selfPage = await selfContext.context.newPage();
  const selfScreenshot = path.join(ARTIFACT_DIR, "smoke-referral-self.png");

  try {
    const selfAttempt = await collectEvents(selfPage, async () => {
      await selfPage.goto(`${DEFAULT_ORIGIN}/auth?ref=${sourceSession.user.id}`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      await selfPage.waitForTimeout(6_000);
      await dismissMaybeLaterPrompt(selfPage);
      await selfPage.screenshot({ path: selfScreenshot, fullPage: true });
      return {
        url: selfPage.url(),
        storedRef: await selfPage.evaluate(() => window.localStorage.getItem("vibely_referrer_id")),
        profile: await getOwnProfile(sourceSession, config),
        screenshot: selfScreenshot,
      };
    });
    await selfPage.close();
    await selfContext.context.close();

    const targetContext = await createFreshContext();
    const targetPage = await targetContext.context.newPage();
    const inviteScreenshot = path.join(ARTIFACT_DIR, "smoke-referral-invite.png");
    const referralsScreenshot = path.join(ARTIFACT_DIR, "smoke-referral-settings.png");

    try {
      const setOnce = await collectEvents(targetPage, async () => {
        await targetPage.goto(`${DEFAULT_ORIGIN}/invite?ref=${sourceSession.user.id}`, {
          waitUntil: "load",
          timeout: 120_000,
        });
        await targetPage.waitForTimeout(2_000);
        const landing = await targetPage.evaluate(() => ({
          url: window.location.href,
          storedRef: window.localStorage.getItem("vibely_referrer_id"),
          textSample: document.body.innerText.slice(0, 300),
        }));

        await injectSessionIntoContext(targetContext.context, targetSession);
        await targetPage.goto(`${DEFAULT_ORIGIN}/auth?ref=${sourceSession.user.id}`, {
          waitUntil: "load",
          timeout: 120_000,
        });
        await targetPage.waitForTimeout(6_000);
        await dismissMaybeLaterPrompt(targetPage);
        await targetPage.screenshot({ path: inviteScreenshot, fullPage: true });

        await targetPage.goto(`${DEFAULT_ORIGIN}/settings/referrals`, {
          waitUntil: "load",
          timeout: 120_000,
        });
        await targetPage.waitForTimeout(4_000);
        await dismissMaybeLaterPrompt(targetPage);
        await targetPage.screenshot({ path: referralsScreenshot, fullPage: true });

        return {
          landing,
          postAuthUrl: targetPage.url(),
          storedRefAfterAuth: await targetPage.evaluate(() =>
            window.localStorage.getItem("vibely_referrer_id"),
          ),
          profile: await getOwnProfile(targetSession, config),
          referralsText: (await targetPage.locator("body").innerText()).slice(0, 500),
          inviteScreenshot,
          referralsScreenshot,
        };
      });

      const secondAttempt = await collectEvents(targetPage, async () => {
        await targetPage.goto(`${DEFAULT_ORIGIN}/auth?ref=${sourceSession.user.id}`, {
          waitUntil: "load",
          timeout: 120_000,
        });
        await targetPage.waitForTimeout(5_000);
        await dismissMaybeLaterPrompt(targetPage);
        return {
          url: targetPage.url(),
          storedRefAfterRetry: await targetPage.evaluate(() =>
            window.localStorage.getItem("vibely_referrer_id"),
          ),
          profile: await getOwnProfile(targetSession, config),
        };
      });

      return {
        selfAttempt: { ...selfAttempt.result, events: selfAttempt.events },
        setOnce: { ...setOnce.result, events: setOnce.events },
        repeatAttempt: { ...secondAttempt.result, events: secondAttempt.events },
      };
    } finally {
      await targetPage.close().catch(() => {});
      await targetContext.context.close().catch(() => {});
    }
  } catch (error) {
    await selfContext.context.close().catch(() => {});
    throw error;
  }
}

async function captureVibeReadyAndCaptionProof(primarySession, config) {
  const originalProfile = await getOwnProfile(primarySession, config);
  const originalCaption = originalProfile?.vibe_caption ?? "";
  const tempCaption = `${PROOF_TAG} caption`;

  const { context } = await createFreshContext();
  await injectSessionIntoContext(context, primarySession);
  const page = await context.newPage();
  const screenshot = path.join(ARTIFACT_DIR, "smoke-vibe-ready.png");

  try {
    const { result, events } = await collectEvents(page, async () => {
      await page.goto(`${DEFAULT_ORIGIN}/vibe-studio`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      await page.waitForTimeout(6_000);
      await dismissMaybeLaterPrompt(page);

      const initialText = await page.locator("body").innerText();
      const textarea = page.getByPlaceholder("What are you vibing on right now?");
      const saveCaptionButton = page.getByRole("button", { name: /Save caption/i });
      await textarea.fill(tempCaption);
      await page.waitForTimeout(300);
      await saveCaptionButton.click();
      await page.waitForTimeout(2_500);
      const afterSave = await getOwnProfile(primarySession, config);

      await textarea.fill(originalCaption);
      await page.waitForTimeout(300);
      await saveCaptionButton.click();
      await page.waitForTimeout(2_500);
      const restored = await getOwnProfile(primarySession, config);

      await page.screenshot({ path: screenshot, fullPage: true });

      return {
        url: page.url(),
        initialTextSample: initialText.slice(0, 500),
        initialCaption: originalCaption,
        savedCaption: afterSave?.vibe_caption ?? null,
        restoredCaption: restored?.vibe_caption ?? null,
        readyVisible: initialText.includes("Ready") || initialText.includes("Your Vibe Video is live"),
        screenshot,
      };
    });

    return { ...result, events };
  } finally {
    await context.close();
  }
}

async function captureVibeCreateDeleteProof(partnerSession, config) {
  const { context } = await createFreshContext();
  await injectSessionIntoContext(context, partnerSession);
  const page = await context.newPage();
  const screenshot = path.join(ARTIFACT_DIR, "smoke-vibe-create-delete.png");

  try {
    const { result, events } = await collectEvents(page, async () => {
      await page.goto(`${DEFAULT_ORIGIN}/vibe-studio`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      await page.waitForTimeout(4_000);
      await dismissMaybeLaterPrompt(page);
      const initialText = await page.locator("body").innerText();

      const created = await page.evaluate(
        async ({ storageKey, supabaseUrl }) => {
          const raw = window.localStorage.getItem(storageKey);
          const session = raw ? JSON.parse(raw) : null;
          const response = await fetch(`${supabaseUrl}/functions/v1/create-video-upload`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({ context: "profile_studio" }),
          });
          return {
            status: response.status,
            json: await response.json().catch(() => null),
          };
        },
        {
          storageKey: SUPABASE_STORAGE_KEY,
          supabaseUrl: config.supabaseUrl,
        },
      );

      await page.waitForTimeout(1_500);
      await page.reload({ waitUntil: "load", timeout: 120_000 });
      await page.waitForTimeout(3_000);
      await dismissMaybeLaterPrompt(page);
      const uploadingText = await page.locator("body").innerText();
      const profileAfterCreate = await getOwnProfile(partnerSession, config);

      const deleted = await page.evaluate(
        async ({ storageKey, supabaseUrl }) => {
          const raw = window.localStorage.getItem(storageKey);
          const session = raw ? JSON.parse(raw) : null;
          const response = await fetch(`${supabaseUrl}/functions/v1/delete-vibe-video`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session?.access_token}`,
            },
          });
          return {
            status: response.status,
            json: await response.json().catch(() => null),
          };
        },
        {
          storageKey: SUPABASE_STORAGE_KEY,
          supabaseUrl: config.supabaseUrl,
        },
      );

      await page.waitForTimeout(1_500);
      await page.reload({ waitUntil: "load", timeout: 120_000 });
      await page.waitForTimeout(3_000);
      await dismissMaybeLaterPrompt(page);
      const finalText = await page.locator("body").innerText();
      const profileAfterDelete = await getOwnProfile(partnerSession, config);

      await page.screenshot({ path: screenshot, fullPage: true });

      return {
        url: page.url(),
        initialTextSample: initialText.slice(0, 400),
        created,
        uploadingTextSample: uploadingText.slice(0, 500),
        profileAfterCreate,
        deleted,
        finalTextSample: finalText.slice(0, 500),
        profileAfterDelete,
        screenshot,
      };
    });

    return { ...result, events };
  } finally {
    await context.close();
  }
}

async function capturePublicProfileProof(viewerSession, targetProfileId, config) {
  const expected = await fetchPublicProfileSnapshot(viewerSession, config, targetProfileId);
  const { context } = await createFreshContext();
  await injectSessionIntoContext(context, viewerSession);
  const page = await context.newPage();
  const screenshot = path.join(ARTIFACT_DIR, "smoke-public-profile.png");

  try {
    const { result, events } = await collectEvents(page, async () => {
      await page.goto(`${DEFAULT_ORIGIN}/user/${targetProfileId}`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      await page.waitForTimeout(6_000);
      await dismissMaybeLaterPrompt(page);

      const bodyText = await page.locator("body").innerText();
      const aboutSnippet =
        typeof expected.about_me === "string" && expected.about_me.trim().length > 0
          ? expected.about_me.trim().slice(0, 32)
          : null;
      const tagline =
        typeof expected.tagline === "string" && expected.tagline.trim().length > 0
          ? expected.tagline.trim()
          : null;
      const firstVibe = expected.vibes[0] ?? null;
      const hasReadyVideo =
        typeof expected.bunny_video_uid === "string" &&
        expected.bunny_video_uid.length > 0 &&
        expected.bunny_video_status === "ready";
      const vibeCaption =
        typeof expected.vibe_caption === "string" && expected.vibe_caption.trim().length > 0
          ? expected.vibe_caption.trim()
          : null;

      await page.screenshot({ path: screenshot, fullPage: true });

      return {
        url: page.url(),
        viewerUserId: viewerSession.user?.id ?? null,
        targetUserId: targetProfileId,
        expected: {
          name: expected.name ?? null,
          age: expected.age ?? null,
          tagline,
          aboutSnippet,
          firstVibe,
          photoVerified: expected.photo_verified === true,
          hasReadyVideo,
          vibeCaption,
        },
        notFoundVisible:
          bodyText.includes("Profile not found") ||
          bodyText.includes("This profile is unavailable right now."),
        showsName:
          typeof expected.name === "string" && expected.name.trim().length > 0
            ? bodyText.includes(expected.name.trim())
            : null,
        showsAge:
          typeof expected.age === "number" ? bodyText.includes(String(expected.age)) : null,
        showsTagline: tagline ? bodyText.includes(tagline) : null,
        showsAboutMe: aboutSnippet
          ? bodyText.includes("About Me") && bodyText.includes(aboutSnippet)
          : null,
        showsFirstVibe: firstVibe ? bodyText.includes(firstVibe) : null,
        showsPhotoVerified:
          expected.photo_verified === true ? bodyText.includes("Photo verified") : null,
        showsVibeVideo:
          hasReadyVideo ? bodyText.includes("Vibing on") || (vibeCaption ? bodyText.includes(vibeCaption) : false) : null,
        textSample: bodyText.slice(0, 700),
        screenshot,
      };
    });

    return { ...result, events };
  } finally {
    await context.close();
  }
}

async function buildAuditNote(matchId) {
  return {
    targets: [
      {
        proofTarget: "Schedule non-empty pending/upcoming/history + reminder truth",
        requiredAuthState: `${PRIMARY.email} fresh authenticated web session`,
        requiredDataState: `Tagged smoke proof suggestions/plans on match ${matchId}`,
        canCursorBootstrapNow: "yes",
      },
      {
        proofTarget: "Referral set-once + repeated apply immutability + self-ref rejection",
        requiredAuthState:
          `${PARTNER.email} fresh authenticated target session plus ${PRIMARY.email} referrer id`,
        requiredDataState: "profiles.referred_by reset to null before seed",
        canCursorBootstrapNow: "yes",
      },
      {
        proofTarget: "Vibe Studio ready state + caption save/revert",
        requiredAuthState: `${PRIMARY.email} fresh authenticated web session`,
        requiredDataState: "Existing ready Vibe video on primary smoke profile",
        canCursorBootstrapNow: "yes",
      },
      {
        proofTarget: "Vibe Studio create/upload entry + delete cleanup",
        requiredAuthState: `${PARTNER.email} fresh authenticated web session`,
        requiredDataState: "Complete profile with no active video",
        canCursorBootstrapNow: "yes",
      },
      {
        proofTarget: "Public profile route render",
        requiredAuthState: `${PARTNER.email} fresh authenticated web session viewing ${PRIMARY.email}`,
        requiredDataState: "Existing public profile data on the primary smoke account",
        canCursorBootstrapNow: "yes",
      },
      {
        proofTarget: "Human-granted web push prompt and click-through",
        requiredAuthState: "Interactive real browser/device session",
        requiredDataState: "Real notification delivery and user interaction",
        canCursorBootstrapNow: "no",
      },
    ],
  };
}

async function main() {
  const mode = process.argv[2] ?? "bootstrap";
  await mkdir(ARTIFACT_DIR, { recursive: true });

  const cursorEnv = await ensureCursorEnv();
  const config = await readPublicConfig();
  const matchId = await getLatestSmokeMatchId();
  const auditNote = await buildAuditNote(matchId);

  const passwords = {
    primary: cursorEnv.SMOKE_PROOF_PRIMARY_PASSWORD,
    partner: cursorEnv.SMOKE_PROOF_PARTNER_PASSWORD,
  };

  const resetResult = await resetLinkedState(passwords, matchId);
  if (mode === "cleanup") {
    console.log(
      JSON.stringify(
        {
          mode,
          artifactDir: ARTIFACT_DIR,
          cursorEnvPath: CURSOR_ENV_PATH,
          auditNote,
          resetResult,
        },
        null,
        2,
      ),
    );
    return;
  }

  const primarySession = await signInWithPassword(
    { email: PRIMARY.email, password: passwords.primary },
    config,
  );
  const partnerSession = await signInWithPassword(
    { email: PARTNER.email, password: passwords.partner },
    config,
  );

  const seeded = await seedScheduleProofData(primarySession, partnerSession, config, matchId);
  const schedule = await captureScheduleProof(primarySession, config);
  const referrals = await captureReferralProof(primarySession, partnerSession, config);
  const vibeReady = await captureVibeReadyAndCaptionProof(primarySession, config);
  const vibeCreateDelete = await captureVibeCreateDeleteProof(partnerSession, config);
  const publicProfile = await capturePublicProfileProof(partnerSession, PRIMARY.id, config);

  console.log(
    JSON.stringify(
      {
        mode,
        artifactDir: ARTIFACT_DIR,
        cursorEnvPath: CURSOR_ENV_PATH,
        auditNote,
        resetResult,
        seeded,
        sessions: {
          primary: { userId: primarySession.user?.id ?? null, email: primarySession.user?.email ?? null },
          partner: { userId: partnerSession.user?.id ?? null, email: partnerSession.user?.email ?? null },
        },
        schedule,
        referrals,
        vibeReady,
        vibeCreateDelete,
        publicProfile,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
