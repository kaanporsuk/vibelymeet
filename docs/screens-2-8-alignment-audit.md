# Screens 2–8 final line-by-line alignment audit

## Summary

Full file reads were performed for **Events list** (Screen 2) and **Event detail** (Screen 3). Targeted fixes were applied; Screens 4–8 were compared at key points and documented. Remaining gaps that need screenshot or product review are listed per screen.

---

## SCREEN 2: Events list — fixes applied

| Item | Web | Native (before) | Fix |
|------|-----|-----------------|-----|
| Date format on cards | `toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })` → "Sat, Mar 22"; time with hour12 | `toLocaleDateString(undefined, …)` / `toLocaleTimeString(undefined, …)` | **eventsApi.ts:** Added `formatEventDate()` → "Sat, Mar 22" and `formatEventTime()` → "8:00 PM" (en-US, minute, hour12). Used in useEvents map and rowToEventListItem. |
| Date · time separator | " · " (middle dot) | " • " (bullet) | **events/index.tsx:** Rail card and discover meta use " · ". |
| Empty state (no events) | "No events near you yet 💫" + "But there are events happening in other cities!" + "Go Premium to explore →" | Different copy / EmptyState | **events/index.tsx:** Custom block with same title, subtitle, and CTA label. |
| Empty state (filters) | "No events found" + "Try adjusting your filters or search terms" | EmptyState component | **events/index.tsx:** Custom filteredEmpty view with same two lines. |
| Happening Elsewhere | useOtherCityEvents(); only when cities.length > 0; blurred city cards + CTA "Explore with Premium →" | Static "Happening Elsewhere" + single CTA card | **events/index.tsx:** useOtherCityEvents(user?.id); section only when otherCities.length > 0; horizontal city cards (image/placeholder + city name + count) + same CTA card. |
| Premium CTA destination | Web navigates to /premium | router.push('/premium') | Unchanged; already matches. |

**Remaining (screenshot/review):** Card width 280/320 vs native CARD_WIDTH; EventCardPremium vibe match badge and scope (city/global) not in native useEvents payload so not shown on rail cards; blur on city cards (web filter: blur(8px)) — native uses solid overlay.

---

## SCREEN 3: Event detail — fixes applied

| Item | Web | Native (before) | Fix |
|------|-----|-----------------|-----|
| Date row format | formatDate(event.eventDate) → weekday long, month long, day numeric ("Saturday, March 22") | toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) | **[id].tsx:** dateStr = format(eventDate, 'EEEE, MMMM d'); timeStr = format(eventDate, 'h:mm a'). |
| Time row format | event.time (from hook, formatted) | toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) | Same as above: timeStr = format(eventDate, 'h:mm a'). |

**Remaining (screenshot/review):** Cover aspect 16/9 max 50vh vs native min(280, 0.4*height); gradient from-background via-background/60 to-transparent vs native rgba(0,0,0,0.5); back button glass + ArrowLeft w-5 h-5; description "Read more" expand (web has none in read); registration button labels per state (Register / View Ticket / Enter Lobby / Manage Booking); gender-based price display in PricingBar.

---

## SCREEN 4: Event lobby

**Checked:** Lobby profile card vibe tags already limited to 3 + "+N" (web parity). Card aspect, overlay, and action button sizes were not changed in this pass.

**Remaining:** Card width/height from web (e.g. % of viewport); gradient overlay stops; name/age overlay font size and shadow; Pass/Super Vibe/Vibe button exact sizes and icons; empty state copy and Mystery Match CTA.

---

## SCREEN 5: Matches

**Checked:** Tab labels "Conversations" / "Daily Drop"; search placeholder "Search by name or vibe..." — already aligned.

**Remaining:** Tab indicator style (underline vs pill); match row time format (web relative: "2m" / "3h" / "Yesterday"); unread dot size/color; Who Liked You gate blur and CTA styling; sort dropdown options; archived section layout.

---

## SCREEN 6: Chat

**Checked:** Input placeholder "Type a message..." already set in a previous pass.

**Remaining:** Sent/received bubble colors and corner radii; padding and max width; timestamp format and position; voice message UI; send button icon and disabled state; attachment row order; "Suggest a date" chip visibility.

---

## SCREEN 7: Profile

**Remaining:** Hero photo size and borderRadius; edit button overlay; name+age format and font; verification badges layout; Vibe Score ring size and stroke; stats row; photo grid columns and add button; bio/prompts/lifestyle section styling; vibe video thumbnail and "Record" CTA; settings gear position.

---

## SCREEN 8: Settings

**Checked:** Section cards, SettingsRow usage, Premium/Credits/Notifications/Account/Quick links/Log out/Danger zone — structure aligned. Web has no app version in code; native has none.

**Remaining:** Row height/padding exact values; icon size 20 vs 18 in some rows; divider styling; "Log Out" vs "Log out" copy.

---

## Files changed (this pass)

- **apps/mobile/lib/eventsApi.ts** — formatEventDate(), formatEventTime(); use in useEvents and rowToEventListItem.
- **apps/mobile/app/(tabs)/events/index.tsx** — useOtherCityEvents; Happening Elsewhere only when otherCities.length > 0; city cards rail; empty states (no events, no filter results); date · time separator; remove EmptyState import.
- **apps/mobile/app/(tabs)/events/[id].tsx** — date-fns format; dateStr = format(eventDate, 'EEEE, MMMM d'); timeStr = format(eventDate, 'h:mm a').

---

## Counts

- **Screen 2:** 6 substantive fixes.
- **Screen 3:** 2 substantive fixes.
- **Screens 4–8:** 0 code changes this pass; gaps documented for follow-up.

---

## Verification

`npx tsc --noEmit` in apps/mobile: **pass**.
