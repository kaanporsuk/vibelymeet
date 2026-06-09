import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const removalMigration = read("supabase/migrations/20260610000100_remove_post_date_instant_next.sql");
const reviewFollowupMigration = read("supabase/migrations/20260610022531_review_comments_1262_1280_followups.sql");
const swipeActions = read("supabase/functions/swipe-actions/index.ts");
const webLobby = read("src/pages/EventLobby.tsx");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const webSwipe = read("src/hooks/useSwipeAction.ts");
const nativeEventsApi = read("apps/mobile/lib/eventsApi.ts");
const webSurvey = read("src/components/video-date/PostDateSurvey.tsx");
const nativeSurvey = read("apps/mobile/components/video-date/PostDateSurvey.tsx");

test("post-date auto-next removal migrations define the latest ready-queue authority", () => {
  assert.match(removalMigration, /DELETE FROM public\.client_feature_flags[\s\S]*video_date\.post_date_instant_next_v2/);
  assert.match(removalMigration, /DELETE FROM public\.client_feature_flags[\s\S]*video_date\.outbox_v2\.drain_match_queue/);
  assert.match(removalMigration, /DROP FUNCTION IF EXISTS public\.drain_match_queue\(uuid\)/);
  assert.match(removalMigration, /DROP FUNCTION IF EXISTS public\.drain_match_queue_v2\(uuid, text\)/);
  assert.match(removalMigration, /DROP FUNCTION IF EXISTS public\.get_video_date_queue_hint_v1\(uuid, uuid\)/);
  assert.match(removalMigration, /DROP FUNCTION IF EXISTS public\.promote_ready_gate_if_eligible\(uuid, uuid\)/);
  assert.match(removalMigration, /DROP FUNCTION IF EXISTS public\.video_date_actor_pending_feedback_gate_v1\(uuid, uuid\)/);
  assert.match(reviewFollowupMigration, /match_queued_promoted_to_ready_gate/);
});

test("foreground heartbeats no longer promote queued sessions", () => {
  const markForeground = removalMigration.slice(
    removalMigration.indexOf("CREATE OR REPLACE FUNCTION public.mark_lobby_foreground"),
    removalMigration.indexOf("COMMENT ON FUNCTION public.mark_lobby_foreground"),
  );

  assert.match(markForeground, /last_lobby_foregrounded_at = v_now/);
  assert.match(markForeground, /promotion_removed/);
  assert.doesNotMatch(markForeground, /promote_ready_gate_if_eligible/);
  assert.doesNotMatch(markForeground, /drain_match_queue/);
});

test("legacy match_queued SQL responses are promoted to Ready Gate after queue removal", () => {
  const wrapper = reviewFollowupMigration.slice(
    reviewFollowupMigration.indexOf("CREATE OR REPLACE FUNCTION public.handle_swipe_20260601183000_deck_authority_base"),
    reviewFollowupMigration.indexOf("COMMENT ON FUNCTION public.handle_swipe_20260601183000_deck_authority_base"),
  );

  assert.match(wrapper, /v_outcome IS DISTINCT FROM 'match_queued'[\s\S]*RETURN v_result/);
  assert.match(wrapper, /ready_gate_status = 'ready'/);
  assert.match(wrapper, /queue_status = 'in_ready_gate'/);
  assert.match(wrapper, /'result', 'match'/);
  assert.match(wrapper, /'video_session_id', v_session_id/);
  assert.match(wrapper, /'queue_removed_conversion', 'match_queued_promoted_to_ready_gate'/);
  assert.doesNotMatch(wrapper, /queued_auto_promotion_removed/);
  assert.doesNotMatch(wrapper, /ready_gate_status = 'expired'/);
});

test("direct mutual match to Ready Gate remains the only client-opening swipe path", () => {
  assert.match(swipeActions, /if \(result\.result === "match" && sessionId\)/);
  assert.match(webSwipe, /shouldOpenReadyGateFromSwipePayload\(raw\)/);
  assert.match(nativeLobby, /shouldOpenReadyGateFromSwipePayload\(normalizedEnvelope\)/);
  assert.doesNotMatch(swipeActions, /match_queued[\s\S]{0,500}send-notification/);
  assert.doesNotMatch(webSwipe, /match_queued/);
  assert.doesNotMatch(nativeLobby, /match_queued/);
});

test("web and native lobbies removed queue drain and queued-count surfaces", () => {
  for (const source of [webLobby, nativeLobby, nativeEventsApi]) {
    assert.doesNotMatch(source, /drainMatchQueue|drain_match_queue|getQueuedMatchCount|fetchVideoDateQueueHint/);
    assert.doesNotMatch(source, /queuedCount|queueHintEnabled|QUEUE_DRAIN_/);
  }
});

test("post-date surveys ignore backend ready/date actions instead of draining another queue", () => {
  for (const source of [webSurvey, nativeSurvey]) {
    assert.match(source, /serverNext\.action === ["']ready_gate["'] \|\| serverNext\.action === ["']video_date["']/);
    assert.match(source, /removed_auto_next_target_ignored/);
    assert.doesNotMatch(source, /drainMatchQueue|useMatchQueue|getQueuedMatchCount/);
    assert.doesNotMatch(source, /onQueuedVideoSessionReady|onVideoDateReady/);
  }
});
