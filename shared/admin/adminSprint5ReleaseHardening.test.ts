import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

function listFiles(dir: string): string[] {
  const fullDir = join(root, dir);
  return readdirSync(fullDir)
    .flatMap((entry) => {
      const fullPath = join(fullDir, entry);
      const relativePath = `${dir}/${entry}`;
      if (statSync(fullPath).isDirectory()) return listFiles(relativePath);
      return relativePath;
    })
    .filter((path) => /\.(ts|tsx)$/.test(path));
}

const adminUiFiles = [
  ...listFiles("src/components/admin"),
  "src/pages/admin/AdminLogin.tsx",
  "src/pages/admin/AdminDashboard.tsx",
];

const sprintAdminEdgeFunctions = [
  "supabase/functions/verify-admin/index.ts",
  "supabase/functions/admin-data-export/index.ts",
  "supabase/functions/admin-review-verification/index.ts",
  "supabase/functions/admin-proof-selfie-sign/index.ts",
  "supabase/functions/admin-media-lifecycle-controls/index.ts",
  "supabase/functions/admin-video-date-ops/index.ts",
  "supabase/functions/upload-event-cover/index.ts",
  "supabase/functions/send-support-reply/index.ts",
  "supabase/functions/event-notifications/index.ts",
];

test("admin UI routes failures through the shared admin error resolver", () => {
  const resolver = read("src/lib/adminErrorResolver.ts");
  assert.match(resolver, /export function resolveAdminErrorMessage/);
  assert.match(resolver, /export async function resolveAdminFunctionErrorMessage/);
  assert.match(resolver, /sanitizeAdminRpcErrorMessage/);
  assert.match(resolver, /resolveSupabaseFunctionErrorMessage/);
  assert.match(resolver, /record\.message/);
  assert.match(resolver, /record\.error/);

  for (const file of adminUiFiles) {
    const source = read(file);
    assert.doesNotMatch(source, /sanitizeAdminRpcErrorMessage/, `${file} must not bypass the admin UI resolver`);
    assert.doesNotMatch(source, /resolveSupabaseFunctionErrorMessage/, `${file} must not bypass the admin function resolver`);
    assert.doesNotMatch(source, /(error|err|e) instanceof Error \? \1\.message/, `${file} must not render raw Error.message`);
    assert.doesNotMatch(source, /description:\s*(error|err|e)\.message/, `${file} must not toast raw Error.message`);
    assert.doesNotMatch(source, /\{(?:error|err|e)\?\.message(?:\s*\|\|[^}]*)?\}/, `${file} must not show raw optional error.message`);
    assert.doesNotMatch(source, /throw new Error\(data\?\.error \|\| error\?\.message/, `${file} must parse Edge errors consistently`);
  }
});

test("Sprint 5 keeps CSP and admin CORS on explicit allowlists", () => {
  const vercelJson = read("vercel.json");
  assert.doesNotMatch(vercelJson, /https:\/\/\*\.daily\.co/);
  assert.doesNotMatch(vercelJson, /wss:\/\/\*\.daily\.co/);
  assert.match(vercelJson, /https:\/\/api\.daily\.co/);
  assert.match(vercelJson, /https:\/\/vibelyapp\.daily\.co/);
  assert.match(vercelJson, /wss:\/\/vibelyapp\.daily\.co/);

  for (const file of sprintAdminEdgeFunctions) {
    const source = read(file);
    assert.doesNotMatch(source, /Access-Control-Allow-Origin["']:\s*["']\*["']/, `${file} must not use wildcard CORS`);
    assert.match(source, /preflightResponse\(req(?:,|\))/, `${file} must use the shared preflight helper`);
  }
});

