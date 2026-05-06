# P4 Native And Store Operations Playbook

Native remains Expo/React Native in `apps/mobile`. P4 adds evidence ledgers and checklists; it does not replace the store dashboards.

## Release Channels

| Channel | Purpose | Evidence |
|---|---|---|
| dev | Local/device validation | build id, device, smoke result |
| internal | team testing | install proof, auth/onboarding/events/chat/video-date smoke |
| testflight | iOS beta | App Review status, crash-free evidence, release notes |
| play_internal | Android beta | Play track status, crash-free evidence, release notes |
| production | phased rollout | rollout percent, rollback criteria, support watch |

## Required Checks

- Auth and onboarding smoke.
- Event list/detail/register/lobby smoke.
- Ready Gate and video-date join smoke.
- Chat/send-message smoke.
- OneSignal native token sync and deep-link route smoke.
- RevenueCat entitlement verification against backend entitlement truth.
- Sentry release/environment mapping.
- PostHog event parity using shared taxonomy.
- Store metadata checklist: screenshots, description, privacy labels, category, support URL, release notes.

## Evidence Tables

- `native_release_runs`
- `store_review_events`
- `store_metadata_checklists`

These are manual evidence ledgers. They do not mutate App Store Connect, Play Console, RevenueCat, OneSignal, or provider dashboards.

## Rollback Criteria

- Critical auth/onboarding regression.
- Payment/entitlement drift that cannot be reconciled.
- Push/deep-link routing failure on the target platform.
- Crash-free sessions below the active release budget.
- Trust/safety or account-deletion workflow regression.
