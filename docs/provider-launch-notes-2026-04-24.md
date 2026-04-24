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
