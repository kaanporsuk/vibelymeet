# Video Date Remote-Seen Retry Plan - 2026-06-14

Status: implemented in the local candidate source and ready for publish verification. The linked backend contract remains unchanged.

Session investigated: `16d1d7ac-d3d7-4ceb-8247-c405e8634695`

Event investigated: `1986a036-c01e-4695-9a9b-b2383ae7926e`

Participants:

- Native iOS physical device user: `267aa05e-0802-4b87-9a7b-ff78b97fdfa7`
- Web user: `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c`

## Executive Diagnosis

The test failed because the native client rendered remote media but lost the one-shot `remote_track_mounted` evidence before it could call `mark_video_date_remote_seen`.

This was not primarily a Daily room creation failure, Daily webhook failure, surface-claim failure, or registration cleanup failure. Both users joined the Daily room with provider-backed proof. The web user eventually stamped `participant_2_remote_seen_at`. The native user never stamped `participant_1_remote_seen_at`, so the server correctly kept the session in entry and ended it with `entry_timeout`.

The implementation should preserve the current server policy: do not weaken SQL promotion to allow one-sided remote media. Instead, fix web/native client evidence delivery so render-bound evidence is retried and drained when provider/call proof becomes available.

## Failure Chain

1. Both Daily webhook joins arrived almost simultaneously:
   - Web provider join: `2026-06-13 23:26:05.134+00`
   - Native provider join: `2026-06-13 23:26:05.136+00`

2. Native Daily join and alive proof became healthy:
   - Native provider session: `b4aa0931-cc52-4b4f-ae8d-30228d6c96ef`
   - Native call instance: `vde_mqczhmqp_bx4fml3s05:2`
   - Native owner id: `vdeo_mqczhmqp_zgd575vnkt`

3. Native remote media evidence fired at `2026-06-13T23:26:09.075Z`, but the native hook logged:
   - `mark_video_date_remote_seen_skipped_provider_missing`
   - `source: remote_track_mounted`
   - `meetingState: joined-meeting`
   - `providerBackedJoined: true`
   - `providerSessionId: b4aa0931-cc52-4b4f-ae8d-30228d6c96ef`
   - no `callInstanceId` in the logged proof payload

4. The current hook treats that local proof miss as terminal for retry:
   - `apps/mobile/lib/videoDate/useNativeVideoDateRemoteSeen.ts` builds a `retryable: false` local payload when provider/call proof is missing.
   - It also runs an initial `buildProviderBoundRemoteSeenArgs(source)` and returns immediately on `!initialProof.ok`, before the retry path can run.
   - The web hook has the same pattern in `src/hooks/videoCall/useVideoDateRemoteSeen.ts`, even though web happened to recover in this run.

5. Later native heartbeats were provider-backed and carried the missing call identity, but no new remote-track event re-fired, so the native side never retried the remote-seen RPC.

6. Once web stamped `participant_2_remote_seen_at`, the live server gate required bilateral remote seen. This is intentional in the deployed SQL:
   - heartbeat promotion requires `NOT v_one_remote_seen`
   - bilateral remote-seen promotion also requires `NOT v_one_remote_seen` on the one-sided guard branch
   - the observed promotion reason repeatedly became `bilateral_remote_seen_required`

7. Native still had real remote media by the time the entry deadline fired:
   - `first_playable_remote_seen: true`
   - `remote_video_mounted: true`
   - `remote_audio_mounted: true`
   - `first_playable_remote_age_ms: 125121`

8. The session ended:
   - `ended_reason: entry_timeout`
   - `date_started_at: null`
   - `stable_bilateral_media_at: null`
   - `participant_1_remote_seen_at: null`
   - `participant_2_remote_seen_at: 2026-06-13T23:26:39.012506+00:00`
   - no `date_feedback` rows for the session

## Confirmed Non-Causes

