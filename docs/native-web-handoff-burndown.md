# Native web handoff burn-down (Sprint 4)

Consumer-facing surfaces that still hand off to web, and justification. Intentional handoffs are documented; no vague "do this on web" without a clear link or reason.

---

## Remaining handoffs (intentional for launch)

| Surface | Where | Action | Justification |
|--------|--------|--------|----------------|
| **Schedule** | Profile → My Vibe Schedule | Alert + "Open schedule on web" → vibelymeet.com/schedule | Schedule backend (slots, date_proposals, useSchedule) is substantial; not in Sprint 4 scope. Copy is explicit. |
| **Profile preview** (own profile as others see) | Profile → eye icon | Alert + "Open on web" → vibelymeet.com/profile | Optional parity; native public profile exists for *other* users. Own preview can follow later. |
| **Account settings** (password, pause, etc.) | Settings → Account | "Open account settings on web" → vibelymeet.com/settings | Full account UI (password change, pause/resume) remains web; no new backend. |
| **Notification toggles** (quiet hours, sounds) | Settings → Notifications | "Open notification settings on web" → vibelymeet.com/settings | Backend exists; full UI scope deferred. Copy explicit. |
| **Daily Drop** (empty state) | Matches → Daily Drop tab | "Daily Drop is coming to mobile soon" + "Open on web" → vibelymeet.com/matches | Separate feature; not in Sprint 4. |
| **Reset password** | Auth reset flow | "Use the web app to reset your password: vibelymeet.com" | Auth flow; link is explicit. |
| **How it works / Help / Privacy / Terms** | Settings quick actions | Links to vibelymeet.com/… | Legal and marketing content; web-only by design. |

---

## Implemented or improved in Sprint 4

| Surface | Change |
|--------|--------|
| **Public profile** | Native `/user/:userId` screen; entry from chat "View profile". |
| **Match celebration** | Native match-celebration screen; wired from matches list (unread → celebration → Message → chat). |
| **Credits** | Native pack selection + create-credits-checkout → open Stripe URL; copy: "Payment is processed on web (Stripe)." |
| **Schedule** | Copy made explicit: "Manage on web", "Open schedule on web". |

---

## Summary

- **No dead-end copy:** Every consumer handoff has a clear action (open web link or explicit message).
- **Credits:** Native entry (pack choice + checkout URL); payment in browser is intentional (Stripe).
- **Schedule, account, notifications, Daily Drop, profile preview, reset password, legal/marketing:** Remain web handoff with explicit copy for launch.
