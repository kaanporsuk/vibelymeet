# Phase 3B — Completion plan: unresolved parity-critical items

**Purpose:** Close Phase 3 by implementing the parity-critical items that were deferred in Stages 1–5.

---

## 1. Exact unresolved items (from Phase 3 Stage 1 audit and closure)

| # | Item | Source | Status before 3B |
|---|------|--------|------------------|
| 1 | **Native profile fetch** does not include prompts, vibes, lifestyle, vibe_caption, photo_verified, phone_verified, is_premium, premium_until | Stage 1 §5 | Data missing; Conversation Starters, My Vibes, Lifestyle, Verification, identity Premium cannot render from API |
| 2 | **Conversation Starters** only empty state; no list when `profile.prompts` exists | C1 | Not rendered |
| 3 | **My Vibes** only placeholder; no chips when `profile.vibes` exists | T1 | Not rendered |
| 4 | **Lifestyle** only placeholder; no key-value rows when `profile.lifestyle` exists | E5 | Not rendered |
| 5 | **Identity row** missing zodiac and Premium chip (derivable from birth_date and is_premium) | I1 | Not shown |
| 6 | **Verification** step list does not reflect actual photo_verified / phone_verified state | R2, R3 | Hardcoded "Verified" / "Verify on web" |
| 7 | **VerificationBadge** on profile photo when verified | H4 | Missing |
| 8 | **Hero** solid tint instead of gradient; no gradient treatment | H1 | Solid only |
| 9 | **Vibe Video** not a 16:9 card with thumbnail, play overlay, caption hierarchy | V1–V4 | Vertical block, no thumbnail/caption |
| 10 | **Settings Premium** generic row; web has stateful Premium card (Premium status vs Upgrade CTA) | — | Single generic row |
| 11 | **Settings Credits** subtitle static; web shows dynamic (Premium · Expires … or X Extra Time · Y Extended Vibe) | — | Static |
| 12 | **Settings delete-account** single Alert; no stronger confirmation flow | — | One-step only |

---

## 2. Implementation plan (priority order)

| Step | Task | Files |
|------|------|--------|
| 1 | Extend native profile fetch additively: profiles select lifestyle, prompts, vibe_caption, photo_verified, phone_verified, is_premium, premium_until; profile_vibes + vibe_tags for vibes; add ProfileRow fields; no schema change | `apps/mobile/lib/profileApi.ts` |
| 2 | Add zodiac helpers (getZodiacSign, getZodiacEmoji) for native; derive from birth_date | `apps/mobile/lib/profileApi.ts` (or small util) |
| 3 | Profile: render Conversation Starters list when prompts exist; keep empty state | `apps/mobile/app/(tabs)/profile/index.tsx` |
| 4 | Profile: render My Vibes chips when vibes exist; keep placeholder when empty | `apps/mobile/app/(tabs)/profile/index.tsx` |
| 5 | Profile: render Lifestyle key-value rows when lifestyle exists; keep placeholder | `apps/mobile/app/(tabs)/profile/index.tsx` |
| 6 | Profile: identity row — add zodiac emoji (from birth_date), Premium chip (from is_premium) | `apps/mobile/app/(tabs)/profile/index.tsx` |
| 7 | Profile: verification steps — Email verified; Photo/Phone from profile.photo_verified, profile.phone_verified | `apps/mobile/app/(tabs)/profile/index.tsx` |
| 8 | Profile: VerificationBadge on hero photo when profile.photo_verified | `apps/mobile/app/(tabs)/profile/index.tsx` |
| 9 | Profile: hero gradient (GradientSurface or theme gradient token) | `apps/mobile/app/(tabs)/profile/index.tsx` |
| 10 | Profile: Vibe Video 16:9 card — thumbnail, play overlay, caption (vibe_caption) when ready; empty/processing states | `apps/mobile/app/(tabs)/profile/index.tsx` |
| 11 | Settings: Premium card stateful (useBackendSubscription); show Premium status + Manage or Upgrade CTA | `apps/mobile/app/settings/index.tsx` |
| 12 | Settings: Credits subtitle dynamic (useCredits + useBackendSubscription for premium_until) | `apps/mobile/app/settings/index.tsx` |
| 13 | Settings: delete-account two-step confirmation (native-only) | `apps/mobile/app/settings/index.tsx` |

---

## 3. Exact files to change

| File | Changes |
|------|---------|
| `apps/mobile/lib/profileApi.ts` | Add to ProfileRow: prompts, vibes, lifestyle, vibe_caption, photo_verified, phone_verified, is_premium, premium_until. Extend select; add profile_vibes query; add getZodiacSign, getZodiacEmoji. |
| `apps/mobile/app/(tabs)/profile/index.tsx` | Use new profile fields; render prompts list, vibes chips, lifestyle rows; identity zodiac + Premium; verification from data; VerificationBadge on photo; hero gradient; Vibe Video 16:9 card with thumbnail/caption. |
| `apps/mobile/app/settings/index.tsx` | useBackendSubscription for Premium card (stateful); useCredits + subscription for Credits subtitle; two-step delete confirmation. |
| `apps/mobile/app/settings/credits.tsx` | Optional: export useCredits or keep hook local and duplicate minimal credits fetch in Settings. Prefer reusing: create a small `useCredits` in a shared lib or export from credits screen. |

---

## 4. Additive native data-fetch extension

**Yes.** `profileApi.ts` will:

- **Select** from `profiles`: add `lifestyle, prompts, vibe_caption, photo_verified, phone_verified, is_premium, premium_until`. (vibe_video_status if column exists — web uses it; migrations show vibe_video_status.)
- **Query** `profile_vibes` with `vibe_tags(label)` for current user, map to `vibes: string[]`.
- **ProfileRow** type: add optional fields so existing consumers remain valid.

No backend/schema/provider changes. All columns and tables exist; RLS unchanged.

---

## 5. Implementation

To be done in code below.

---

## 6. Closure report (after implementation)

Will separate: **completed** (done in 3B), **intentionally deferred** (out of scope or design choice), **blocked** (backend/data limit).
