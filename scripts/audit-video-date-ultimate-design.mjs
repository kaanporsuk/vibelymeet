#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const strict = process.argv.includes("--strict");
const json = process.argv.includes("--json");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const files = {
  webDate: "src/pages/VideoDate.tsx",
  webTimer: "src/components/video-date/EntryPhaseTimer.tsx",
  webIceBreaker: "src/components/video-date/IceBreakerCard.tsx",
  webVibeCheck: "src/components/video-date/VibeCheckButton.tsx",
  webControls: "src/components/video-date/VideoDateControls.tsx",
  webPip: "src/components/video-date/SelfViewPIP.tsx",
  webSafety: "src/components/video-date/InCallSafetyModal.tsx",
  webKeepTheVibe: "src/components/video-date/KeepTheVibe.tsx",
  webCall: "src/hooks/useVideoCall.ts",
  nativeDate: "apps/mobile/app/date/[id].tsx",
  nativeTimer: "apps/mobile/components/video-date/EntryPhaseTimer.tsx",
  nativeIceBreaker: "apps/mobile/components/video-date/IceBreakerCard.tsx",
  nativeVibeCheck: "apps/mobile/components/video-date/VibeCheckButton.tsx",
  nativeControls: "apps/mobile/components/video-date/VideoDateControls.tsx",
  nativeSafety: "apps/mobile/components/video-date/InCallSafetySheet.tsx",
  nativeKeepTheVibe: "apps/mobile/components/video-date/KeepTheVibe.tsx",
  sharedCountdown: "shared/matching/videoDateCountdown.ts",
  sharedIceBreakers: "shared/matching/videoDateIceBreakers.ts",
  sharedExtension: "shared/matching/videoDateExtensionSpend.ts",
  mediaAudit: "scripts/audit-video-date-remote-frame.mjs",
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, read(path)]),
);

const results = [];

function evidence(key, needle) {
  const path = files[key];
  if (!needle) return path;
  const text = source[key];
  const index = text.indexOf(needle);
  if (index < 0) return path;
  const line = text.slice(0, index).split("\n").length;
  return `${path}:${line}`;
}

function add(status, area, requirement, evidenceText, detail = "") {
  results.push({ status, area, requirement, evidence: evidenceText, detail });
}

function check(condition, area, requirement, passEvidence, gapEvidence, detail = "") {
  add(condition ? "PASS" : "GAP", area, requirement, condition ? passEvidence : gapEvidence, detail);
}

function includes(key, needle) {
  return source[key].includes(needle);
}

function matches(key, pattern) {
  return pattern.test(source[key]);
}

function sliceBetween(key, startNeedle, endNeedle) {
  const text = source[key];
  const start = text.indexOf(startNeedle);
  if (start < 0) return "";
  const end = text.indexOf(endNeedle, start);
  return text.slice(start, end >= 0 ? end : undefined);
}

check(
  includes("webDate", "<PartnerProfileSheet") &&
    includes("webDate", "onClick={() => isConnected && setShowProfileSheet(true)}") &&
    includes("webDate", "setShowProfileSheet(true)"),
  "Profile",
  "Web top chip and dock profile icon open the same non-destructive profile sheet.",
  `${evidence("webDate", "<PartnerProfileSheet")} and ${evidence("webDate", "setShowProfileSheet(true)")}`,
  files.webDate,
);

check(
  includes("nativeDate", "setShowProfileSheet(true)") &&
    includes("nativeDate", "styles.partnerChip") &&
    includes("nativeDate", "const profileSheetPartner") &&
    includes("nativeDate", "partner={profileSheetPartner}") &&
    includes("nativeDate", "onViewProfile={"),
  "Profile",
  "Native top chip and dock profile icon open the same profile sheet, including basic-profile fallback while full data loads.",
  `${evidence("nativeDate", "styles.partnerChip")} and ${evidence("nativeDate", "const profileSheetPartner")}`,
  files.nativeDate,
);