- Daily room existed and was verified.
- Both provider `participant.joined` webhooks were recorded and reconciled.
- Both clients kept provider-backed alive heartbeats for the session.
- Surface claims existed for both sides near terminal.
- Registration cleanup happened after failure.
- PostHog rate-limit warnings were noisy but not causal for this failure.
- The server's `bilateral_remote_seen_required` outcome was correct once only one participant had stamped remote seen.

## Code Problem

The current web/native hooks are too brittle around the boundary between render evidence and provider/call identity proof.

Native problem area:

- `apps/mobile/lib/videoDate/useNativeVideoDateRemoteSeen.ts`
- `callInstanceId` is read only from `activeNativeDailyCallIdentityRef.current`
- `providerSessionId` is read only from the live call object
- `getVideoDateEntryOwner(...)` is used for `ownerId`, `entryAttemptId`, and trace id, but not as a fallback for `callInstanceId` or `providerSessionId`
- local provider/call proof miss returns `retryable: false`
- initial proof miss returns before `stamp(...)` and `handleFailure(...)` can schedule retry

Web parity problem area:

- `src/hooks/videoCall/useVideoDateRemoteSeen.ts`
- the same early-return and `retryable: false` pattern exists
- web recovered in this run only because its first provider-bound RPC reached the server, received a server retryable error, and retried successfully

Shared ownership state already has the data we need:

- `shared/matching/videoDateEntryOwner.ts` stores `callInstanceId` and `providerSessionId` on both entry owner and daily owner state.
- `updateVideoDateDailyOwnerState(...)` notifies `subscribeVideoDateDailyOwner(...)` subscribers when provider/call proof changes.

## Implementation Principles

- Keep remote-seen evidence render-bound. Do not stamp from `participant_joined`, snapshots, plain heartbeats, or presence alone.
- Keep provider proof strict. The RPC must still receive owner id, call instance id, provider session id, owner state, entry attempt id, and evidence source.
- Treat local provider/call proof gaps as pending, not failed, unless the Daily call is terminal.
- Preserve web/native parity. Fix both hooks even though this failure manifested on native.
- Do not loosen the SQL gate in the first pass. The server correctly rejected one-sided remote media as insufficient once `one_remote_seen=true`.

## Implementation Plan

### Phase 1 - Add Shared Remote-Seen Evidence Helpers

Create a small shared helper, likely `shared/matching/videoDateRemoteSeenEvidence.ts`, to avoid duplicating fragile source and retry semantics.

The helper should export:

- `VIDEO_DATE_REMOTE_SEEN_RENDER_EVIDENCE_SOURCES`
- `isVideoDateRemoteSeenRenderEvidenceSource(source: string): boolean`
- `videoDateRemoteSeenProviderMissingPayload(input): Record<string, unknown>`
- `videoDateRemoteSeenProviderMissingRetryable(terminal: boolean): boolean`

Required behavior:

- allowed render evidence sources remain exactly:
  - `loadeddata`
  - `playing`
  - `remote_track_mounted`
  - `first_remote_frame`
  - `request_video_frame_callback`
- provider/call missing is retryable while meeting state is non-terminal
- terminal meeting states stay non-retryable and continue clearing heartbeat timers
- payload includes `retry_after_ms: 1500`, `provider_presence_required: true`, `provider_presence_missing: true`, and `provider_presence_terminal`

### Phase 2 - Patch Native Remote-Seen Stamping

Edit `apps/mobile/lib/videoDate/useNativeVideoDateRemoteSeen.ts`.

Changes:

1. Remove the initial proof short-circuit:
   - remove `const initialProof = buildProviderBoundRemoteSeenArgs(source);`
   - remove `if (!initialProof.ok) return;`
   - allow `stamp(source, 1)` to handle proof miss through `handleFailure(...)`

2. Make local provider/call missing retryable when non-terminal:
   - replace `retryable: false` with `retryable: !terminal`
   - include `retry_after_ms: REMOTE_SEEN_RPC_RETRY_DELAY_MS`
   - rename or augment the log from `mark_video_date_remote_seen_skipped_provider_missing` to a pending/retryable log for non-terminal states

