# Video Date Daily Webhook Operator Checklist

This checklist covers the Daily provider webhook that reconciles real participant join/leave events for Video Date v4.

## Endpoint

- Supabase project ref: `schdyxcunwcvddlcshwd`
- Edge Function: `video-date-daily-webhook`
- Function URL: `https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/video-date-daily-webhook`
- Gateway JWT posture: `verify_jwt = false`
- Protection model: provider-public endpoint with function-internal Daily HMAC and timestamp validation.

## Secret Format

Set `DAILY_WEBHOOK_SECRET` to the Daily webhook `hmac` value exactly as Daily returns it. It is a base64-encoded HMAC-SHA256 secret. Do not decode it before storing it in Supabase. The function decodes the base64 value to bytes and signs:

```text
X-Webhook-Timestamp + "." + raw request body
```

The computed digest is compared with Daily's base64 `X-Webhook-Signature` header.

Official Daily contract: https://docs.daily.co/reference/rest-api/webhooks

## Provider Registration

The Daily dashboard/API webhook must point to:

```text
https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/video-date-daily-webhook
```

Subscribe to:

- `participant.joined`
- `participant.left`

The server also tolerates legacy/internal `participant.join` and `participant.leave` strings in the reconciliation RPC.

## Safe Secret Set Command

Do not print the secret in shell history or logs.

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

1. Confirm Daily webhook state is `ACTIVE` and points to the exact URL above.
2. Start one real video-date session through the app.
3. Have both participants join the Daily room through normal app flow.
4. Have both participants leave/end through normal app flow.
5. Confirm Daily `lastMomentPushed` becomes non-null and `failedCount` remains `0`.
6. Confirm Supabase Edge logs show accepted `video-date-daily-webhook` invocations.
7. Confirm `video_date_daily_webhook_events` contains non-secret rows for `participant.joined` and `participant.left`.

## Rebuild Implication

If this webhook, secret, or provider registration is missing, video-date Daily join/leave recovery cannot be production-verified. Core room creation may still work through `daily-room`, which can hide the missing recovery ledger until reconnect/away reconciliation is needed.
