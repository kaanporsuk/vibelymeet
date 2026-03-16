# Phase 5 — Real parity audit: Events, discovery, lobby

**Source of truth:** Web app (structure, hierarchy, visual tone, spacing, cards, typography, CTAs, badges, chips, section order, state handling).  
**Compare against:** `apps/mobile` (native).

---

## Native file ownership

| Surface | Web owner(s) | Native owner(s) |
|--------|----------------|------------------|
| Events list | `src/pages/Events.tsx`, `FeaturedEventCard`, `EventsFilterBar`, `EventsRail`, `EventCardPremium`, `ShimmerSkeleton` | `apps/mobile/app/(tabs)/events/index.tsx` (inline FeaturedEventCard, EventRailCard, EventsRail, LocationPromptBanner, EventsSkeleton) |
| Event detail | `src/pages/EventDetails.tsx`, `VenueCard`, `GuestListTeaser`, `GuestListRoster`, `PricingBar`, `MutualVibesSection`, `PaymentModal`, `ManageBookingModal`, `CancelBookingModal`, `TicketStub`, `MiniProfileModal` | `apps/mobile/app/(tabs)/events/[id].tsx` |
| Registration block / CTA | `EventDetails`: PricingBar (sticky), "You're In!" bar, Manage Booking, PaymentModal flow | `events/[id].tsx`: single Register / Cancel / Open lobby VibelyButtons |
| Attendee / guest sections | `GuestListTeaser` (pre-reg: mystery cards, count, lock), `GuestListRoster` (post-reg: avatars, names, ticket CTA) | None |
| Event lobby | `src/pages/EventLobby.tsx`, `LobbyProfileCard`, `LobbyEmptyState`, `ReadyGateOverlay` | `apps/mobile/app/event/[eventId]/lobby.tsx` (inline LobbyProfileCard), `ReadyGateOverlay.tsx` |
| Swipe / discovery deck | `EventLobby`: SwipeableCard, LobbyProfileCard stack, Pass / Super Vibe / Vibe buttons | `lobby.tsx`: stack of LobbyProfileCard, Pass / Super Vibe / Vibe (order fixed in Phase 5) |
| Ready Gate | `src/components/lobby/ReadyGateOverlay.tsx` (timer, partner photo, Ready/Snooze/Skip, useReadyGate) | `apps/mobile/components/lobby/ReadyGateOverlay.tsx` (modal, partner name + optional image, Ready/Skip) |
| Daily Drop | `src/components/matches/DropsTabContent.tsx`, `useDailyDrop` | Matches tab: "Daily Drop" tab with CTA "Open Daily Drop on web" (no in-app deck) |
| Loading / empty / error (events) | Events: FeaturedEventSkeleton + 3× EventsRailSkeleton; filter empty: "No events found" + copy; EventDetails: Loader2 full screen; error: "Event not found" + Back | Native: EventsSkeleton (hero + 1 rail); EmptyState for filter empty; event detail: LoadingState / ErrorState |
| Loading / empty / error (lobby) | EventLobby: spinner; empty: LobbyEmptyState ("You've seen everyone…", Refresh) | lobby.tsx: LoadingState "Loading deck…"; empty: EmptyState "No one to show…", Refresh |

---

## 1. Events list

| Element | Web | Native | Gap (impact × leverage) |
|--------|-----|--------|-------------------------|
| Header | pt-safe-top, Calendar icon in rounded bg-primary/10, "Discover Events" (font-display 2xl), subtitle "Find your next vibe match" | GlassHeaderBar, icon box accentSoft, same title/subtitle | **Aligned.** |
| Location prompt | LocationPromptBanner when hasLocation === false | Shell (showLocationPrompt flag); no profile location check | **Low:** Native is shell only. |
| Filter bar | EventsFilterBar: sticky, search (rounded-2xl, pl-12), Filters toggle + date chips (Tonight, This Weekend, This Week, Upcoming), interest chips expandable, "Clear all" | Search + horizontal DATE_FILTERS chips, clear all | **Medium:** No sticky hide-on-scroll; no interest filters; same date filters. |
| Featured hero | FeaturedEventCard: 420–480px, dual gradient overlay, Live/Featured/Ended badge, countdown (when not live), tags (neon-violet), title 3xl/4xl, description, real attendee avatars, "Get Tickets" | FeaturedEventCard: 376px, single gradient, Live/Featured, tags (tint), title 24, +N going (placeholder circles), "Get Tickets" | **Medium:** No countdown on hero; placeholder avatars vs real; height/badge styling. |
| Rail grouping | Live Now; Near You (scope local); Global Events; In Your Region (scope regional) | Live Now; Upcoming (or "Discover") — no scope | **High impact, medium leverage:** Scope-based rails need scope in API. |
| Rail cards | EventCardPremium: image, scope badge, date/time, attendees, tags, status, Register CTA | EventRailCard: image, live badge, tags, title, meta, avatar row, Register | **Low:** Structure similar; scope/location on card missing on native. |
| Filtered results | Grid or list, "X events found"; empty: icon, "No events found", "Try adjusting…" | Horizontal scroll of rail cards; empty: EmptyState | **Low:** Native empty copy can match; grid vs horizontal is UX choice. |
| Empty (no events) | "No events near you yet 💫", "But there are…", "Go Premium to explore" button | Same idea, "Go Premium to explore" | **Aligned.** |
| Happening Elsewhere | HappeningElsewhere: blurred city cards + Premium CTA card | Section + premium card, "Explore with Premium" | **Aligned.** |
| Loading | FeaturedEventSkeleton + 3× EventsRailSkeleton (px-4 space-y-8) | EventsSkeleton: hero + 1 rail | **Low:** Native could add 2 more rail skeletons. |
| Error | (Not shown in Events.tsx; likely parent or toast) | ErrorState full screen | **Aligned.** |
| Retry / refresh | (Refetch via data layer) | RefreshControl on ScrollView | **Aligned.** |