3. Fallback to owner state for proof:
   - `providerSessionId = readNativeDailyProviderSessionId(call) ?? entryOwner?.providerSessionId ?? dailyOwner?.providerSessionId ?? null`
   - `callInstanceId = identityCurrent?.callInstanceId ?? entryOwner?.callInstanceId ?? dailyOwner?.callInstanceId ?? null`
   - `ownerId = identityCurrent?.ownerId ?? entryOwner?.ownerId ?? dailyOwner?.ownerId ?? null`
   - preserve current `entryAttemptId` and trace fallbacks

4. Use `getVideoDateDailyOwner(...)` with the current `roomNameRef.current` so fallback proof is scoped to the same session/user/room.

5. On successful RPC, keep updating both entry owner and daily owner with `state: "remote_seen"` and the proof used.

### Phase 3 - Patch Web Remote-Seen Stamping

Edit `src/hooks/videoCall/useVideoDateRemoteSeen.ts` with equivalent changes.

Changes:

1. Remove the initial proof short-circuit.
2. Make local provider/call missing retryable when non-terminal.
3. Fallback to entry/daily owner proof for provider session and call instance id.
4. Keep the existing web-only render evidence sources (`loadeddata`, `playing`, first-frame paths) render-bound.
5. Preserve existing terminal survey handling and live-remount identity preservation.

### Phase 4 - Add Pending Evidence Drain

Timed retry alone is not enough. The native failure happened because render evidence was one-shot and later proof arrived through owner heartbeat state. Add a pending evidence buffer in both hooks.

Implementation shape:

- Add `remoteSeenPendingEvidenceRef`:
  - `sessionId`
  - `userId`
  - `roomName`
  - `source`
  - `createdAtMs`
  - `attempts`

- When `markRemoteSeenOnServer(source)` receives an allowed render evidence source, store or refresh pending evidence before attempting the RPC.

- Clear pending evidence when:
  - the RPC succeeds
  - a terminal survey/terminal stop is observed
  - the hook unmounts or session id changes
  - evidence is older than a conservative active-session TTL, likely 180 seconds

- Subscribe to `subscribeVideoDateDailyOwner(...)`.

- On owner update, drain pending evidence when:
  - owner `sessionId` matches pending `sessionId`
  - owner `userId` matches pending `userId`
  - owner `roomName` is null or matches pending `roomName`
  - owner state is `joined` or `remote_seen`
  - owner has both `callInstanceId` and `providerSessionId`
  - no remote-seen RPC is already in flight

- Drain by calling `markRemoteSeenOnServer(`${source}_owner_ready`)`, but keep `p_evidence_source` equal to the original render source. The server must not receive `_owner_ready` as evidence source.

This is the important durability fix: render evidence survives until provider-bound proof becomes available.

### Phase 5 - Observability

Add or refine logs so the next production run is self-explaining.

Add fields to local provider-missing logs:

- `code`
- `retryable`
- `willRetry`
- `attempt`
- `hasIdentityCallInstance`
- `hasEntryOwnerCallInstance`
- `hasDailyOwnerCallInstance`
- `hasCallProviderSession`
- `hasEntryOwnerProviderSession`
- `hasDailyOwnerProviderSession`
- `pendingEvidenceAgeMs`

Add a new drain log:

- `mark_video_date_remote_seen_pending_evidence_drain`

Keep `mark_video_date_remote_seen_skipped_provider_missing` only for truly terminal or non-retryable skips, or rename non-terminal cases to `mark_video_date_remote_seen_provider_pending`.

### Phase 6 - Contract Tests

Add a focused static contract test, likely `shared/matching/videoDateRemoteSeenRetryContracts.test.ts`.

Test assertions:

