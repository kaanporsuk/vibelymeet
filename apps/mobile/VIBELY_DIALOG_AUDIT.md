# VibelyDialog migration audit (system `Alert` → `VibelyDialog` / `useVibelyDialog`)

All `Alert.alert`, `Alert.prompt`, `ActionSheetIOS`, `alert(`, and `confirm(` usages under `apps/mobile/` (excluding `node_modules`) were removed in favor of `VibelyDialog` or the `useVibelyDialog()` helper.

## Shared component

- **`components/VibelyDialog.tsx`** — `VibelyDialog` + `useVibelyDialog()` (`show`, `hide`, `dialog` fragment).

## Files touched (inventory)

| File | Pattern | Notes |
|------|---------|--------|
| `components/matches/DropsTabContent.tsx` | Wrapper + `showDialog` | Pass confirm, send errors |
| `app/settings/notifications.tsx` | `useVibelyDialog` | Pause/resume/master/quiet-hours errors |
| `app/(onboarding)/index.tsx` | `useVibelyDialog` | Permissions, upload, height, submit errors; `dialog` on all returns |
| `app/event/[eventId]/lobby.tsx` | `useVibelyDialog` | Swipe toasts, offline, generic swipe error; `dialog` on all returns |
| `app/vibe-video-record.tsx` | `useVibelyDialog` | Record, library, upload, poll outcomes, playback; `dialog` on all returns |
| `components/photos/PhotoManageDrawer.tsx` | `useVibelyDialog` | Permissions, max photos, upload, file picker, remove confirm, discard, save |
| `app/settings/account.tsx` | `useVibelyDialog` | Break, delete (2-step premium/non-premium), restore, logout, email/password sheets |
| `app/settings/privacy.tsx` | `useVibelyDialog` | Option sheet save errors; `DiscoveryModeSheet` snooze validation + save |
| `app/(tabs)/profile/ProfileStudio.tsx` | `useVibelyDialog` | Photos, prompts, intent, bio, tagline, details, vibe delete |
| `app/(tabs)/profile/index.legacy.tsx` | `useVibelyDialog` | Legacy profile parity with above patterns |
| `components/chat/games/ScavengerBubble.tsx` | `useVibelyDialog` | Camera/photos permission (plus `ScavengerSnapshot` narrowing fix for `tsc`) |

## Prior migrations (already on branch before this pass)

Other screens/components were already migrated in the same initiative (e.g. chat, events, matches, settings subpages, premium, drawers). This audit file documents the **remaining** batch completed in this session; see `git log` / diff for the full set.

## Verification

- `npx tsc --noEmit` from `apps/mobile/` — pass.
- `grep -rn 'Alert\.alert\|Alert\.prompt' apps/mobile --include='*.tsx' --include='*.ts' --exclude-dir=node_modules` — no matches.
- No `Alert` in `from 'react-native'` imports under app source (same grep scope).