---

## 2. Event detail

| Element | Web | Native | Gap (impact × leverage) |
|--------|-----|--------|-------------------------|
| Header | Absolute top: back + share (glass), over hero | GlassHeaderBar: back + title | **Medium:** No share; structure aligned. |
| Hero | Parallax 16/9 max-h 50vh, dual gradient, category + vibe match %, title 2xl, date/time | Cover 220h, bottom gradient, no overlaid title/date on image | **Medium:** Native has gradient; no overlaid hero text (deferred). |
| Location/scope | Line under hero: MapPin + city/country or Globe "Global Event" | None | **Medium:** Need scope/city in API. |
| Recurring | "Part of a recurring series" + Next link | None | **Low.** |
| Tags | Pills: bg-primary/10 border-primary/30 | Pills: tintSoft + tint | **Aligned.** |
| About | "About This Event" (h2), then description | Description only in info card | **High leverage:** Add "About This Event" heading. |
| Guest / attendee | **Pre-reg:** GuestListTeaser — "Who's Going", lock, count, 6 mystery (blurred) cards + vibe tags. **Post-reg:** GuestListRoster — avatars, names, ticket CTA | None | **High impact, high leverage:** Add "Who's going" block with count + lock (current_attendees); roster needs attendee API. |
| Venue | VenueCard (virtual/place, address, date, Join/Details) | None | **Medium.** |
| Mutual vibes | MutualVibesSection (registered, mutual vibes) | None | **Low.** |
| Registration CTA (not registered) | **PricingBar** (sticky): price (Free/€X), capacity status (Spots / Filling Fast / Only N left), gender label, "Get my spot" primary CTA → PaymentModal or free register | Single VibelyButton "Register" | **High impact, medium leverage:** Price/capacity need API; can style CTA block. |
| Registered state | "You're In!" sticky bar (sparkles, "See you there", Manage Booking) + Cancel registration + Open lobby | Cancel + Open lobby buttons only | **Medium:** Add "You're in" style block (no new API). |
| Loading | Loader2 full screen | LoadingState | **Aligned.** |
| Error | "Event not found", "This event may have been removed…", Back to Events | ErrorState same idea | **Aligned.** |

---

## 3. Event registration block / CTA treatment

| Element | Web | Native | Gap |
|--------|-----|--------|-----|
| Not registered | Sticky PricingBar: price, capacity pill, primary CTA | Single primary Register button | **Gap:** No sticky bar, no price/capacity. |
| Registering | (Button loading in PaymentModal flow) | VibelyButton loading state | **Aligned.** |
| Registered | Sticky "You're In!" bar + Manage Booking; Cancel + lobby elsewhere | Two buttons: Cancel registration, Open lobby | **Gap:** No "You're in" bar. |
| Paid flow | PaymentModal, Stripe; free: direct register | registerForEvent (backend-owned); no payment UI on native | **Out of scope:** Payment on native may be separate. |

---

## 4. Attendee / guest sections

| Element | Web | Native | Gap |
|--------|-----|--------|-----|
| Pre-registration | GuestListTeaser: "Who's Going", lock, "{N} attending", 6 blurred mystery cards + vibe tags | None | **Gap:** Add teaser (count + lock + optional copy). |
| Post-registration | GuestListRoster: list with avatars, names, ticket CTA | None | **Gap:** Needs attendee list API (useEventAttendees). |
| Section order | After tags/description; before Venue | N/A | — |

---

## 5. Event lobby

