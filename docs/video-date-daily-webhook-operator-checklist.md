# Video Date Daily Webhook Operator Checklist

This checklist covers the Daily provider webhook that reconciles real participant join/leave events for Video Date v4.

Current recovery overlay (2026-06-05): start with `docs/video-date-success-command-center.md` for active Video Date recovery state. Functional Video Date code landed in PR #1200 at merge commit `fbca4996a096273914ee650b556ba7994477aa5e`; verify current Git state before assuming no docs-only follow-up sits on top. Supabase migrations through `20260605115657_video_date_early_confirmed_encounter_promotion.sql` are applied. The webhook ledger is required evidence for active Daily co-presence: a provider/client join is latest-state evidence only when newer than leave/away evidence, provider joins should clear reconnect grace when they prove return, stale provider leaves must not override newer joins, and confirmed bilateral remote-media encounters should promote to `date` immediately instead of waiting for a stale handshake deadline race.

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
   - `handshake_started_at` starts only after both participants' latest provider presence is active.
9. Confirm `event_loop_observability_events` shows `handshake_started_after_active_daily_copresence` only after active co-presence, `daily_join_waiting_for_active_partner` only while a partner is absent or away, and `reconnect_grace_cleared_by_provider_join` when a provider join cancels pending reconnect grace.

## Rebuild Implication

If this webhook, secret, or provider registration is missing, video-date Daily join/leave recovery and active-presence gating cannot be production-verified. Core room creation may still work through `daily-room`, which can hide the missing recovery ledger until reconnect/away reconciliation is needed.