- Native remote-seen no longer has an initial `if (!initialProof.ok) return` before retry setup.
- Web remote-seen no longer has an initial `if (!initialProof.ok) return` before retry setup.
- Native local provider/call missing payload is `retryable: !terminal`.
- Web local provider/call missing payload is `retryable: !terminal`.
- Native proof builder falls back to `entryOwner?.callInstanceId` or daily owner equivalent.
- Web proof builder falls back to `entryOwner?.callInstanceId` or daily owner equivalent.
- Both hooks subscribe to `subscribeVideoDateDailyOwner`.
- Both hooks preserve original `baseEvidenceSource` for `p_evidence_source`.
- Neither hook stamps remote-seen from participant/snapshot/presence-only sources.

Wire the test into `package.json`:

- Add it to `test:video-date:red-flags`
- Add it to `test:video-date-v4`

Consider updating `shared/matching/videoDateStrictDailyJoinRemoteSeen.test.ts` if its existing remote-seen assertions are the best home for the render-bound evidence rules.

### Phase 7 - Documentation Update

After code and tests pass, update canonical docs only:

- `docs/video-date-runbook.md`
- `docs/video-date-architecture.md` if the client evidence-drain behavior should be documented as architecture

Document:

- remote-seen render evidence is queued locally until provider-bound proof is available
- local proof pending is retryable while Daily is non-terminal
- SQL still requires bilateral remote seen once one participant has stamped remote seen

## Validation Plan

### Static Validation

Run focused contracts first:

```bash
npx tsx shared/matching/videoDateRemoteSeenRetryContracts.test.ts
npm run test:video-date:red-flags
```

Then run the wider Video Date suite:

```bash
npm run test:video-date-v4
```

Then run project health checks:

```bash
npm run typecheck
npm run lint
```

If no Supabase schema or SQL function changes are made, no migration should be created and no Supabase types should be regenerated. Still run the linked dry-run before deploy/publish as a guard:

```bash
SUPABASE_CLI_TELEMETRY_OPTOUT=1 npx supabase db push --linked --dry-run
SUPABASE_CLI_TELEMETRY_OPTOUT=1 npx supabase migration list --linked
```

### Runtime Validation

The only acceptable fix proof is a fresh disposable two-user production run with one web user and one physical iOS device user.

Required runtime proof:

1. Both users reach Ready Gate and enter the same Daily room.
2. Both provider `participant.joined` webhooks are recorded.
3. Both clients emit provider-backed alive heartbeats.
4. Both `participant_1_remote_seen_at` and `participant_2_remote_seen_at` are set.
5. `stable_bilateral_media_at` is set.
6. `date_started_at` is set.
7. The run reaches survey.
8. Two `date_feedback` rows are persisted.
9. Event registrations are released cleanly after completion.

For the new session id, run:

```bash
npm run latency:video-date <new-session-id>
```

Expected forensics after the fix:

- `state=ended/ended` only after survey completion, not `entry_timeout`
- `ended_reason` should not be the pre-date entry timeout path
- both remote-seen timestamps should exist
- stable bilateral media should have a source
- date feedback rows should exist

## Rollback Plan

If the client patch causes bad behavior:

1. Revert the web/native remote-seen hook changes.
2. Keep the investigation artifact.
3. Do not change SQL unless a separate fresh run proves the server gate is the blocker after both client remote-seen stamps are reliable.

## Explicit Non-Plan

Do not do these in the first implementation pass:

- Do not relax `video_date_stable_bilateral_media_gate_v1`.
- Do not treat Daily joined or alive heartbeat as remote media evidence.
- Do not stamp remote-seen from snapshots or participant updates.
- Do not add a migration unless code inspection during implementation proves a server contract gap.
- Do not declare success from static tests, CI, Daily room creation, `both_ready`, brief media, or a survey-required terminal row.

## Implementation Order For Codex

1. Add the shared remote-seen evidence helper.
2. Patch native hook.
3. Patch web hook.
4. Add pending evidence drain subscriptions in both hooks.
5. Add focused contract tests.
6. Wire focused test into Video Date scripts.
7. Run static validation.
8. Update canonical docs.
9. Prepare a fresh production two-user validation checklist and SQL proof bundle.
