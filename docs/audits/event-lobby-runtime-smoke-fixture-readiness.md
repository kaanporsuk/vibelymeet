# Event Lobby Runtime Smoke Fixture Readiness

Date: 2026-05-01

Branch: `audit/event-lobby-runtime-and-device-smoke-readiness`

## 1. Executive Verdict

Status: **blocked**.

The source/static Event Lobby contracts remain healthy, the linked Supabase project is the canonical production ref, and the remote database dry-run reports no pending migrations. Runtime web smoke and native device/simulator smoke were **not executed** because approved safe fixture metadata is missing from the repo docs, redacted local env scan, and current shell environment.

This report makes no runtime pass claim. It records the exact fixture metadata and cleanup boundaries required before a future operator can run Stream 11 or Stream 12 runtime proof safely.

## 2. Fixture Safety Status

No approved safe fixture set was found for Event Lobby runtime smoke.

Required metadata is still absent:

- `EVENT_LOBBY_REGRESSION_ENV`
- `EVENT_LOBBY_REGRESSION_SUPABASE_REF`
- `EVENT_LOBBY_REGRESSION_SAFE_FIXTURES`
- `EVENT_LOBBY_REGRESSION_EVENT_ID`
- explicit User A / User B / User C fixture aliases and IDs
- one live smoke event
- one scheduled/not-started event, or a safe event-state switch plan
- one ended event, or a safe event-end plan
- optional blocked/reported target fixture
- cleanup/reset plan for swipes, sessions, registrations, notifications, event status, and provider side effects

Evidence:

- `docs/audits/event-lobby-closure-report.md` already marks runtime smoke as blocked because no safe staging fixture metadata is present.
- `docs/golden-path-event-lobby-regression-runbook.md` defines the required staging-smoke metadata and states that production smoke is refused without explicit safe fixture approval.
- `scripts/run_event_lobby_regression.sh` validates fixture metadata but does not execute live RPC smoke flows.
- `docs/qa/native-physical-device-qa-runbook.md` and `docs/qa/video-date-seeded-runtime-qa-pack.md` contain placeholder fixture templates, not approved fixture IDs or credentials.
- Redacted env/operator-note scan found no `EVENT_LOBBY_REGRESSION_*` or `EVENT_LOBBY_SMOKE_*` variables in local env files or the current shell environment. Values were not printed.

## 3. Environment Used

- Local repo: `/Users/kaanporsuk/Documents/Vibely/Git/vibelymeet`
- Git branch: `audit/event-lobby-runtime-and-device-smoke-readiness`
- Baseline main commit: `91bc13938 docs: close event-lobby-investigation-batch-4-native investigation (#672)`
- Supabase linked ref: `schdyxcunwcvddlcshwd`
- Supabase project in `supabase/config.toml`: `schdyxcunwcvddlcshwd`

Environment classification for runtime smoke: **unavailable**.

No true staging Supabase project, isolated production fixture, fixture event, fixture users, cleanup path, or native runtime device/simulator target was approved for this pass.

## 4. Fixture IDs Redacted Or Summarized

No fixture IDs were available to redact. No auth credentials, session tokens, passwords, provider secrets, service-role keys, or user-private payloads were inspected, printed, or committed.

The future smoke fixture set must be documented outside Git or provided during the run without exposing secrets:

- `User A`: confirmed registration, complete profile, public usable photo, no active session.
- `User B`: confirmed registration, complete profile, public usable photo, no active session.
- `User C`: confirmed registration, complete profile, public usable photo, no active session.
- Optional blocked/reported target: isolated fixture pair only.
- Live event: active/live, enough duration for two-user and three-user flows.
- Scheduled event: not started, safe for no-action gate checks.
- Ended event or state switch: safe and reversible fixture-only end path.

## 5. Automated Baseline Results

These checks are non-mutating and do not execute live RPC smoke flows.

| Command | Result |
| --- | --- |
| `git status --short` | PASS, clean before report creation. |
| `supabase migration list --linked` | PASS, local/remote migration parity through `20260501230000`. |
| `supabase db push --linked --dry-run` | PASS, remote database is up to date. |
| `npm run test:event-lobby-regression` | PASS. |
| `./scripts/run_event_lobby_regression.sh` | PASS. |
| `npm run test:hardening-contracts` | PASS. |
| `npm run typecheck` | PASS, includes mobile typecheck and `expo-crypto` guard. |
| `npm run lint` | PASS with existing warning backlog: 208 warnings, 0 errors. |
| `npm run build` | PASS with existing Vite dynamic-import/chunk-size warnings. |

The `--staging-smoke-check` path was not treated as a passing runtime check because the required fixture metadata is absent. The script remains available to validate metadata once an operator provides approved fixtures.

## 6. Read-Only Deployed Contract Verification

Read-only startup checks completed:

- linked Supabase ref is `schdyxcunwcvddlcshwd`
- local/remote migration list is aligned through the current latest migration
- dry-run reports no pending migration drift

The deeper deployed runtime marker/source checks from the smoke prompt were not continued into runtime smoke because the fixture gate blocked the stream. Prior Event Lobby investigation batches already recorded read-only contract evidence for active-event guards, deck payload markers, swipe idempotency, Ready Gate/queue guards, and native parity. This batch does not replace those reports or claim fresh provider/runtime proof.

## 7. Web Scenario Table

