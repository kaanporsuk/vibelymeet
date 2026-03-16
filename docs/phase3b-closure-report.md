# Phase 3B — Closure report: parity-critical completion

**Purpose:** Implement the parity-critical items that were deferred in Phase 3 Stages 1–5. This report separates **completed**, **intentionally deferred**, and **blocked** items.

---

## 1. Completed parity items (Phase 3B)

| Item | Implementation |
|------|-----------------|
| **Native profile data** | `profileApi.ts`: extended select with `lifestyle`, `prompts`, `vibe_caption`, `photo_verified`, `phone_verified`, `is_premium`, `premium_until`; added `profile_vibes` + `vibe_tags(label)` for `vibes`; added `getZodiacSign` / `getZodiacEmoji`. |
| **Conversation Starters list** | When `profile.prompts?.length > 0`, render glass card with Q/A rows and Edit link; else keep pressable empty card. |
| **My Vibes chips** | When `profile.vibes?.length > 0`, render `Chip` list; else "No vibes yet" placeholder. |
| **Lifestyle rows** | When `profile.lifestyle` has keys with non-empty values, render key-value rows (same style as Basics); else helper text. |
| **Identity: zodiac + Premium** | Identity row: name/age + Premium chip (when `profile.is_premium`) + zodiac emoji (from `profile.birth_date`). |
| **Verification from data** | Email always "Verified"; Photo step shows "Verified" + check when `profile.photo_verified`, else "Verify on web" + link; Phone step same for `profile.phone_verified`. |
| **VerificationBadge on photo** | When `profile.photo_verified`, show shield-checkmark badge on hero photo container. |
| **Hero gradient** | Hero strip uses `GradientSurface` variant="primary" (solid fallback from gradient token). |
| **Vibe Video 16:9 card** | 16:9 aspect card: thumbnail (Bunny CDN), play overlay (opens fullscreen modal), caption strip ("Vibing on" + `vibe_caption`), actions (Record new, Delete). Empty: "Record a 15-second video intro to stand out" + "Record My Vibe". Added `getVibeVideoThumbnailUrl`, fullscreen Modal with `VibeVideoPlayer`. |
| **Settings Premium card** | Stateful: when `useBackendSubscription` isPremium, show "✦ Vibely Premium", "Renews …", "Manage Subscription" (create-portal-session + open URL); else "Upgrade to Premium" + "Unlock all features" → `/premium`. |
| **Settings Credits subtitle** | Dynamic: when isPremium && currentPeriodEnd → "Premium · Expires …"; else useCredits → "X Extra Time · Y Extended Vibe"; fallback "Extra Time · Extended Vibe". |
| **Delete-account UX** | Two-step confirmation: first "Delete your account?" + Continue/Cancel; second "This is permanent" + Delete/Cancel. On Delete, call existing delete-account flow. |

---

## 2. Intentionally deferred (not in 3B scope)

| Item | Reason |
|------|--------|
| **Per-section edit drawers** | Web uses drawers per section; native keeps single inline edit form + Manage sheet for photos. Accepted as different UX. |
| **Tagline direct edit** | Web has tagline drawer; native Edit opens full form. No dedicated tagline-only edit in 3B. |
| **Preview profile in-app** | Web has ProfilePreview; native "Preview" opens Alert "coming to mobile soon" + web link. Full in-app preview left for later. |
| **Notifications / Privacy in-app toggles** | Web has drawers with toggles; native routes to sub-screens or web. No new toggles in 3B. |
| **Hero animated gradient** | Web has motion overlay; native uses GradientSurface solid. Animated gradient would require extra deps or native code. |
| **Runtime gradient on hero** | GradientSurface remains solid (no expo-linear-gradient); first token used. Documented in Phase 1. |

---

## 3. Blocked (backend / data / platform limits)

| Item | Blocker |
|------|--------|
| **Photo verification status (pending/rejected/expired)** | Web fetches `photo_verifications` and `photo_verification_expires_at` for granular status. Native uses only `profiles.photo_verified` boolean. Showing "Under review" / "Expired" would require native to query `photo_verifications` or profiles.photo_verification_expires_at if available; not done in 3B to avoid scope creep. |
| **Manage Subscription on native without browser** | create-portal-session returns Stripe portal URL; we open it via Linking. If the app never opens browser or Stripe doesn’t support deep link back, user must re-open app. No native in-app portal; same as web (redirect). |

---

## 4. Files changed (Phase 3B)

| File | Changes |
|------|---------|
| `apps/mobile/lib/profileApi.ts` | ProfileRow extended (prompts, vibes, lifestyle, vibe_caption, photo_verified, phone_verified, is_premium, premium_until). fetchMyProfile: profiles select + profile_vibes query; return mapped. getZodiacSign, getZodiacEmoji, ZODIAC_EMOJI added. |
| `apps/mobile/lib/vibeVideoPlaybackUrl.ts` | getVibeVideoThumbnailUrl added. |
| `apps/mobile/app/(tabs)/profile/index.tsx` | GradientSurface hero; VerificationBadge on photo; identity row (zodiac, Premium chip); Conversation Starters list or empty card; My Vibes chips or placeholder; Lifestyle rows or placeholder; Verification steps from profile.photo_verified/phone_verified; Vibe Video 16:9 card (thumbnail, play, caption, fullscreen Modal). New styles and state (showVibeVideoFullscreen). |
| `apps/mobile/app/settings/index.tsx` | useBackendSubscription, useCredits, formatDate; stateful Premium card; dynamic Credits subtitle; two-step delete (handleDeleteAccount → confirmDeleteAccount). New styles (premiumCardInner, etc.). |
| `docs/phase3b-completion-plan.md` | New — plan. |
| `docs/phase3b-closure-report.md` | New — this report. |

---

## 5. Backend / contract

- **No schema or provider changes.** All new profile fields and profile_vibes come from existing tables and RLS.
- **Additive only:** ProfileRow and fetchMyProfile return extra fields; existing callers that ignore them are unchanged.
- **Settings:** Uses existing `subscriptions`, `user_credits`, `create-portal-session`, `delete-account`.

---

## 6. Phase 3 status after 3B

**Phase 3 (Profile + Settings parity) is complete** with Phase 3B. Parity-critical items from the Stage 1 audit that could be fulfilled with existing backend data and no new provider/schema work are implemented. Remaining gaps are either deferred by product choice or blocked by data/UX limits and are documented above.
