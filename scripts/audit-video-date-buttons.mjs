#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const files = {
  // PR 7.5 decomposed the page into the videoDate family; PR 7 replaced the
  // deleted dateNavigationGuard with the shared navigation-intents family.
  webDate: [
    "src/pages/videoDate/videoDatePageShared.tsx",
    "src/pages/videoDate/useTerminalSurveyRecovery.ts",
    "src/pages/videoDate/useVideoDateBroadcastReconcile.ts",
    "src/pages/videoDate/useVideoDateLifecycleLeave.ts",
    "src/pages/VideoDate.tsx",
  ],
  webConnectionOverlay: "src/components/video-date/ConnectionOverlay.tsx",
  webControls: "src/components/video-date/VideoDateControls.tsx",
  webVibeCheck: "src/components/video-date/VibeCheckButton.tsx",
  webKeepTheVibe: "src/components/video-date/KeepTheVibe.tsx",
  webSafety: "src/components/video-date/InCallSafetyModal.tsx",
  webSurvey: "src/components/video-date/PostDateSurvey.tsx",
  webDateNavigationGuard: [
    "shared/videoDate/navigationIntents.ts",
    "src/lib/videoDateNavigationIntents.ts",
  ],
  webActiveSession: "src/hooks/useActiveSession.ts",
  webReadyGate: "src/components/lobby/ReadyGateOverlay.tsx",
  webEventLobby: "src/pages/EventLobby.tsx",
  // PR 8 decomposed the native date screen into its module family.
  nativeDate: [
    "apps/mobile/lib/videoDate/videoDateScreenShared.tsx",
    "apps/mobile/lib/daily/nativeDailyCallSingleton.ts",
    "apps/mobile/lib/daily/nativeDailyMediaHelpers.ts",
    "apps/mobile/lib/videoDate/nativeVideoDateSurfaceClient.ts",
    "apps/mobile/lib/videoDate/useNativeDailyAliveHeartbeat.ts",
    // PR 8.5 body sub-hooks, original in-screen source order.
    "apps/mobile/lib/videoDate/useNativeVideoDateCallListeners.ts",
    "apps/mobile/lib/videoDate/useNativeVideoDateRemoteSeen.ts",
    "apps/mobile/lib/videoDate/useNativeVideoDateCallEndCleanup.ts",
    "apps/mobile/lib/videoDate/useNativeVideoDateAppStateBackground.ts",
    "apps/mobile/lib/videoDate/useNativeVideoDateSurfaceClaim.ts",
    "apps/mobile/lib/videoDate/useNativeVideoDateStartCall.ts",
    "apps/mobile/lib/videoDate/useNativeVideoDateCameraControls.ts",
  "apps/mobile/app/date/[id].tsx",
    "apps/mobile/lib/videoDate/videoDateScreenStyles.ts",
  ],
  nativeDateNavigationGuard: [
    "shared/videoDate/navigationIntents.ts",
    "apps/mobile/lib/videoDateNavigationIntents.ts",
  ],
  nativeActiveSession: "apps/mobile/lib/useActiveSession.ts",
  nativeReadyGate: "apps/mobile/components/lobby/ReadyGateOverlay.tsx",
  nativeEventLobby: "apps/mobile/app/event/[eventId]/lobby.tsx",
  // PR 8.5: ready screen body split across lib/videoDate sub-hooks.
  nativeStandaloneReady: [
    "apps/mobile/lib/videoDate/useNativeReadyGateMediaPermissions.ts",
    "apps/mobile/lib/videoDate/useNativeReadyGateTruthReconcile.ts",
    "apps/mobile/lib/videoDate/useNativeReadyGateForfeitExpiry.ts",
    "apps/mobile/app/ready/[id].tsx",
  ],
  nativeConnectionOverlay: "apps/mobile/components/video-date/ConnectionOverlay.tsx",
  nativeControls: "apps/mobile/components/video-date/VideoDateControls.tsx",
  nativeVibeCheck: "apps/mobile/components/video-date/VibeCheckButton.tsx",
  nativeKeepTheVibe: "apps/mobile/components/video-date/KeepTheVibe.tsx",
  nativeSafety: "apps/mobile/components/video-date/InCallSafetySheet.tsx",
  nativeSurvey: "apps/mobile/components/video-date/PostDateSurvey.tsx",
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [
    key,
    Array.isArray(path) ? path.map(read).join("\n") : read(path),
  ]),
);

function mustInclude(key, needle, message) {
  assert.ok(source[key].includes(needle), `${files[key]}: ${message}`);
}

function mustMatch(key, pattern, message) {
  assert.match(source[key], pattern, `${files[key]}: ${message}`);
}

