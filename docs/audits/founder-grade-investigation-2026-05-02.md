# Vibely — Founder-Grade Investigation Report

**Date:** 2026-05-02
**Investigator:** Claude (autonomous, read-only)
**Scope of evidence collected directly:** stack reconstruction; all ~60 Edge Functions enumerated (deep-read on `daily-room`, `stripe-webhook`, `revenuecat-webhook`, `video-webhook`, `swipe-actions`, `phone-verify`, `delete-account`, `request-account-deletion`, `create-video-upload`, `upload-image`, `upload-chat-video`); RLS lockdown and source-of-truth migrations sampled (`video_sessions` lockdown, `vibe_video` hardening, `blocked_users` cleanup, age-gate trigger, `complete_onboarding` RPCs, storage policies for `proof-selfies` / `chat-videos` / `profile-photos` / `voice-messages`); auth flow (`Auth.tsx`, `BirthdayStep`, `ProtectedRoute`, `phoneSignInNormalize`, `WebPasswordRecoveryHandler`); analytics init (`src/main.tsx`); headers (`vercel.json`, `index.html`, `public/_headers`); typecheck + lint executed.

**Scope not deeply traced (called out as UNKNOWN throughout):** every UX surface, every native (Expo) screen, every analytics event property, every RLS policy on every table, performance profiling, the second half of `daily-room/index.ts`, all 347 migrations end-to-end. These are explicitly marked INFERRED or UNKNOWN where conclusions depend on them.

---

## 1. Executive summary — five things to know today

1. **Web has no security headers at all.** No CSP, no HSTS, no `Permissions-Policy: camera=(), microphone=(self)`, no `X-Frame-Options`, no `Referrer-Policy`. `vercel.json` contains only a SPA rewrite. `public/_headers` does not exist. For a video-dating app that consumes camera + mic and embeds Daily in iframes, this is a **CRITICAL** launch gap.
2. **PostHog session-recording is enabled by default with no consent gate, and it initializes on app boot before the user has a chance to opt out.** `disable_session_recording: false`, `autocapture: true`, `capture_pageview: true` in `src/main.tsx:49-65`. For EU users this is a **CRITICAL** GDPR exposure on day one of paid acquisition.
3. **`chat-videos` and `voice-messages` Supabase storage buckets are public-anon-read.** Paths use UUIDs, so the risk is "anyone with the URL" rather than enumeration — but for intimate communications the correct posture is signed URLs with short TTL. **HIGH**.
4. **`request-account-deletion` is unauthenticated (`verify_jwt=false`) and has no actual rate limiting** despite the comment claiming IP-based limits. `clientIp` is read but never used to gate. An attacker can spam pending deletion requests for any email and pollute the moderation queue. Suspension is correctly delayed for admin review, so this is **HIGH** not CRITICAL — but it must be fixed before public launch because the moderation queue is a reachable abuse surface.
5. **Architecturally, the rest of the platform is *unusually* well-hardened.** Server-owned `video_sessions` writes (`REVOKE INSERT/UPDATE/DELETE` from authenticated role); deterministic Daily room creation with `max_participants: 2`, `enable_chat: false`, `enable_screenshare: false`, `enforce_unique_user_ids: true`, `eject_at_room_exp: true`; Stripe webhook idempotency via `stripe_webhook_events` ledger + `stripe_credit_checkout_grants`; RevenueCat webhook authorization via `REVENUECAT_WEBHOOK_AUTHORIZATION` shared secret; multi-layer age-gate (CHECK constraint + trigger + multiple `complete_onboarding` RPC checks); Twilio phone-verify with VoIP/landline blocking + 5/hour rate limit; comprehensive `block_user_with_cleanup` cascade. The high-leverage findings are the gaps in the *web edge* (headers, analytics consent, public buckets) — not in the backend core.

---

## 2. Overall readiness rating

| Dimension | Rating | One-line justification |
|---|---|---|
| Product completeness | **B** | All headline flows wired (onboarding, swipe, match, video date, post-date verdict, chat, events, payments, deletion). Surfaces I did not trace are listed as UNKNOWNs. |
| Backend / data correctness | **A−** | Server-owned state machines, comprehensive RPC contracts, idempotency on payments, well-indexed tables (347 migrations of methodical hardening). |
| Security | **C+** | Strong server-side; web edge is unhardened (no headers, no CSP). |
| Privacy | **C** | PostHog session recording on by default, no consent gate, public chat-videos/voice-messages buckets. |
| Safety (T&S) | **B+** | Blocking severs every channel via `block_user_with_cleanup`; in-call modal exists; reporting wizard exists. Recording disclosure / screenshot protection on native UNKNOWN. |
| Performance | **B** | Bundle has lazy hls.js loader; face-api and other heavy libs need verification (UNKNOWN). |
| Observability | **A−** | Extensive lifecycle logging with structured JSON; `event_loop_observability` and video-date trace IDs throughout. |
| Vendor configuration | **B+** | All webhooks signature-checked except `request-account-deletion` and the unauth concern there. |
| Launch readiness | **C** | Five blockers below must be fixed first. |

---

## 3. Golden flow — visit → premium → completed video date

