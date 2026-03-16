# Sprint C — Matches, chat, and monetization — Closure report

## Sprint C status: **complete**

All major code-inferable gaps for matches, chat, and monetization are closed within `apps/mobile`. Layer 1 is effectively complete; remaining work is mostly screenshot-led parity, polish, and edge cases.

---

## Exact scope completed

### A) Matches actions completion
- **Hooks**: `useUnmatch`, `useBlockUser`, `useArchiveMatch`, `useMuteMatch` (native, same contracts as web).
- **Matches list**: Main list shows only non-archived matches (`archived_at` null). Long-press on a row opens **MatchActionsSheet** with: Archive / Unarchive, Mute / Unmute (1 day), Report, Block, Unmatch. Destructive actions use `Alert.alert` confirm; list and cache invalidate after success.
- **Chat**: Header overflow (⋯) opens same **MatchActionsSheet**; Unmatch/Block navigate back after success.
- **Profile (user/[userId])**: Message (if match), Report, Block, Unmatch with confirmations; **ReportFlowModal** for report.

### B) Profile drawer completion
- **Public profile** (`/user/[userId]`): Photo gallery, name/age, tagline, job, location, Looking for, About, Vibes. **Actions**: Message (if match), Report, Block, Unmatch. No separate “drawer” component; full-screen profile is the drawer equivalent.

### C) Report flow
- **ReportFlowModal**: Reason selection (harassment, fake, inappropriate, vibe), optional details, “Also block” toggle. Submits to `user_reports` and optionally inserts into `blocked_users` (same as web ReportWizard).
- **reportApi.ts**: `submitReport()` and `REPORT_REASONS`. Entry points: match row long-press → Report, chat overflow → Report, profile → Report.

### D) Drops tab completion
- Drops tab unchanged: “Daily Drop” card with copy and **“Open Daily Drop on web”** → `https://vibelymeet.com/matches`. No native Daily Drop flow; web handoff is explicit.

### E) Chat date proposals / scheduling
- **“Propose date”** and **“Games”** quick actions above the composer: open `https://vibelymeet.com/schedule` and `https://vibelymeet.com/matches` respectively. No in-thread proposal cards or native proposal creation; scheduling remains web-led with clear handoff.

### F) Credits flow return handling
- **Credits screen**: `useFocusEffect` refetches `user_credits` when the screen gains focus (return from browser). Copy updated to: “Return to this screen after payment — your balance will refresh automatically.” No deep-link or URL params; refetch on focus is the return handling.

### G) In-app notification preferences
- **useNotificationPreferences**: Fetches `notification_preferences` (notify_new_match, notify_messages, notify_date_reminder, notify_event_reminder, notify_ready_gate, notify_daily_drop, notify_product_updates). `toggle(key)` upserts single column.
- **Settings → Notifications**: Section “What to notify” with Switch rows for each toggle; quiet hours / sounds still link to web.

### H) Arcade/game fallback
- **Chat**: “Games” quick action opens web matches (product surface for games). No native arcade; no broken placeholder.

### I) Visual and UX
- MatchActionsSheet and ReportFlowModal use glass/neon styling, safe areas, and clear hierarchy. No admin/debug UI; no dead rows or buttons.

---

## Exact files changed

| File | Change |
|------|--------|
| `apps/mobile/lib/useUnmatch.ts` | **New**. Unmatch mutation (messages, date_proposals, match delete). |
| `apps/mobile/lib/useBlockUser.ts` | **New**. Block/unblock, optional match delete; isUserBlocked. |
| `apps/mobile/lib/useArchiveMatch.ts` | **New**. Archive/unarchive match (archived_at/archived_by). |
| `apps/mobile/lib/useMuteMatch.ts` | **New**. Mute/unmute (match_mutes, match_notification_mutes), 1h/1d/1w/forever. |
| `apps/mobile/lib/reportApi.ts` | **New**. submitReport, REPORT_REASONS; user_reports + optional block. |
| `apps/mobile/lib/useNotificationPreferences.ts` | **New**. Fetch/update notification_preferences toggles. |
| `apps/mobile/lib/chatApi.ts` | MatchListItem + archived_at; select archived_at in query. |
| `apps/mobile/components/match/MatchActionsSheet.tsx` | **New**. Sheet: Unmatch, Archive, Mute, Report, Block. |
| `apps/mobile/components/match/ReportFlowModal.tsx` | **New**. Reason → details → also block → submit. |
| `apps/mobile/app/(tabs)/matches/index.tsx` | activeMatches filter, long-press → sheet, report modal, handlers. |
| `apps/mobile/app/chat/[id].tsx` | Header overflow → MatchActionsSheet, ReportFlowModal, Propose date / Games links. |
| `apps/mobile/app/user/[userId].tsx` | Message, Report, Block, Unmatch; ReportFlowModal. |
| `apps/mobile/app/settings/credits.tsx` | useFocusEffect refetch; return copy. |
| `apps/mobile/app/settings/notifications.tsx` | useNotificationPreferences; “What to notify” toggles. |

---

## Exact behaviors now working

1. **Matches**: Long-press row → Unmatch (with confirm), Archive, Mute 1 day, Report, Block (with confirm). Archived matches excluded from main list. Report opens modal; submit updates user_reports and optionally blocks.
2. **Chat**: Header ⋯ → same actions; Unmatch/Block then navigate back. “Propose date” and “Games” open web.
3. **Profile**: Message (if match), Report, Block, Unmatch with confirmations; report flow in modal.
4. **Credits**: Refetch balance when Credits screen is focused (return from Stripe).
5. **Notifications**: Toggles for messages, new match, date/event reminders, ready gate, daily drop, product updates; persist to notification_preferences.

---

## Anything still blocked and why

- **In-thread date proposal cards**: Web uses local state + schedule UI; native uses “Propose date” → web. Backend `date_proposals` exists; a future pass could add native create + list per match.
- **Archived list in Matches**: Only active matches shown; no “Archived” tab or section. Adding a filter/tab would be a small UX addition.
- **Deep link after credits purchase**: No URL/scheme handling; return handling is refetch on focus only.
- **Native arcade/games**: No implementation; “Games” links to web. No backend change.

---

## Layer 1 complete and ready for manual screenshot refinement

Yes. After Sprint C:

- Match management (unmatch, archive, block, mute, report) is implemented and wired in list, chat, and profile.
- Profile has actions and report flow; credits return is handled by refetch on focus; notification toggles persist.
- Drops and date scheduling use explicit web handoffs; arcade uses a single web link.

Remaining work is mainly:

- Screenshot-led visual and copy parity.
- Optional: in-thread proposal cards, archived section, deep link for credits success.
- Edge cases and platform-specific polish.

---

*Generated after Sprint C implementation. TypeScript: `npx tsc --noEmit` passes.*