function mustOrder(key, beforeNeedle, afterNeedle, message) {
  const before = source[key].indexOf(beforeNeedle);
  const after = source[key].indexOf(afterNeedle);
  assert.ok(before >= 0, `${files[key]}: missing ${beforeNeedle}`);
  assert.ok(after > before, `${files[key]}: ${message}`);
}

function mustOrderAfter(key, anchorNeedle, beforeNeedle, afterNeedle, message) {
  const anchor = source[key].indexOf(anchorNeedle);
  assert.ok(anchor >= 0, `${files[key]}: missing ${anchorNeedle}`);
  const before = source[key].indexOf(beforeNeedle, anchor);
  const after = source[key].indexOf(afterNeedle, anchor);
  assert.ok(before >= 0, `${files[key]}: missing ${beforeNeedle} after ${anchorNeedle}`);
  assert.ok(after > before, `${files[key]}: ${message}`);
}

mustInclude("webDate", "const handlePreDateExit = useCallback", "web must have a dedicated pre-date escape path");
mustInclude("webDate", "runVideoDateManualExitStep(\"daily_cleanup\"", "web pre-date exit must bound Daily cleanup");
mustInclude("webDate", "runVideoDateManualExitStep(\"server_end\"", "web pre-date exit must bound server cleanup");
mustInclude("webDate", "signalPreDateManualEnd(reason)", "web pre-date exit must still signal server end");
mustInclude("webDate", "suppressDateNavigationAfterManualExit(id)", "web pre-date exit must suppress immediate lobby bounce-back");
mustInclude("webDate", "clearDateEntryTransition(id)", "web pre-date exit must clear date-entry latch");
mustInclude("webDate", "navigate(target, { replace: true })", "web pre-date exit must route out with replace");
mustMatch(
  "webDate",
  /onLeave=\{\s*peerMissing\.terminal\s*\?\s*handlePeerMissingLeave\s*:\s*handlePreDateExit\s*\}/,
  "non-terminal connection overlay Leave must use pre-date escape, not the survey end path",
);
mustInclude(
  "webDate",
  "onLeave={requestEndDateConfirmation}",
  "active controls must open the end-date confirmation before leaving",
);
mustInclude("webDate", "const confirmEndDate = useCallback", "web end-date confirmation must keep a real confirm handler");
mustInclude("webDate", "await handleLeave()", "web end-date confirmation must call the canonical leave handler");
mustInclude("webDate", "End this date?", "web end-date confirmation must keep the safety copy");
mustInclude("webDate", "Stay", "web end-date confirmation must keep the cancel action");
mustInclude("webDate", "End date", "web end-date confirmation must keep the destructive action");
mustInclude("webDate", "isLeaving={isLeavingVideoDate}", "web escape controls must expose in-flight disabled state");
mustMatch(
  "webDate",
  /const hasDateEntryTruth =\s*hasEnteredDateFlowRef\.current \|\|\s*phaseRef\.current === "date" \|\|\s*Boolean\(dateStartedAt\) \|\|\s*videoSessionHasEncounterExposureTruth\(entryTruth\)/,
  "web end handler must split pre-date escape from date-phase survey behavior",
);
mustInclude(
  "webDate",
  "confirmTerminalPostDateSurveyFromServerTruth(\"local_end\")",
  "date-phase end must confirm terminal server truth before opening the post-date survey",
);
mustInclude("webDate", "recoverTerminalPostDateSurvey", "date-phase end must keep terminal survey recovery");
mustInclude("webDate", "openPostDateSurvey(source)", "terminal survey recovery must still open the post-date survey");

mustInclude("webDateNavigationGuard", "recent_manual_exit", "date navigation guard must know manual exit suppression");
mustInclude("webDateNavigationGuard", "sessionStorage", "manual exit suppression must survive route remounts in the tab");
mustInclude(
  "webActiveSession",
  "isDateNavigationSuppressedAfterManualExit(next.sessionId)",
  "active-session hydration must not bounce a manual-exited user back into the same date",
);
mustInclude("nativeDateNavigationGuard", "recent_manual_exit", "native date navigation guard must know manual exit suppression");
mustInclude("nativeDateNavigationGuard", "suppressDateNavigationAfterManualExit", "native date navigation guard must expose manual exit suppression");
mustInclude(
  "nativeActiveSession",
  "isDateNavigationSuppressedAfterManualExit(reg.current_room_id as string)",
  "native active-session hydration must not resurrect a manually exited pre-connect date",
);
mustInclude(
  "nativeActiveSession",
  "manual_date_exit_suppressed_after_preconnect",
  "native active-session suppression must emit a durable reason code",
);