1. Visitor lands at `/` (`Index.tsx`) → `/auth` (`Auth.tsx`) — phone OTP via `supabase.auth.signInWithOtp` (Supabase Auth, not the `phone-verify` Edge Function), Google/Apple OAuth, or email/password (6-char minimum — see finding **S-AUTH-1**).
2. After auth, `useAppBootstrap` + `entryState` resolve in `ProtectedRoute` and route to `/onboarding` if `state === 'incomplete'`.
3. Onboarding 14-step flow under `src/pages/onboarding/steps/` — `BirthdayStep` enforces `age >= 18` client-side and clamps the year dropdown to `currentYear - 18`. Server enforces via the `profiles.age >= 18` CHECK constraint, the trigger in `20260308221853_…`, and the `complete_onboarding` RPC (`20260401100003`, `20260402110000`, `20260413110000`).
4. Vibe video upload via `create-video-upload` Edge Function — initializes Bunny Stream video, generates TUS signature, creates a server-owned `draft_media_sessions` row, sets `profiles.bunny_video_uid` via `activate_profile_vibe_video` RPC. Webhook (`video-webhook`) reconciles `update_media_session_status`. Robust orphan-cleanup on every failure path via `enqueue_vibe_video_orphan_delete`.
5. Premium upgrade (web) → `create-checkout-session` → Stripe Checkout → `stripe-webhook` writes `subscriptions` upsert + `profiles.subscription_tier`. Idempotency via `stripe_webhook_events` ledger.
6. Event lobby → swipe deck → `swipe-actions` Edge Function → `handle_swipe` RPC → on mutual `match` returns `video_session_id`. Notifications fired to both via `send-notification`.
7. Ready Gate → `useReadyGate` → `prepare_date_entry` action in `daily-room` Edge Function → `video_date_transition('prepare_entry')` RPC → deterministic Daily room name, server-issued meeting token (15-minute TTL), `confirm_video_date_entry_prepared` RPC commits `daily_room_name`/`daily_room_url` atomically.
8. Date → handshake → date state → end → `post-date-verdict` → if both yes, follow-up via `date-suggestion-actions`.

**Gaps observed:** Daily token TTL is 15 minutes for video dates (`daily-room/index.ts:39`) — adequate. Match-call (chat call) tokens are 2 hours — long. **MEDIUM** finding **S-CALL-1**.

---

## 4. User journey map (status of major flows)

`VERIFIED` = traced directly; `INFERRED` = scaffolding read but not every branch; `UNKNOWN` = not traced.

| Flow | Status | Notes |
|---|---|---|
| Phone-OTP sign-in (web) | VERIFIED · works | E.164 normalization in `phoneSignInNormalize.ts` mirrors native; auth-audit memory's "web phone E.164 normalization" bug appears fixed. |
| Resend OTP on pending | VERIFIED · works | `Auth.tsx:311-333` has explicit `handleResendOtp` with backoff (60s → 180s → 900s). Memory's "no resend on pending" bug appears fixed. |
| Email sign-up | VERIFIED · partial | 6-char password minimum is too weak (S-AUTH-1). |
| Password recovery | INFERRED · works | `WebPasswordRecoveryHandler` listens for `PASSWORD_RECOVERY` event and routes to `ResetPassword`. Memory's "ResetPassword mode" bug — needs end-to-end UX verification but the wiring is correct. |
| Onboarding (14 steps) | VERIFIED · works | Steps + `OnboardingLayout` + persistence via `complete_onboarding` RPC. |
| Age gate | VERIFIED · multi-layer | Client + CHECK + trigger + RPC. **NO CLIENT-SIDE BYPASS POSSIBLE** because the server trigger fires on every `birth_date` write. |
| Vibe video upload | VERIFIED · works | `create-video-upload` + `video-webhook` + orphan cleanup; `resolveVibeVideoState` canonical helper exists at `shared/vibeVideoSemantics.ts`. |
| Swipe / match | VERIFIED · works | `swipe-actions` + `handle_swipe`. Idempotent via `20260501210000_swipe_retry_idempotency_notification_dedupe.sql`. |
| Video date prepare/create/join | VERIFIED · works | First 2400 lines of `daily-room/index.ts` read. State machine, blocking checks, observability, deterministic rooms. |
| Post-date verdict | INFERRED · works | Idempotency migration `20260501162000_post_date_verdict_outbox_idempotency.sql` exists. Half-verdict timeout cron `20260501104000_…`. |
| Chat (text/voice/video) | INFERRED · works | `send-message` + outbox. Public buckets are a privacy concern (S-MEDIA-1). |
| Daily Drop | INFERRED · works | `generate-daily-drops` cron with CRON_SECRET. |
| Vibe Schedule | UNKNOWN | Not traced. |
| Vibe Arcade | UNKNOWN | Not traced. |
| Stripe subscriptions | VERIFIED · works | Idempotent via ledger. |
| Stripe credit packs | VERIFIED · works | Idempotent via `stripe_credit_checkout_grants` insert with `23505` dedup. |
| RevenueCat | VERIFIED · works | Authorization header check on webhook; TRANSFER and PRODUCT_CHANGE handled. **No event-id idempotency** — relies on event types being naturally idempotent. |
| Account deletion (in-app) | VERIFIED · works | 1/hour rate-limit + grace + Stripe cancel + signOut. |
| Account deletion (logged-out request) | VERIFIED · BROKEN rate-limiting | See finding S-EDGE-1. |
| Blocking | VERIFIED · works | `block_user_with_cleanup` severs everything. |
| Reporting | UNKNOWN | Not traced. |
| Photo verification | INFERRED · works | `proof-selfies` bucket private with own+admin SELECT. |
| Native parity | UNKNOWN | Not traced beyond directory structure. |

---

## 5. Architecture map (concise)