| Element | Web | Native | Gap |
|--------|-----|--------|-----|
| Top bar | Sticky glass, back, title + LIVE pill, countdown + PremiumPill | GlassHeaderBar, back, title + LIVE, countdown | **Aligned** (Phase 5). |
| Deck | 3/4 aspect max 65vh, 3 stacked cards (scale/opacity), SwipeableCard | 3/4 max 55vh, 3 stacked LobbyProfileCard | **Low:** Swipe gesture vs tap-only. |
| LobbyProfileCard | Photo, gradient bottom, Super Vibe badge, Premium, "In a date", name+age, job/location, shared vibes | Photo, bottom gradient, name+age, tagline/job | **Medium:** No Super Vibe/Premium/In a date badges. |
| Actions | Pass (X), Super Vibe (Star), Vibe (Heart) — left to right | Same order (Phase 5) | **Aligned.** |
| Empty | LobbyEmptyState: "You've seen everyone…", "More people are joining…", Refresh | EmptyState: "No one to show…", "deck refreshes every 15s", Refresh | **Low:** Copy nuance. |
| Loading | Spinner | LoadingState "Loading deck…" | **Aligned.** |

---

## 6. Swipe / discovery deck cards

| Element | Web | Native | Gap |
|--------|-----|--------|-----|
| Card content | LobbyProfileCard (see above) | Inline LobbyProfileCard (name, age, tagline, job) | **Medium:** Badges, shared vibes. |
| Swipe | Framer Motion drag, Pass/Vibe stamp on exit | Tap only | **Nice-to-have.** |
| Deck meta | (Implicit) | "X of Y in deck" | **Aligned.** |

---

## 7. Ready Gate visible surface

| Element | Web | Native | Gap |
|--------|-----|--------|-----|
| Backdrop | Dark overlay | Modal, dark backdrop | **Aligned.** |
| Content | useReadyGate: timer, partner photo, shared vibes, Ready / Snooze / Skip | Title, "You matched with {name}!", partner image or placeholder, Ready, Skip | **Medium:** No timer, no snooze, no shared vibes. |
| Partner photo | Fetched from session | Passed from lobby on match (Phase 5) | **Aligned.** |

---

## 8. Daily Drop visible surface

| Element | Web | Native | Gap |
|--------|-----|--------|-----|
| Tab | Matches: "Daily Drop" tab, DropsTabContent | Matches: "Daily Drop" tab | **Aligned.** |
| Content | useDailyDrop: drop card, partner, status, opener/reply, pass, past drops, loading/empty/expired/passed states | Single card: "Get a fresh batch…", "Open Daily Drop on web" CTA | **Out of scope:** No in-app Daily Drop deck; web-only. |

---

## 9. Loading / empty / error / retry (by screen)

| Screen | Web | Native | Gap |
|--------|-----|--------|-----|
| Events list | FeaturedEventSkeleton + 3 rails; filter empty: icon + "No events found" + copy; refetch via data | EventsSkeleton (1 hero + 1 rail); EmptyState; RefreshControl | **Low:** Extra rail skeletons; empty copy. |
| Event detail | Loader2; "Event not found" + Back | LoadingState; ErrorState + Back to events | **Aligned.** |
| Lobby | Spinner; LobbyEmptyState + Refresh | LoadingState; EmptyState + Refresh | **Aligned.** |
| Ready Gate | (Inside overlay) | Modal with Ready/Skip | **Aligned.** |

---

## 10. Gaps ranked by visible impact × implementation leverage

**High impact, high leverage (do first)**  
1. **Event detail — "About This Event" heading** above description (native has description only).  
2. **Event detail — "Who's going" teaser** block: "Who's Going", lock icon, "{event.current_attendees} attending" (no roster, no new API).

**High impact, medium leverage**  
3. **Event detail — Registration/CTA block:** When registered, add a clear "You're in" style block (icon + "You're In!" + "See you there") above Cancel/Open lobby; keep existing buttons.  
4. **Events list — Rail grouping:** Near You / Global / In Your Region would need scope (and optionally location) in events API; defer or small API extension.

**Medium impact**  
5. **Event detail — Share button** in header.  
6. **Event detail — Sticky pricing/capacity bar** when not registered (needs price/capacity from API).  
7. **Lobby — LobbyProfileCard:** Super Vibe badge, Premium, "In a date" (needs data).  
8. **Ready Gate:** Timer, snooze (needs useReadyGate-style backend).

**Low / deferred**  
9. Events list: location prompt behavior, interest filters, hero countdown.  
10. Event detail: location/scope line, recurring, VenueCard, MutualVibesSection, GuestListRoster (attendee API).  
11. Daily Drop: in-app deck (out of scope).

---

## 11. First implementation slice (immediate)

1. **Event detail**  
   - Add **"About This Event"** heading above the description in the info card.  
   - Add **"Who's going"** teaser section: icon row (Users + Lock), title "Who's Going", subtitle "{current_attendees} attending" (from `event.current_attendees`). No new API.  
   - When **registered**, add a short **"You're in"** block (e.g. Card or View with sparkles icon, "You're in!", "See you there") above the Cancel / Open lobby buttons.

No new architecture, no provider changes, no backend ownership change. Uses only existing `useEventDetails` / `useIsRegisteredForEvent` data.
