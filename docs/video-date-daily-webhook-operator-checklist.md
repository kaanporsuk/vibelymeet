# Video Date Daily Webhook Operator Checklist

This checklist covers the Daily provider webhook that reconciles real participant join/leave events for Video Date v4.

Current local overlay (2026-06-08): start with `docs/video-date-success-command-center.md` and `docs/branch-deltas/fix-video-date-active-owner-terminal-truth.md`. Migration `20260608171837_video_date_active_owner_terminal_truth.sql` preserves delayed provider join/left truth by webhook `occurred_at` even when the session is already terminal and row mutation is blocked. A late Daily event must not be allowed to incorrectly restart an ended session, but it must still leave historical evidence that a participant actually joined or left. This overlay is not yet cloud proof until the migration is applied remotely.

Current recovery overlay (2026-06-07): start with `docs/video-date-success-command-center.md` for active Video Date recovery state. PR #1216 merged at `3ae7f196749f2229d66da6f0ef73ae2f76f30768` after failed session `c9dc7af1-1f40-431f-93ed-4435019126aa`; Supabase project `schdyxcunwcvddlcshwd` is applied/aligned through `20260606205211_video_date_provider_participant_id_presence_repair.sql`. The webhook ledger is required evidence for Daily provider history, but it is not enough by itself to start handshake: provider/client join evidence must be latest-state active, both route/session Daily owners must heartbeat after the later join, latest heartbeats must be fresh, provider presence must be current, and either the first qualifying bilateral heartbeat pair must have stayed stable for at least 2 seconds or canonical remote-seen must exist. Provider-authoritative presence checks must read `video_date_daily_webhook_events.provider_participant_id` first, matching `video-date-daily-webhook` ingestion, before falling back to sanitized payload participant/session fields. Client heartbeats without a current provider session id, or heartbeats contradicted by a matching later Daily `participant.left`, are telemetry only and must not clear away state, advance joined evidence, or revive copresence. Provider joins should clear reconnect grace when they prove return, stale provider leaves must not override newer joins, confirmed bilateral remote-media encounters with current provider proof should promote to `date` immediately instead of waiting for a stale handshake deadline race, provider leaves after `date_started_at` should affect current peer presence without erasing survey eligibility, terminal rows should retain canonical room metadata for forensics while provider deletion is recorded in marker columns, active date/survey ownership should prevent lobby/Ready Gate Daily prepare churn, and registrations still pointing at pending surveys should be `in_survey` until feedback exists. Native notification pending-survey tap failures are not Daily webhook failures by default; first confirm the route reconciler sends `/date/:sessionId` with `pending_survey_terminal_encounter` / `navigate_date` before changing webhook or provider logic.

## Endpoint

- Supabase project ref: `schdyxcunwcvddlcshwd`
- Edge Function: `video-date-daily-webhook`
- Function URL: `https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/video-date-daily-webhook`
- Gateway JWT posture: `verify_jwt = false`
- Protection model: provider-public endpoint with function-internal Daily HMAC and timestamp validation.
- Current Daily webhook UUID: `a5407924-6f29-4a35-835a-ff5185eeae5c`

## Secret Format

Set `DAILY_WEBHOOK_SECRET` to the Daily webhook `hmac` value exactly as Daily returns it. It is a base64-encoded HMAC-SHA256 secret. Do not decode it before storing it in Supabase. The function decodes the base64 value to bytes and signs:

```text
X-Webhook-Timestamp + "." + raw request body
```

The computed digest is compared with Daily's base64 `X-Webhook-Signature` header.

Official Daily contract: https://docs.daily.co/reference/rest-api/webhooks

Current deploy and rebuild references:

- `docs/supabase-cloud-deploy.md`
- `_cursor_context/vibely_edge_function_manifest.md`
- `_cursor_context/vibely_daily_provider_sheet.md`

## Provider Registration

The Daily dashboard/API webhook must point to:

```text
https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/video-date-daily-webhook
```

Subscribe to:

- `participant.joined`
- `participant.left`

The server also tolerates legacy/internal `participant.join` and `participant.leave` strings in the reconciliation RPC.

Current operator evidence as of 2026-05-22:

- signed `{"test":"test"}` probe returned HTTP 200
- Daily `POST /webhooks` returned HTTP 200
- webhook UUID is `a5407924-6f29-4a35-835a-ff5185eeae5c`
- webhook state is `ACTIVE`
- `failedCount` is `0`
- `lastMomentPushed` is still null until real participant events occur

Do not recreate or update this webhook during verification. The remaining proof is real join/leave delivery.

## Safe Secret Set Command

