# Phase 5 — Events, discovery, and lobby parity audit

**Web source:** `src/pages/Events.tsx`, `EventDetails.tsx`, `EventLobby.tsx`, `FeaturedEventCard`, `EventCardPremium`, `EventsRail`, `LobbyProfileCard`, `ReadyGateOverlay`, `GuestListTeaser`, `PricingBar`.  
**Native source:** `apps/mobile/app/(tabs)/events/index.tsx`, `events/[id].tsx`, `event/[eventId]/lobby.tsx`, `components/lobby/ReadyGateOverlay.tsx`, `lib/eventsApi.ts`.

---

## 1. Events list

| Area | Web | Native | Gap |
|------|-----|--------|-----|
| Header | Sticky glass-card, Calendar + "Events", filter/sort | GlassHeaderBar, calendar icon, "Discover Events" + subtitle | Native uses "Discover Events"; web "Events". Minor copy. |
| Location prompt | LocationPromptBanner (Enable / Not now) | Location prompt shell (dismiss, Enable placeholder) | Aligned (shell). |
| Filter bar | EventsFilterBar (search, date filters) | Search + DATE_FILTERS chips | Aligned. |
| Featured hero | FeaturedEventCard: 420–480px, gradient overlay, Live/Featured badge, tags, title, desc, attendees, Get Tickets | FeaturedEventCard: 376px, gradient overlay, Live/Featured, tags, title, desc, +N going, Get Tickets | Close; native slightly smaller. |
| Live Now rail | EventsRail "Live Now" 🔴 | EventsRail "Live Now" 🔴 | Aligned. |
| Upcoming rail | EventsRail "Upcoming" / "Discover" | EventsRail "Upcoming" / "Discover" | Aligned. |
| Empty | "No events near you yet" + Premium CTA | Same idea | Aligned. |
| Happening Elsewhere | Blurred city cards + Premium CTA card | Section + Premium card | Aligned. |
| Scroll bottom | pb-24 for nav | bottomSpacer 96/88 | Use layout.scrollContentPaddingBottomTab for consistency. |
| Loading | FeaturedEventSkeleton + EventsRailSkeleton | EventsSkeleton (hero + rail) | Aligned. |

**Must-fix:** Scroll content padding for tab bar (`layout.scrollContentPaddingBottomTab`).

---

## 2. Event detail

| Area | Web | Native | Gap |
|------|-----|--------|-----|
| Header | Absolute top: back + share (glass) | GlassSurface: back + title | **Must-fix:** Use GlassHeaderBar; add share (optional). |
| Hero | Parallax 16/9, gradient overlay, category + vibe %, title, date/time | Cover image 220h, no gradient | **Must-fix:** Gradient overlay on cover. |
| Tags | Pills below hero | None | **Must-fix:** Tags row when event.tags?.length. |
| Content | Location/scope, recurring, description, Guest list, PricingBar, Register CTA | Info card (title, date, time, duration, attendees, description), Register/Cancel/Open lobby | Capacity/pricing deferred. Add tags; keep CTAs. |
| Bottom padding | pb-28 | paddingBottom: 48 | Use layout constant. |

**Must-fix:** GlassHeaderBar, gradient overlay on cover, tags row, bottom padding.

---

## 3. Lobby / deck

| Area | Web | Native | Gap |
|------|-----|--------|-----|
| Header | Sticky glass: back, title, LIVE pill, countdown, PremiumPill | GlassSurface: back, title, LIVE, countdown | **Must-fix:** Use GlassHeaderBar. |
| Card stack | 3/4 aspect, max 65vh, 3 layers (scale/opacity), SwipeableCard | 3/4 aspect, max 55vh, 3 layers | Aligned. |
| LobbyProfileCard | Photo, gradient bottom, Super Vibe badge, Premium, "In a date", name+age, job/location, shared vibes | Photo, bottom gradient, name+age, tagline/job | **Polish:** Stronger gradient, name/age prominence (web: text-2xl bold). |
| Actions | Pass (X), Super Vibe (Star), Vibe (Heart) — left to right | Pass, Vibe, Super Vibe | **Must-fix:** Order to Pass, Super Vibe, Vibe (web order). |
| Empty | LobbyEmptyState + refresh | EmptyState + Refresh | Aligned. |
| Ready Gate | Overlay with timer, partner photo, Ready/Skip/Snooze | Modal: partner name, placeholder avatar, Ready/Skip | **Polish:** Show partner avatar when lobby passes image. |

**Must-fix:** GlassHeaderBar, action button order. **Polish:** Card gradient/typography, Ready Gate partner avatar.

---

## 4. Ready Gate

| Area | Web | Native | Gap |
|------|-----|--------|-----|
| Backdrop | Dark overlay | Modal transparent, dark backdrop | Aligned. |
| Content | useReadyGate: timer, partner photo, shared vibes, Ready/Snooze/Skip | Title, subtitle, placeholder circle, Ready, Skip | **Polish:** Partner avatar from session/lobby when available. |
| Backend | ready_gate_transition, video_sessions | Same flow; native passes sessionId, onReady → date | No change. |

**Polish:** Accept optional partnerImageUrl in ReadyGateOverlay; lobby passes current profile avatar on match.

---

## 5. Daily Drop visible shell

Web: Matches tab has "Daily Drop" tab and DropsTabContent. Native: Matches has Daily Drop tab with "Open Daily Drop on web" CTA. No in-app deck in Phase 5 scope. **Out of scope.**

---

## 6. Highest-impact implementation order

1. **Event detail** — GlassHeaderBar, gradient overlay on cover, tags row, scroll padding.
2. **Events list** — Scroll content padding for tab bar.
3. **Lobby** — GlassHeaderBar, action order Pass → Super Vibe → Vibe.
4. **Lobby card** — Gradient and name/age typography (optional).
5. **Ready Gate** — Optional partner avatar prop; lobby passes image on match.