check(
  includes("webDate", "objectFit: VIDEO_DATE_REMOTE_OBJECT_FIT") &&
    includes("webDate", "REMOTE_DATE_VIDEO_CLASS") &&
    includes("mediaAudit", 'VIDEO_DATE_REMOTE_OBJECT_FIT = "contain"'),
  "Remote Video",
  "Web remote video keeps the contain media contract.",
  `${evidence("webDate", "objectFit: VIDEO_DATE_REMOTE_OBJECT_FIT")} plus ${files.mediaAudit}`,
  files.webDate,
);

check(
  matches("nativeDate", /<DailyMediaView[\s\S]*objectFit="contain"[\s\S]*zOrder=\{0\}/),
  "Remote Video",
  "Native remote video keeps DailyMediaView objectFit=\"contain\".",
  evidence("nativeDate", 'objectFit="contain"'),
  files.nativeDate,
);

check(
  includes("webDate", "data-video-date-stage") &&
    includes("webDate", "md:w-[min(calc(100vw_-_2rem),500px)]") &&
    includes("webDate", "md:h-[min(calc(100dvh_-_2rem),920px)]"),
  "Remote Video",
  "Desktop web uses an intentional centered date stage.",
  evidence("webDate", "data-video-date-stage"),
  files.webDate,
);

check(
  includes("sharedCountdown", "remainingStartedAtCountdownSeconds") &&
    includes("sharedCountdown", "resolveVideoDatePhaseCountdown") &&
    includes("webDate", "resolveVideoDatePhaseCountdown") &&
    includes("nativeDate", "resolveVideoDatePhaseCountdown") &&
    includes("webDate", "entryStartedAt") &&
    includes("nativeDate", "entryStartedAtIso"),
  "Timer Sync",
  "Entry countdown derives from shared started-at session time on web and native.",
  `${files.sharedCountdown}, ${evidence("webDate", "resolveVideoDatePhaseCountdown")}, ${evidence("nativeDate", "resolveVideoDatePhaseCountdown")}`,
  `${files.sharedCountdown}, ${files.webDate}, ${files.nativeDate}`,
);

check(
  !sliceBetween("nativeDate", "Authoritative visible countdown", "const toggleMute").includes("hasRemotePartner") &&
    !sliceBetween("nativeDate", "Authoritative visible countdown", "const toggleMute").includes("isTimerPaused"),
  "Timer Sync",
  "Native visible timer is not gated by remote participant or reconnect UI state.",
  evidence("nativeDate", "Authoritative visible countdown"),
  files.nativeDate,
);

check(
  includes("webTimer", 'phase === "handshake" && isUrgent') &&
    includes("nativeTimer", "phase === 'handshake' && isUrgent"),
  "Timer Motion",
  "Heartbeat/pulse is gated to the final 10 seconds of handshake only.",
  `${evidence("webTimer", 'phase === "handshake" && isUrgent')} and ${evidence("nativeTimer", "phase === 'handshake' && isUrgent")}`,
  `${files.webTimer}, ${files.nativeTimer}`,
);