Do not run this during the 2026-05-23 closure pass; the webhook registration and secret presence are already closed by operator evidence. This command is retained only for a future full rebuild or approved secret recovery. Do not print the secret in shell history or logs.

```bash
read -rsp "Daily webhook hmac (base64): " DAILY_WEBHOOK_SECRET; printf "\n"
tmp="$(mktemp)"; chmod 600 "$tmp"
printf 'DAILY_WEBHOOK_SECRET=%s\n' "$DAILY_WEBHOOK_SECRET" > "$tmp"
supabase secrets set --env-file "$tmp" --project-ref schdyxcunwcvddlcshwd
rm -f "$tmp"; unset DAILY_WEBHOOK_SECRET
```

## Smoke Expectations

Before `DAILY_WEBHOOK_SECRET` is set, unsigned probes return:

```text
503 webhook_secret_missing
```

After the secret is set, unsigned probes must fail closed with timestamp/signature validation, not secret-missing:

```text
401 timestamp_missing
```

or:

```text
401 signature_invalid
```

Signed verification probe, only when a test/real hmac is explicitly available in the environment:

```bash
DAILY_WEBHOOK_SECRET=<base64 hmac> node scripts/probe-daily-webhook.mjs --cloud --verification-probe
```

Expected response:

```json
{"ok":true,"test":true}
```

Signed synthetic event probe:

```bash
DAILY_WEBHOOK_SECRET=<base64 hmac> node scripts/probe-daily-webhook.mjs --cloud
```

For synthetic room/user ids, a successful signature path may still return an ignored reconciliation result such as `ignored_session_not_found`; that proves signature handling, not provider registration.

## Real Provider Validation

Use a controlled two-user video-date smoke to prove provider delivery:

1. Confirm Daily webhook UUID `a5407924-6f29-4a35-835a-ff5185eeae5c` is still `ACTIVE` and points to the exact URL above.
2. Start one real video-date session through the app.
3. Have both participants join the Daily room through normal app flow.
4. Have both participants leave/end through normal app flow.
5. Confirm Daily `lastMomentPushed` becomes non-null and `failedCount` remains `0`.
6. Confirm Supabase Dashboard Edge Function logs show accepted `participant.joined` and `participant.left` invocations for `video-date-daily-webhook`.
7. Confirm `video_date_daily_webhook_events` contains non-secret rows for `participant.joined` and `participant.left`.
8. Confirm `video_sessions` reflects active presence correctly:
   - a real join advances `participant_*_joined_at`,
   - a later leave stamps `participant_*_away_at`,
   - a newer real route/provider join clears the actor's away stamp,
   - a join that proves return clears `reconnect_grace_ends_at`,
   - a stale leave older than the latest join does not mark the participant away,
   - pre-`20260606180000`, `handshake_started_at` starts only after both participants' latest provider presence is active.
9. After `20260606205211` is applied, confirm `video_date_presence_events` also shows fresh latest owner/client heartbeats from both participants, first qualifying bilateral heartbeat evidence after the later provider-backed join, and handshake starts only after provider-authoritative stable copresence or current canonical remote-seen evidence.
10. Confirm `event_loop_observability_events` shows `handshake_started_after_active_daily_copresence` only after active co-presence on pre-`20260606180000` runs. After the provider-authoritative stable-copresence rollout, confirm `mark_video_date_daily_joined` / `mark_video_date_daily_alive` returns `waiting_for_stable_copresence` until both latest provider joins are current by `provider_participant_id`, no later matching provider leave exists, and both owner heartbeats are fresh.
11. Confirm any route churn/rejoin path also leaves non-secret audit rows in `video_date_surface_claim_events` and preserves `same_session_daily_continuity_latched` / `parked_singleton` details in `event_loop_observability_events` when emitted.
12. If a native notification is tapped after terminal survey truth, confirm it routes to Date survey recovery without new Daily prepare/join churn or extra provider webhook dependency.
13. After `20260608171837`, if Daily provider events arrive after terminalization, confirm they are ordered by `occurred_at`, preserve `participant_*_provider_joined_at` / `participant_*_provider_left_at`, and append `video_date_presence_events.source = 'daily_webhook_historical_truth'` without reviving active date state.
14. Confirm terminalized sessions include a coherent terminal tuple: `video_sessions.terminal_generation`, `terminal_audit_*`, surface-claim `session_terminal_generation`, `session_state_updated_at`, `session_ended_at`, and `session_ended_reason`.

## Rebuild Implication

If this webhook, secret, or provider registration is missing, video-date Daily join/leave recovery and active-presence gating cannot be production-verified. Core room creation may still work through `daily-room`, which can hide the missing recovery ledger until reconnect/away reconciliation is needed.