mustInclude("webConnectionOverlay", "onRetryRemotePlayback", "web playback resume button must stay wired");
mustInclude("webConnectionOverlay", "onRetryPeerMissing", "web peer-missing retry button must stay wired");
mustInclude("webConnectionOverlay", "onKeepWaitingPeerMissing", "web peer-missing keep-waiting button must stay wired");
mustInclude("webConnectionOverlay", "disabled={isLeaving}", "web connection buttons must disable during leave");
mustMatch("webConnectionOverlay", /<Button[\s\S]*type="button"[\s\S]*onClick=\{onLeave\}/, "web Leave button must be a real button wired to onLeave");
mustMatch("webControls", /aria-label=\{isLeaving \? "Ending date" : "End date"\}/, "web end-date control must expose leaving state");
mustMatch("webControls", /onClick=\{onLeave\}[\s\S]*disabled=\{isLeaving\}/, "web end-date control must be disabled while leaving");
mustMatch("webVibeCheck", /handleTap\("pass"\)/, "web Pass button must stay wired");
mustMatch("webVibeCheck", /handleTap\("vibe"\)/, "web Vibe button must stay wired");
mustMatch("webKeepTheVibe", /onClick=\{\(\) => handleExtend\(2, "extra_time"\)\}/, "web +2 min button must stay wired");
mustMatch("webKeepTheVibe", /onClick=\{\(\) => handleExtend\(5, "extended_vibe"\)\}/, "web +5 min button must stay wired");
mustMatch("webKeepTheVibe", /onClick=\{handleGetCreditsTap\}/, "web get-credits button must stay wired");
mustMatch("webSafety", /onClick=\{\(\) => void submit\("report"\)\}/, "web report-only button must stay wired");
mustMatch("webSafety", /onClick=\{\(\) => void submit\("end"\)\}/, "web end-and-report button must stay wired");
mustInclude("webSurvey", "onVerdict={handleVerdict}", "web post-date verdict buttons must stay wired");
mustInclude("webSurvey", "onReport={handleReportFromVerdict}", "web post-date report action must stay wired");
mustInclude("webSurvey", "onClick={() => setStep(\"highlights\")}", "web post-date continue button must stay wired");
mustInclude("webReadyGate", "const result = await skip()", "web Ready Gate Step away must await server forfeit truth");
mustInclude("webReadyGate", "result.status === \"both_ready\"", "web Ready Gate Step away must preserve both-ready race navigation");
mustInclude("webReadyGate", "manualExitRequestedRef", "web Ready Gate Step away must mark intentional exits before terminal close");
mustInclude("webReadyGate", "onManualExitConfirmed?.(sessionId)", "web Ready Gate must notify the lobby after confirmed manual exit");
mustMatch("webReadyGate", /type="button"[\s\S]*runTerminalAction\("skip_this_one"\)/, "web Ready Gate pre-ready Step away must be a real button");
mustMatch("webReadyGate", /type="button"[\s\S]*runTerminalAction\("cancel_go_back"\)/, "web Ready Gate waiting Step away must be a real button");
mustMatch("webReadyGate", /rounded-full px-4 py-2 text-xs text-muted-foreground/, "web Ready Gate text actions must keep a tappable hit area");
mustInclude("webEventLobby", "READY_GATE_MANUAL_EXIT_SUPPRESS_MS", "web lobby must suppress reopening a manually exited Ready Gate");
mustInclude("webEventLobby", "isReadyGateManualExitSuppressed(sessionId)", "web lobby must check Ready Gate manual-exit suppression before opening");
mustInclude("webEventLobby", "onManualExitConfirmed={suppressReadyGateSessionAfterManualExit}", "web Ready Gate overlay must wire manual-exit suppression");

