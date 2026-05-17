import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const exists = (path: string) => existsSync(new URL(`../../${path}`, import.meta.url));

test("chat overflow actions use server-owned archive, mute, and unmatch contracts", () => {
  const migration = read("supabase/migrations/20260509235500_chat_overflow_actions_server_contract.sql");
  const unmatchActorMigration = read("supabase/migrations/20260511153000_match_call_unmatch_actor.sql");
  const webArchive = read("src/hooks/useArchiveMatch.ts");
  const webMute = read("src/hooks/useMuteMatch.ts");
  const webUnmatch = read("src/hooks/useUnmatch.ts");
  const webBlock = read("src/hooks/useBlockUser.ts");
  const nativeArchive = read("apps/mobile/lib/useArchiveMatch.ts");
  const nativeMute = read("apps/mobile/lib/useMuteMatch.ts");
  const nativeUnmatch = read("apps/mobile/lib/useUnmatch.ts");
  const nativeBlock = read("apps/mobile/lib/useBlockUser.ts");
  const blockMigration = read("supabase/migrations/20260430211000_blocked_users_server_owned_safety.sql");
  const lockdownMigration = read(
    "supabase/migrations/20260510001000_chat_overflow_rls_write_lockdown_followup.sql",
  );
  const conversationCountMigration = read(
    "supabase/migrations/20260510020000_fix_daily_drop_and_conversation_count_contracts.sql",
  );

  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.match_archives/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.set_match_archive_state/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.set_match_notification_mute/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.clear_match_notification_mute/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.unmatch_match/);
  assert.match(unmatchActorMigration, /CREATE OR REPLACE FUNCTION public\.unmatch_match/);
  assert.match(unmatchActorMigration, /ended_reason = COALESCE\(ended_reason, 'unmatched_pair'\)/);
  assert.match(unmatchActorMigration, /ended_by_user_id = COALESCE\(ended_by_user_id, v_uid\)/);
  assert.match(migration, /DROP POLICY IF EXISTS "Users can archive own matches"/);
  assert.match(migration, /DROP POLICY IF EXISTS "Users can manage own match mutes"/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.set_match_archive_state\(uuid, boolean\) TO authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.set_match_notification_mute\(uuid, text\) TO authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.clear_match_notification_mute\(uuid\) TO authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.unmatch_match\(uuid\) TO authenticated/);
  assert.match(migration, /v_uid NOT IN \(v_match\.profile_id_1, v_match\.profile_id_2\)/);
  assert.match(lockdownMigration, /REVOKE INSERT, UPDATE, DELETE ON public\.match_archives FROM authenticated/);
  assert.match(lockdownMigration, /REVOKE INSERT, UPDATE, DELETE ON public\.match_notification_mutes FROM authenticated/);
  assert.match(lockdownMigration, /DROP POLICY IF EXISTS "Users can create own match archives"/);
  assert.match(lockdownMigration, /DROP POLICY IF EXISTS "Users can update own match archives"/);
  assert.match(lockdownMigration, /DROP POLICY IF EXISTS "Users can delete own match archives"/);
  assert.match(lockdownMigration, /DROP POLICY IF EXISTS "Users can create own match notification mutes"/);
  assert.match(lockdownMigration, /DROP POLICY IF EXISTS "Users can update own match notification mutes"/);
  assert.match(lockdownMigration, /DROP POLICY IF EXISTS "Users can delete own match notification mutes"/);
  assert.doesNotMatch(lockdownMigration, /CREATE POLICY "Users can create own match archives"/);
  assert.doesNotMatch(lockdownMigration, /CREATE POLICY "Users can update own match archives"/);
  assert.doesNotMatch(lockdownMigration, /CREATE POLICY "Users can delete own match archives"/);
  assert.doesNotMatch(lockdownMigration, /CREATE POLICY "Users can create own match notification mutes"/);
  assert.doesNotMatch(lockdownMigration, /CREATE POLICY "Users can update own match notification mutes"/);
  assert.doesNotMatch(lockdownMigration, /CREATE POLICY "Users can delete own match notification mutes"/);
  assert.equal(exists("src/utils/notificationHelpers.ts"), false);
  assert.match(conversationCountMigration, /CREATE OR REPLACE FUNCTION public\._user_active_conversation_count_unchecked/);
  assert.match(conversationCountMigration, /FROM public\.match_archives ma/);
  assert.doesNotMatch(conversationCountMigration, /m\.archived_at IS NULL/);

  for (const source of [webArchive, nativeArchive]) {
    assert.match(source, /set_match_archive_state/);
    assert.doesNotMatch(source, /\.from\(["']matches["']\)\s*[\s\S]*\.update\(\{\s*archived_at/);
  }

  for (const source of [webMute, nativeMute]) {
    assert.match(source, /set_match_notification_mute/);
    assert.match(source, /clear_match_notification_mute/);
    assert.match(source, /muted_until\.is\.null/);
    assert.doesNotMatch(source, /\.upsert\(/);
  }

  for (const source of [webUnmatch, nativeUnmatch]) {
    assert.match(source, /unmatch_match/);
    assert.doesNotMatch(source, /\.from\(["']messages["']\)\s*[\s\S]*\.delete\(\)/);
    assert.doesNotMatch(source, /\.from\(["']matches["']\)\s*[\s\S]*\.delete\(\)/);
  }

  assert.match(blockMigration, /CREATE OR REPLACE FUNCTION public\.block_user_with_cleanup/);
  for (const source of [webBlock, nativeBlock]) {
    assert.match(source, /block_user_with_cleanup/);
    assert.match(source, /get_my_blocked_users/);
    assert.match(source, /unblock_user/);
    assert.doesNotMatch(source, /\.from\(["']blocked_users["']\)\s*[\s\S]*\.(insert|upsert|delete)\(/);
  }
});

test("web and native chat action surfaces stay wired to shared UI contracts", () => {
  const sharedDurations = read("shared/chat/matchMuteDurations.ts");
  const webChatHeader = read("src/components/chat/ChatHeader.tsx");
  const webSheet = read("src/components/MuteOptionsSheet.tsx");
  const nativeSheet = read("apps/mobile/components/match/MatchActionsSheet.tsx");
  const nativeChat = read("apps/mobile/app/chat/[id].tsx");
  const nativeMatches = read("apps/mobile/app/(tabs)/matches/index.tsx");
  const webReportWizard = read("src/components/safety/ReportWizard.tsx");
  const nativeReportModal = read("apps/mobile/components/match/ReportFlowModal.tsx");

  assert.match(sharedDurations, /"1hour", "1day", "1week", "forever"/);
  assert.match(webChatHeader, /MATCH_MUTE_DURATIONS\.map/);
  assert.match(webChatHeader, /open=\{showProfileDrawer\}/);
  assert.match(webChatHeader, /onOpenChange=\{setShowProfileDrawer\}/);
  assert.match(webChatHeader, /blockUserAsync\(user\.id, user\.name, reason, matchId\)/);
  assert.match(webChatHeader, /ReportWizard/);
  assert.match(webChatHeader, /preSelectedUser=\{\{/);
  assert.match(webSheet, /MATCH_MUTE_DURATIONS\.map/);

  assert.match(nativeSheet, /MATCH_MUTE_DURATIONS\.map/);
  assert.match(nativeSheet, /setMode\('mute'\)/);
  for (const label of ["View Profile", "Archive", "Mute notifications", "Report", "Block", "Unmatch"]) {
    assert.match(nativeSheet, new RegExp(label));
  }
  assert.match(nativeChat, /sourceSurface="native_chat"/);
  assert.match(nativeChat, /blockUser\(\{ blockedId: matchForActions\.id, matchId: matchForActions\.matchId \}\)/);
  assert.match(nativeMatches, /sourceSurface="native_matches"/);
  assert.match(nativeMatches, /handleBlock\(actionsMatch\.id, actionsMatch\.name, actionsMatch\.matchId\)/);
  assert.match(webReportWizard, /submitUserReportRpc/);
  assert.match(webReportWizard, /alsoBlock/);
  assert.match(nativeReportModal, /submitReport/);
  assert.match(nativeReportModal, /alsoBlock/);
});

test("archiving is private organization state and does not globally block match calls", () => {
  const dailyRoom = read("supabase/functions/daily-room/index.ts");
  const migration = read("supabase/migrations/20260509235500_chat_overflow_actions_server_contract.sql");

  assert.match(migration, /Archive is private organization state/);
  assert.doesNotMatch(dailyRoom, /ARCHIVED_MATCH/);
  assert.doesNotMatch(dailyRoom, /archivedAt/);
  assert.doesNotMatch(dailyRoom, /archived_at/);
});

test("match-call end reason migrations preserve archive and block terminal reasons", () => {
  const endReasonMigration = read("supabase/migrations/20260511120000_match_call_end_reasons.sql");
  const repairMigration = read("supabase/migrations/20260511133000_match_call_blocked_pair_reason_repair.sql");
  const cloudRepairMigration = read(
    "supabase/migrations/20260511143000_match_call_unmatched_pair_reason_cloud_repair.sql",
  );
  const webMatchCallHook = read("src/hooks/useMatchCall.tsx");
  const webActiveCallOverlay = read("src/components/chat/ActiveCallOverlay.tsx");
  const nativeMatchCallApi = read("apps/mobile/lib/matchCallApi.ts");

  assert.match(endReasonMigration, /ended_reason IN \([\s\S]*'blocked_pair'[\s\S]*'unmatched_pair'[\s\S]*'media_failure'/);
  assert.match(endReasonMigration, /v_allowed\s+text\[\]\s*:= ARRAY\[[\s\S]*'blocked_pair'[\s\S]*'unmatched_pair'[\s\S]*'media_failure'/);
  assert.match(repairMigration, /ended_reason IN \([\s\S]*'blocked_pair'[\s\S]*'unmatched_pair'[\s\S]*'media_failure'/);
  assert.match(cloudRepairMigration, /ended_reason IN \([\s\S]*'blocked_pair'[\s\S]*'unmatched_pair'[\s\S]*'media_failure'/);
  assert.match(cloudRepairMigration, /v_transition_fn\s+regprocedure/);
  assert.match(cloudRepairMigration, /to_regprocedure\('public\.match_call_transition\(uuid,text,text\)'\)/);
  assert.match(cloudRepairMigration, /pg_get_functiondef\(v_transition_fn\)/);
  assert.doesNotMatch(cloudRepairMigration, /pg_get_functiondef\('public\.match_call_transition\(uuid,text,text\)'::regprocedure\)/);
  assert.match(cloudRepairMigration, /''provider_error'',\s*''blocked_pair'',\s*''unmatched_pair'',\s*''busy''/);
  assert.match(cloudRepairMigration, /''blocked_pair'',\s*''unmatched_pair'',\s*''busy''/);

  for (const source of [webMatchCallHook, webActiveCallOverlay, nativeMatchCallApi]) {
    assert.match(source, /unmatched_pair/);
  }
  assert.match(webActiveCallOverlay, /case "unmatched_pair":/);
});

test("match-call camera switching stays wired on web and native chat calls", () => {
  const webMatchCallHook = read("src/hooks/useMatchCall.tsx");
  const webActiveCallOverlay = read("src/components/chat/ActiveCallOverlay.tsx");
  const webSelfViewPip = read("src/components/video-date/SelfViewPIP.tsx");
  const nativeMatchCallHook = read("apps/mobile/lib/useMatchCall.tsx");
  const nativeSwitchCommit = read("shared/chat/nativeCameraSwitchCommit.ts");
  const nativeActiveCallOverlay = read("apps/mobile/components/chat/ActiveCallOverlay.tsx");

  assert.match(webMatchCallHook, /navigator\.mediaDevices[\s\S]*enumerateDevices/);
  assert.match(webMatchCallHook, /canFlipCamera/);
  assert.match(webMatchCallHook, /isFlippingCamera/);
  assert.match(webMatchCallHook, /const flipCamera = useCallback/);
  assert.match(webMatchCallHook, /waitForWebCameraSwitchCommit/);
  assert.match(webMatchCallHook, /chooseWebVideoDevice/);
  assert.match(webMatchCallHook, /const currentDeviceId = before\.deviceId/);
  assert.match(webMatchCallHook, /return currentDeviceId \? candidates\[0\] \?\? null : null/);
  assert.match(webMatchCallHook, /localCamera\.readyState !== "live"/);
  assert.match(webMatchCallHook, /before\.readyState !== "live"/);
  assert.match(
    webMatchCallHook,
    /if \(live && \(trackChanged \|\| deviceChanged \|\| facingChanged \|\| expectedDeviceMatched \|\| expectedFacingMatched\)\)/,
  );
  assert.match(webMatchCallHook, /setInputDevicesAsync/);
  assert.match(webMatchCallHook, /cycleCamera/);
  assert.match(webMatchCallHook, /has_cycle_camera/);
  assert.match(webMatchCallHook, /flip_camera_committed/);
  assert.match(webActiveCallOverlay, /canFlipCamera=\{canFlipCamera\}/);
  assert.match(webActiveCallOverlay, /isFlippingCamera=\{isFlippingCamera\}/);
  assert.match(webActiveCallOverlay, /onFlipCamera=\{canFlipCamera \? onFlipCamera : undefined\}/);
  assert.match(webSelfViewPip, /aria-label="Switch camera"/);
  assert.match(webSelfViewPip, /<SwitchCamera/);

  assert.match(nativeMatchCallHook, /const \[canFlipCamera, setCanFlipCamera\] = useState\(false\)/);
  assert.match(nativeMatchCallHook, /enumerateDevices/);
  assert.match(nativeMatchCallHook, /setCamera/);
  assert.match(nativeMatchCallHook, /cycleCamera/);
  assert.match(nativeMatchCallHook, /waitForNativeCameraSwitchCommit/);
  assert.match(nativeMatchCallHook, /type NativeCameraState/);
  assert.match(nativeMatchCallHook, /const nativeCameraStateRef = useRef<NativeCameraState>\(emptyNativeCameraState\(\)\)/);
  assert.match(nativeMatchCallHook, /resolveNativeCameraState/);
  assert.match(nativeMatchCallHook, /nativeCameraStateFromCommit/);
  assert.match(nativeMatchCallHook, /fallbackDeviceMatchesCommittedFacing/);
  assert.match(nativeMatchCallHook, /fallbackState\.facingMode === commit\.facingMode/);
  assert.match(nativeMatchCallHook, /nativeCameraDeviceFacingMode/);
  assert.match(nativeMatchCallHook, /const desiredFacingMatches = usable\.filter/);
  assert.match(nativeMatchCallHook, /desiredFacingMatches\.find\(\(device\) => nativeCameraDeviceKey\(device\) !== currentDeviceKey\)/);
  assert.match(nativeMatchCallHook, /localCamera\.readyState === 'live'/);
  assert.match(nativeMatchCallHook, /before\.readyState !== 'live'/);
  assert.match(nativeMatchCallHook, /expectedDeviceKey/);
  assert.match(nativeSwitchCommit, /expectedDeviceMatched/);
  assert.match(nativeSwitchCommit, /controlsExpectedFacingMatched/);
  assert.match(nativeSwitchCommit, /snapshotExpectedFacingMatched/);
  assert.match(nativeSwitchCommit, /controlsFacingChangedFromBefore/);
  assert.match(nativeSwitchCommit, /controlsFacingChangedFromPrevious/);
  assert.match(nativeSwitchCommit, /snapshotFacingChangedFromBefore/);
  assert.match(nativeSwitchCommit, /cameraIdentityChanged/);
  assert.match(nativeMatchCallHook, /previousControlsFacing/);
  assert.match(nativeMatchCallHook, /const beforeControlsFacing = await readNativeCameraFacingMode\(controls\)/);
  assert.match(nativeMatchCallHook, /currentCamera\.source === 'controls' \? currentCamera\.facingMode : beforeControlsFacing/);
  assert.match(nativeMatchCallHook, /committedFacingConflictsWithObserved/);
  assert.match(nativeMatchCallHook, /mergeNativeCameraState\(observedState, committedState, observedState\.source\)/);
  assert.match(nativeMatchCallHook, /beforeDeviceKey/);
  assert.match(nativeSwitchCommit, /expectedFacing !== baselineFacingMode/);
  assert.match(nativeSwitchCommit, /controlsFacing === expectedFacing/);
  assert.match(nativeSwitchCommit, /controlsFacingChangedFromBefore \|\| controlsFacingChangedFromPrevious \|\| cameraIdentityChanged/);
  assert.match(nativeSwitchCommit, /snapshotFacingChangedFromBefore \|\| cameraIdentityChanged/);
  assert.match(nativeSwitchCommit, /expectedDeviceKey !== beforeDeviceKey/);
  assert.match(nativeSwitchCommit, /trackChangedToExpectedTarget/);
  assert.match(nativeSwitchCommit, /trackChangedWithoutIdentity/);
  assert.match(nativeMatchCallHook, /targetCanImproveFacing/);
  assert.match(nativeMatchCallHook, /controlsFacingConflictsWithTrack/);
  assert.match(nativeMatchCallHook, /facingMode: controlsFacingConflictsWithTrack \? controlsFacing : trackState\.facingMode \?\? controlsFacing/);
  assert.match(nativeMatchCallHook, /source: controlsFacingConflictsWithTrack \|\| !trackState\.facingMode \? 'controls' : 'track'/);
  assert.match(nativeMatchCallHook, /flip_camera_start/);
  assert.match(nativeMatchCallHook, /flip_camera_set_camera_target/);
  assert.match(nativeMatchCallHook, /current_facing_mode/);
  assert.match(nativeMatchCallHook, /target_facing_mode/);
  assert.match(nativeMatchCallHook, /nativeCameraStateRef\.current = committedState/);
  assert.match(nativeMatchCallHook, /has_cycle_camera/);
  assert.match(nativeMatchCallHook, /flip_camera_committed/);
  assert.match(nativeMatchCallHook, /canFlipCamera=\{canFlipCamera\}/);
  assert.match(nativeMatchCallHook, /isFlippingCamera=\{isFlippingCamera\}/);
  assert.match(nativeMatchCallHook, /onFlipCamera=\{flipCamera\}/);
  assert.match(nativeActiveCallOverlay, /canFlipCamera && !isVideoOff && localVideoTrack/);
  assert.match(nativeActiveCallOverlay, /accessibilityLabel="Switch camera"/);
  assert.match(nativeActiveCallOverlay, /disabled=\{isFlippingCamera\}/);
  assert.match(nativeActiveCallOverlay, /name="camera-reverse"/);
});

test("match-call active voice controls stay vertically aligned on native and web", () => {
  const webActiveCallOverlay = read("src/components/chat/ActiveCallOverlay.tsx");
  const nativeActiveCallOverlay = read("apps/mobile/components/chat/ActiveCallOverlay.tsx");

  assert.match(nativeActiveCallOverlay, /<Pressable onPress=\{onEndCall\} style=\{\[styles\.ringingEndBtn,/);
  assert.match(nativeActiveCallOverlay, /<Pressable onPress=\{onEndCall\} style=\{\[styles\.voiceEndBtn,/);
  assert.match(nativeActiveCallOverlay, /controlsRow: \{ flexDirection: 'row', alignItems: 'center'/);
  assert.match(
    nativeActiveCallOverlay,
    /ringingEndBtn: \{ width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginTop: spacing\.xl \}/,
  );
  assert.match(
    nativeActiveCallOverlay,
    /voiceEndBtn: \{ width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center' \}/,
  );
  assert.doesNotMatch(nativeActiveCallOverlay, /voiceEndBtn:[^\n]*marginTop/);

  assert.match(webActiveCallOverlay, /<div className="flex items-center gap-6">/);
  assert.match(webActiveCallOverlay, /className="w-14 h-14 rounded-full bg-destructive flex items-center justify-center"/);
});
