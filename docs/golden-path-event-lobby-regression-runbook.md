# Event Lobby Regression Runbook

Date: 2026-05-01

Scope: Event Lobby active-event enforcement, swipe idempotency, queueing, Ready Gate entry, block/report exclusion, Super Vibe limits, empty-state diagnostics, and stale direct-call rejection.

## Safety Posture

Do not run these manual flows against production unless there is an explicitly approved safe fixture or a rollback-safe transaction. The automated harness is non-destructive by default and does not execute live RPC smoke flows.

Production Supabase ref: `schdyxcunwcvddlcshwd`

Required staging-smoke metadata:

```bash
EVENT_LOBBY_REGRESSION_ENV=staging
EVENT_LOBBY_REGRESSION_SUPABASE_REF=<non-production-ref>
EVENT_LOBBY_REGRESSION_SAFE_FIXTURES=1
EVENT_LOBBY_REGRESSION_EVENT_ID=<fixture-event-id>
```

If a production fixture is ever approved, document the fixture and rollback safety before running any manual step. The local script still requires `--allow-production` and `EVENT_LOBBY_REGRESSION_PRODUCTION_FIXTURE_ID` before it will accept production smoke metadata.

## Automated Harness

Run from the repo root:

```bash
./scripts/run_event_lobby_regression.sh
```

Optional checks:

```bash
./scripts/run_event_lobby_regression.sh --full
./scripts/run_event_lobby_regression.sh --db-dry-run
./scripts/run_event_lobby_regression.sh --staging-smoke-check
npm run test:event-lobby-regression
```

The default harness runs source/static contract tests for:

- active-event helper states
- `get_event_deck` inactive rejection
- `handle_swipe` inactive rejection with no `event_swipes`, `video_sessions`, or registration room/partner mutation
- removed Mystery Match RPC contract
- queue promotion inactive rejection
- block/report exclusion plus paused, suspended, and deleted candidate exclusion markers
- simultaneous mutual swipes creating one session
- web, mobile web, and native swipe submissions sending an explicit user JWT to `swipe-actions`
- duplicate swipes creating one row and suppressing duplicate notification side effects
- Super Vibe per-event limit and retry behavior
- active-session collision during queue promotion
- `swipe-actions` duplicate notification suppression and inactive-event normalization
- web missing/ended/invalid-registration deck gating and Ready Gate open dedupe by session id
- native deck payload and swipe outcome parsing

## Mystery Match Removal Verification

Mystery Match is removed from the active product/backend path as of migration `20260609152000_remove_mystery_match.sql`. Do not use old parity docs or old applied migrations as current truth.

Required read-only checks:

```bash
test ! -f src/hooks/useMysteryMatch.ts
test ! -f apps/mobile/lib/useMysteryMatch.ts

rg -n "useMysteryMatch|find_mystery_match|MYSTERY_MATCH|Mystery Match|showMysteryMatch|mystery_match" \
  src apps/mobile shared/analytics supabase/functions src/integrations/supabase/types.ts

npx tsx shared/matching/mysteryMatchRemovalContracts.test.ts
npm run test:event-lobby-regression
```

Expected result:

- no active source or generated-type hits;
- `find_mystery_match%` absent from linked Supabase public routines;
- zero `video_sessions.session_source = 'mystery_match'` rows;
- `video_sessions.session_source` defaults to `'reciprocal_swipe'::text`;
- validated reciprocal-swipe-only constraint remains present.

Residual-reference classification:

- Allowed: old applied migrations, `_cursor_context` snapshots, archive docs, historical audit docs, current docs explicitly saying Mystery Match was removed, and active tests/validation asserting RPC absence.
- Blockers: active product source, generated Supabase types, active validation that requires `find_mystery_match` to exist, or tests preserving Mystery Match behavior as a supported product path.

If running optional broader Video Date checks, note that a failure in `npm run test:video-date-v4` against the single-line regex `existing.roomName === params.roomName && existing.roomUrl === params.roomUrl` in `shared/matching/videoDateSprint3DailyHandoffContracts.test.ts` is a known unrelated source-shape issue when `src/lib/webVideoDateDailyPrewarm.ts` contains the same room-name/URL guard split across lines. Do not classify that as a Mystery Match removal blocker unless the underlying guard is missing.

## Legacy Direct Queue/Session RPC Removal Verification

Direct legacy queue/session RPCs `find_video_date_match(uuid,uuid)` and `join_matching_queue(uuid,uuid)` are removed from the active backend contract as of migration `20260609163130_remove_legacy_queue_session_rpcs.sql`. The remaining legacy cleanup RPC `leave_matching_queue(uuid)` is removed as of migration `20260609165218_remove_leave_matching_queue.sql`.

Required read-only checks:

```bash
rg -n "find_video_date_match|join_matching_queue|leave_matching_queue|deprecated_legacy_queue_surface" \
  src apps/mobile supabase/functions shared --glob '!**/*.test.ts' --glob '!src/integrations/supabase/types.ts'

rg -n "find_video_date_match|join_matching_queue|leave_matching_queue" src/integrations/supabase/types.ts

npx tsx shared/matching/eventLobbyCanonicalActiveState.test.ts
npx tsx shared/matching/videoDateClosureIssuesContracts.test.ts
```

Expected result:

- no active runtime callsites;
- no generated-type entries for any removed RPC;
- linked Supabase public routines have no `find_video_date_match`, `join_matching_queue`, or `leave_matching_queue`;
- validation checks use `to_regprocedure(...) is null` for all three removed RPCs;
- active `drain_match_queue`, `promote_ready_gate_if_eligible`, Ready Gate, and Video Date state-machine behavior remain intact.

