import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("Ready Gate diagnostics render shared checklist rows and only actionable repairs", () => {
  const webReadyGate = read("src/components/lobby/ReadyGateOverlay.tsx");
  const nativeReadyGate = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
  const nativeChecklist = read("apps/mobile/components/lobby/ReadyGateDiagnosticChecklist.tsx");

  assert.match(webReadyGate, /aria-label="Ready Gate diagnostics"/);
  assert.match(webReadyGate, /diagnosticChecklist\.rows\.map\(\(row\)/);
  assert.match(webReadyGate, /row\.actionKind !== "none" && row\.actionKind !== "wait"/);
  assert.match(webReadyGate, /handleDiagnosticAction\(row\)/);

  assert.match(nativeReadyGate, /<ReadyGateDiagnosticChecklist/);
  assert.match(nativeReadyGate, /rows=\{diagnosticChecklist\.rows\}/);
  assert.match(nativeReadyGate, /onAction=\{handleDiagnosticAction\}/);
  assert.match(nativeChecklist, /accessibilityLabel="Ready Gate diagnostics"/);
  assert.match(nativeChecklist, /canRenderAction\(row\.actionKind\)/);
});

test("safety submit surfaces keep duplicate-submit guards and durable success routing", () => {
  const webSafety = read("src/components/video-date/InCallSafetyModal.tsx");
  const nativeSafety = read("apps/mobile/components/video-date/InCallSafetySheet.tsx");
  const webDate = read("src/pages/VideoDate.tsx");
  const nativeDate = read("apps/mobile/app/date/[id].tsx");

  for (const source of [webSafety, nativeSafety]) {
    assert.match(source, /submitInFlightRef/);
    assert.match(source, /resolveVideoDateSafetySubmitCopy/);
    assert.match(source, /resolveVideoDateSafetySubmitOutcome/);
    assert.match(source, /onServerEndedAfterReport/);
    assert.match(source, /onReportOnlySuccess/);
    assert.match(source, /onEndAfterReport/);
  }

  assert.match(webSafety, /if \(!reportedUserId \|\| submitInFlightRef\.current\) return/);
  assert.match(webSafety, /disabled = !reportedUserId \|\| submitting !== "idle"/);
  assert.match(nativeSafety, /if \(submitInFlightRef\.current\) return/);
  assert.match(nativeSafety, /if \(!reportedUserId\)/);
  assert.match(nativeSafety, /disabled = !reportedUserId \|\| busy !== 'idle'/);

  assert.match(webDate, /suppressPartnerControlsAfterSafety/);
  assert.match(nativeDate, /suppressPartnerControlsAfterSafety/);
});

test("queue and lobby state surfaces render rich queue details and honor retry versus terminal actions", () => {
  const webLobby = read("src/pages/EventLobby.tsx");
  const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");

  for (const source of [webLobby, nativeLobby]) {
    assert.match(source, /resolveEventDeckPhase4UiState/);
    assert.match(source, /resolveVideoDateQueueCopy/);
    assert.match(source, /queueHintCopy\.title/);
    assert.match(source, /queueHintCopy\.message/);
    assert.match(source, /queueHintDetailParts\.map/);
    assert.match(source, /deckErrorUiState\.actionTarget === ['"]matches['"]/);
    assert.match(source, /deckErrorUiState\.actionTarget === ['"]event['"]/);
    assert.match(source, /deckErrorUiState\.actionTarget === ['"]end_break['"]/);
  }

  assert.match(webLobby, /void refetchDeck\(\)/);
  assert.match(nativeLobby, /refetchDeck\(\)/);
});
