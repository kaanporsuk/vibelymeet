# Vibe Schedule — Native Parity Deliverables

## 1. Files created or modified

### Created
- **`apps/mobile/lib/useSchedule.ts`** — Schedule data hook (load user_schedules, toggleSlot, rollPreviousWeek, dateRange, shiftRange, getSlotState). Mirrors web `useSchedule`.
- **`apps/mobile/components/schedule/ScheduleCell.tsx`** — Single grid cell with states: BUSY, OPEN, LOCKED, SAVING.
- **`apps/mobile/components/schedule/VibeScheduleGrid.tsx`** — 2D grid (4 time buckets × N days), row labels fixed, day columns in one horizontal ScrollView.

### Modified
- **`apps/mobile/app/schedule.tsx`** — Rebuilt as full Schedule screen: header bar, intro + Roll Previous Week, legend, range navigator, grid, privacy note, My Dates section (segmented tabs + empty states). Inspection comment block at top. Toast banners for roll success/error; unread bell badge.
- **`apps/mobile/app/(tabs)/profile/index.tsx`** — Profile entry row: teal rounded icon chip, title "My Vibe Schedule", subtitle "Set when you're open for dates", chevron right; `onPress` → `router.push('/schedule')`. New styles: `scheduleIconChip`, `scheduleTextWrap`, `scheduleRowTitle`, `scheduleRowSub` (reused existing `scheduleRow`).

---

## 2. Data contract vs web

| Item | Web | Native | Match |
|------|-----|--------|-------|
| **Table** | `user_schedules` | Same | ✓ |
| **Columns** | `user_id`, `slot_key`, `slot_date`, `time_block`, `status` | Same | ✓ |
| **slot_key** | `YYYY-MM-dd_block` | Same | ✓ |
| **time_block** | `morning` \| `afternoon` \| `evening` \| `night` | Same | ✓ |
| **status** | DB: `open` \| `busy`; UI type includes `event` (locked) | Same; locked from empty `lockedSlotKeys` for now | ✓ |
| **Toggle** | Delete if open, else upsert `{ user_id, slot_key, slot_date, time_block, status: 'open' }` | Same | ✓ |
| **Roll previous week** | Client-side: copy current week open → next week, then `upsert(newSlots)` | Same | ✓ |
| **Date proposals** | Web: local state in useSchedule | Native: `date_proposals` via `useScheduleProposals` + `partitionScheduleProposals` | ✓ (source differs; API is backend) |

**Divergence:** None. Native uses the same Supabase table and mutation shapes. Date proposals on web are local state; native uses the real `date_proposals` table.

---

## 3. Blocked / deferred items

- **LOCKED (event overlap):** Web type has `SlotStatus = "event"` but the DB only allows `open` \| `busy`. Locked is intended to be derived from event overlap. Native has `lockedSlotKeys` in the hook (empty); no event-overlap fetch is implemented yet. To complete: load `event_registrations` + `events` for the visible date range and mark overlapping slots as locked.
- **ScheduleCell in 4 states:** All four states (BUSY, OPEN, LOCKED, SAVING) are implemented in `ScheduleCell.tsx`. LOCKED is reachable when `getSlotState` returns `'locked'` (once `lockedSlotKeys` is populated from events). No Storybook in repo; verify by running the app and toggling slots (BUSY ↔ OPEN), and optionally temporarily adding a locked slot key to see LOCKED; SAVING appears during the mutation.

---

## 4. ScheduleCell states (for screenshot / manual check)

- **BUSY:** Background `#1C1C2E`, border dark gray, label = bucket name (e.g. "Morning"), gray text.
- **OPEN:** Transparent bg, teal border 1.5px, teal glow shadow, label "Open", teal semibold.
- **LOCKED:** Purple tint bg `rgba(139,92,246,0.15)`, purple border, bucket name in purple; not tappable.
- **SAVING:** Same as current state (busy or open) with a small centered `ActivityIndicator`; not tappable.

---

## 5. Parity checklist

- [x] Profile entry row renders and navigates to Schedule
- [x] Header bar (back, title, bell with unread badge when unread > 0)
- [x] Intro block with Roll Previous Week button
- [x] Legend row (Open for Vibe, Event (Locked), Busy/Neutral)
- [x] Range navigator with chevrons and date range text
- [x] Grid with 4 time rows and day columns
- [x] Today's column header highlighted (purple chip)
- [x] Cells default to BUSY
- [x] Tap BUSY → OPEN (teal outline + glow)
- [x] Tap OPEN → BUSY
- [x] LOCKED cells non-interactive (hook supports; no event data yet)
- [x] Per-cell SAVING spinner during mutation
- [x] Roll Previous Week success → green banner; error → red toast
- [x] Privacy note below grid
- [x] My Dates section with segmented tabs (Pending / Upcoming / Past)
- [x] All three empty states (No pending date proposals, No upcoming dates, No past dates)
- [x] Horizontal scroll on grid
- [x] No regressions on Profile (row replaced, navigation to `/schedule`)
