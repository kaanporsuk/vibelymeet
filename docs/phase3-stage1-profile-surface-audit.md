# Phase 3 — Stage 1: Profile surface audit

**Scope:** Compare web profile experience to native `apps/mobile` profile. Classify each gap; propose smallest high-impact implementation sequence.

**Web source:** `src/pages/Profile.tsx`, `ProfilePhoto`, `PhotoGallery`, `VibeScore`, `VerificationBadge`, `VerificationSteps`, `RelationshipIntent`, `VibeTag`, `ProfilePrompt`, `LifestyleDetails`.  
**Native source:** `apps/mobile/app/(tabs)/profile/index.tsx`, `lib/profileApi.ts`.

---

## 1. Current mismatch summary

Each gap is classified as one of: **structural** | **visual** | **interaction** | **content hierarchy** | **missing affordance**.

### 1.1 Hero / media block structure

| # | Gap | Classification | Notes |
|---|-----|----------------|--------|
| H1 | Web: hero is gradient strip (`h-36 bg-gradient-primary`) with subtle overlay animation. Native: solid tint bar (`theme.tint`). | **Visual mismatch** | Hero reads as flat on native; web has gradient + motion. |
| H2 | Web: profile photo is `ProfilePhoto` rounded-2xl, `border-4 border-background shadow-2xl`; overlays (Camera, Video, VerificationBadge) positioned on it. Native: `Avatar` 120px in ring, same two buttons (video, camera). | **Visual mismatch** | Shape/size/border treatment differ; native has no VerificationBadge. |
| H3 | Web: Vibe Video button only when `bunnyVideoUid && bunnyVideoStatus === "ready"`. Native: video button always visible (left); behavior differs when no video. | **Interaction mismatch** | Web hides the button when no video; native shows it always (opens record flow). |
| H4 | Web: VerificationBadge on photo when `profile.verified`. Native: no badge on photo. | **Missing affordance** | Trust signal absent on native. |
| H5 | Web: top buttons are `glass-card` rounded-full. Native: `heroButtonGlass` with border. | **Visual mismatch** | Glass treatment differs. |

### 1.2 Photo gallery layout and primary-photo hierarchy

| # | Gap | Classification | Notes |
|---|-----|----------------|--------|
| P1 | Web: grid 3 cols; first photo `col-span-2 row-span-2 aspect-[4/5]`, rest `aspect-square`; "Main" badge Crown + "Main" (top-left). Native: same logic (main 2×2 cells, 4/5 aspect, rest square); "Main" badge Sparkles + "Main". | **Visual mismatch** | Icon for Main badge: web Crown, native Sparkles. |
| P2 | Web: Photos section has "Manage" opening PhotoManager drawer. Native: "Edit" / "Add photo" pill; Manage sheet for reorder/remove. | **Interaction mismatch** | Wording "Manage" vs "Edit"; both open management. |
| P3 | Web: gallery in glass-card with Camera icon + "Photos" + Manage. Native: Card with "Photos" + pill. | **Visual mismatch** | Section card and header style. |
| P4 | Web: empty state "Add" in dashed cell (in editable gallery). Profile view empty: no explicit empty cell in snippet shown. Native: single "Add your first photo" pressable with add icon. | **Content hierarchy mismatch** | Both have empty state; native is a single CTA block. |

**Summary:** Layout (main + grid, 4/5 aspect) and max 6 photos align. Differences: Main badge icon, section card treatment, and empty-state presentation.

### 1.3 Video / vibe area presence and prominence

| # | Gap | Classification | Notes |
|---|-----|----------------|--------|
| V1 | Web: Vibe Video is a **16:9 cinematic card** (rounded-2xl): thumbnail, play button (glass circle), caption overlay "Vibing on" + text, "Manage" top-right; empty: icon + copy + "Record My Vibe"; processing: spinner + copy. Native: **vertical block** (no fixed aspect): icon + copy + small player or CTAs; no thumbnail; no play overlay; no caption overlay. | **Structural mismatch** | Video block is not a 16:9 card; prominence and hierarchy differ. |
| V2 | Web: section header "Vibe Video" with optional "Processing..." subline. Native: SectionHeader "Vibe Video" only. | **Visual mismatch** | Processing state not in header on native. |
| V3 | Web: when ready, primary action is play (fullscreen); Manage is secondary. Native: "Your vibe video is ready" + inline player + "Record new" + "Delete video". | **Content hierarchy mismatch** | Web emphasizes play; native emphasizes status + actions. |
| V4 | Web: empty CTA "Record a 15-second video intro to stand out" + "Record My Vibe". Native: "Record a short video to show your vibe" + "Record vibe video". | **Content hierarchy mismatch** | Copy and CTA label differ slightly. |

