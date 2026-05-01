# Screenshot-Led Native Visual Parity Capture Plan

Date: 2026-05-01
Branch: `fix/screenshot-led-native-visual-parity`

## Principle

Web is the visual and product source of truth for this pass. Native fixes should only be made from screenshot evidence or from obvious code-level parity defects that can be tied to an existing web/native contract. Do not infer visual differences from memory, preference, or design taste.

## Screenshot Inventory

No comparable web/native screen captures were present in the repository at the start of this stream.

The only committed image assets found were app icons, splash assets, logo assets, and social/marketing images under `public/`, `apps/mobile/assets/images/`, and generated native iOS asset folders. These are not screen captures and were not used as parity evidence.

## Capture Output

Store sanitized captures outside user-private locations and avoid committing PII. Recommended local output structure:

```text
docs/qa/screenshots/stream18/
  web/
    01-auth-sign-in.png
    02-onboarding.png
    ...
  native-ios/
    01-auth-sign-in.png
    02-onboarding.png
    ...
  native-android/
    01-auth-sign-in.png
    02-onboarding.png
    ...
  notes.md
```

If screenshots contain real user names, faces, phone numbers, email addresses, tickets, chat content, payment state, or live media, keep them local only or redact before sharing.

## Web Capture Setup

Use the current deployed app or a local web dev server connected to the normal remote Supabase environment. Do not run local Supabase.

Recommended web viewports:

- Desktop: `1440 x 900`
- Mobile web reference: `390 x 844`
- Optional tablet: `834 x 1194`

Suggested local commands if a local web render is needed:

```bash
npm install
npm run dev -- --host 127.0.0.1
```

Capture with Playwright, browser devtools, or the operating-system screenshot tool. Keep browser zoom at `100%`, disable extensions that alter fonts or colors, and record whether the capture is production, preview, or local dev.

## Native Capture Setup

Use a real physical device or a simulator only for layout preflight. Physical device captures are preferred before making visual fixes.

Recommended iOS targets:

- iPhone 15 Pro Max or similar large device
- iPhone SE or similar compact device for overflow checks

Recommended Android target:

- Pixel 7 or comparable 390-430dp wide device

Useful setup commands:

```bash
cd apps/mobile
npm install
npm run typecheck
xcrun devicectl list devices
npm run ios -- --device
```

Do not run EAS unless a release operator explicitly requests it. Do not add native modules.

## Test Data

Use controlled internal test users and fixtures only:

- user with incomplete onboarding
- user with completed onboarding and photos
- user with active event registration
- user eligible for Event Lobby and Ready Gate
- user with an active/prepared video-date session
- user with at least one match and chat thread
- user with notification permission not yet granted
- user with Vibe Video absent, processing, and ready states where safe

Do not upload/delete real production media, send real production SMS/email/push to users, create unapproved Daily rooms, or run real purchases as part of screenshot capture.

## Target Screen Matrix

| # | Screen | Web source-of-truth surfaces | Native surfaces | Required states |
|---|---|---|---|---|
| 1 | Auth / sign in / sign up | `src/pages/Auth.tsx`, `src/pages/Index.tsx`, `src/pages/ResetPassword.tsx` | `apps/mobile/app/(auth)/sign-in.tsx`, `apps/mobile/app/(auth)/reset-password.tsx`, `apps/mobile/app/index.tsx` | signed out, password reset, auth error |
| 2 | Onboarding | `src/pages/onboarding/index.tsx`, `src/pages/onboarding/steps/*` | `apps/mobile/app/(onboarding)/index.tsx`, `apps/mobile/components/onboarding/steps/*` | first step, middle step, validation error, completion |
| 3 | Dashboard/home | `src/pages/Dashboard.tsx` | `apps/mobile/app/(tabs)/index.tsx` | empty/first-run, live event, upcoming date/rejoin where available |
| 4 | Events list | `src/pages/Events.tsx`, `src/components/events/*` | `apps/mobile/app/(tabs)/events/index.tsx` | loading, empty, nearby events, filters |
| 5 | Event details | `src/pages/EventDetails.tsx` | `apps/mobile/app/(tabs)/events/[id].tsx` | free event, paid event, registered, unavailable |
| 6 | Event lobby | `src/pages/EventLobby.tsx` | `apps/mobile/app/event/[eventId]/lobby.tsx` | deck, empty deck, queued, blocked/ended event |
| 7 | Ready Gate overlay and route | `src/components/lobby/ReadyGateOverlay.tsx`, `src/pages/ReadyRedirect.tsx` | `apps/mobile/components/lobby/ReadyGateOverlay.tsx`, `apps/mobile/app/ready/[id].tsx` | ready, snooze, skip, timeout, event-ended |
| 8 | Video date route | `src/pages/VideoDate.tsx`, `src/components/video-date/*` | `apps/mobile/app/date/[id].tsx`, `apps/mobile/components/video-date/VideoDateControls.tsx` | permission prompt, prejoin, joined, reconnect, terminal/survey |
| 9 | Matches list | `src/pages/Matches.tsx`, `src/components/ArchivedMatchesSection.tsx` | `apps/mobile/app/(tabs)/matches/index.tsx`, `apps/mobile/components/matches/ArchivedMatchesSection.tsx` | empty, active matches, archived, search |
| 10 | Chat thread | `src/pages/Chat.tsx`, `src/components/chat/*` | `apps/mobile/app/chat/[id].tsx` | empty thread, text, image/voice/video, date/call affordances |
| 11 | Profile Studio | `src/pages/ProfileStudio.tsx`, `src/components/vibe-video/*` | `apps/mobile/app/(tabs)/profile/ProfileStudio.tsx`, `apps/mobile/app/vibe-studio.tsx`, `apps/mobile/app/vibe-video-record.tsx` | edit profile, photos, verification, Vibe Video |
| 12 | Settings | `src/pages/Settings.tsx`, `src/components/settings/*` | `apps/mobile/app/settings/index.tsx`, `apps/mobile/app/settings/*` | account, privacy, notifications, safety, support |
| 13 | Push permission / notification surfaces | `src/components/PushPermissionPrompt.tsx`, `src/components/notifications/*` | `apps/mobile/components/notifications/PushPermissionPrompt.tsx`, `apps/mobile/app/settings/notifications.tsx`, `apps/mobile/components/NotificationDeepLinkHandler.tsx` | permission unknown, denied recovery, enabled, deep link |
| 14 | Vibe Video surfaces | `src/components/vibe-video/*`, `src/pages/VibeStudio.tsx` | `apps/mobile/components/video/*`, `apps/mobile/app/vibe-video-record.tsx` | absent, uploading/processing, ready playback, error |

## Comparison Rubric

For each screen, compare:

- page structure and section order
- primary/secondary action labels
- recovery, empty, terminal, and error copy
- spacing rhythm and card density
- contrast and disabled/loading states
- icon usage and button affordances
- keyboard/safe-area behavior on native
- scroll position and content clipping
- media treatment and fallbacks

Record every difference with:

```text
Screen:
State:
Web screenshot:
Native screenshot:
Observed difference:
Expected source-of-truth:
Severity:
Proposed fix:
Risk:
```

Only implement differences that are concrete, scoped, and high-confidence.

## Completion Criteria

- Every target screen has at least one web and one native capture.
- At least one compact-device native capture exists for text wrapping and overflow risk.
- Differences are logged with screenshot file names.
- Fixes, if any, are limited to native UI/copy/style changes.
- No backend contracts, migrations, Edge Functions, env vars, native modules, or provider semantics change.
