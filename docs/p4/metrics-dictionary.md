# P4 Product Metrics Dictionary

P4 metrics are decision signals, not product-state authority. Supabase/backend contracts remain the source of truth; PostHog and future BI surfaces are analytical only.

## Core Domains

| Domain | Metric | Canonical meaning | Source family | Privacy rule |
|---|---|---|---|---|
| Activation | Verified signups | Profiles created in the window with verified email, phone, or photo evidence | `profiles` | No email/phone export |
| Activation | Onboarding completed | Profiles with onboarding completion evidence | `profiles` | Aggregate only |
| Events | Event registrations | Registration rows, not confirmed attendance | `event_registrations` | User-level access admin-only |
| Events | Lobby participation | Registration/session evidence that a user entered Ready Gate/lobby/date flow | `event_registrations`, `video_sessions` | Aggregate first |
| Events | Event liquidity score | Deterministic score from registrations, capacity, balance, verification, lobby, matches, and reports | `admin_get_event_liquidity_metrics` | Advisory only |
| Matching | Mutual matches | Match rows created in the window | `matches` | No message content |
| Matching | Match quality score | Deterministic score beyond mutual swipe: completion, feedback, messaging, reports/blocks | `admin_get_match_quality_metrics` | Advisory only |
| Trust | Report rate | Reports submitted in the window | `user_reports` | No freeform report text in analytics |
| Trust | Triage risk score | Explainable prioritization from reports, blocks, warnings, suspensions, verification attempts, no-show proxies | `admin_get_trust_triage_queue` | Human review required |
| Revenue | Active subscriptions | Stripe + RevenueCat active/trialing rows | `subscriptions` | Provider IDs admin-only |
| Revenue | Entitlement drift | Profile premium state differs from subscription evidence | `admin_get_entitlement_reconciliation` | Admin-only |
| Growth | Referral claim | Signed-in user claimed an opaque referral token | `invite_attribution_claims` | Token hash only |
| Quality | Budget observation | Release/runtime evidence against a defined budget | `quality_budget_observations` | No raw session replay |
| Cost | Unit economics | Provider cost snapshots divided by product usage proxies | `provider_cost_snapshots`, product tables | Manual/provider evidence only |

## Reporting Defaults

- Reporting timezone: UTC.
- P4 scores are deterministic v1 heuristics.
- Scores never automatically change matching, ranking, moderation, revenue, account deletion, exports, or provider state.
- Missing telemetry means missing telemetry, not a pass or proof of zero activity.

## PII Guardrails

- Analytics event properties must pass through `sanitizeProductIntelligenceProperties`.
- Freeform text, email, phone, names, URLs, tokens, IP/address, photo/media paths, and message/report bodies are blocked.
- Platform, city, event/session/match ids, surface, status, outcome, provider, plan, bucket, and numeric counters are allowed when needed.