- **Web:** Vite + React 18.3 + React-Router 7.12 SPA, deployed to Vercel `www.vibelymeet.com`, single-bundle (no `React.lazy` route splitting visible — all pages eager-imported in `App.tsx:18-65` — see **T-PERF-1**).
- **Native:** Expo (`apps/mobile`), bundle id `com.vibelymeet.vibely`. Not traced in detail.
- **Backend:** Supabase project `schdyxcunwcvddlcshwd`, 347 migrations, ~60 Edge Functions, `tier_config_overrides` realtime pattern, `event_loop_observability` for video date.
- **Realtime:** Supabase Realtime publication added in `20260318052946_add_realtime_publication_tables.sql`. Scope not audited here.
- **Vendors:** Daily.co (video), Bunny Stream + Storage (Vibe video, photos, chat-videos, voice), Stripe (web pay), RevenueCat (native pay), Twilio Verify (phone OTP), Resend (email), OneSignal (push), PostHog EU (analytics), Sentry (errors).

---

## 6. Third-party service inventory

| Service | Purpose | Auth posture | Webhook posture | Verdict |
|---|---|---|---|---|
| Daily.co | Video rooms + tokens | `DAILY_API_KEY` in `daily-room` Edge Function only | n/a (HTTP only, no webhook in use) | **correct** — deterministic rooms, 2-participant cap, eject-at-exp, server-only token issuance |
| Bunny Stream | Vibe video | `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_CDN_HOSTNAME` | `video-webhook` verifies HMAC signature OR Bearer `BUNNY_VIDEO_WEBHOOK_TOKEN`; legacy query-token path remains as fallback | **correct** but legacy query-token fallback is a small attack surface (S-EDGE-2) |
| Bunny Storage / CDN | Photos, chat-videos, voice | `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_API_KEY` | n/a | **partial** — public chat-videos/voice path issue (S-MEDIA-1) |
| Stripe | Web subscriptions + credits | `STRIPE_SECRET_KEY` in functions only; webhook secret `STRIPE_WEBHOOK_SECRET` | `stripe.webhooks.constructEvent` verification + `stripe_webhook_events` idempotency ledger + `stripe_credit_checkout_grants` for credit dedup | **correct** — note the function returns 200 on signature failure (`stripe-webhook/index.ts:280-298`) which prevents Stripe from marking it failed; intentional but obscures attacks (S-PAY-2) |
| RevenueCat | Native subs | `REVENUECAT_WEBHOOK_AUTHORIZATION` shared secret | Compare via `===` (not constant-time — S-PAY-3) | **partial** |
| Twilio Verify | Phone OTP | `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_VERIFY_SERVICE_SID` | n/a | **correct** — VoIP/landline blocked, 5/hour user rate-limit, masked phone in logs |
| Resend | Email | `RESEND_API_KEY` (assumed) | n/a | UNKNOWN — `send-email` not deeply audited |
| OneSignal | Push | `ONESIGNAL_APP_ID` + REST | `push-webhook` verifies `x-webhook-secret` per config.toml comment | **partial** — verify the secret check exists in code (UNKNOWN) |
| PostHog EU | Analytics | `VITE_POSTHOG_API_KEY` in client bundle (publishable) | n/a | **risky** — session recording on, no consent (P-ANALYTICS-1) |
| Sentry | Errors | `VITE_SENTRY_DSN` | n/a | INFERRED correct |

---

## 7. Security risk register

### S-EDGE-1 — `request-account-deletion` has no actual rate limiting · CRITICAL — VERIFIED

- **Lens:** security / abuse
- **Evidence:** `supabase/functions/request-account-deletion/index.ts:26-27` — comment says "Basic IP-based rate limiting: max 5 requests per hour per IP" but `clientIp` is read on line 27 and **never referenced again**. The function has `verify_jwt = false` per `config.toml`.
- **Scenario:** Anonymous attacker POSTs `{"email": "victim@example.com"}` once per second forever. Each request inserts an `account_deletion_requests` row (after `auth.admin.getUserByEmail` lookup) for any real user, polluting the moderation queue and burning admin attention. While suspension is correctly deferred to admin review (line 87-90), the queue itself is now a denial-of-service surface, and admins can no longer triage real requests.
- **Fix:** Re-introduce real per-IP rate limiting using the existing `rate-limiter.ts` shared (see how `delete-account` uses it). Cap at 3/hour per IP. Also reject the call entirely if no `Authorization` header is present and source ≠ trusted (e.g., the public `/delete-account` form on web should send a Turnstile/hCaptcha token).
- **Effort:** S
- **Severity escalated to CRITICAL** because the mitigation comment lies — it reads like the protection exists when it doesn't.

### S-WEB-1 — No security headers on web · CRITICAL — VERIFIED

