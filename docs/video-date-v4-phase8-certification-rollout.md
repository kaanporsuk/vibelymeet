# Video Date v4 Phase 8 Certification And Rollout

Phase 8 is the release gate for the v4 Video Date system. It does not change the product truth model: Postgres owns state, Daily is media-only, Edge Functions mint tokens, private Broadcast is sanitized, and every recovery path ends in retry, requeue, refund, report/block, or clear ended state.

## Current Deployed Baseline

As of 2026-05-22, Phase 0 through Phase 8.6, the Phase 7/8 audit-automation closure, and the Daily webhook compatibility/provider-registration closure are merged to `main` / `origin/main`. Commit `196fd676a840970c13197eee71a4bbbd78c9dd06` from PR #992 (`Harden video date phase 8 automation`) is the Phase 7/8 automation baseline; commit `e6f086eef` (`Fix Daily webhook signature contract`) is the merged Daily webhook compatibility closure.

Supabase project `schdyxcunwcvddlcshwd` has migration `20260522024000_video_date_phase7_8_audit_automation_hardening.sql` applied. `admin-video-date-ops` is deployed at version `310`, `video-date-daily-webhook` is deployed at version `7`, and `synthetic-video-date-monitor` is deployed at version `9`.

Do not recreate already-closed provider resources during certification. Daily webhook provider registration is closed under webhook UUID `a5407924-6f29-4a35-835a-ff5185eeae5c`; use the real two-user smoke below for delivery proof instead of creating another webhook or rotating/printing `DAILY_WEBHOOK_SECRET`.

## PR 8.1 - Two-User Certification

Preferred automation is the nightly/manual GitHub workflow:

```text
.github/workflows/video-date-phase8-certification.yml
```

It runs against staging with `VIBELY_E2E_USE_EXTERNAL_SERVER=1`, materializes the two storage-state files from repository secrets, executes the two-user Playwright spec, and records the Phase 8 ledger row on success. For local or operator use, run the same harness directly:

```bash
VIBELY_E2E_TWO_USER_WEB=1 \
VIBELY_E2E_USE_EXTERNAL_SERVER=1 \
PLAYWRIGHT_BASE_URL=<staging_url> \
VIBELY_E2E_USER_A_STATE=./.auth/user-a.json \
VIBELY_E2E_USER_B_STATE=./.auth/user-b.json \
VIBELY_E2E_EVENT_ID=<event_uuid> \
npm run test:e2e -- --grep "ready gate, early continue"
```

The event must be synthetic or staging-only, with two confirmed users and camera/mic permissions available. The harness covers lobby entry, Ready Gate, Daily entry, early "Continue when ready", reload recovery on `/date/:id`, post-date survey recovery, and browser diagnostics with token redaction.

Record a pass without hand-written SQL:

```bash
npm run phase8:certify -- record \
  --run-kind two_user_e2e \
  --platform web \
  --status passed \
  --event-id <event_uuid> \
  --commit-sha <commit_sha> \
  --report-json '{"harness":"e2e/video-date-two-user.staging.spec.ts"}'
```

The underlying RPC remains:

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

Native certification still depends on real iOS and Android devices, but recording is no longer hand-written SQL. Use the same synthetic event on iOS and Android, exercising background/foreground, delayed push/deep link, switch-device prompt, early continue, mutual extension, safety report, and survey recovery. Then record `native_smoke` with explicit evidence flags:

```bash
npm run phase8:certify -- native-smoke \
  --event-id <event_uuid> \
  --commit-sha <commit_sha> \
  --operator <operator_email> \
  --ios \
  --android \
  --background-foreground \
  --delayed-push-deeplink \
  --switch-device \
  --early-continue \
  --safety \
  --mutual-extension \
  --survey-recovery
```

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

Daily webhook provider registration is already complete for Video Date. Use the existing webhook UUID `a5407924-6f29-4a35-835a-ff5185eeae5c` at `https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/video-date-daily-webhook`; do not create another webhook, and do not print or rotate `DAILY_WEBHOOK_SECRET`. The registered event types are `participant.joined` and `participant.left`. Real-event certification is complete only after a two-user smoke makes Daily `lastMomentPushed` non-null, keeps `failedCount=0`, and shows matching accepted rows in `video_date_daily_webhook_events`.

