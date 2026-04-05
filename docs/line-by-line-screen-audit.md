# Line-by-line web vs native screen audit

## Scope

Full file reads were performed for **Dashboard** (web `Dashboard.tsx` vs native `(tabs)/index.tsx`). Other screens were spot-checked where parity was already high (e.g. Events header/subtitle). Remaining screens have **documented deltas** below; many require visual QA or large refactors (Chat bubbles, Profile hero sizing, Settings drawer vs stack).

---

## SCREEN 1: Dashboard — differences addressed

| Area | Web | Native (before) | Fix |
|------|-----|-----------------|-----|
| Other cities nudge | Premium upsell card with counts, cities, **Go Premium →** → `/events` | Missing | Added `useOtherCityEvents` + card matching web copy and navigation to `/events`. |
| MiniDateCountdown tap | `/schedule` | `/matches` | Opens `https://vibelymeet.com/schedule`. |
| DateReminderCard Join | Prefers `/date/:id` when an active session is known; else `/schedule` | Prefers `/date/:id` when an active session is known; else opens match chat fallback | Contextual join handler wired on both platforms. |
| Live section | Enter Lobby only | Extra “View event details” | Removed secondary link. |
| Next event (registered) | No bottom CTA; whole card navigates | “View event” button | **View & Register** only when **not** registered (matches web). |
| No upcoming events | Single muted line + ghost **Browse Events** | EmptyState component | Plain text + text button (same copy). |
| Matches empty | One paragraph + outline **Browse Events →** | Title/message split | Single **No matches yet. Join an event…** + bordered button. |
| “X new” pill | `neon-pink` styling | Generic accent | Uses `theme.neonPink` at ~20% bg. |

**Still different (by platform):** Header notification uses `NotificationPermissionButton` + unread count on web; native uses bell + static dot. Active session banner ordering vs web. Live badge: web **Radio** icon + framer pulse; native **PulsingLiveDot**. Next-event media: web `h-36`; native `height: 144` (same). Countdown: web `w-14 h-14` (56); native 56×56.

---

## SCREEN 2: Events list

Header **Discover Events** / **Find your next vibe match**, search placeholder, and filter chips **Tonight / This Weekend / This Week / Upcoming** already aligned on native. Web uses `visible-events` RPC + richer rails (near you / global); native uses `useEvents` — data model differs; no code change this pass.

---

## SCREENS 3–8 (Event detail, Lobby, Matches, Chat, Profile, Settings)

**Not modified in this pass.** Representative gaps:

- **Event detail:** Gradient stops, “Read more” on description, pricing copy per gender.
- **Lobby:** Web `LobbyProfileCard` vs inline native card — already partially aligned (3 vibe tags).
- **Matches:** Tab styling, Who Liked You blur, row time format.
- **Chat:** Bubble corner radii, attachment row, typing “Vibing…”.
- **Profile:** Vibe score ring, gallery columns, settings gear.
- **Settings:** Web drawer rows vs native stack — structural.

---

## Files changed (this pass)

- `apps/mobile/lib/useOtherCityEvents.ts` — new (RPC `get_other_city_events`).
- `apps/mobile/app/(tabs)/index.tsx` — dashboard parity fixes above.

---

## Counts

- **Differences identified (Dashboard deep):** ~12 substantive; **8 fixed** in code; **4** accepted as platform/implementation variance.
- **Screens 2–8:** dozens of potential deltas; **0 bulk fixes** (documented only).

---

## Verification

`npx tsc --noEmit` in `apps/mobile`: **pass**.
