import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

test("native lobby normalizes swipe outcome fields before routing and telemetry", () => {
  const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");

  assert.match(nativeLobby, /getSwipeOutcome/);
  assert.match(nativeLobby, /result: envelope\.result \?\? envelope\.outcome \?\? envelope\.error \?\? null/);
  assert.match(nativeLobby, /const failureOutcome = getSwipeOutcome\(normalizedEnvelope\)/);
  assert.match(nativeLobby, /showSwipeToast\(failureOutcome\)/);
  assert.match(nativeLobby, /getSwipeFailureUserMessage\(normalizedEnvelope\)/);
  assert.match(nativeLobby, /const outcome = getSwipeOutcome\(normalizedEnvelope\)/);
  assert.match(nativeLobby, /shouldAdvanceLobbyDeckAfterSwipe\(outcome\)/);
  assert.match(nativeLobby, /shouldAdvanceLobbyDeckAfterSwipe\(failureOutcome\)/);
  assert.match(nativeLobby, /videoSessionIdFromSwipePayload\(normalizedEnvelope\)/);
  assert.match(nativeLobby, /shouldOpenReadyGateFromSwipePayload\(normalizedEnvelope\)/);
  assert.match(nativeLobby, /readyGateOpenSuppressed/);
  assert.match(nativeLobby, /swipe_ready_gate_open_suppressed_after_manual_exit/);
  assert.match(nativeLobby, /if \(!readyGateOpenSuppressed\) \{[\s\S]+showSwipeToast\(outcome, \{ openingReadyGate \}\)/);
});

test("native lobby treats backend event_not_active as a terminal gate", () => {
  const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");

  assert.match(nativeLobby, /serverInactiveEventReason/);
  assert.match(nativeLobby, /setServerInactiveEventReason\(['"]event_not_active['"]\)/);
  assert.match(nativeLobby, /setServerInactiveEventReason\(failureReason\)/);
  assert.match(nativeLobby, /deckEmptyReason === ['"]event_not_active['"]/);
  assert.match(nativeLobby, /if \(isEventInactiveByServer\) return ['"]event_not_active['"]/);
  assert.match(nativeLobby, /resolveEventDeckPhase4UiState/);
  assert.match(nativeLobby, /router\.replace\('\/\(tabs\)\/matches'\)/);
});

test("native lobby covers backend swipe outcome taxonomy without client side effects", () => {
  const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");

  for (const outcome of [
    "pass_recorded",
    "vibe_recorded",
    "super_vibe_sent",
    "match",
    "match_queued",
    "already_matched",
    "already_swiped",
    "swipe_already_recorded",
    "event_not_active",
    "participant_has_active_session_conflict",
    "pair_already_met_this_event",
    "limit_reached",
    "already_super_vibed_recently",
    "target_unavailable",
    "target_not_found",
    "rate_limited",
    "account_paused",
    "not_registered",
    "unauthorized",
    "invalid_request",
    "swipe_failed",
    "internal_error",
    "blocked",
    "reported",
  ]) {
    assert.match(nativeLobby, new RegExp(`['"]${outcome}['"]`), `native lobby should handle ${outcome}`);
  }

  assert.match(nativeLobby, /LOBBY_SWIPE_DUPLICATE_SUPPRESSED/);
  assert.doesNotMatch(nativeLobby, /sendPushNotification|sendNotification|OneSignal\.postNotification/);
});

test("native lobby respects deck availability state and media contract", () => {
  const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
  const imageUrl = read("apps/mobile/lib/imageUrl.ts");

  assert.match(nativeLobby, /currentAvailabilityState = current\?\.availability_state \?\? ['"]available['"]/);
  assert.match(nativeLobby, /currentIsSwipeable = currentAvailabilityState === ['"]available['"]/);
  assert.match(nativeLobby, /currentSwipePending = current \? pendingSwipeTargetIds\.has\(current\.id\) : false/);
  assert.match(nativeLobby, /pendingSwipeTargetIdsRef\.current\.has\(current\.id\)/);
  assert.match(nativeLobby, /swipeActionsDisabled = currentSwipePending \|\| !currentIsSwipeable \|\| swipeRateLimited/);
  assert.match(nativeLobby, /disabled=\{swipeActionsDisabled/);
  assert.match(nativeLobby, /availabilityState = profile\.availability_state \?\? ['"]available['"]/);
  assert.match(nativeLobby, /queueBadgeLabel = isUnavailable \? 'Unavailable' : 'In session'/);
  assert.match(nativeLobby, /profile\.primary_photo_path \?\?/);
  assert.match(nativeLobby, /resolvePrimaryProfilePhotoPath/);
  assert.match(nativeLobby, /deckCardUrl\(photo, profile\.media_version\)/);
  assert.match(imageUrl, /export function deckCardUrl/);
  assert.match(imageUrl, /width: 1080/);
  assert.match(imageUrl, /height: 1440/);
});

test("native Event Lobby implementation status docs are present", () => {
  const contract = read("docs/contracts/event-lobby-native-contract.md");
  const verification = read("docs/audits/native-event-lobby-parity-implementation.md");
  const delta = read("docs/branch-deltas/fix-native-event-lobby-parity.md");
  const activeDocMap = read("docs/active-doc-map.md");

  assert.match(contract, /Prompt 9 Implementation Status/);
  assert.match(verification, /Supabase project ref: `schdyxcunwcvddlcshwd`/);
  assert.match(verification, /No schema changes/);
  assert.match(verification, /No Edge Function changes/);
  assert.match(verification, /Rebuild Delta/);
  assert.match(delta, /Native Event Lobby parity implementation/);
  assert.match(activeDocMap, /Event Lobby native parity implementation/);
});
