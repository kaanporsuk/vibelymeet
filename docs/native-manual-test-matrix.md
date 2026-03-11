# Native Manual Test Matrix

Practical manual test matrix for native (iOS/Android) and cross-platform interoperability. Mark which tests require real devices or provider dashboards.

**Legend**

- **Simulator:** Can be run on iOS Simulator / Android Emulator.
- **Real device:** Requires physical device (e.g. push, IAP, sometimes video).
- **Dashboard:** Requires provider dashboard (RevenueCat, OneSignal, etc.) or backend already configured.

---

## Auth / session

| Test | Steps | Simulator | Real device | Notes |
|------|--------|-----------|-------------|--------|
| Sign in | Sign in with email/link or OTP | ✓ | ✓ | Same Supabase as web. |
| Session restore | Sign in, kill app, reopen | ✓ | ✓ | Should remain logged in (AsyncStorage). |
| Sign out | Sign out, confirm redirect to auth | ✓ | ✓ | |
| Route guard | While signed out, try to open protected screen | ✓ | ✓ | Should redirect to auth. |

---

## Onboarding / profile

| Test | Steps | Simulator | Real device | Notes |
|------|--------|-----------|-------------|--------|
| Onboarding flow | New user; complete name, gender, optional fields | ✓ | ✓ | No photo upload in scope. |
| Incomplete profile gate | Sign in with user that has no profile; confirm redirect to onboarding | ✓ | ✓ | |
| Profile load | Open profile tab; see name, tagline, etc. | ✓ | ✓ | |
| Profile edit | Edit name/tagline/job/about, save | ✓ | ✓ | Backend update. |

---

## Events / register / lobby / discovery / swipes

| Test | Steps | Simulator | Real device | Notes |
|------|--------|-----------|-------------|--------|
| Events list | Open events; see upcoming events | ✓ | ✓ | |
| Event detail | Open event; see description, register button | ✓ | ✓ | |
| Register | Register for event | ✓ | ✓ | |
| Lobby | From event detail, open lobby (registered only) | ✓ | ✓ | |
| Deck | See attendee card; Pass / Vibe / Super Vibe | ✓ | ✓ | swipe-actions Edge Function. |
| Match / queue | After swipe, see toast; deck updates | ✓ | ✓ | Backend-owned. |

---

## Matches / chat / send / realtime

| Test | Steps | Simulator | Real device | Notes |
|------|--------|-----------|-------------|--------|
| Matches list | Open matches; see list with last message, unread | ✓ | ✓ | |
| Chat thread | Open thread; see history | ✓ | ✓ | |
| Send message | Send text; appears in thread | ✓ | ✓ | send-message Edge Function. |
| Realtime | Other user sends message; appears without refresh | ✓ | ✓ | Supabase realtime. |

---

## Push notifications

| Test | Steps | Simulator | Real device | Notes |
|------|--------|-----------|-------------|--------|
| Permission | App requests notification permission | ✓ | ✓ | |
| Registration | After sign-in, backend has mobile_onesignal_player_id | — | ✓ | Requires OneSignal dashboard + device. |
| Receive push | Trigger notification (e.g. new match/message); receive on device | — | ✓ | OneSignal + backend send-notification. |

---

## Daily Drop

| Test | Steps | Simulator | Real device | Notes |
|------|--------|-----------|-------------|--------|
| Load drop | Open Daily Drop; see partner card or empty | ✓ | ✓ | |
| Send opener / reply | Send opener or reply; backend transition | ✓ | ✓ | daily-drop-actions. |
| Pass | Pass drop; backend transition | ✓ | ✓ | |
| Mark viewed | First view marks viewed (idempotent) | ✓ | ✓ | |

---

## Ready Gate

| Test | Steps | Simulator | Real device | Notes |
|------|--------|-----------|-------------|--------|
| Ready Gate screen | Navigate from both_ready; see partner, status | ✓ | ✓ | |
| I'm ready | Tap I'm ready; backend transition | ✓ | ✓ | ready_gate_transition. |
| Snooze / Step away | Snooze or forfeit; backend transition | ✓ | ✓ | |
| Navigate to date | When both ready, navigate to video date screen | ✓ | ✓ | |

---

## Video date

| Test | Steps | Simulator | Real device | Notes |
|------|--------|-----------|-------------|--------|
| Join room | From Ready Gate (both ready); app gets token, joins Daily | ✓ | ✓ | Dev build; simulator may have camera/mic limits. |
| Local / remote video | See self and partner (or placeholder) | — | ✓ | Real device preferred for media. |
| End date | Tap End date; leave room, backend transition, navigate away | ✓ | ✓ | |
| Session ended (realtime) | Partner ends; local UI shows ended, cleanup | ✓ | ✓ | |

---

## Premium screen / offering load / purchase / restore

| Test | Steps | Simulator | Real device | Notes |
|------|--------|-----------|-------------|--------|
| Load offerings | Open premium; see packages if RevenueCat configured | ✓ | ✓ | Dashboard: products + offering. |
| Already premium | If backend is_premium or active sub; see "You're Premium" | ✓ | ✓ | |
| Purchase (sandbox) | Tap package; complete sandbox purchase | — | ✓ | Requires RevenueCat + store sandbox. |
| Restore | Tap Restore; restore purchases; backend refetch | — | ✓ | |
| Webhook sync | After purchase; backend subscriptions + is_premium updated | — | ✓ | RevenueCat webhook deployed + secret set. |

---

## Cross-platform interoperability

### Web ↔ iOS

| Test | Steps | Notes |
|------|--------|--------|
| Web user ↔ iOS user match | Web and iOS same event; swipe to match | Shared backend, same match. |
| Web user ↔ iOS user chat | Send message from web; appears on iOS and vice versa | send-message, same matches/messages. |
| Web user ↔ iOS user video date | Both ready; one on web, one on iOS; join same Daily room | Same daily-room, same session. |
| Web premium ↔ iOS premium | Subscribe on web (Stripe); is_premium true on iOS. Subscribe on iOS (RevenueCat); is_premium true on web. | Same profiles.is_premium, subscriptions (provider). |

### Web ↔ Android

| Test | Steps | Notes |
|------|--------|--------|
| Same as Web ↔ iOS | Mirror the above with Android device | Same backend, same contracts. |

### iOS ↔ Android

| Test | Steps | Notes |
|------|--------|--------|
| iOS user ↔ Android user match / chat / video | Two devices, one iOS one Android; match, chat, video date | Same backend and Daily room. |

---

**Summary**

- **Simulator-only:** Auth, onboarding, profile, events, lobby, swipes, matches, chat, Daily Drop, Ready Gate, premium screen (load/state); basic video date flow.
- **Real device required:** Push receive, sandbox IAP/restore, webhook sync validation, reliable video/audio.
- **Dashboard required:** RevenueCat (products, offerings, webhook), OneSignal (mobile apps, credentials), Supabase (migrations, revenuecat-webhook deploy, secret).
