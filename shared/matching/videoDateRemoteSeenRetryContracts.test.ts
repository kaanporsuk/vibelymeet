import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const helper = read("shared/matching/videoDateRemoteSeenEvidence.ts");
const nativeRemoteSeen = read(
  "apps/mobile/lib/videoDate/useNativeVideoDateRemoteSeen.ts",
);
const webRemoteSeen = read("src/hooks/videoCall/useVideoDateRemoteSeen.ts");
const packageJson = read("package.json");

function assertRemoteSeenRetryContract(name: string, source: string) {
  assert.doesNotMatch(
    source,
    /const initialProof = buildProviderBoundRemoteSeenArgs\(source\);[\s\S]{0,100}if \(!initialProof\.ok\) return;/,
    `${name} must not drop first render evidence before retry handling`,
  );
  assert.match(
    source,
    /const baseEvidenceSource =[\s\S]{0,120}normalizeVideoDateRemoteSeenEvidenceSource\(source\)/,
    `${name} must normalize retry labels away from server evidence`,
  );
  assert.match(
    source,
    /const forceRestamp =[\s\S]{0,120}isVideoDateRemoteSeenRenderEvidenceSource\(baseEvidenceSource\)/,
    `${name} must persist only render-bound evidence as pending`,
  );
  assert.match(
    source,
    /remoteSeenPendingEvidenceRef\.current = \{[\s\S]{0,500}source: baseEvidenceSource/,
    `${name} must store render evidence before proof can be available`,
  );
  assert.match(
    source,
    /const providerSessionId =[\s\S]{0,220}entryOwner\?\.providerSessionId[\s\S]{0,120}dailyOwner\?\.providerSessionId/,
    `${name} must fall back to owner provider-session proof`,
  );
  assert.match(
    source,
    /const callInstanceId =[\s\S]{0,220}entryOwner\?\.callInstanceId[\s\S]{0,120}dailyOwner\?\.callInstanceId/,
    `${name} must fall back to owner call-instance proof`,
  );
  assert.match(
    source,
    /buildVideoDateRemoteSeenProviderMissingPayload\(\{[\s\S]{0,140}retryAfterMs: REMOTE_SEEN_RPC_RETRY_DELAY_MS[\s\S]{0,80}terminal/,
    `${name} must make non-terminal local proof gaps retryable`,
  );
  assert.match(
    source,
    /subscribeVideoDateDailyOwner\(\(owner\) => \{[\s\S]+mark_video_date_remote_seen_pending_evidence_drain[\s\S]+markRemoteSeenOnServer\(pending\.source\)/,
    `${name} must drain pending render evidence when owner proof becomes ready`,
  );
  assert.match(
    source,
    /p_evidence_source: baseEvidenceSource/,
    `${name} must send the original render evidence source to the server`,
  );
  assert.doesNotMatch(
    source,
    /p_evidence_source: attemptSource/,
    `${name} must not send retry labels as server evidence`,
  );
}

test("shared remote-seen evidence helper preserves the server allowlist", () => {
  for (const source of [
    "loadeddata",
    "playing",
    "remote_track_mounted",
    "first_remote_frame",
    "request_video_frame_callback",
  ]) {
    assert.match(helper, new RegExp(`"${source}"`));
  }
  assert.match(helper, /VIDEO_DATE_REMOTE_SEEN_PENDING_EVIDENCE_TTL_MS = 180_000/);
  assert.match(helper, /retryable = !input\.terminal/);
  assert.match(helper, /retry_after_ms: retryable \? input\.retryAfterMs : 0/);
  assert.match(helper, /source\.replace\(\/\(\?:_owner_ready\|_retry_/);
});

test("native remote-seen retries pending render evidence until provider proof is ready", () => {
  assertRemoteSeenRetryContract("native", nativeRemoteSeen);
  assert.match(nativeRemoteSeen, /remoteSeenActiveSessionRef\.current !== pending\.sessionId/);
});

test("web remote-seen retries pending render evidence until provider proof is ready", () => {
  assertRemoteSeenRetryContract("web", webRemoteSeen);
  assert.match(webRemoteSeen, /optionsRef\.current\?\.roomId !== pending\.sessionId/);
});

test("video-date suites include the remote-seen retry regression contract", () => {
  assert.match(packageJson, /videoDateRemoteSeenRetryContracts\.test\.ts/);
});
