import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVibeClipRecovery,
  type VibeClipRecoveryOutboxSummary,
  type VibeClipServerUpload,
} from "./vibeClipRecovery";

const NOW = Date.parse("2026-05-20T12:00:00.000Z");

function outbox(overrides: Partial<VibeClipRecoveryOutboxSummary> = {}): VibeClipRecoveryOutboxSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    payloadKind: "video",
    state: "failed",
    ...overrides,
  };
}

function server(overrides: Partial<VibeClipServerUpload> = {}): VibeClipServerUpload {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    matchId: "33333333-3333-4333-8333-333333333333",
    clientRequestId: "11111111-1111-4111-8111-111111111111",
    status: "uploading",
    providerObjectId: "44444444-4444-4444-8444-444444444444",
    expiresAt: "2026-05-20T12:10:00.000Z",
    updatedAt: "2026-05-20T11:58:00.000Z",
    publishedMessageId: null,
    ...overrides,
  };
}

test("outbox source present with unexpired credentials resumes from TUS offset", () => {
  const decision = buildVibeClipRecovery({
    outboxItem: outbox(),
    serverUpload: server(),
    localSourcePresent: true,
    nowMs: NOW,
  });

  assert.equal(decision?.canResume, true);
  assert.equal(decision?.canDiscard, true);
  assert.equal(decision?.resumeStrategy, "tus_offset");
  assert.equal(decision?.telemetryOutcome, "resumable");
});

test("outbox source present with expired credentials reissues upload credentials", () => {
  const decision = buildVibeClipRecovery({
    outboxItem: outbox(),
    serverUpload: server({ expiresAt: "2026-05-20T11:59:59.000Z" }),
    localSourcePresent: true,
    nowMs: NOW,
  });

  assert.equal(decision?.canResume, true);
  assert.equal(decision?.resumeStrategy, "reissue_credentials");
  assert.equal(decision?.telemetryOutcome, "reissue_credentials");
});

test("missing local source falls through to discard-only", () => {
  const decision = buildVibeClipRecovery({
    outboxItem: outbox(),
    serverUpload: server(),
    localSourcePresent: false,
    nowMs: NOW,
  });

  assert.equal(decision?.canResume, false);
  assert.equal(decision?.canDiscard, true);
  assert.equal(decision?.resumeStrategy, null);
  assert.equal(decision?.telemetryOutcome, "discard_only");
});

test("published server uploads hide recovery even when local source is gone", () => {
  const decision = buildVibeClipRecovery({
    outboxItem: outbox(),
    serverUpload: server({
      status: "processing",
      publishedMessageId: "55555555-5555-4555-8555-555555555555",
    }),
    localSourcePresent: false,
    nowMs: NOW,
  });

  assert.equal(decision, null);
});

test("server-only stuck row shows a discard/check-status affordance", () => {
  const decision = buildVibeClipRecovery({
    outboxItem: null,
    serverUpload: server({ status: "processing" }),
    localSourcePresent: false,
    nowMs: NOW,
  });

  assert.equal(decision?.canResume, false);
  assert.equal(decision?.canDiscard, true);
  assert.equal(decision?.resumeStrategy, null);
  assert.equal(decision?.showPanel, true);
});

test("failed server status is surfaced as discard-only recovery", () => {
  const decision = buildVibeClipRecovery({
    outboxItem: null,
    serverUpload: server({ status: "failed" }),
    localSourcePresent: false,
    nowMs: NOW,
  });

  assert.equal(decision?.canResume, false);
  assert.equal(decision?.canDiscard, true);
  assert.equal(decision?.resumeStrategy, null);
  assert.equal(decision?.telemetryOutcome, "terminal_failed");
  assert.equal(decision?.showPanel, true);
});

test("sync self-healed ready published rows hide the recovery panel", () => {
  const decision = buildVibeClipRecovery({
    outboxItem: outbox(),
    serverUpload: server({
      status: "ready",
      publishedMessageId: "55555555-5555-4555-8555-555555555555",
    }),
    localSourcePresent: true,
    nowMs: NOW,
  });

  assert.equal(decision, null);
});
