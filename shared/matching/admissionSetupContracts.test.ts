import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readProjectFile(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

test("web registration snapshot reads payment status as diagnostic admission context", () => {
  const useEventDetails = readProjectFile("src/hooks/useEventDetails.ts");
  const useRegistrations = readProjectFile("src/hooks/useRegistrations.ts");
  const useEvents = readProjectFile("src/hooks/useEvents.ts");
  const nativeEventsApi = readProjectFile("apps/mobile/lib/eventsApi.ts");

  assert.match(useEventDetails, /@clientShared\/eventAdmissionReadiness/);
  assert.match(useEventDetails, /\.select\("admission_status, payment_status"\)/);
  assert.match(useEventDetails, /EventRegistrationSnapshot = EventAdmissionReadinessSnapshot/);
  assert.match(useEventDetails, /resolveEventAdmissionReadiness/);
  assert.match(useRegistrations, /\.select\("event_id, admission_status, payment_status"\)/);
  assert.match(useRegistrations, /resolveEventAdmissionReadiness/);
  assert.match(useRegistrations, /paid_like_but_not_confirmed/);
  assert.match(useEvents, /@clientShared\/eventAdmissionReadiness/);
  assert.match(useEvents, /payment_status/);
  assert.match(useEvents, /resolveEventAdmissionReadiness/);
  assert.match(useEvents, /if \(!admission\.isConfirmed && !admission\.isWaitlisted\) return false/);
  assert.match(nativeEventsApi, /@clientShared\/eventAdmissionReadiness/);
  assert.match(nativeEventsApi, /\.select\('event_id, admission_status, payment_status'\)/);
  assert.match(nativeEventsApi, /\.select\('admission_status, payment_status'\)/);
  assert.match(nativeEventsApi, /resolveEventAdmissionReadiness/);
  assert.match(nativeEventsApi, /if \(!admission\.isConfirmed && !admission\.isWaitlisted\) return false/);
  assert.match(nativeEventsApi, /result\.registrationSnapshot\.isConfirmed \|\| result\.registrationSnapshot\.isWaitlisted/);
});

test("seeded runtime QA requires confirmed admission before Ready Gate triage", () => {
  const qaDoc = readProjectFile("docs/qa/video-date-seeded-runtime-qa-pack.md");

  assert.match(qaDoc, /admission_status = 'confirmed'/);
  assert.match(qaDoc, /`payment_status` as informational only/i);
  assert.match(qaDoc, /paid_like_but_not_confirmed/);
  assert.match(qaDoc, /setup failure before triaging Ready Gate or Video Date/i);
});