check(
  !includes("webTimer", '"hsl(0,84%,60%)"') &&
    !includes("webTimer", "hsl(0, 84%, 60%)") &&
    !matches("nativeTimer", /if \(phase === 'handshake'\) \{\s*if \(isUrgent\) return 'hsl\(0, 84%, 60%\)'/),
  "Timer Tone",
  "Handshake urgency avoids aggressive red warning colors.",
  `${files.webTimer}, ${files.nativeTimer}`,
  `${files.webTimer}, ${files.nativeTimer}`,
  "Ultimate spec asks for violet/pink glow, not red alarm styling.",
);

check(
  includes("webPip", "canFlipCamera && !isVideoOff && onFlipCamera") &&
    includes("webCall", "cycleCamera") &&
    includes("nativeDate", "canFlipCamera && !isVideoOff && localVideoTrack") &&
    includes("nativeDate", "cycleCamera"),
  "PiP",
  "Flip camera control is gated and wired where supported.",
  `${evidence("webPip", "canFlipCamera && !isVideoOff && onFlipCamera")} and ${evidence("nativeDate", "canFlipCamera && !isVideoOff && localVideoTrack")}`,
  `${files.webPip}, ${files.webCall}, ${files.nativeDate}`,
);

check(
  includes("webPip", "MicOff") &&
    includes("webPip", "Camera off") &&
    includes("nativeDate", "styles.muteBadge") &&
    includes("nativeDate", "videocam-off"),
  "PiP",
  "Self-view PiP exposes mute and camera-off state.",
  `${evidence("webPip", "MicOff")} and ${evidence("nativeDate", "styles.muteBadge")}`,
  `${files.webPip}, ${files.nativeDate}`,
);

check(
  !includes("webIceBreaker", "Choose when it feels right") &&
    !includes("nativeIceBreaker", "Choose when it feels right") &&
    !includes("nativeIceBreaker", "Choose only when it feels right") &&
    includes("webVibeCheck", "Continue when ready") &&
    includes("nativeVibeCheck", "Continue when ready"),
  "Icebreaker",
  "Decision guidance is removed from icebreaker and owned by Pass/Vibe.",
  `${evidence("webVibeCheck", "Continue when ready")} and ${evidence("nativeVibeCheck", "Continue when ready")}`,
  `${files.webIceBreaker}, ${files.nativeIceBreaker}, ${files.webVibeCheck}, ${files.nativeVibeCheck}`,
);

check(
  includes("webIceBreaker", "advance_video_session_vibe_question") &&
    includes("webIceBreaker", "onDismiss") &&
    includes("nativeIceBreaker", "onShuffle") &&
    includes("nativeIceBreaker", "onDismiss"),
  "Icebreaker",
  "Prompt next and close controls are real actions on web and native.",
  `${evidence("webIceBreaker", "advance_video_session_vibe_question")} and ${evidence("nativeIceBreaker", "onShuffle")}`,
  `${files.webIceBreaker}, ${files.nativeIceBreaker}`,
);

check(
  includes("sharedIceBreakers", "VIDEO_DATE_ICE_BREAKER_ROTATION_MS = 8_000"),
  "Icebreaker",
  "Auto-rotation interval is the ultimate 8 seconds.",
  evidence("sharedIceBreakers", "VIDEO_DATE_ICE_BREAKER_ROTATION_MS"),
  evidence("sharedIceBreakers", "VIDEO_DATE_ICE_BREAKER_ROTATION_MS"),
  "Current source should use 8_000 to fully match the ultimate spec.",
);

check(
  includes("sharedIceBreakers", "ICE_BREAKER_MANUAL_PAUSE_MS") ||
    includes("webIceBreaker", "10_000") ||
    includes("nativeDate", "10_000"),
  "Icebreaker",
  "Manual next pauses auto-rotation for 10 seconds.",
  `${files.sharedIceBreakers}, ${files.webIceBreaker}, ${files.nativeDate}`,
  `${files.sharedIceBreakers}, ${files.webIceBreaker}, ${files.nativeDate}`,
);

check(
  includes("webDate", "Icebreaker") &&
    matches("webDate", /showCollapsedIceBreaker|collapsed/) &&
    includes("nativeDate", "Icebreaker") &&
    matches("nativeDate", /showCollapsedIceBreaker|collapsed/),
  "Icebreaker",
  "Dismissed prompt offers a subtle collapsed reopen affordance.",
  `${files.webDate}, ${files.nativeDate}`,
  `${files.webDate}, ${files.nativeDate}`,
);

check(
  includes("webVibeCheck", "bg-gradient-to-r from-primary to-accent") &&
    includes("nativeVibeCheck", "LinearGradient") &&
    includes("webVibeCheck", "Ready to continue") &&
    includes("nativeVibeCheck", "Ready to continue") &&
    includes("webVibeCheck", "Continue when ready") &&
    includes("nativeVibeCheck", "Continue when ready") &&
    !includes("webVibeCheck", "Your choice only continues after it saves") &&
    !includes("nativeVibeCheck", "Your choice only continues after it saves") &&
    !includes("webVibeCheck", "Soft nudge") &&
    !includes("nativeVibeCheck", "Soft nudge"),
  "Pass/Vibe",
  "Decision rail uses quiet Pass, gradient Vibe, saved states, and avoids old anxious copy.",
  `${evidence("webVibeCheck", "bg-gradient-to-r from-primary to-accent")} and ${evidence("nativeVibeCheck", "LinearGradient")}`,
  `${files.webVibeCheck}, ${files.nativeVibeCheck}`,
);

check(
  !includes("webVibeCheck", "Warm-up ending") && !includes("nativeVibeCheck", "Warm-up ending") &&
    !includes("webVibeCheck", "saved before") && !includes("nativeVibeCheck", "saved before"),
  "Pass/Vibe",
  "Warm-up choice microcopy is calm and not technical/anxious.",
  `${files.webVibeCheck}, ${files.nativeVibeCheck}`,
  `${files.webVibeCheck}, ${files.nativeVibeCheck}`,
  "Ultimate verification explicitly calls out Warm-up ending and technical save language for review.",
);

check(
  !includes("webControls", "partnerName") &&
    !includes("nativeControls", "partnerName") &&
    matches("webControls", /User[\s\S]*Mic[\s\S]*aria-label=\{isLeaving \? "Ending date" : "End date"\}[\s\S]*PhoneOff[\s\S]*Video[\s\S]*Shield/) &&
    matches("nativeControls", /person[\s\S]*mic[\s\S]*phone-hangup[\s\S]*videocam[\s\S]*shield-checkmark/),
  "Bottom Dock",
  "Bottom dock is icon-only and ordered Profile, Mic, End, Camera, Safety.",
  `${files.webControls}, ${files.nativeControls}`,
  `${files.webControls}, ${files.nativeControls}`,
);

check(
  includes("webDate", "End this date?") && includes("webDate", "Stay") && includes("webDate", "End date") &&
    includes("nativeDate", "End this date?") && includes("nativeDate", "Stay") && includes("nativeDate", "End date"),
  "End Call",
  "End call is protected by the ultimate confirmation sheet.",
  `${files.webDate}, ${files.nativeDate}`,
  `${files.webDate}, ${files.nativeDate}`,
);

check(
  includes("webSafety", 'submit("report")') &&
    includes("webSafety", 'submit("end")') &&
    includes("nativeSafety", "submit('report')") &&
    includes("nativeSafety", "submit('end')"),
  "Safety",
  "Safety/report sheet exposes report and end-after-report actions.",
  `${files.webSafety}, ${files.nativeSafety}`,
  `${files.webSafety}, ${files.nativeSafety}`,
);

check(
  matches("webDate", /phase === "date"[\s\S]*<KeepTheVibe/) &&
    matches("nativeDate", /showDatePhaseChrome[\s\S]*<KeepTheVibe/) &&
    includes("sharedExtension", "not_in_date_phase") &&
    !includes("nativeDate", "addTimeFab"),
  "Extension",
  "Extension remains backend-safe, date-phase only, and near the timer without a duplicate native FAB.",
  `${evidence("webDate", '<KeepTheVibe')} and ${evidence("sharedExtension", "not_in_date_phase")}`,
  `${files.webDate}, ${files.nativeDate}, ${files.sharedExtension}`,
  "This intentionally differs from a warm-up Extend CTA because current backend rejects non-date usage.",
);

check(
  !sliceBetween("webDate", "{/* ─── Pass/Vibe", "{/* ─── Mutual Vibe").includes("<KeepTheVibe") &&
    !sliceBetween("nativeDate", "{showHandshakeChrome", "{showDatePhaseChrome").includes("<KeepTheVibe"),
  "Extension",
  "No broken warm-up spend-credit CTA is visible.",
  `${files.webDate}, ${files.nativeDate}`,
  `${files.webDate}, ${files.nativeDate}`,
);

check(
  includes("nativeControls", "layout.minTouchTargetSize") ||
    includes("nativeIceBreaker", "layout.minTouchTargetSize") ||
    includes("nativeControls", "BTN_DEFAULT = 52"),
  "Native Layout",
  "Native touch targets meet or exceed 48 px for warm-up controls.",
  `${files.nativeControls}, ${files.nativeIceBreaker}`,
  `${files.nativeControls}, ${files.nativeIceBreaker}`,
);

check(
  includes("nativeDate", "onLayout={handleControlsLayout}") &&
    includes("nativeDate", "bottom: insets.bottom") &&
    includes("nativeDate", "measuredControlsStackHeight") &&
    includes("nativeDate", "Math.max(DATE_CONTROLS_STACK_HEIGHT, controlsStackHeight)"),
  "Native Layout",
  "Native lower stack derives warm-up offsets from measured dock height and safe-area bottom.",
  `${evidence("nativeDate", "onLayout={handleControlsLayout")} and ${evidence("nativeDate", "bottom: insets.bottom")}`,
  files.nativeDate,
);

check(
  includes("nativeControls", "COMPACT_DOCK_WIDTH = 350") &&
    includes("nativeControls", "BTN_COMPACT = 48") &&
    includes("nativeControls", "LEAVE_COMPACT = 52") &&
    includes("nativeControls", "useWindowDimensions"),
  "Native Layout",
  "Native bottom dock has compact sizing with 48 px minimum quiet controls.",
  evidence("nativeControls", "COMPACT_DOCK_WIDTH"),
  files.nativeControls,
);

check(
  includes("webControls", "clamp(3rem,14vw,3.5rem)") &&
    includes("webControls", "gap-[clamp(0.25rem,1.8vw,0.5rem)]") &&
    includes("webControls", "px-[clamp(0.5rem,2.6vw,1rem)]") &&
    includes("webControls", "gap-[clamp(0.25rem,2vw,0.625rem)]"),
  "Web Layout",
  "Web bottom dock uses clamp sizing so compact mobile web keeps all controls visible.",
  evidence("webControls", "clamp(3rem,14vw,3.5rem)"),
  files.webControls,
);

add(
  "BLOCKED",
  "Runtime",
  "Two-user timer sync, live media, profile sheet, safety sheet, Pass/Vibe save, and extension spend require authenticated test accounts plus an active video-date session.",
  "No staging credentials or active non-production session are encoded in repo.",
);

add(
  "BLOCKED",
  "Native Runtime",
  "iOS/Android visual runtime verification requires an existing Expo/dev-client session or simulator/device run; local native/mobile builds are explicitly out of scope.",
  "Plan constraint: no Expo/EAS/native build.",
);

const counts = results.reduce(
  (acc, row) => {
    acc[row.status] += 1;
    return acc;
  },
  { PASS: 0, GAP: 0, BLOCKED: 0 },
);

if (json) {
  console.log(JSON.stringify({ counts, results }, null, 2));
} else {
  console.log("Vibely Video Date Warm-up Ultimate Design Scorecard");
  console.log(`PASS ${counts.PASS} | GAP ${counts.GAP} | BLOCKED ${counts.BLOCKED}`);
  console.log("");
  for (const row of results) {
    console.log(`[${row.status}] ${row.area}: ${row.requirement}`);
    console.log(`  Evidence: ${row.evidence}`);
    if (row.detail) console.log(`  Note: ${row.detail}`);
  }
}

if (strict && (counts.GAP > 0 || counts.BLOCKED > 0)) {
  process.exitCode = 1;
}