### 1.4 Bio / about / prompt section ordering

| # | Gap | Classification | Notes |
|---|-----|----------------|--------|
| B1 | Section order is the same: Identity → Vibe Score → Schedule → Stats → Looking For → About Me → Conversation Starters → My Vibes → Vibe Video → Photos → Basics → Lifestyle → Verification. | — | No ordering mismatch. |
| B2 | Web: tagline is editable (click opens drawer); shows pencil; "Add tagline" when empty. Native: tagline text or "Add tagline" but tap has no dedicated handler (Edit opens global inline form). | **Missing affordance** | Native has no direct "edit tagline" affordance; Edit is generic. |
| B3 | Web: About Me in glass-card with "Edit" opening bio drawer. Native: Card with "Edit" opening inline form. | **Interaction mismatch** | Same affordance (Edit), different flow (drawer vs inline). |

### 1.5 Conversation Starters and prompts

| # | Gap | Classification | Notes |
|---|-----|----------------|--------|
| C1 | Web: shows list of ProfilePrompt (question + answer) when `profile.prompts.length > 0`; each has onEdit. Native: **only empty state** ("Add your first Conversation Starter" + subline); **does not render existing prompts**. | **Structural mismatch** | Prompts from API are not displayed on native. |
| C2 | Native `ProfileRow` / `fetchMyProfile` does not include `prompts`. Web `fetchMyProfile` returns `prompts` from profiles. | **Content hierarchy / data** | Displaying prompts requires extending native profile fetch (see §5). |

### 1.6 Vibe tags / chips treatment

| # | Gap | Classification | Notes |
|---|-----|----------------|--------|
| T1 | Web: "My Vibes" glass-card with VibeTag list (`profile.vibes.map`); empty: "No vibes yet. Add some personality!". Native: SectionHeader + Card with **only** placeholder "No vibes yet..."; **does not render existing vibes**. | **Structural mismatch** | Vibes array not shown when present. |
| T2 | Web: vibes from `profile_vibes` + vibe_tags (separate query). Native: `ProfileRow` has no `vibes`; no profile_vibes fetch. | **Content hierarchy / data** | Displaying vibes requires extending native profile fetch (see §5). |
| T3 | Web: Looking For uses RelationshipIntent (chip(s)). Native: single chip or placeholder; same intent, different chip styling. | **Visual mismatch** | Chip treatment for intent can be aligned with theme. |

### 1.7 Verification surfaces and trust/status

| # | Gap | Classification | Notes |
|---|-----|----------------|--------|
| R1 | Web: VerificationSteps (email, photo, phone) with labels and onStartStep (e.g. open photo verification, phone verification). Native: single paragraph "Verify your email, photo, and phone on vibelymeet.com...". | **Missing affordance** | No step list, no per-step actions. |
| R2 | Web: VerificationBadge on profile photo when verified. Native: none. | **Missing affordance** | Trust badge missing. |
| R3 | Web: photo verification status (pending, approved, rejected, expired) drives step description. Native: no verification state in UI. | **Content hierarchy mismatch** | Status not surfaced. |

### 1.8 Identity: Premium, zodiac, location

| # | Gap | Classification | Notes |
|---|-----|----------------|--------|
| I1 | Web: name + age + Premium chip (Crown + "Premium") when isPremium + zodiac emoji. Native: name + age only; no Premium chip; no zodiac. | **Content hierarchy mismatch** | Premium and zodiac not shown. |
| I2 | Web: location with MapPin. Native: location with location-outline; same intent. | — | Minor visual (icon). |

### 1.9 Actions and edit affordances

