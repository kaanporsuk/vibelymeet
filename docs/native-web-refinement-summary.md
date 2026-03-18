# Native ↔ Web refinement pass (2026-03-18)

Deep comparison of rendered content, copy, and structure. Fixes were applied in `apps/mobile/`; remaining gaps need device/screenshot QA.

## Per screen

### 1. Dashboard
| Issues found | Fix applied |
|--------------|-------------|
| Live event merged into “Next Event” card with countdown hidden inconsistently | **Dedicated “Live Now” block** when `status === live` and registered: tall cover, **pulsing LIVE dot**, title + “People vibing right now”, primary **Enter Lobby →**, secondary “View event details” (matches web SECTION 1 vs SECTION 2 split). |
| Non-live next event showed live UI when registered | Countdown + “Next Event” card only when event is **not** in live registered mode. |
| Empty “no events” copy longer than web | Title **No upcoming events**, empty subtitle, CTA **Browse Events** (web ghost button). |
| Matches empty CTA | **Browse Events →** to match web. |
| Date reminder notifications flag | `DateReminderCard` now gets **`notificationsEnabled={pushGranted}`** (was always false). |
| Upcoming rail empty link casing | **Browse Events** capitalization. |
| “X new” pill styling | Softer accent border/fill toward web neon-pink feel. |

**Manual review:** Premium nudge card, exact gradient on live hero vs web glass stack, avatar ring animation on new matches.

### 2. Events list
| Issues found | Fix applied |
|--------------|-------------|
| (Prior state) | Header **Discover Events** / **Find your next vibe match**, filters **Tonight / This Weekend / This Week / Upcoming**, location banner copy already matched web. |

**Manual review:** Featured card badge “Live Now” vs “Live”, rail CTA “Register” vs web card CTAs, city/scope line on cards (needs `city` on `EventListItem` + API).

### 3. Event detail
| Issues found | Fix applied |
|--------------|-------------|
| HTML entity in RN Text | **You're in!** instead of `You&apos;re in!`. |

**Manual review:** Cover aspect, PricingBar capacity colors, ManageBooking/TicketStub microcopy.

### 4. Event lobby
| Issues found | Fix applied |
|--------------|-------------|
| None in this pass | Pass / Super Vibe / Vibe actions already present. |

**Manual review:** 3:4 card ratio, queued-match badge position.

### 5. Matches
| Issues found | Fix applied |
|--------------|-------------|
| None in this pass | Search placeholder already **Search by name or vibe...**. |

**Manual review:** “NEW” rail treatment, tab indicator pixels, archived section.

### 6. Chat
| Issues found | Fix applied |
|--------------|-------------|
| Input placeholder | **Type a message...** (web). **Vibing...** already matched typing line. |

**Manual review:** Bubble radii, voice bubble layout.

### 7. Profile
| Issues found | Fix applied |
|--------------|-------------|
| (Indirect) | Dashboard completeness now uses **vibes + prompts** like web (via `DashboardGreeting`). |

**Manual review:** Hero layout, vibe score ring, edit flows.

### 8. Settings
| Issues found | Fix applied |
|--------------|-------------|
| None | Structure already close (Premium, Credits, Notifications, Privacy, Quick links, Log out). |

**Manual review:** Row icon sizes vs web drawer.

### 9. Auth
| Issues found | Fix applied |
|--------------|-------------|
| Title “Vibely — Sign in” | **Vibely** + **Welcome back! Sign in to continue.** |
| Sign-up | **Create your account to get started.** |
| Toggle link | **Don't have an account? Sign up** (sign-in). |

**Manual review:** Logo image, glass card, gradient button (native uses solid tint).

### 10. Onboarding
| Issues found | Fix applied |
|--------------|-------------|
| Step copy drift vs web identity step | Step 0: **Let's get to know you** / **The basics first, then the fun stuff**, label **First Name**, placeholder **Your first name**. Step 1: **Tell us a bit more** + helper before gender block. |

**Manual review:** Web has 10+ steps (DOB, photos, vibes); native remains shortened — full parity would be a large project.

---

## Summary

| Metric | Count |
|--------|-------|
| **Fixes applied (this pass)** | ~18 targeted edits across 7 files |
| **Remaining manual review** | Events rail metadata, Event detail pricing, Lobby layout, Matches/Daily Drop tabs, Profile hero, Auth visuals, full onboarding parity |
| **Closest parity** | Events list header/filters/location, Settings sections, Chat typing + input placeholder, Lobby actions |
| **Most manual work** | Onboarding depth, Auth visual polish, live event gradients, event cards + city scope |

## Files touched

- `apps/mobile/app/(tabs)/index.tsx` — Live Now section, empty states, date reminders, match pill
- `apps/mobile/components/DashboardGreeting.tsx` — Profile completeness = web (vibes, prompts)
- `apps/mobile/app/(tabs)/events/[id].tsx` — You're in! copy
- `apps/mobile/app/chat/[id].tsx` — Input placeholder
- `apps/mobile/app/(auth)/sign-in.tsx`, `sign-up.tsx` — Branding + subtitles + link copy
- `apps/mobile/app/(onboarding)/index.tsx` — Step titles / first name copy
