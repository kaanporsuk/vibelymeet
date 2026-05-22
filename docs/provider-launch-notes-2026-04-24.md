# Provider Launch Notes - 2026-04-24

## OneSignal Tag Limit

The native OneSignal tag writer is already limited to durable, low-cardinality tags:

- `onboarding_complete`
- `has_photos`
- `is_premium`
- `subscription_tier`

It also deletes old high-churn tags (`user_id`, `city`, `signup_date`). Web does not currently write OneSignal tags. If OneSignal continues returning `409 entitlements-tag-limit`, the remaining action is provider/account cleanup or a plan limit increase rather than adding more app-side tags.

## RevenueCat App Store Products

`premium_monthly` and `premium_annual` are blocked on App Store Connect product approval while they remain `READY_TO_SUBMIT`. This is not coupled to the video-date fix unless product identifiers or RevenueCat offering config are changed.

## Daily Webhook Provider Registration - 2026-05-22

Daily webhook provider registration is closed for Video Date real-participant reconciliation.

- Supabase project: `schdyxcunwcvddlcshwd`
- Webhook UUID: `a5407924-6f29-4a35-835a-ff5185eeae5c`
- URL: `https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/video-date-daily-webhook`
- Event types: `participant.joined`, `participant.left`
- State: `ACTIVE`
- Retry type: `exponential`
- Failed count at registration close: `0`

Validation evidence:

- Signed Daily verification probe `{"test":"test"}` returned HTTP 200 with `{"ok":true,"test":true}`.
- Daily `POST /webhooks` returned HTTP 200 and created the webhook above.
- `lastMomentPushed` is expected to remain `null` until the first real subscribed Daily event is delivered.

Secrets posture: `DAILY_WEBHOOK_SECRET` is present and must not be printed, rotated, or copied into notes. The HMAC value is intentionally excluded from this document.
