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
  assert.match(protectedRoute, /requireAdmin && !isServerVerifiedAdmin/);
});

test("admin login uses the same server verification path as the protected dashboard", () => {
  assert.match(adminLogin, /const verifyAdminSession/);
  assert.match(adminLogin, /supabase\.functions\.invoke\("verify-admin"/);
  assert.match(adminLogin, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(adminLogin, /\.from\(['"]user_roles['"]\)/);
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
  assert.match(verifier, /catch \(err\)/);
  assert.match(sessionCheck, /try \{/);
  assert.match(sessionCheck, /finally \{/);
  assert.match(sessionCheck, /setIsCheckingAuth\(false\)/);
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
