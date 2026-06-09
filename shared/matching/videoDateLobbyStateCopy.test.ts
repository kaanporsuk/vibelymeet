import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveLobbyEmptyStateCopy,
  resolveVideoDateLobbyStateCopy,
  type VideoDateLobbyFocusedReason,
} from "./videoDateLobbyStateCopy";

test("focused lobby state copy maps back to coarse safe observability reasons", () => {
  const cases: Array<[VideoDateLobbyFocusedReason, string]> = [
    ["ready_gate_diagnostic_failure", "all_candidates_busy_or_unavailable"],
    ["safety_limited", "user_not_eligible"],
    ["geo_or_eligibility_mismatch", "user_not_eligible"],
    ["media_unavailable", "rpc_error"],
    ["recoverable_fetch_error", "network_error"],
    ["terminal_event_state", "event_not_active"],
  ];

  for (const [reason, observabilityReason] of cases) {
    assert.equal(resolveVideoDateLobbyStateCopy({ reason }).observabilityReason, observabilityReason);
  }
});

test("focused lobby state copy separates retryable and terminal states", () => {
  assert.equal(resolveVideoDateLobbyStateCopy({ reason: "recoverable_fetch_error" }).retryable, true);
  assert.equal(resolveVideoDateLobbyStateCopy({ reason: "terminal_event_state" }).terminal, true);
  assert.equal(resolveVideoDateLobbyStateCopy({ reason: "geo_or_eligibility_mismatch" }).actionTarget, "event");
});

test("legacy lobby empty-state helper name remains a stable alias", () => {
  const input = { reason: "media_unavailable" as const };
  assert.deepEqual(resolveLobbyEmptyStateCopy(input), resolveVideoDateLobbyStateCopy(input));
});
