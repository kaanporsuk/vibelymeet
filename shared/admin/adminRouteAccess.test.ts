import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const app = read("src/App.tsx");
const protectedRoute = read("src/components/ProtectedRoute.tsx");
const adminLogin = read("src/pages/admin/AdminLogin.tsx");
const adminDashboard = read("src/pages/admin/AdminDashboard.tsx");
const adminSidebar = read("src/components/admin/AdminSidebar.tsx");
const sharedAdminAuth = read("supabase/functions/_shared/adminAuth.ts");
const sharedCors = read("supabase/functions/_shared/cors.ts");
const verifyAdminFunction = read("supabase/functions/verify-admin/index.ts");

const sprint1AdminEdgeFunctions = [
  "supabase/functions/verify-admin/index.ts",
  "supabase/functions/admin-data-export/index.ts",
  "supabase/functions/admin-review-verification/index.ts",
  "supabase/functions/admin-proof-selfie-sign/index.ts",
  "supabase/functions/admin-media-lifecycle-controls/index.ts",
  "supabase/functions/admin-video-date-ops/index.ts",
  "supabase/functions/upload-event-cover/index.ts",
  "supabase/functions/send-support-reply/index.ts",
].map((path) => ({ path, source: read(path) }));

const adminPanels = [
  { id: "overview", component: "AdminQuickActionsCards" },
  { id: "operations", component: "AdminOperationsCenter" },
  { id: "intelligence", component: "AdminP4IntelligencePanel" },
  { id: "users", component: "AdminUsersPanel" },
  { id: "events", component: "AdminEventsPanel" },
  { id: "reports", component: "AdminReportsPanel" },
  { id: "export", component: "AdminExportPanel" },
  { id: "event-analytics", component: "AdminLiveEventMetrics" },
  { id: "video-date-timeline", component: "AdminVideoDateTimelinePanel" },
  { id: "activity-log", component: "AdminActivityLog" },
  { id: "engagement", component: "AdminEngagementAnalytics" },
  { id: "campaigns", component: "AdminPushCampaignsPanel" },
  { id: "photo-verification", component: "AdminPhotoVerificationPanel" },
  { id: "deletions", component: "AdminDeletionsPanel" },
  { id: "support", component: "SupportInbox" },
  { id: "tier-config", component: "AdminTierConfigPanel" },
  { id: "ghost-bootstrap", component: "AdminGhostBootstrapPanel" },
  { id: "media-lifecycle", component: "AdminMediaLifecyclePanel" },
];

test("/kaan routes are wired to admin login and server-verified dashboard protection", () => {
  assert.match(app, /<Route path="\/kaan" element=\{<AdminLogin \/>\} \/>/);
  assert.match(
    app,
    /<Route path="\/kaan\/dashboard" element=\{<ProtectedRoute requireAdmin requireOnboarding=\{false\}><AdminDashboard \/><\/ProtectedRoute>\} \/>/,
  );
});

test("admin dashboard access uses verify-admin edge verification", () => {
  assert.match(protectedRoute, /supabase\.functions\.invoke\('verify-admin'/);
  assert.match(protectedRoute, /Authorization: `Bearer \$\{session\.access_token\}`/);
  assert.match(protectedRoute, /AdminAccessProblem/);
  assert.match(protectedRoute, /refetchOnWindowFocus: "always"/);
  assert.match(protectedRoute, /refetchInterval: requireAdmin \? 60_000 : false/);
  assert.match(protectedRoute, /table: "user_roles"/);
  assert.match(protectedRoute, /invalidateQueries\(\{ queryKey: \['verify-admin-role', userId\] \}\)/);
});

test("admin login uses the same server verification path as the protected dashboard", () => {
  assert.match(adminLogin, /const verifyAdminSession/);
  assert.match(adminLogin, /supabase\.functions\.invoke\("verify-admin"/);
  assert.match(adminLogin, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(adminLogin, /await supabase\.auth\.signOut\(\)/);
  assert.match(adminLogin, /verification\.status === "not_admin"/);
  assert.doesNotMatch(adminLogin, /\.from\(['"]user_roles['"]\)/);
  assert.doesNotMatch(verifyAdminFunction, /roles: auth\.context\.roles/);
});

test("admin login clears session-check loading even when verification rejects", () => {
  const sessionCheck = adminLogin.slice(
    adminLogin.indexOf("const checkExistingSession"),
    adminLogin.indexOf("checkExistingSession();"),
  );
  const verifier = adminLogin.slice(
    adminLogin.indexOf("const verifyAdminSession"),
    adminLogin.indexOf("const AdminLogin"),
  );

  assert.match(verifier, /try \{/);
  assert.match(verifier, /catch(?: \(err\))? \{/);
  assert.match(sessionCheck, /try \{/);
  assert.match(sessionCheck, /finally \{/);
  assert.match(sessionCheck, /setIsCheckingAuth\(false\)/);
});

test("Sprint 1 admin Edge Functions use shared auth and allowlisted CORS", () => {
  assert.match(sharedAdminAuth, /authenticateAdminRequest/);
  assert.match(sharedAdminAuth, /statusForAdminError/);
  assert.match(sharedAdminAuth, /INTERNAL_ERROR[\s\S]*SERVER_MISCONFIGURED[\s\S]*return 500/);
  assert.match(sharedCors, /capacitor:\/\/localhost/);
  assert.match(sharedCors, /if \(!origin\) return true/);

  for (const { path, source } of sprint1AdminEdgeFunctions) {
    assert.doesNotMatch(source, /Access-Control-Allow-Origin["']:\s*["']\*["']/, `${path} must not use wildcard CORS`);
    assert.match(source, /preflightResponse\(req(?:,|\))/, `${path} must use shared preflight CORS`);
    if (path.includes("admin-media-lifecycle-controls")) {
      assert.match(source, /req\.method !== "GET" && req\.method !== "POST"/, `${path} must reject unsupported methods`);
    } else {
      assert.match(source, /req\.method !== "POST"/, `${path} must reject unsupported methods`);
    }
    if (!path.includes("verify-admin")) {
      assert.match(source, /authenticateAdminRequest\(req/, `${path} must use shared admin auth`);
    }
  }
});

test("push campaigns dashboard copy is honest about draft-only delivery", () => {
  assert.match(adminDashboard, /Draft campaign copy and supported targeting until backend delivery is available/);
  assert.doesNotMatch(adminDashboard, /Send targeted notifications to user segments/);
});

test("every /kaan dashboard sidebar tab has a title and render branch", () => {
  for (const panel of adminPanels) {
    assert.match(adminDashboard, new RegExp(`'${panel.id}'`), `${panel.id} must be in ActivePanel/dashboard`);
    assert.match(adminSidebar, new RegExp(`id: '${panel.id}' as const`), `${panel.id} must be in the sidebar`);
    assert.match(adminDashboard, new RegExp(`activePanel === '${panel.id}' &&`), `${panel.id} must have title/copy coverage`);
    assert.match(adminDashboard, new RegExp(panel.component), `${panel.id} must render ${panel.component}`);
  }
  assert.doesNotMatch(adminDashboard, /AdminFeedbackPanel/);
  assert.doesNotMatch(adminSidebar, /id: 'feedback' as const/);
});

test("admin dashboard supports URL-selected Date Timeline sessions", () => {
  assert.match(adminDashboard, /useSearchParams/);
  assert.match(adminDashboard, /panelFromSearchParams/);
  assert.match(adminDashboard, /'video-date-timeline'/);
  assert.match(adminDashboard, /nextSearchParams\.delete\("session_id"\)/);
});