mustInclude("nativeDate", "const handleAbortConnection = useCallback", "native must keep a dedicated connection abort path");
mustInclude("nativeDate", "abortConnectionInFlightRef", "native connection abort must dedupe repeated taps");
mustInclude("nativeDate", "endVideoDate(sessionId, \"ended_from_client\")", "native generic connection abort must use server pre-date cleanup to avoid ghost active sessions");
mustInclude("nativeDate", "fetchVideoSessionDateEntryTruth(sessionId)", "native peer-missing abort must reconcile server truth before terminalizing");
mustInclude("nativeDate", "shouldTerminalizeNativePeerMissingAbort(truth)", "native peer-missing abort must gate terminalization on partial-join evidence");
mustInclude("nativeDate", "reason_code: \"pre_date_manual_end\"", "native generic connection abort must emit server pre-date cleanup telemetry");
mustInclude("nativeDate", "server_end_attempted: true", "native pre-date abort telemetry must prove server cleanup was attempted");
mustInclude("nativeDate", "suppressDateNavigationAfterManualExit(sessionId)", "native connection abort must suppress immediate lobby bounce-back");
mustInclude("nativeDate", "endVideoDate(sessionId, \"partial_join_peer_timeout\")", "native peer-missing abort must preserve canonical server reason");
mustInclude("nativeDate", "router.replace(target)", "native connection abort must route out");
mustInclude("nativeDate", "isLeaving={isAbortingConnection}", "native connection overlay must expose in-flight disabled state");
mustInclude("nativeConnectionOverlay", "disabled={isLeaving}", "native overlay Leave must disable while leaving");
mustInclude("nativeConnectionOverlay", "{isLeaving ? 'Leaving...' : partnerWaitMax ? 'Return to deck' : 'Leave'}", "native overlay Leave must show progress copy");
mustInclude("nativeDate", "isLeaving={isEndDateConfirming}", "native active controls must expose in-flight disabled state");
mustMatch("nativeControls", /isLeaving = false/, "native controls must default to an enabled state");
mustMatch("nativeControls", /disabled=\{isLeaving\}/, "native controls must disable terminal actions while leaving");
mustMatch("nativeControls", /onPress=\{onLeave\}/, "native end-call button must stay wired");
mustMatch("nativeVibeCheck", /handlePress\('pass'\)/, "native Pass button must stay wired");
mustMatch("nativeVibeCheck", /handlePress\('vibe'\)/, "native Vibe button must stay wired");
mustMatch("nativeKeepTheVibe", /onPress=\{\(\) => handleExtend\(2, 'extra_time'\)\}/, "native +2 min button must stay wired");
mustMatch("nativeKeepTheVibe", /onPress=\{\(\) => handleExtend\(5, 'extended_vibe'\)\}/, "native +5 min button must stay wired");
mustInclude("nativeSafety", "onPress={() => void submit('report')}", "native report-only button must stay wired");
mustInclude("nativeSafety", "onPress={() => void submit('end')}", "native end-and-report button must stay wired");
mustInclude("nativeSurvey", "onPress={() => void handleVerdict(true)}", "native post-date Vibe verdict must stay wired");
mustInclude("nativeSurvey", "onPress={() => void handleVerdict(false)}", "native post-date Pass verdict must stay wired");
mustInclude("nativeReadyGate", "const result = await forfeit()", "native Ready Gate Step away must await server forfeit truth");
mustInclude("nativeReadyGate", "result.status === 'both_ready'", "native Ready Gate Step away must preserve both-ready race navigation");
mustInclude("nativeReadyGate", "manualExitRequestedRef", "native Ready Gate Step away must mark intentional exits before terminal close");
mustInclude("nativeReadyGate", "onManualExitConfirmed?.(sessionId)", "native Ready Gate must notify the lobby after confirmed manual exit");
mustInclude("nativeEventLobby", "READY_GATE_MANUAL_EXIT_SUPPRESS_MS", "native lobby must suppress reopening a manually exited Ready Gate");
mustInclude("nativeEventLobby", "isReadyGateManualExitSuppressed(sessionId)", "native lobby must check Ready Gate manual-exit suppression before opening");
mustInclude("nativeEventLobby", "onManualExitConfirmed={suppressReadyGateAfterManualExit}", "native Ready Gate overlay must wire manual-exit suppression");
mustInclude("nativeEventLobby", "isDateNavigationSuppressedAfterManualExit(sessionIdToOpen)", "native lobby must suppress date re-entry after a local pre-connect exit");
mustInclude("nativeEventLobby", "date_nav_suppressed_before_prepare", "native lobby must record manual date re-entry suppression before preparing provider entry");
mustInclude("nativeStandaloneReady", "const result = await forfeit()", "standalone native Ready Gate Step away must await server forfeit truth");
mustInclude("nativeStandaloneReady", "resolveReadyGateTransitionFailureCopy", "standalone native Ready Gate must keep conflict-aware forfeit failure handling");
mustInclude("nativeStandaloneReady", "action: 'forfeit'", "standalone native Ready Gate forfeit failures must be classified by action");
mustInclude("nativeStandaloneReady", "multi_device_conflict: fallback.staleOrConflict", "standalone native Ready Gate must surface multi-device forfeit conflicts");

mustOrderAfter(
  "webDate",
  "const handlePreDateExit = useCallback",
  "suppressDateNavigationAfterManualExit(id)",
  "navigate(target, { replace: true })",
  "manual exit suppression must be installed before routing to the lobby",
);
mustOrderAfter(
  "nativeEventLobby",
  "const navigateToDateSession = useCallback",
  "isDateNavigationSuppressedAfterManualExit(sessionIdToOpen)",
  "ensureVideoDateStartableBeforeNavigation",
  "native manual date-exit suppression must run before provider/startability preparation",
);

console.log("Video Date button contract audit passed.");