Record passes with `run_kind='rls_negative'`, `run_kind='chaos'`, and `run_kind='load'`.

The automation wrapper runs the RLS test, chaos contracts/probes, worker dry-runs, synthetic monitor webhook/cleanup probes, snapshot fetch probe, and Phase 7 performance contracts, then records the ledger rows:

```bash
npm run phase8:live-certify -- --mode all
npm run phase8:live-certify -- --mode rls
npm run phase8:live-certify -- --mode chaos
npm run phase8:live-certify -- --mode load
```

Chaos automation covers duplicate taps, Broadcast loss, Daily webhook loss, worker crash/retry, mobile backgrounding, reconnect grace expiry, provider room cleanup dry-run, and delayed push/deep link by combining live probes with the already-deployed contract harnesses. Load automation probes queue drain, deadline finalizer, outbox drainer, snapshot fetch, and Daily token paths through dry-run workers, token-free snapshot fetch, and Phase 7 checkpoint contracts. The live wrapper records `failed` or `blocked` ledger rows on certification failure when service-role credentials are available, so stale green proof cannot silently survive a bad nightly run.

## PR 8.3 - Rollout Readiness Gate

Use the service-role readiness view before every ramp:

```sql
select *
from public.get_video_date_phase8_rollout_readiness('<event_uuid>')
order by window_id, target_rollout_bps;
```

Also verify Daily performance emission health before the 10% ramp. `daily_join` and `first_remote_frame` must not be dark or stale, otherwise the Phase 8 first-frame SLA gate can become a false negative:

```sql
select *
from public.get_video_date_daily_performance_emission_health('<event_uuid>')
where window_id = '24h'
  and segment_key in ('daily_join', 'first_remote_frame');
```

Daily room pooling remains disabled unless `get_video_date_daily_performance_decision()` recommends it for the target event/window. Keep the decision auditable in `docs/video-date-daily-room-pool-decision-log.md`.

Before the first 1% ramp, stage the v4 flags as `enabled=true`, `rollout_bps=0`, `kill_switch_active=false`. This is still user-off, but it proves the rollout population is controlled by `rollout_bps` rather than the hard disabled path.

Ramp only in this order: `1% -> 10% -> 50% -> 100%`. A row is eligible only when `can_advance_rollout=true` and `rollout_blockers` is empty for the target. Do not override blockers with a client-side flag edit.

Event-specific certification records override global records. If a synthetic/staging event has a failed or blocked event-specific proof, a global pass will not clear that event's rollout gate.

After each successful production slice, record an exact `rollout_step` pass before opening the next slice. The `phase8:rollout` CLI and `record_video_date_phase8_rollout_step_v2()` RPC both preflight `get_video_date_phase8_rollout_readiness()` for the requested target and refuse to record if any 24h/7d event row is blocked. The readiness gate blocks 10% until `rollout_bps=100` is both certified and still the live flag minimum, blocks 50% until `rollout_bps=1000` is certified and live, and blocks 100% until `rollout_bps=5000` is certified and live.

## PR 8.4 - Operational Proof Wrappers

Prefer the narrow service-role wrappers for rollout and cleanup proof instead of hand-writing generic ledger rows. They reject token/secret-shaped report payloads and enforce the operational preconditions that are easy to forget during an incident.

Generic passed `rollout_step` and `legacy_cleanup` rows are rejected by `record_video_date_phase8_certification_run_v2`; use the dedicated wrappers below. Failed or blocked rows may still be recorded generically by the live certification wrapper so a bad nightly run leaves an audit trail.

Use an event id for event-specific synthetic/staging proof. Use `null` for global production rollout proof that should count toward final Phase 8 release closure.

Preferred wrapper:

```bash
npm run phase8:rollout -- --bps 100 --commit-sha <commit_sha> --report-json '{"window":"1%","source":"phase8_readiness_gate"}'
```

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

```bash
npm run phase8:rollout -- legacy-cleanup --commit-sha <commit_sha> --report-json '{"source":"server_dealt_deck_final_cutover"}'
```

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