## Manual Staging Smoke

Use seeded staging users and events only. Do not create hardcoded production test users in migrations. Keep any fixture cleanup outside production or inside an explicitly rollback-safe transaction.

Record for every flow:

- staging ref and event id
- user ids or fixture aliases, not real user PII
- expected result
- observed web/native result
- relevant `lobby_*`, `queue_*`, `ready_gate_*`, and `notification_*` observability rows/logs
- pass/fail and follow-up issue link if failed

### Two-User Mutual Vibe

1. Use a live confirmed event with two confirmed eligible users and no active sessions.
2. User A enters Event Lobby and sees User B as swipeable.
3. User B enters Event Lobby and sees User A as swipeable.
4. User A sends a vibe.
5. User B sends a vibe.
6. Expect exactly one session, Ready Gate shown to both users, and date entry only after both users complete the backend-owned Ready Gate path.

Expected observability:

- `lobby_entered`
- `lobby_deck_loaded`
- two `lobby_swipe_submitted`
- two compatible `lobby_swipe_result` rows/logs
- `ready_gate_shown`
- `ready_gate_transition`
- `date_entered_from_lobby`

### Swipe 401 Guard

1. Use signed-in fixture users on web desktop, mobile web, and native.
2. Open the same live confirmed Event Lobby surface on each client.
3. Submit Pass, Vibe, and Super Vibe where fixture state allows it.
4. Inspect the `swipe-actions` request headers and response.

Expected result:

- every client sends `Authorization: Bearer <user access token>`, not a Supabase public key fallback
- every client sends the public `apikey` header
- `swipe-actions` returns `200` with a normal swipe envelope, or a handled `success: false` envelope
- signed-out or expired-session smoke returns the coarse `unauthorized` envelope and does not issue a public-key fallback request

### Three-User Queued Match

1. Use a live confirmed event with three eligible users A, B, and C.
2. Create a scenario where A and B can match immediately while C remains eligible for queue behavior.
3. Confirm queued match behavior uses backend-owned `match_queued` or queue state, not client-created sessions.
4. Trigger queue drain through normal foreground/lobby refresh behavior.
5. Expect queue drain to promote only when both users are eligible and not already in Ready Gate, handshake, or date.

Expected observability:

- `queue_drain_attempted`
- `queue_drain_result`
- no second active session for any participant

### Super-Vibe Limit And Retry

1. Use a live confirmed event and a user with the expected Super Vibe allowance.
2. Send the first Super Vibe.
3. Retry the same Super Vibe from the same client context.
4. Retry the same action from a second client session if available.
5. Continue until the per-event limit path is reached with safe fixtures.

Expected result:

- first send preserves `super_vibe_sent`
- retry returns stable duplicate semantics such as `already_swiped` or the existing compatible cap outcome
- duplicate retries do not create a second notification
- limit path remains `limit_reached` or `already_super_vibed_recently` according to the current backend contract

### Block/Report Exclusion

1. Use fixture users where A blocks or reports B in staging.
2. Confirm B is not returned as a normal swipeable card for A.
3. Attempt a direct stale swipe call from A to B using a safe staging request.
4. Expect no new swipe/session mutation and no user-visible private safety reason beyond the coarse allowed outcome.

Expected observability:

- no leaked block/report internals in client payloads
- notification suppression reason is coarse, for example `blocked`, `reported`, or `target_unavailable`

### Event Ends While Users Are In Lobby

1. Put two eligible users in the lobby for a live fixture event.
2. End or expire the fixture event using a staging-safe admin path.
3. Keep both clients open.
4. Confirm deck polling stops, swipe controls disable, transient swipe UI closes, and Ready Gate does not open from stale client state unless there is already a valid session.
5. Attempt a stale direct deck or swipe call against the ended event.

Expected result:

- local UI shows ended or redirects safely
- backend returns `event_not_active`
- no `event_swipes`, `video_sessions`, or registration room/partner mutation occurs from stale calls

### Empty Deck Diagnostics

1. Use a live confirmed event that is safe to make empty by fixture setup.
2. Exercise each coarse empty cause that staging fixtures support:
   - `event_not_active`
   - `user_not_eligible`
   - `no_confirmed_candidates`
   - `all_candidates_filtered`
   - `all_candidates_seen_locally`
   - `all_candidates_busy_or_unavailable`
   - `rpc_error`
   - `network_error`
   - `unknown`
3. Confirm the user-facing state remains coarse and non-sensitive.

Expected observability:

- `lobby_deck_empty` includes only the safe reason category
- no exact block/report/moderation details are exposed

### Direct Stale RPC Rejection

1. Use a fixture event that is missing, scheduled/not-started, ended, cancelled, archived, or draft.
2. Attempt direct calls for deck fetch, swipe, queue drain, and Ready Gate/date-entry transition where a fixture session allows it.
3. Expect backend rejection before state mutation.

Expected result:

- `get_event_deck` rejects inactive events instead of silently returning an empty deck
- `handle_swipe` returns `success: false`, `outcome: event_not_active`, and a safe `reason`
- `find_mystery_match` is not present as a callable RPC
- queue promotion does not promote inactive events
- Ready Gate/date-entry does not advance new date-entry state after event inactivity

## Pass/Fail Template

```text
Run date:
Environment/ref:
Fixture event:
Harness command:
Manual flows completed:
Failures:
Follow-up issues:
Operator:
```

## Known Limitations

The automated harness is source/static and local-test based. It intentionally does not create staging users, send production notifications, or mutate live Supabase data. Full runtime proof for two-user, three-user, and event-ending flows remains a manual staging smoke until the project has dedicated non-production fixtures and secrets managed outside the repo.