| # | Gap | Classification | Notes |
|---|-----|----------------|--------|
| A1 | Web: per-section "Edit" / "Manage" opens **drawers** (photos, vibes, basics, bio, prompt, tagline, intent, lifestyle, vibe-video). Native: one **inline edit** form (name, tagline, job, about_me) + separate Manage sheet for photos. | **Interaction mismatch** | Many sections share one Edit on native; no section-specific drawers. |
| A2 | Web: Vibe Score card has "Preview" + "Complete Profile" (when &lt;100). Native: only "Complete Profile" (opens inline edit); Preview opens Alert "coming to mobile soon". | **Missing affordance** | Preview exists but is degraded (alert). |
| A3 | Web: tagline click opens tagline drawer. Native: no direct tagline edit; Edit opens full form. | **Missing affordance** | No focused tagline edit. |

### 1.10 Empty-state handling

| # | Gap | Classification | Notes |
|---|-----|----------------|--------|
| E1 | Web: Conversation Starters empty = dashed card with icon + "Add your first Conversation Starter" + subline. Native: same copy and structure (SectionHeader + Card with icon + title + sub). | — | Aligned. |
| E2 | Web: My Vibes empty = "No vibes yet. Add some personality!". Native: same copy in Card. | — | Aligned. |
| E3 | Web: Vibe Video empty = 16:9 card with icon + copy + "Record My Vibe". Native: block with icon + copy + "Record vibe video". | **Visual mismatch** | Card shape and prominence. |
| E4 | Web: Photos empty = (in Manage) add button. On profile, PhotoGallery shows grid; if 0 photos, web may show add state. Native: single "Add your first photo" pressable. | **Visual mismatch** | Empty state layout (single block vs possible dashed area). |
| E5 | Lifestyle: web shows LifestyleDetails (key-value rows) or empty. Native: placeholder text only; no key-value rows even when data could exist. | **Structural mismatch** | Lifestyle content not rendered; native fetch doesn’t include lifestyle. |

### 1.11 Section spacing, headers, separators, and card treatment

| # | Gap | Classification | Notes |
|---|-----|----------------|--------|
| S1 | Web: main `pt-20 space-y-5`; sections are `glass-card p-4` or `p-5`; motion stagger. Native: `styles.main` padding; Card; no consistent `space-y-5` equivalent (e.g. spacing['2xl']); no glass-card. | **Visual mismatch** | Spacing and card treatment (glass vs Card). |
| S2 | Web: section titles `font-display font-semibold`. Native: mix of `styles.cardTitle` and SectionHeader; VibelyText not used for section titles. | **Visual mismatch** | Typography not aligned to design tokens. |
| S3 | Web: no explicit separators between sections; cards are the grouping. Native: same (cards only). | — | Aligned. |
| S4 | Web: Stats are 3 glass-cards in a row. Native: 3 cards (theme.surface, border). | **Visual mismatch** | Glass vs solid card. |
| S5 | Native: main padding uses `spacing.lg`; dashboard uses `layout.containerPadding`. Profile does not use shared layout constants for horizontal padding or section gap. | **Visual mismatch** | Inconsistent use of layout tokens. |

---

## 2. Ordered fix list (smallest high-impact for profile parity)

Priority order: fix structural/data gaps first so content appears, then visual and hierarchy, then interaction/affordance polish.