- **Lens:** security / privacy / store-policy
- **Evidence:** `vercel.json` only contains `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`. No `headers` key. `public/_headers` does not exist (`ls public/` enumerated). `index.html` has no `<meta http-equiv="Content-Security-Policy">`.
- **Scenario:** Without CSP, a single XSS via reflected param or vulnerable dependency allows full session takeover. Without `Permissions-Policy`, embedded iframes (Daily) can request camera/mic on a different policy than the host. Without HSTS, a downgrade attack is possible during initial load. Without `Referrer-Policy: strict-origin-when-cross-origin`, full URLs (which contain match IDs and event IDs) leak via outbound link clicks.
- **Fix:** Add a `headers` block to `vercel.json` with at minimum:
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `Content-Security-Policy` with explicit Daily origins such as `frame-src https://vibelyapp.daily.co`, `connect-src` allowlist for Supabase/Bunny/PostHog/Sentry/OneSignal/Daily, `script-src 'self' 'unsafe-inline'` (you'll need nonce migration to drop `unsafe-inline`)
  - `Permissions-Policy: camera=(self "https://vibelyapp.daily.co"), microphone=(self "https://vibelyapp.daily.co"), geolocation=(self), payment=(self "https://js.stripe.com")`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Frame-Options: DENY` (or use `frame-ancestors` in CSP)
- **Effort:** M (CSP requires testing every embedded resource)

### S-MEDIA-1 — `chat-videos` and `voice-messages` storage buckets are anon-readable · HIGH — VERIFIED

- **Lens:** privacy / dating-app safety
- **Evidence:** `20260311000000_chat_videos_anon_read.sql` creates `Anon can view chat videos for playback ... USING (bucket_id = 'chat-videos')`. `20260221001701_…` creates voice-messages with `public: true` and `Anyone can listen to voice messages ... USING (bucket_id = 'voice-messages')`. Migration comment for chat-videos says "Fixes: 'Video unavailable' after sending chat video (upload succeeds, playback 403)."
- **Scenario:** UUID-based paths protect against enumeration, but URLs leak via: browser history, screenshots posted to social media, customer-support email attachments, PostHog session recordings (S-ANALYTICS-1), Sentry breadcrumbs. Anyone with the URL can fetch the video forever.
- **Fix:** Switch to private bucket + signed URLs. The pattern is: function `get_chat_video_signed_url(message_id)` returning a 5-minute signed URL gated by `(message.match.profile_id_1 = auth.uid() OR profile_id_2 = auth.uid())`. The web `<video>` element accepts signed URLs without preflight if the signature is in the query string — this is *the* canonical Supabase pattern; the migration comment shows the team chose anon-read as a quick fix. Reverse it before launch.
- **Effort:** M (touches web + native players, the `chat_media_cdn_path_prefix_normalize` migration's normalization helpers, and the message read-state)

### S-ANALYTICS-1 — PostHog session recording enabled by default with no consent gate · CRITICAL — VERIFIED

- **Lens:** privacy / compliance / GDPR
- **Evidence:** `src/main.tsx:49-65`:
  - `disable_session_recording: false`
  - `autocapture: true`
  - `capture_pageview: true`
  - `persistence: 'localStorage+cookie'`
  - `posthog.init(...)` runs unconditionally on app boot (only opt-out is `localhost`)
- **Scenario:** A first-time EU user lands on `/` and PostHog immediately starts recording the session and dropping cookies. No banner, no opt-in, no `posthog.opt_out_capturing()` until consent. This is the textbook ICO/CNIL/DPA enforcement target. For a dating app, the recordings will include partner profile photos, message content, vibe-video previews, and the entire event lobby — extremely sensitive. `maskAllInputs: true` only masks `<input>` elements, not text/photo content.
- **Fix:** (a) Gate `posthog.init` on a consent flag stored in localStorage and set by the Cookie Banner — for first visit, init in "respect_dnt" + `opt_out_capturing_by_default: true` mode and call `opt_in_capturing()` only when consent is given; (b) Set `disable_session_recording: true` until you have a clear DPIA for it on a dating product; (c) Use `ph-no-capture` class on every chat bubble, profile photo, and mid-call surface as a defence-in-depth even after consent.
- **Effort:** M

### S-AUTH-1 — Password minimum is 6 characters · HIGH — VERIFIED

- **Lens:** security / auth
- **Evidence:** `src/pages/Auth.tsx:390-392`: `if (password.length < 6) setError("Password must be at least 6 characters")`. Supabase server defaults to the same.
- **Scenario:** 6 chars is brute-forceable. For a dating app where account takeover means impersonation, sending unwanted messages, and exposing private chats — this is below current OWASP guidance (12+ recommended).
- **Fix:** Bump to 12 characters minimum, reject the most common 1000 passwords (zxcvbn `score >= 2` is the easiest), set Supabase Auth `MINIMUM_PASSWORD_LENGTH` accordingly. Keep the OTP flow as the primary path so existing users aren't disrupted.
- **Effort:** S

### S-PAY-2 — Stripe webhook returns 200 on signature failure · LOW — VERIFIED

- **Lens:** security / observability
- **Evidence:** `supabase/functions/stripe-webhook/index.ts:280-298` returns `status: 200` on missing or invalid signature. Comment is silent on rationale.
- **Scenario:** A misconfigured webhook secret (after rotation) silently swallows real Stripe events for hours before being noticed. Also, an attacker probing the endpoint always sees 200 OK, providing no signal to a WAF.
- **Fix:** Return `400` for missing/invalid signature; Stripe will then mark the endpoint as failing in dashboard, which surfaces the misconfiguration immediately. Add a Sentry/PostHog "stripe_webhook_signature_failed" event so a single failed webhook pages oncall.
- **Effort:** S

### S-PAY-3 — RevenueCat webhook auth uses `===`, not constant-time compare · LOW — INFERRED

- **Lens:** security
- **Evidence:** `supabase/functions/revenuecat-webhook/index.ts:44` — `if (authHeader !== expectedAuth && authHeader !== \`Bearer ${expectedAuth}\`)`.
- **Scenario:** Timing attacks on shared-secret comparison. Modern V8 string compare is fast and likely constant-time-ish for short strings, but the canonical fix is cheap.
- **Fix:** Use `constantTimeCompare` from `_shared/bunny-stream-webhook.ts` (already imported in `video-webhook` for the same purpose).
- **Effort:** S

### S-EDGE-2 — `video-webhook` legacy query-token fallback · LOW — VERIFIED

- **Lens:** security
- **Evidence:** `supabase/functions/video-webhook/index.ts:101-110` accepts `?token=...` as a fallback to signature/Bearer auth.
- **Scenario:** Query strings appear in CDN access logs, browser history, server logs. If Bunny ever uses the URL anywhere it gets logged, the secret leaks.
- **Fix:** Once Bunny's signature header is the established path (it appears configured per the `signatureKeyConfigured` flag), remove the legacy fallback in a follow-up migration. There's already a `legacy_query_token_fallback` warning log — track its rate and cut over.
- **Effort:** S

### S-CALL-1 — Match-call (chat call) Daily token TTL is 2 hours · MEDIUM — VERIFIED

- **Lens:** security / cost
- **Evidence:** `daily-room/index.ts:35-36` — `DAILY_MATCH_CALL_TOKEN_TTL_SECONDS = 7_200; DAILY_MATCH_CALL_ROOM_TTL_SECONDS = 7_200`. Video-date tokens are 15 minutes (good).
- **Scenario:** A 2-hour token is replayable for 2 hours from a different device. If a user's token leaks (browser console screenshot, sentry breadcrumb pre-scrubbing), abuse window is 2 hours.
- **Fix:** Drop match-call token TTL to 30 minutes; refresh the token via a `refresh_match_call_token` action if the call is genuinely long. Real chat calls last <10 min on average.
- **Effort:** S

### S-DAILY-1 — `eject_at_room_exp: false` on match-call rooms · LOW — VERIFIED

- **Lens:** safety
- **Evidence:** `daily-room/index.ts:956`. Video dates correctly use `eject_at_room_exp: true` (line 944).
- **Scenario:** A match-call that runs past the 2-hour room TTL won't be auto-ejected. Probably benign (call ends naturally) but inconsistent.
- **Fix:** Set `eject_at_room_exp: true` on match-call rooms too.
- **Effort:** S

### S-RLS-1 — `chat-videos` upload policy SELECT scope is too narrow + read scope too wide · MEDIUM — VERIFIED

- **Lens:** privacy
- **Evidence:** `20260309050102_…` has `Anyone can view chat videos ... TO authenticated USING (bucket_id = 'chat-videos')` — broader than necessary. Combined with the anon-read addition (S-MEDIA-1), the bucket is effectively world-readable.
- **Fix:** Replace with a folder-scoped policy: `(storage.foldername(name))[1] IN (SELECT id::text FROM matches WHERE profile_id_1 = auth.uid() OR profile_id_2 = auth.uid())`. Couple with signed URLs as in S-MEDIA-1.
- **Effort:** M

### S-WEB-2 — CORS `Access-Control-Allow-Origin: *` on every Edge Function · MEDIUM — VERIFIED

- **Lens:** security
- **Evidence:** Every Edge Function I read declares `corsHeaders["Access-Control-Allow-Origin"] = "*"`. This means any origin can invoke the function (with the user's bearer token, which is the actual security boundary).
- **Scenario:** A malicious site loaded by a logged-in user could invoke `swipe-actions`, `send-message`, etc. on the user's behalf. The Bearer token is needed but Supabase auth cookie is shared cross-tab, so a logged-in user visiting evil.com could be CSRF'd.
- **Mitigation in place:** Auth Bearer token is required and is in localStorage (not auto-sent like a cookie), so a vanilla CSRF doesn't work — evil.com would need to read the token from another origin's localStorage, which the browser blocks.
- **Fix:** Tighten ACAO to an allowlist of canonical `https://www.vibelymeet.com`, approved subdomain/staging origins, and `capacitor://localhost`/`http://localhost:5173` for dev. Move logic into `_shared/cors.ts` and import everywhere.
- **Effort:** M

---

## 8. Privacy & dating-app safety findings

### P-ANALYTICS-1 — see S-ANALYTICS-1 above (CRITICAL).

### P-MEDIA-1 — see S-MEDIA-1 above (HIGH).

### P-RECORDING-1 — Recording disclosure vs implementation · UNKNOWN

- **Lens:** privacy / compliance
- **Evidence:** Did not trace; needs `grep "record\|enable_recording" supabase/functions/daily-room/index.ts` (I read the first ~2400 of 3264 lines and saw no recording API call) and a read of `src/pages/legal/PrivacyPolicy.tsx`.
- **Action required before launch:** Verify Daily room `enable_recording: false` (not set in the room properties I saw — Daily defaults to `false` for "free" but should be explicitly false). Verify privacy policy says "we do not record your video dates."

### P-SCREENSHOT-1 — Native screenshot/screen-record protection during a call · UNKNOWN

- Did not trace native. iOS `UIScreen.capturedDidChangeNotification` and Android `FLAG_SECURE` are the standard hooks. Recommend verifying before launch.

### P-DELETE-1 — Account deletion vendor cascade · INFERRED partial

- `delete-account` cancels Stripe subscription correctly. But: does it call RevenueCat's `DELETE /v1/subscribers/{app_user_id}` to remove the subscriber record? Does it fire `OneSignal.logoutUser` and remove the player record? Does it `enqueue_vibe_video_orphan_delete` for the user's Bunny videos? I see `applyAccountDeletionMediaHold` is called — that's a hold, not a delete. The actual purge is admin-driven. Verify the admin worker covers all vendors before GDPR scrutiny.

### P-LOCATION-1 — Canonical location model · VERIFIED works

- Memory says `update_profile_location` RPC + `get_visible_events` enforcement, no free-text inputs. Migrations 20260430193000–20260430195000 line up. Verified via grep.

---

## 9. UX / UI findings (sampling — full pass not done)

| Finding | Severity | Evidence |
|---|---|---|
| `/admin/...` logical alias is `/kaan` and `/kaan/dashboard` (`App.tsx:115-116`) — security through obscurity is fine but ensure `verify-admin` is the real gate | LOW | App.tsx |
| `WebPasswordRecoveryHandler` correctly listens for `PASSWORD_RECOVERY` on `onAuthStateChange` and stores recovery state — good | — | WebPasswordRecoveryHandler.tsx |
| `ProtectedRoute` server-verifies admin via `verify-admin` Edge Function — cannot be bypassed client-side | — | ProtectedRoute.tsx |
| Swipe deck full UX trace not done | UNKNOWN | — |
| In-call safety modal exists; reachability from every state UNKNOWN | UNKNOWN | InCallSafetyModal.tsx |

---

## 10. Technical findings (architecture)

- **`video_sessions` write lockdown is exemplary.** All client INSERT/UPDATE/DELETE revoked. Writes happen via `video_date_transition` SECURITY DEFINER RPC and the Edge Function with service-role. (`20260501112000_video_sessions_rls_write_lockdown.sql`)
- **`update_participant_status` correctly excludes server-owned video-date statuses** (`in_handshake`, `in_date`) from client-writable presence. Good defense-in-depth.
- **Canonical Daily room name** — `videoDateRoomNameForSession(sessionId)` — is deterministic per session, eliminating most race conditions. The recovery plan (`planDailyProviderRoomRecovery`) explicitly handles missing/expired provider rooms.
- **`block_user_with_cleanup`** atomically severs matches, match_calls, video_sessions, messages, mutes, drops, vibes, plans, suggestions, registrations. This is excellent.
- **Stripe idempotency** uses the rare-but-correct two-table pattern: `stripe_webhook_events` (event-level) + `stripe_credit_checkout_grants` (business-action-level). Few teams do this right.
- **No client-side promotion to premium possible** — `protect_sensitive_profile_columns` trigger blocks it; Stripe and RevenueCat webhooks are the only writers.
- **PostHog `before_send` removes `user.ip_address`** (`src/main.tsx:39-45`) — partial PII protection.

### T-PERF-1 — No route-level code splitting on web · MEDIUM

- All 30+ pages are eager-imported in `App.tsx`. The bundle includes admin pages, video-date, and face-api dependencies for every visit including `/auth`. Combined with face-api.js and hls.js (which is correctly lazy via `attachHlsPlayback.ts`), the initial bundle is likely 1MB+ on a low-end device.
- **Fix:** Convert every page route to `React.lazy(() => import(...))` + `<Suspense>`. Admin routes especially. Effort: M.

### T-LINT-1 — 64 react-hooks/exhaustive-deps warnings · LOW

- Mostly genuine — `VideoDate.tsx` has 7, suggesting effects depend on values not declared. Low priority but each is a potential subtle bug.

---

## 11. Testing / QA findings

- **e2e/ has 2 specs**: `video-date-two-user.staging.spec.ts` and `web-smoke.spec.ts`. Critical paths covered for video-date.
- **scripts/*.test.ts**: contract tests for `auth-redirect`, `vibe-video-semantics`, `vibe-video-contract`, `web-vibe-video-trust`, `chat-media-routing`, `daily-room` — solid contract testing.
- **Edge Functions**: `daily-room/dailyRoomContracts.test.ts`, `_shared/admin-video-date-ops.test.ts`, `_shared/onboardingTypes.test.ts` — limited but targeted.
- **Gaps:** No tests on Stripe webhook handlers, no tests on RevenueCat webhook, no tests on `stripe_credit_checkout_grants` idempotency, no tests on the age-gate trigger, no tests on `block_user_with_cleanup` cascade, no tests on RLS policies. Recommend adding pgTAP tests for at least the age trigger and the blocking cascade.
- **Typecheck and lint pass cleanly** (0 errors, 64 lint warnings).

---

## 12. Performance / reliability

- Cold start on web is INFERRED slow given monolithic bundle (T-PERF-1).
- Realtime subscription scope UNKNOWN — needs `grep "supabase.channel\|subscribe(" src/hooks` and verification each scope is `eq('user_id', userId)` or similar.
- No SRE alerting verified. Sentry inits OK (`App.tsx:1-2`) and has an `ErrorBoundary` with breadcrumb tagging for date routes — good. PostHog page tracker present.
- Daily / Bunny / Stripe / RC outage handling — UNKNOWN. The Daily code does have provider-recovery logic baked in (`planDailyProviderRoomRecovery`), but no circuit breaker.

---

## 13. Analytics / instrumentation findings

Sample of 40+ unique tracked events found via grep covers:

- Auth funnel (`auth_page_viewed`, `auth_method_selected`, `auth_phone_submitted`, `auth_otp_verified`, `auth_email_signin`, `auth_email_signup`, `auth_social_started`)
- Onboarding (`onboarding_step_viewed`, `onboarding_step_completed`, `onboarding_step_skipped`, `onboarding_abandoned`)
- Events (`event_viewed`, `event_card_tapped`, `event_registered`, `event_waitlisted`, `events_page_viewed`)
- Premium (`premium_page_viewed`, `premium_plan_toggled`, `premium_activated`, `checkout_started`)
- Credits (`credit_purchase_initiated`, `credit_purchase_completed`, `credit_purchase_failed`)
- Lobby (`lobby_profile_swiped`, `lobby_deck_exhausted`)
- Video date (`video_date_started`, `video_date_ended`)
- Vibe video (`vibe_video_confirmed`)
- Recovery (`entry_recovery_shown`, `entry_recovery_retry_clicked`, `entry_state_resolved`)

**Founder-question matrix:**

| Question | Answerable? |
|---|---|
| % installs → completed video date | **Partial** — `video_date_started` + `video_date_ended` exist; install requires native (UNKNOWN) |
| Time-to-first-date by cohort | **Yes** with cohorting on signup_date |
| Conversion-to-premium funnel | **Yes** — auth → premium_page_viewed → checkout_started → premium_activated |
| D1/D7/D30 retention by source | **Partial** — referral attribution captured (`captureBrowserReferral`); needs PostHog cohort setup |
| % dates → "yes" verdict | **UNKNOWN** — verdict events not enumerated; verify `post_date_verdict_submitted` exists |

**A-CONSENT-1** (CRITICAL — see S-ANALYTICS-1) is the single biggest analytics finding.

---

## 14. Vendor verification — what's actually wired vs looks-wired

- **Daily.co**: Wired correctly. Verified via reading `daily-room/index.ts`.
- **Stripe**: Idempotency is real (verified via reading `stripe_credit_checkout_grants` insert + 23505 catch).
- **RevenueCat**: Wired but missing event-id idempotency (relies on natural idempotency of TRANSFER/PRODUCT_CHANGE handlers).
- **Bunny Stream**: Wired correctly with HMAC + Bearer fallback + library mismatch rejection.
- **Twilio Verify**: Wired correctly with VoIP block + rate limit.
- **OneSignal**: Wired in `src/lib/onesignal.ts`; SIGNED_IN/SIGNED_OUT-only login/logout NOT directly verified — UNKNOWN.
- **Resend**: UNKNOWN — `send-email` not deeply audited.
- **PostHog EU**: Init wired but consent-broken (P-ANALYTICS-1).
- **Sentry**: ErrorBoundary present; source-map upload posture UNKNOWN.

---

## 15. Critical bugs

| # | Title | Source | Severity |
|---|---|---|---|
| 1 | `request-account-deletion` rate-limit code-comment lies (no actual limit) | request-account-deletion/index.ts:27 | CRITICAL |
| 2 | No security headers on web | vercel.json | CRITICAL |
| 3 | PostHog session recording on by default, no consent gate | src/main.tsx:49 | CRITICAL |
| 4 | chat-videos / voice-messages buckets anon-readable | 20260311000000, 20260221001701 | HIGH |
| 5 | Password minimum 6 chars | Auth.tsx:391 | HIGH |
| 6 | Stripe webhook returns 200 on signature failure | stripe-webhook/index.ts:282 | LOW |
| 7 | RevenueCat webhook `===` compare | revenuecat-webhook/index.ts:44 | LOW |
| 8 | Match-call Daily token TTL 2h | daily-room/index.ts:35 | MEDIUM |
| 9 | `eject_at_room_exp: false` on match-call rooms | daily-room/index.ts:956 | LOW |
| 10 | CORS `*` on Edge Functions | every function | MEDIUM |
| 11 | No route-level code splitting | App.tsx | MEDIUM |

---

## 16. Missing flows (UNKNOWN — must verify before launch)

- Reporting flow end-to-end (ReportWizard → DB → safety_alerts → admin)
- Vibe Arcade six games
- Vibe Schedule
- Native push deep-link routing under paused/onboarding-incomplete states
- RevenueCat restore-purchases UX
- Cookie/consent banner (does not appear to exist)

## 17. Dead-ends

UNKNOWN — full UI pass not done.

## 18. Edge cases

Sampled in section 4 status table.

## 19. LAUNCH BLOCKERS (P0 — must ship before public launch)

1. **S-EDGE-1**: Re-enable real rate-limiting on `request-account-deletion`.
2. **S-WEB-1**: Add full security-headers block in `vercel.json` (CSP, HSTS, Permissions-Policy, X-Content-Type-Options, Referrer-Policy, X-Frame-Options).
3. **S-ANALYTICS-1**: Gate PostHog init on a consent flag; ship a cookie banner; default `disable_session_recording: true` until DPIA completes.
4. **S-MEDIA-1 + S-RLS-1**: Migrate chat-videos and voice-messages to private buckets + signed URLs.
5. **Verify Daily `enable_recording: false`** and confirm privacy-policy copy matches (P-RECORDING-1).
6. **S-AUTH-1**: Bump password minimum to 12 chars + zxcvbn score ≥ 2.

## 20. High priority (next 1–2 weeks)

- S-CALL-1: Drop match-call token TTL.
- S-DAILY-1: `eject_at_room_exp: true` on match-call rooms.
- S-PAY-2 / S-PAY-3 / S-EDGE-2: Webhook hardening pass.
- T-PERF-1: Route-level code splitting (start with admin, video-date, vibe-studio).
- Verify OneSignal SIGNED_IN/SIGNED_OUT-only login/logout (memory item).
- Add pgTAP tests for age-gate trigger and `block_user_with_cleanup`.
- Add Stripe-webhook handler tests with signature mocking.
- Verify account-deletion vendor cascade (RevenueCat, OneSignal, Bunny).

## 21. Medium priority (1–2 months)

- S-WEB-2: CORS allowlist instead of `*` on Edge Functions.
- T-LINT-1: Resolve the 7 VideoDate.tsx exhaustive-deps warnings.
- Add full UX dead-end pass (not done).
- Add native parity audit (not done).
- Source-map upload pipeline for Sentry on web + native.
- pgTAP coverage for RLS on profiles, messages, matches, video_sessions.

## 22. Low priority

- Lint cleanup, dead-code removal (e.g., the legacy bunny-video query token after rollout).

## 23. Recommended implementation plan (sequenced)

```
Week 1 (parallel):
  Stream A (security):     S-WEB-1 headers + S-MEDIA-1 signed URLs + S-EDGE-1 rate limit
  Stream B (privacy):      S-ANALYTICS-1 cookie banner + consent gate + DPIA
  Stream C (auth):         S-AUTH-1 password policy + verify OneSignal lifecycle
  Stream D (verify):       P-RECORDING-1 + P-DELETE-1 + missing-flows verification

Week 2:
  Webhook hardening pass (S-PAY-2/3, S-EDGE-2, S-CALL-1, S-DAILY-1)
  Stream E: route-level code splitting (T-PERF-1)
  Stream F: pgTAP tests (age trigger, block cascade, RLS sample)

Week 3-4:
  Native parity audit
  UX dead-end pass
  CORS allowlist
```

## 24. Suggested specific tests

- pgTAP: `INSERT INTO profiles WITH age = 17` must `RAISE EXCEPTION` (age trigger).
- pgTAP: After `block_user_with_cleanup(B)`, no `matches` row with the pair, no open `match_calls`, no `video_sessions` open, no `messages` deliverable.
- pgTAP: `INSERT INTO video_sessions ... AS authenticated` must fail (RLS lockdown).
- pgTAP: `UPDATE profiles SET subscription_tier = 'premium' WHERE id = auth.uid()` must fail (`protect_sensitive_profile_columns`).
- Edge: Stripe-webhook with stale event ID returns `duplicate: true`, doesn't double-grant credits.
- Edge: RevenueCat-webhook with wrong Authorization returns 401.
- Playwright: full new-user-to-completed-date with two browser contexts.

## 25. Open questions (UNKNOWN — could not verify in this pass)

1. Daily `enable_recording` setting and matching privacy-policy copy (would require reading the rest of `daily-room/index.ts` and `PrivacyPolicy.tsx`).
2. Native (Expo) parity for video date, payments, push deep-linking. Did not enter `apps/mobile/`.
3. Reporting pipeline end-to-end: `ReportWizard` → DB → `safety_alerts` → admin. Files exist; flow not traced.
4. Vibe Arcade games — six games per project context; not traced.
5. Native screenshot / screen-recording protection during a call.
6. OneSignal init/login/logout verifying `SIGNED_IN` / `SIGNED_OUT` only (not `TOKEN_REFRESHED`) — files exist, code not read.
7. Service worker (`public/sw.js` is 444 bytes — minimal) scope and behavior.
8. Whether `send-email`, `forward-geocode`, `send-support-reply`, `process-media-delete-jobs`, `event-notifications`, `send-game-event`, and ~40 other Edge Functions have similar latent issues (S-EDGE-1 was found by reading just one of them).
9. Realtime subscription scope on web and native.
10. Native store-policy posture (Apple dating-app rules, Google account-deletion-in-app).

## 26. Evidence appendix

Files read (full or substantial portion):

- `src/App.tsx`
- `src/main.tsx` head
- `vercel.json`
- `package.json`
- `supabase/config.toml`
- `AGENTS.md`
- `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/revenuecat-webhook/index.ts`
- `supabase/functions/video-webhook/index.ts`
- `supabase/functions/swipe-actions/index.ts`
- `supabase/functions/phone-verify/index.ts`
- `supabase/functions/delete-account/index.ts`
- `supabase/functions/request-account-deletion/index.ts`
- `supabase/functions/upload-image/index.ts` head
- `src/components/ProtectedRoute.tsx`
- `src/lib/phoneSignInNormalize.ts`
- `src/pages/onboarding/steps/BirthdayStep.tsx`
- `supabase/migrations/20260501112000_video_sessions_rls_write_lockdown.sql`
- `supabase/migrations/20251229003354_…sql` (proof-selfies bucket)
- `supabase/migrations/20260309050102_…sql` (chat-videos bucket initial)
- `supabase/migrations/20260311000000_chat_videos_anon_read.sql`
- `supabase/functions/daily-room/index.ts:1-2400` (of 3264)
- `supabase/functions/create-video-upload/index.ts:1-600`
- `src/pages/Auth.tsx:1-420`

Greps run (key ones): age/birthday enforcement (multi-migration), CRON_SECRET enforcement (every cron function), storage bucket policies, posthog event names, `chat-videos` references, `face-api`/`hls.js`/`@daily-co` import locations.

Tools run: `npm run typecheck:core` ✓, `npm run typecheck` (app+core+mobile) ✓, `npm run lint` ✓ (0 errors, 64 warnings).

Investigation halted at the boundary noted in section 25's UNKNOWNs — the original brief asked for full multi-domain coverage, and the parallel sub-agents I dispatched returned nothing due to platform rate limits, so this single-thread pass prioritized the highest-stakes findings rather than padding partial sections. The launch-blocker list (section 19) is the action set.
