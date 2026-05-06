# P4 Analytics Instrumentation Map

Shared analytics event names live in `shared/analytics/productIntelligence.ts`. Web and native wrappers import the same sanitizer and must not invent sensitive local event payloads.

## Ownership

| Surface | Wrapper | Platform value | Notes |
|---|---|---|---|
| Web | `src/lib/analytics.ts` | `web` | Consent-gated PostHog capture, operational video-date checkpoint RPC remains separate |
| Native | `apps/mobile/lib/analytics.ts` | `native` | Runtime consent-gated PostHog capture |
| Backend/RPC | SQL admin RPCs | `backend` | Product-state truth and admin metrics |
| Edge Functions | Function logs/RPC wrappers | `edge` | Provider-facing or unauth capture surfaces |

## Event Families

- `activation.*`: signup, onboarding, profile-media activation.
- `events.*`: event discovery, registration, lobby, video-date, feedback.
- `matching.*`: deck, swipe, mutual match, second-message, quality signals.
- `trust.*`: report, block, verification, triage recommendation display.
- `revenue.*`: premium/checkout/purchase/entitlement signals.
- `growth.*`: invite/referral attribution and quality.
- `native_store.*`: native release and deep-link proof.
- `cost.*`: provider usage and unit economics evidence.
- `quality.*`: release/runtime budget observations.
- `experiments.*`: assignment, exposure, and safety stop events.

## Instrumentation Rules

1. Use declared taxonomy names for new P4 instrumentation.
2. Use stable primitive properties only.
3. Do not send freeform text, names, email, phone, media paths, URLs with query strings, report details, chat bodies, IP/address, tokens, secrets, or provider raw payloads.
4. Record experiment assignment through `resolve_experiment_assignment` and exposure through `record_experiment_exposure`.
5. Growth landing/click capture uses `record-growth-attribution` with opaque referral tokens only; signed-in binding uses `claim_growth_attribution`.
6. Product analytics can inform decisions but cannot override Supabase/backend product state.
