# Sprint 4 — Parity surfaces and web handoff audit

| Feature | Live on web? | Documented? | Native status now | Can implement safely this sprint? | Decision |
|---------|--------------|-------------|-------------------|-----------------------------------|----------|
| **Public profile** (`/user/:userId`) | Yes (UserProfile) | Yes | No route | Yes — read profiles + profile_vibes by id; same contract | **Implement now** |
| **Schedule** | Yes (Schedule + VibeSchedule, date_proposals) | Yes | Handoff (Alert + link) | No — backend (slots, proposals, useSchedule) is substantial | **Keep handoff** (explicit copy) |
| **Match celebration** | Yes (MatchCelebration page + MutualMatchCelebration in PostDateSurvey) | Yes | No screen | Yes — minimal screen + wire from matches (unread → celebration → chat) | **Implement now** |
| **Credits** | Yes (Credits page, create-credits-checkout → Stripe) | Yes | Balance + "Get credits on web" | Yes — pack selection + EF → open URL; payment on web (Stripe) | **Implement now** (native entry, payment in browser) |
| **Profile preview** (own profile as others see) | Yes | Yes | Alert + link to web | Optional — would mirror public profile view for self | **Keep handoff** |
| **Account settings** (password, pause, etc.) | Yes | Yes | Link to web | No new backend; UI-heavy | **Keep handoff** |
| **Notification toggles** (quiet hours, etc.) | Yes | Yes | Link to web | Backend exists; UI scope | **Keep handoff** |
| **Daily Drop** (empty state) | Yes | Yes | "Coming to mobile" + link | Separate feature | **Keep handoff** |

No Supabase functions, migrations, or DB/cloud config changed this sprint.