| Scenario | Status | Notes |
| --- | --- | --- |
| Missing/stale event link | Blocked | Requires approved browser session and fixture routing context. |
| Scheduled/not-started event | Blocked | Requires approved scheduled fixture event or safe state switch. |
| Live two-user immediate match | Blocked | Would mutate swipes, session state, Ready Gate transitions, and observability. |
| Duplicate swipe retry | Blocked | Would require fixture swipe mutation and duplicate replay. |
| Three-user queued match | Blocked | Would mutate queue/session state across three fixture users. |
| Busy/in-session candidate | Blocked | Requires fixture active-session state and direct conflict attempt. |
| Event ends while mounted | Blocked | Requires safe fixture event-state transition. |
| Block/report exclusion | Blocked | Requires approved isolated safety fixture and cleanup. |
| Empty deck diagnostics | Blocked | Requires controlled fixture deck state. |
| Observability review | Blocked | Runtime event/log proof depends on the above fixture flows. |

No web runtime pass or failure was recorded.

## 8. Provider Touchpoint Table

| Provider/path | Status | Notes |
| --- | --- | --- |
| OneSignal / `send-notification` | Blocked | No real push or provider delivery smoke was run. |
| Daily room/token handoff | Blocked | No Ready Gate/date-entry provider path was invoked. |
| Media/CDN deck card loading | Blocked | No fixture UI deck media was loaded. |

Provider delivery and runtime media proof remain unproven until approved fixtures exist.

## 9. Native Device Or Simulator Table

| Scenario | Status | Notes |
| --- | --- | --- |
| Missing/stale event link | Blocked | No native runtime fixture/session was approved. |
| Scheduled/not-started event | Blocked | Requires approved fixture event. |
| Live deck load | Blocked | Requires approved fixture users/event. |
| Deck card media fallback | Blocked | Requires approved fixture public media. |
| Non-available candidate disabled | Blocked | Requires controlled backend candidate state. |
| Swipe outcome mapping | Blocked | Would mutate fixture swipes. |
| Duplicate/no-op handling | Blocked | Would require fixture replay. |
| `event_not_active` deck/swipe terminal state | Blocked | Requires safe inactive fixture. |
| Ready Gate open/dedupe | Blocked | Would mutate session and Ready Gate state. |
| Event ends while mounted | Blocked | Requires safe fixture event-state transition. |
| Queue promotion | Blocked | Requires three-user fixture flow. |
| Observability emitted/sanitized | Blocked | Depends on approved runtime flows. |

No simulator/device smoke was run. No TestFlight/app-store rollout was attempted.

## 10. Data Mutation And Cleanup Statement

No production data was mutated. No fake or test records were created. No fixture credentials were committed. No provider action was invoked. No Supabase migration or Edge Function was deployed.

The future cleanup/reset plan must explicitly cover:

- `event_swipes` rows for all fixture pairs
- `video_sessions` and any Ready Gate/date terminal state created during the run
- `event_registrations` room pointers, partner pointers, queue statuses, and lobby heartbeat/status fields
- match queue rows and queued promotion state
- block/report fixture links, if used
- notification or push telemetry rows created by fixture flows
- Event Lobby observability rows/log references created by the run
- Daily room/token side effects if date-entry provider proof is included
- event status/timestamps if scheduled/live/ended state is changed

Any production-isolated fixture approval must name the fixture set and rollback-safe cleanup procedure before live calls are made.

## 11. Required Operator Steps Before Smoke

1. Choose the environment:
   - preferred: true staging Supabase project with no production users
   - acceptable only with explicit approval: production project with isolated approved test users/events
   - unavailable: current state
2. Provide safe fixture metadata without secrets:
   - environment name
   - Supabase ref
   - fixture event aliases/IDs
   - User A/B/C aliases/IDs
   - blocked/reported fixture aliases/IDs if included
   - cleanup/reset owner and exact cleanup boundary
3. For staging, export metadata locally:

   ```bash
   EVENT_LOBBY_REGRESSION_ENV=staging
   EVENT_LOBBY_REGRESSION_SUPABASE_REF=<non-production-ref>
   EVENT_LOBBY_REGRESSION_SAFE_FIXTURES=1
   EVENT_LOBBY_REGRESSION_EVENT_ID=<fixture-event-id>
   ```

4. Validate fixture metadata without running live RPC smoke:

   ```bash
   ./scripts/run_event_lobby_regression.sh --staging-smoke-check
   ```

5. If using the canonical production ref for isolated fixtures, explicitly approve the fixture and provide:

   ```bash
   EVENT_LOBBY_REGRESSION_PRODUCTION_FIXTURE_ID=<approved-fixture-id>
   ./scripts/run_event_lobby_regression.sh --staging-smoke-check --allow-production
   ```

6. Only after the metadata check passes, rerun this investigation prompt to execute the approved web/native scenario matrix and record honest runtime evidence.

## 12. Exact Remaining Blockers

- Approved safe fixture metadata is missing.
- Runtime environment classification is unavailable.
- No cleanup/reset plan is documented for fixture swipes, sessions, registrations, notifications, provider side effects, or event state.
- Native simulator/device target and build route are not approved for this smoke.
- Provider touchpoint proof remains manual/runtime-only and cannot be inferred from source tests.

## 13. Next-Step Prompt

```text
Run Event Lobby runtime and native smoke proof using the approved fixture metadata from docs/audits/event-lobby-runtime-smoke-fixture-readiness.md. First validate the fixture metadata with ./scripts/run_event_lobby_regression.sh --staging-smoke-check. Then execute the web and native scenario matrices only against those fixtures, record data mutations and cleanup, and do not claim provider delivery unless it is actually observed.
```

## No-Production-Mutation Statement

This investigation used source inspection, redacted fixture-metadata checks, local static tests, lint/typecheck/build commands, Supabase migration listing, and Supabase dry-run checks only. It did not mutate production data, deploy Supabase artifacts, deploy Edge Functions, run provider actions, run real push/media/Daily smoke, add native modules, or import/require `expo-av`.
