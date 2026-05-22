# Video Date v4 Phase 8 Certification And Rollout

Phase 8 is the release gate for the v4 Video Date system. It does not change the product truth model: Postgres owns state, Daily is media-only, Edge Functions mint tokens, private Broadcast is sanitized, and every recovery path ends in retry, requeue, refund, report/block, or clear ended state.

## PR 8.1 - Two-User Certification

Run the opt-in staging harness:

```bash
VIBELY_E2E_TWO_USER_WEB=1 \
VIBELY_E2E_USER_A_STATE=./.auth/user-a.json \
VIBELY_E2E_USER_B_STATE=./.auth/user-b.json \
VIBELY_E2E_EVENT_ID=<event_uuid> \
npm run test:e2e -- --grep "ready gate, early continue"
```

The event must be synthetic or staging-only, with two confirmed users and camera/mic permissions available. The harness covers lobby entry, Ready Gate, Daily entry, early "Continue when ready", reload recovery on `/date/:id`, post-date survey recovery, and browser diagnostics with token redaction.

Record a pass with:

```sql
select public.record_video_date_phase8_certification_run_v2(
  'two_user_e2e',
  'web',
  'passed',
  '<event_uuid>',
  null,
  '<commit_sha>',
  jsonb_build_object('harness', 'e2e/video-date-two-user.staging.spec.ts')
);
```

Recording is allowed only from a service-role context or a database-owner SQL session. Browser/mobile authenticated users cannot write certification rows.

Native certification is manual until the native E2E runner exists. Use the same synthetic event on iOS and Android, exercising background/foreground, delayed push/deep link, switch-device prompt, early continue, mutual extension, safety report, and survey recovery. Record `native_smoke` with `platform='native'` only after both iOS and Android are clean.

## PR 8.2 - RLS, Chaos, And Load

Run the runtime Realtime RLS test against a synthetic session:

```bash
VIDEO_DATE_RLS_SUPABASE_URL=<url> \
VIDEO_DATE_RLS_SUPABASE_ANON_KEY=<anon_key> \
VIDEO_DATE_RLS_SESSION_ID=<session_uuid> \
VIDEO_DATE_RLS_PARTICIPANT_JWT=<participant_jwt> \
VIDEO_DATE_RLS_NON_PARTICIPANT_JWT=<nonparticipant_jwt> \
npx tsx shared/matching/videoDateRealtimeRlsRuntime.test.ts
```

Chaos certification must include duplicate taps, Broadcast loss, Daily webhook loss, worker crash/retry, mobile backgrounding, reconnect grace expiry, provider room cleanup dry-run, and delayed push/deep link recovery. Load certification must prove queue drain, deadline finalizer, outbox drainer, snapshot fetch, and Daily token paths stay below the Phase 7 P95/P99 targets at the intended rollout slice.

Record passes with `run_kind='rls_negative'`, `run_kind='chaos'`, and `run_kind='load'`.

## PR 8.3 - Rollout Readiness Gate

Use the service-role readiness view before every ramp:

```sql
select *
from public.get_video_date_phase8_rollout_readiness('<event_uuid>')
order by window_id, target_rollout_bps;
```

Before the first 1% ramp, stage the v4 flags as `enabled=true`, `rollout_bps=0`, `kill_switch_active=false`. This is still user-off, but it proves the rollout population is controlled by `rollout_bps` rather than the hard disabled path.

Ramp only in this order: `1% -> 10% -> 50% -> 100%`. A row is eligible only when `can_advance_rollout=true` and `rollout_blockers` is empty for the target. Do not override blockers with a client-side flag edit.

Event-specific certification records override global records. If a synthetic/staging event has a failed or blocked event-specific proof, a global pass will not clear that event's rollout gate.

After each successful production slice, record an exact `rollout_step` pass before opening the next slice. The readiness gate blocks 10% until `rollout_bps=100` is both certified and still the live flag minimum, blocks 50% until `rollout_bps=1000` is certified and live, and blocks 100% until `rollout_bps=5000` is certified and live.

## PR 8.4 - Operational Proof Wrappers

Prefer the narrow service-role wrappers for rollout and cleanup proof instead of hand-writing generic ledger rows. They reject token/secret-shaped report payloads and enforce the operational preconditions that are easy to forget during an incident.

Use an event id for event-specific synthetic/staging proof. Use `null` for global production rollout proof that should count toward final Phase 8 release closure.

```sql
select public.record_video_date_phase8_rollout_step_v2(
  null,
  100,
  '<commit_sha>',
  jsonb_build_object('window', '1%', 'source', 'phase8_readiness_gate')
);
```

The rollout-step wrapper requires the requested `rollout_bps` to already be live across the core Video Date flags. This keeps the ledger honest: a `10%` pass cannot be recorded while production is still effectively at `1%`.

## PR 8.5 - Final Server-Dealt Deck Cutover

Web and native lobbies now always call `get_event_deck_v2` with `p_limit=1`; `get_event_deck` is no longer an active client fallback. Client-only `seenProfileIds` / swipe-ref filtering has been removed from the active web and native lobby paths, so refresh, crash, reconnect, and swipe-failure recovery all return to the same server-owned impression truth.

Legacy deck cleanup is allowed only after `video_date.deck_deal_v2` has been enabled at 100% with no kill switch for one full week:

```sql
select *
from public.vw_video_date_legacy_deck_cleanup_readiness;
```

Record final cleanup only through:

```sql
select public.record_video_date_phase8_legacy_cleanup_v2(
  '<commit_sha>',
  jsonb_build_object('source', 'server_dealt_deck_final_cutover')
);
```

## PR 8.6 - Release Closure

Before calling Phase 8 closed, use the release closure RPC:

```sql
select *
from public.get_video_date_phase8_release_closure();
```

`can_close_phase8=true` requires all rollout slices to be certified, core flags live at 100% with no kill switch, `deck_deal_v2` baked for one week, legacy cleanup recorded, no page-level recovery alerts, and no stuck active sessions over 2 minutes. If any blocker appears, stop the rollout rather than editing flags around it.