| Order | Fix | Rationale |
|-------|-----|-----------|
| 1 | **Extend native profile fetch** to include `prompts`, `vibes` (via profile_vibes/vibe_tags or profiles if denormalized), `lifestyle`, `vibe_caption`, and optionally `photo_verified` for badge. Same Supabase tables; no backend service change. | Unblocks rendering of Conversation Starters, My Vibes, Lifestyle, and verification badge. |
| 2 | **Render Conversation Starters** when `profile.prompts?.length > 0`: list of Q/A rows; keep existing empty state when none. | Removes structural mismatch C1; high impact. |
| 3 | **Render My Vibes** when `profile.vibes?.length > 0`: chips/tags (e.g. Chip); keep "No vibes yet" when empty. | Removes structural mismatch T1. |
| 4 | **Verification section**: replace single paragraph with step list (email, photo, phone) and actions (e.g. "Verify on web" or open verification flows). Optionally show VerificationBadge on photo when `photo_verified`. | Addresses R1, R2, R3. |
| 5 | **Identity block**: add Premium chip when premium, zodiac emoji when available (derive from birth_date). | Addresses I1. |
| 6 | **Hero**: use gradient (GradientSurface or equivalent) instead of solid tint; align top buttons to glass style. | Addresses H1, H5. |
| 7 | **Vibe Video block**: reshape to 16:9 card: thumbnail, play overlay, caption strip when ready; empty/processing as in web. | Addresses V1–V4. |
| 8 | **Section cards and rhythm**: use Card variant="glass" (or glass-like styles) and shared layout constants (container padding, section gap); use VibelyText for section titles. | Addresses S1, S2, S4, S5. |
| 9 | **Photos section**: align Main badge to web (Crown icon if available, or keep Sparkles with same label); ensure card styling matches other sections. | Addresses P1, P3. |
| 10 | **Lifestyle**: when `profile.lifestyle` has keys, render key-value rows; else keep placeholder. | Addresses E5. |
| 11 | **Edit affordances**: keep current inline/sheet pattern; add "Preview" that opens web or in-app preview if available. Tagline: optional direct edit (e.g. tap opens inline field or sheet). | Addresses A2, A3 as polish. |

---

## 3. Files to touch

| File | Changes |
|------|---------|
| `apps/mobile/lib/profileApi.ts` | Extend `ProfileRow` and `fetchMyProfile` to include `prompts`, `vibes` (from profile_vibes + vibe_tags or profiles), `lifestyle`, `vibe_caption`, `photo_verified`; align types with web where applicable. |
| `apps/mobile/app/(tabs)/profile/index.tsx` | (2) Render prompts list; (3) render vibes as chips; (4) verification steps + badge; (5) Premium + zodiac; (6) hero gradient + glass buttons; (7) Vibe Video 16:9 card; (8) glass cards + layout + VibelyText; (9) Photos Main badge/card; (10) Lifestyle rows; (11) Preview/tagline affordances. |
| `apps/mobile/constants/theme.ts` | Only if new tokens needed (e.g. profile section gap); otherwise reuse existing. |
| `apps/mobile/components/ui.tsx` | Only if new primitive needed (e.g. VerificationBadge); otherwise reuse Card, Chip, SectionHeader, VibelyText. |

---

## 4. Shared primitive extensions

| Primitive | Extension needed? | Notes |
|-----------|-------------------|--------|
| **Card** | No | Already has variant="glass"; use it for profile sections. |
| **Chip** | No | Use for vibes and intent. |
| **VibelyText** | No | Use for section titles and body. |
| **SectionHeader** | No | Already used. |
| **Avatar** | No | Keep; optional VerificationBadge overlay as separate element. |
| **GradientSurface** | No | Exists; use for hero or document fallback. |
| **VerificationBadge** | **Yes (optional)** | Small component for photo overlay when verified; can be inline in profile screen first. |
| **Layout constants** | No | Use existing `layout.containerPadding`, `spacing['2xl']` for section gap. |

No mandatory new primitives; one optional (VerificationBadge) for trust surface parity.

---

## 5. Backend / public contract implication

| Item | Implication |
|------|-------------|
| **Profile fetch** | **Yes.** Native `fetchMyProfile` and `ProfileRow` today do not include `prompts`, `vibes`, `lifestyle`, `vibe_caption`, `photo_verified`. Web fetches these from `profiles` (and `profile_vibes` for vibes). To achieve profile surface parity for Conversation Starters, My Vibes, Lifestyle, and verification: **extend the native profile API** to select/join the same fields. This uses existing Supabase tables and RLS; no new backend service or edge function. |
| **Supabase schema** | No change. Web already reads `profiles.prompts`, `profiles.lifestyle`, `profiles.vibe_caption`, `profiles.photo_verified`, and `profile_vibes` + `vibe_tags`. |
| **Public surface** | `ProfileRow` type and the shape returned by `fetchMyProfile` become the shared contract. Adding optional fields is additive; any consumer that only reads existing fields remains valid. |

**Conclusion:** Profile surface parity **does** implicate extending the **native client-side profile fetch** (and thus the TypeScript contract for profile data). It does **not** require backend or provider changes.
