import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const panel = read("src/components/admin/AdminGhostBootstrapPanel.tsx");
const strictConfidenceMigration = read(
  "supabase/migrations/20260507142000_ghost_bootstrap_strict_confidence.sql",
);

test("ghost accounts panel defaults to all candidates and explains filtered empty states", () => {
  assert.match(panel, /useState<FilterConfidence>\('ALL'\)/);
  assert.match(panel, /confidenceCounts/);
  assert.match(panel, /All \{confidenceCounts\.ALL\}/);
  assert.match(panel, /\{item\.label\} \{confidenceCounts\[item\.value\]\}/);
  assert.match(panel, /strict bootstrap ghost candidates/);
  assert.match(panel, /No ghost bootstrap accounts found for the selected age threshold\./);
  assert.match(panel, /No \{confidenceFilter\.toLowerCase\(\)\} confidence candidates match this filter\./);
  assert.match(panel, /Unable to load ghost bootstrap accounts\./);
});

test("ghost bootstrap RPC uses strict age and last_seen_at-aware confidence semantics", () => {
  assert.match(strictConfidenceMigration, /CREATE OR REPLACE FUNCTION public\.detect_ghost_bootstrap_accounts\(/);
  assert.match(strictConfidenceMigration, /days_old_threshold int DEFAULT 7/);
  assert.match(strictConfidenceMigration, /min_activity_threshold int DEFAULT 0/);
  assert.match(strictConfidenceMigration, /ROUND\(\(EXTRACT\(EPOCH FROM now\(\) - p\.created_at\) \/ 3600\)::numeric, 2\) as account_age_hours/);
  assert.match(strictConfidenceMigration, /au\.deleted_at IS NULL/);
  assert.match(strictConfidenceMigration, /ac\.days_since_creation >= v_days_old_threshold/);
  assert.doesNotMatch(strictConfidenceMigration, /days_old_threshold\s*-\s*[23]/);
  assert.match(
    strictConfidenceMigration,
    /ac\.profile_activity_score = 0\s+AND \(ac\.last_seen_at IS NULL OR ac\.last_seen_at <= ac\.created_at \+ interval '5 minutes'\)\s+THEN 'HIGH'/,
  );
  assert.match(
    strictConfidenceMigration,
    /ac\.profile_activity_score = 0\s+AND ac\.last_seen_at <= ac\.created_at \+ interval '1 day'\s+THEN 'MEDIUM'/,
  );
  assert.match(strictConfidenceMigration, /ELSE 'LOW'/);

  const adminGuardIndex = strictConfidenceMigration.indexOf("IF auth.uid() IS NULL");
  const profileReadIndex = strictConfidenceMigration.indexOf("FROM public.profiles p");
  assert.ok(adminGuardIndex >= 0, "admin guard must exist");
  assert.ok(profileReadIndex >= 0, "profile read must exist");
  assert.ok(adminGuardIndex < profileReadIndex, "admin guard must run before raw profile reads");
});