test("admin Edge Function error bodies stay sanitized before the UI renders them", () => {
  const proofSelfieSign = read("supabase/functions/admin-proof-selfie-sign/index.ts");
  assert.match(proofSelfieSign, /message: sanitizeErrorMessage\(error\?\.message/);
  assert.match(proofSelfieSign, /error: sanitizeErrorMessage\(outcome\.message\)/);
  assert.match(proofSelfieSign, /admin-proof-selfie-sign lookup failed/);
  assert.match(proofSelfieSign, /Could not load verification selfie metadata/);
  assert.match(proofSelfieSign, /"Verification not found"[\s\S]*404/);
  assert.match(proofSelfieSign, /DIRECT_SELFIE_REVALIDATION_SECONDS/);
  assert.match(proofSelfieSign, /ADMIN_PROOF_SELFIE_TRUSTED_ORIGINS/);
  assert.match(proofSelfieSign, /isTrustedDirectSelfieUrl/);
  assert.match(proofSelfieSign, /allowed proof-selfie media origin/);
  assert.match(proofSelfieSign, /expires_at: outcome\.expiresAt/);
  assert.match(proofSelfieSign, /422/);
  assert.doesNotMatch(proofSelfieSign, /message: error\?\.message \?\?/);
  assert.doesNotMatch(proofSelfieSign, /error: outcome\.message/);

  const adminVideoDateOps = read("supabase/functions/admin-video-date-ops/index.ts");
  assert.match(adminVideoDateOps, /error: error \? sanitizeErrorMessage\(error\.message\) : undefined/);

  const adminMediaLifecycle = read("supabase/functions/admin-media-lifecycle-controls/index.ts");
  assert.match(adminMediaLifecycle, /error: sanitizeErrorMessage\(error instanceof Error \? error\.message : "Invalid media lifecycle input"\)/);

  const adminReviewVerification = read("supabase/functions/admin-review-verification/index.ts");
  assert.match(adminReviewVerification, /message: sanitizeErrorMessage\(payload\?\.message \?\? payload\?\.error \?\? "Photo verification review failed\."\)/);

  const uploadEventCover = read("supabase/functions/upload-event-cover/index.ts");
  assert.match(uploadEventCover, /sanitizeErrorMessage/);
  assert.match(uploadEventCover, /function safeLogMessage/);
  assert.doesNotMatch(uploadEventCover, /err=\$\{(?:error|eventError|replaceError)\.message\}/);
  assert.doesNotMatch(uploadEventCover, /receiptRepairError\?\.message \?\?/);
  assert.doesNotMatch(uploadEventCover, /receiptUpdateError\?\.message \?\?/);
  assert.doesNotMatch(uploadEventCover, /p_last_error: replaceError\.message/);
});

test("frontend assumptions match the hardened admin RPC and Edge contracts", () => {
  const exportPanel = read("src/components/admin/AdminExportPanel.tsx");
  assert.match(exportPanel, /resolveAdminFunctionErrorMessage/);
  assert.match(exportPanel, /payload\.success === false \|\| payload\.ok === false/);
  assert.match(exportPanel, /resolveAdminErrorMessage\(payload, "Governed export queue failed"\)/);
  assert.match(exportPanel, /p_limit: 8/);
  assert.match(exportPanel, /p_offset: 0/);

  const supportInbox = read("src/components/admin/SupportInbox.tsx");
  assert.match(supportInbox, /resolveAdminFunctionErrorMessage/);
  assert.match(supportInbox, /resolveAdminFunctionErrorMessage\(null, data, "Failed to send reply"\)/);
  assert.match(supportInbox, /notification_warning/);
  assert.match(supportInbox, /email_warning/);
  assert.match(supportInbox, /delivery_jobs/);

  const liveEventMetrics = read("src/components/admin/AdminLiveEventMetrics.tsx");
  assert.match(liveEventMetrics, /resolveAdminFunctionErrorMessage\(error, data, "Could not load Video Date Ops metrics"\)/);

  const videoDateTimeline = read("src/components/admin/AdminVideoDateTimelinePanel.tsx");
  assert.match(videoDateTimeline, /resolveAdminFunctionErrorMessage\(error, data, "Timeline unavailable"\)/);

  const dailyDropCard = read("src/components/admin/AdminDailyDropCard.tsx");
  assert.match(dailyDropCard, /resolveAdminFunctionErrorMessage\(error, data, 'Failed to generate drops'\)/);
  assert.match(dailyDropCard, /resolveAdminErrorMessage\(data\?\.details \|\| data\?\.error, 'Insert failed'\)/);

  const reportsPanel = read("src/components/admin/AdminReportsPanel.tsx");
  assert.match(reportsPanel, /useDebouncedValue\(searchQuery, 350\)/);
  assert.match(reportsPanel, /p_limit: REPORTS_PAGE_SIZE/);
  assert.match(reportsPanel, /p_offset: pageIndex \* REPORTS_PAGE_SIZE/);
  assert.match(reportsPanel, /payload\.total_count/);
  assert.match(reportsPanel, /Showing \{firstVisibleReport\}-\{lastVisibleReport\} of \{totalCount\} reports/);

  const photoVerificationPanel = read("src/components/admin/AdminPhotoVerificationPanel.tsx");
  assert.match(photoVerificationPanel, /expires_at/);
  assert.match(photoVerificationPanel, /selfieExpiresAt/);
  assert.match(photoVerificationPanel, /adminUtcDayStartIso\(\)/);
  assert.match(photoVerificationPanel, /SELFIE_SIGN_CONCURRENCY = 4/);
  assert.match(photoVerificationPanel, /shouldRefreshSelfieEntry/);
  assert.match(photoVerificationPanel, /previous\?\.selfie === nextUrls\.selfie && previous\.selfieLoadedAt/);
  assert.match(photoVerificationPanel, /window\.addEventListener\("focus", refreshOnFocus\)/);
  assert.match(photoVerificationPanel, /document\.addEventListener\("visibilitychange", refreshOnFocus\)/);
  assert.match(photoVerificationPanel, /disabled=\{approveMutation\.isPending \|\| !selfieAccess\?\.ready\}/);

  const protectedRoute = read("src/components/ProtectedRoute.tsx");
  assert.match(protectedRoute, /AdminAccessProblem/);
  assert.match(protectedRoute, /verification Edge Function or network request failed/);
  assert.match(protectedRoute, /Admin Access Revoked/);
  assert.match(protectedRoute, /verifiedAdminUserIdRef/);
  assert.match(protectedRoute, /verifiedAdminUserIdRef\.current === session\.user\.id/);
  assert.match(protectedRoute, /data\?\.status === "revoked"/);
  assert.match(protectedRoute, /admin_session_invalidation_events/);
  assert.doesNotMatch(protectedRoute, /table: "user_roles"/);
  assert.match(protectedRoute, /onRetry=\{\(\) => void refetchAdminVerification\(\)\}/);
  assert.match(protectedRoute, /refetchOnWindowFocus: "always"/);
  assert.match(protectedRoute, /refetchInterval: requireAdmin \? 60_000 : false/);
});

test("Sprint 5 release note covers changed admin behavior", () => {
  const releaseNote = read("docs/branch-deltas/admin-sprint5-release-hardening.md");
  for (const phrase of [
    "export errors",
    "role revocation",
    "deletion completion",
    "support delivery",
    "UTC timestamps",
    "Daily CSP",
    "allowlisted CORS",
  ]) {
    assert.match(releaseNote, new RegExp(phrase, "i"));
  }
});
