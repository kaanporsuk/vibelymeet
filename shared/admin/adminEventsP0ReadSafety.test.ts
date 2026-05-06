import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const adminEventsPanel = readFileSync(join(root, "src/components/admin/AdminEventsPanel.tsx"), "utf8");
const adminEventControls = readFileSync(join(root, "src/components/admin/AdminEventControls.tsx"), "utf8");
const adminEventForm = readFileSync(join(root, "src/components/admin/AdminEventFormModal.tsx"), "utf8");
const batchEventImport = readFileSync(join(root, "src/components/admin/BatchEventImportModal.tsx"), "utf8");

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing source section start: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing source section end: ${endMarker}`);
  return source.slice(start, end);
}

test("admin events query is read-only", () => {
  const query = section(adminEventsPanel, "queryKey: ['admin-events'", "// Unique cities");

  assert.match(query, /\.from\('events'\)[\s\S]*\.select\('\*'\)/);
  assert.doesNotMatch(query, /\.update\s*\(/);
  assert.doesNotMatch(query, /\.insert\s*\(/);
  assert.doesNotMatch(query, /\.upsert\s*\(/);
  assert.doesNotMatch(query, /\.delete\s*\(/);
  assert.doesNotMatch(query, /\.rpc\s*\(/);
});

test("admin event controls receive raw and computed lifecycle state", () => {
  assert.match(adminEventsPanel, /rawStatus=\{event\.status\}/);
  assert.match(adminEventsPanel, /computedStatus=\{computed\}/);
  assert.match(adminEventsPanel, /endedAt=\{event\.ended_at\}/);
  assert.match(adminEventsPanel, /archivedAt=\{event\.archived_at\}/);

  assert.match(adminEventControls, /rawStatus: string \| null/);
  assert.match(adminEventControls, /computedStatus: string/);
  assert.match(adminEventControls, /endedAt\?: string \| null/);
  assert.match(adminEventControls, /archivedAt\?: string \| null/);
  assert.match(adminEventControls, /normalizedComputedStatus === "ended"/);
  assert.match(adminEventControls, /normalizedComputedStatus === "live" && normalizedRawStatus !== "live"/);
  assert.match(adminEventControls, /isArchived \|\| isDraft \|\| isCancelled \|\| isCompleted \|\| endedAt/);
  assert.match(adminEventControls, /!\s*isComputedEnded && \(/);
});

test("admin event computed lifecycle refreshes while the panel stays open", () => {
  assert.match(adminEventsPanel, /const \[lifecycleNowMs, setLifecycleNowMs\] = useState\(\(\) => Date\.now\(\)\)/);
  assert.match(adminEventsPanel, /window\.setInterval\(\(\) => setLifecycleNowMs\(Date\.now\(\)\), 30_000\)/);
  assert.match(adminEventsPanel, /getComputedStatus\(event, lifecycleNowMs\)/);
  assert.match(adminEventsPanel, /\[events, lifecycleNowMs, statusFilter, scopeFilter, cityFilter, dateFrom, dateTo\]/);
});

test("expired computed events cannot be cancelled from the row menu", () => {
  const rowRender = section(adminEventsPanel, "const renderEventRow", "return (");

  assert.match(rowRender, /computed !== 'ended'/);
  assert.match(rowRender, /!event\.ended_at/);
  assert.match(rowRender, /!\['cancelled', 'draft', 'completed'\]\.includes\(rawStatus\)/);
});

test("batch import emits only database-valid event statuses", () => {
  assert.match(batchEventImport, /const VALID_STATUSES = \["draft", "upcoming", "live"\]/);
  assert.match(batchEventImport, /status: "upcoming"/);
  assert.match(batchEventImport, /status: ev\.status \|\| "upcoming"/);
  assert.doesNotMatch(batchEventImport, /"scheduled"/);
});

test("admin event form footer submits through validation path", () => {
  const footer = section(adminEventForm, "{/* Footer */}", "</motion.div>");

  assert.match(adminEventForm, /<form id=\{formId\} onSubmit=\{handleSubmit\}/);
  assert.match(footer, /<Button type="submit" form=\{formId\}/);
  assert.doesNotMatch(footer, /saveEvent\.mutate\(\)/);
});
