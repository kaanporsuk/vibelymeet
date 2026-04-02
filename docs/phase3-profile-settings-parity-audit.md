# Phase 3 — Profile & Settings parity audit

**Branch:** `feat/mobile-phase3-profile-settings-parity`  
**Scope:** Audit only (no implementation in this pass).  
**Source of truth:** Web `src/pages/Profile.tsx`, `src/pages/Settings.tsx`, and related components.

---

## 1. Profile — Web vs Native

### 1.1 Structure and information architecture

| Block | Web | Native | Gap |
|-------|-----|--------|-----|
| **Hero** | Gradient strip (`bg-gradient-primary` h-36), overlay animation; top-left Preview, top-right Settings | Solid tint bar (`theme.tint`), same two buttons (Preview, Settings) | Hero is solid, not gradient; no gradient/glass treatment |
| **Profile photo** | Centered `ProfilePhoto` (rounded-2xl, border-4 border-background), Camera button (bottom-right), Vibe Video button (bottom-left if ready), VerificationBadge (top-right if verified) | Centered `Avatar` (120px) in ring, video button (left), camera button (right); no VerificationBadge | No verification badge; no zodiac on avatar area |
| **Identity** | Name + age, Premium chip (Crown), zodiac emoji; tagline (editable, italic primary); location (MapPin) | Name + age, tagline, location; no Premium chip; no zodiac | Missing Premium chip and zodiac in identity |
| **Vibe Score** | `glass-card` with VibeScore (ring), "Your Vibe Score", copy, Preview + Complete Profile buttons | `Card` with VibeScoreDisplay, same copy, single "Complete Profile" → inline edit | Same intent; card styling (glass vs Card); Preview opens Alert "coming soon" on native |
| **My Vibe Schedule** | glass-card, icon (CalendarDays), title, subtitle "Set when you're open for dates", ChevronRight → `/schedule` | Card + SettingsRow, "Manage on web" → Alert + link | Copy/subtitle differs; both link to web for schedule |
| **Stats** | 3 glass-cards: Events, Matches, Convos (icon, value gradient-text, label) | 3 stat cards (theme.surface, border), same labels | Visual: web glass-card vs native Card; values from profile |
| **Looking For** | glass-card, Target icon, "Looking For", Edit → drawer; RelationshipIntent (chips) | Card, flag icon, "Edit" → inline edit; single chip or placeholder | Section styling; edit flow (drawer vs inline) |
| **About Me** | glass-card, "About Me", Edit → drawer; body text | Card, same; Edit → inline edit | Same content; edit flow differs |
| **Conversation Starters** | Section header; list of ProfilePrompt (Q/A) or dashed empty CTA "Add your first Conversation Starter" | SectionHeader + single empty-state Card only; **prompts from API are not rendered** | **Functional gap:** native does not display existing prompts; only empty CTA |
| **My Vibes** | glass-card, Sparkles, "My Vibes", Edit → drawer; VibeTag list or "No vibes yet" | SectionHeader + Card with "No vibes yet"; Edit → inline edit | Vibes list not shown when present; section styling |
| **Vibe Video** | 16:9 cinematic card (rounded-2xl), thumbnail, play button (glass circle), caption overlay "Vibing on" + text, Manage (top-right); empty: icon + "Record a 15-second video" + "Record My Vibe"; processing: spinner + copy | Vertical block with icon + copy + small player or CTAs; no 16:9 aspect; no thumbnail/play overlay; states: uploading, processing, ready, failed, none | **Visual/structure gap:** web has 16:9 card with thumbnail, play overlay, caption; native is stacked block |
| **Photos** | glass-card, Camera icon, "Photos", Manage → PhotoManager drawer; PhotoGallery (grid) | Card, "Photos", "Edit" / "Add photo" pill; same 1+5 grid (main + cells), Main badge; Manage sheet for reorder/remove | Grid parity; "Manage" vs "Edit" wording; card styling |
| **The Basics** | glass-card, "The Basics", Edit → drawer; 2×2 grid (Birthday, Work, Height, Location) in rounded-xl bg-secondary/40 | Card, same 4 items in basicsGrid (theme.surfaceSubtle); Edit → inline | Same data; card/row styling (glass, rounded-xl vs native) |
| **Lifestyle** | glass-card, LifestyleDetails (key-value rows), Edit → drawer | Card, placeholder text only; Edit → inline | Native shows placeholder only; no lifestyle data displayed |
| **Verification** | VerificationSteps (email, photo, phone) with step labels and actions (e.g. open photo verification) | Card, single paragraph: "Verify your email, photo, and phone on vibelymeet.com..." | **Functional gap:** web has actionable steps; native is text-only CTA to web |
| **Invite Friends** | (Optional / elsewhere on web) | Card + SettingsRow "Invite Friends", "Share Vibely with your friends" | Native has explicit row; parity of copy |
| **Log out** | (On Settings page) | DestructiveRow at bottom of profile | Web profile does not show Log out; native does — acceptable if design choice |

### 1.2 Media and photo treatment

- **Web:** ProfilePhoto (first photo or avatar_url), rounded-2xl, border-4; PhotoGallery with main + grid; aspect 4/5 for main tile; Manage opens PhotoManager (reorder, add, remove).
- **Native:** Avatar 120px, ring; photo grid with main (2 cells wide, 4/5 aspect) + 5 smaller; "Main" badge on first; Manage sheet (reorder, add, remove). Same max 6 photos.
- **Gap:** Border/ring treatment and card radii (web glass-card vs Card). No functional difference for count or management.

### 1.3 Section hierarchy, spacing, and rhythm

- **Web:** `max-w-lg mx-auto px-4 pt-20 space-y-5`; each section `glass-card p-4` or `p-5`; motion delays for stagger; section titles `font-display font-semibold`.
- **Native:** `styles.main` with vertical stacking; Card with internal padding; no consistent use of `layout.containerPadding` or `spacing['2xl']` section gaps; mix of raw `Text` and typography tokens; **VibelyText not used** for section titles (profile uses `styles.cardTitle` etc.).
- **Gap:** Spacing/rhythm not aligned to theme constants; typography not consistently via VibelyText/typography scale; no glass-card equivalent (Card variant="glass" exists in ui).

### 1.4 Chips, badges, status rows

- **Web:** Premium chip (Crown + "Premium"); zodiac emoji; VerificationBadge on photo; VibeTag for vibes; RelationshipIntent chips; "Main" on photo gallery implied by order.
- **Native:** No Premium chip; no zodiac; no VerificationBadge; Looking For single chip or placeholder; "Main" badge on first photo; no VibeTag list when vibes exist.
- **Gap:** Premium and zodiac missing in identity; VerificationBadge missing; vibes not rendered as tags.

### 1.5 Edit affordances

- **Web:** Per-section "Edit" / "Manage" opens **drawers** (photos, vibes, basics, bio, prompt, tagline, intent, lifestyle, vibe-video); each drawer has its own form and Save.
- **Native:** Single **inline edit mode** (name, tagline, job, about_me) at bottom; "Edit" on multiple sections toggles same inline form; no section-specific drawers. Photos use a separate Manage sheet.
- **Gap:** Web uses many drawers; native uses one inline form. Aligning "edit affordance" without redesigning product logic means: keep native inline/sheet pattern but ensure all sections that are editable on web have a clear path on native (e.g. "Edit" could open web for basics/lifestyle/prompts/vibes, or we add minimal native editors). Parity of *affordance* (visible "Edit") is partly there; parity of *flow* (drawer per section) would be a larger change.

### 1.6 Verification surfaces

- **Web:** VerificationSteps (email done, photo with status, phone); clicking step opens SimplePhotoVerification or PhoneVerification; badge on photo when verified.
- **Native:** Single text block directing user to web; no steps, no photo/phone verification UI.
- **Gap:** No verification steps or actions on native; badge not shown. Backend (profiles.photo_verified, phone_verified, etc.) is shared; only UI is missing.

### 1.7 Destructive actions and helper text

- **Web:** Log out and Delete Account live on Settings; DeleteAccountModal with reason selection and "DELETE" confirm.
- **Native:** Profile has Log out (DestructiveRow); Settings has Log out and Delete My Account (Alert with confirm). No reason selection; no "DELETE" type-to-confirm.
- **Gap:** Delete flow is simpler on native (Alert vs modal with reasons and confirm text). Helper text for danger zone is present on both.

---

## 2. Settings — Web vs Native

### 2.1 Information architecture

| Block | Web | Native | Gap |
|-------|-----|--------|-----|
| **Header** | Sticky `glass-card` border-b, back + "Settings", max-w-lg mx-auto px-4 py-4 | GlassSurface + ScreenHeader "Settings", onBack | Dashboard/Events/Matches use GlassHeaderBar; Settings uses GlassSurface + ScreenHeader. Inconsistent shell. |
| **Premium** | PremiumSettingsCard: if premium → Crown, "Vibely Premium", renews date, "Manage Subscription"; else → gradient border card, "Upgrade to Premium", "Go Premium" | Single SettingsRow: "Premium", "Upgrade for full access" → /premium | **Content gap:** no Premium status (renews date) or Manage Subscription on native; card is row-only. |
| **Credits** | glass-card: icon (Zap), "Video Date Credits", subtitle (Premium expiry or "X Extra Time · X Extended Vibe"), ChevronRight → /credits | SettingsRow: "Video Date Credits", "Extra Time · Extended Vibe" (static) → /settings/credits | Subtitle on native is static; web shows dynamic credits/premium. Credits screen exists and shows balance. |
| **Notifications** | glass-card row → opens NotificationsDrawer (toggles, etc.) | SettingsRow → /settings/notifications (screen with "open on web" CTA) | Web: drawer with toggles; native: sub-screen with link. |
| **Privacy** | glass-card row → opens Privacy drawer (toggles: Online Status, Last Seen, Read Receipts, Location Discovery, Show Age) | SettingsRow → Linking.openURL(vibelymeet.com/settings) | Web: drawer with toggles; native: external link only. |
| **Account** | glass-card row → AccountSettingsDrawer (email, password, phone verification, delete link) | SettingsRow → /settings/account (email + "Open account settings on web") | Web: full drawer; native: minimal screen + web link. |
| **Quick links** | Outline Buttons: How Vibely Works, Help & Feedback, Privacy Policy, Terms of Service; Log out (ghost destructive) | "QUICK LINKS" label + Card with 4 SettingsRows (same four); DestructiveRow Log out | Same links; web uses button style, native uses SettingsRow in Card. Visual hierarchy (section label, spacing) similar. |
| **Danger Zone** | border-t border-destructive/20, "Danger Zone" title, "Delete My Account" button | borderTopWidth, "DANGER ZONE", DestructiveRow "Delete My Account" | Aligned. |
| **Log out** | AlertDialog: "Log out?", "You'll need to sign in again...", Cancel / Log Out | Alert.alert same copy | Aligned. |
| **Delete account** | DeleteAccountModal (drawer): reason dropdown, type "DELETE" to confirm, isDeleting state | Alert.alert with confirm; then POST delete-account | No reason selection; no type-to-confirm on native. |
| **Feedback** | "Help & Feedback" opens FeedbackDrawer | "Help & Feedback" → web link | No native FeedbackDrawer. |
| **DeletionRecoveryBanner** | (If applicable on web) | Not present | Only if web shows it on Settings. |

### 2.2 Row patterns, toggles, grouping

- **Web:** Each top-level block is a glass-card; primary blocks (Premium, Credits, Notifications, Privacy, Account) are single rows with icon (in rounded-xl box), title, subtitle, ChevronRight; Quick links are outline Button rows; Log out and Danger Zone are separate.
- **Native:** Card wraps each primary block; SettingsRow (icon, title, subtitle, onPress); Quick links grouped in one Card with multiple SettingsRows; DestructiveRow for Log out and Delete.
- **Gap:** Structure is similar. Differences: Premium card content (status vs row); Credits subtitle not dynamic on main Settings; no toggles on native (Notifications/Privacy open web or sub-screens).

### 2.3 Footer and spacing

- **Web:** `pb-24`; main `py-6 space-y-4`; Danger Zone `pt-6 border-t`.
- **Native:** `paddingBottom: spacing['2xl'] + layout.tabBarScrollPadding`; main `paddingHorizontal: spacing.lg`, `paddingBottom: spacing.xl`; dangerZone `marginTop: spacing.xl, paddingTop: spacing.lg`. Aligned intent; native could use same layout constants as dashboard for consistency.

---

## 3. Shared primitives and dependencies

Already available in `apps/mobile` from Phase 1/2:

- **Card**, **Card variant="glass"** (theme.surfaceSubtle, theme.glassBorder, shadows.card)
- **GlassHeaderBar**, **GlassSurface**
- **ScreenHeader**
- **SettingsRow**, **DestructiveRow**
- **VibelyText** (titleXL, titleLG, titleMD, titleSM, body, caption, overline)
- **VibelyButton**, **VibelyInput**
- **Avatar**, **Chip**
- **SectionHeader**
- **spacing**, **radius**, **typography**, **layout**, **shadows**, **border** from theme
- **Colors[colorScheme]** (theme.tint, theme.danger, theme.neonCyan, theme.text, theme.textSecondary, theme.surface, theme.surfaceSubtle, theme.glassBorder, etc.)

Profile-specific: **VibeScoreDisplay** should reflect **`profiles.vibe_score`** / **`vibe_score_label`** from the server (triggers + `calculate_vibe_score(uuid)`). The deprecated web helper [`src/utils/calculateVibeScore.ts`](../src/utils/calculateVibeScore.ts) is not authoritative. Native has no duplicate local completeness scorer in-repo; show persisted fields like web.

No new primitives are strictly required for visual parity; gaps are mostly usage of existing Card/glass, VibelyText, layout constants, and optional additions (e.g. a small VerificationBadge component, or reusing Chip for Premium).

---

## 4. Recommended implementation order

1. **Settings shell and Premium/Credits (high impact, low risk)**  
   - Use **GlassHeaderBar** on Settings index (and optionally account/notifications/credits) for consistency with Dashboard/Matches.  
   - Add a **Premium card** that mirrors web: show Premium status + "Manage Subscription" when premium, or "Upgrade to Premium" / "Go Premium" when not (data from existing hooks or profile).  
   - Make **Credits row** subtitle dynamic (e.g. from useCredits/usePremium) on main Settings screen.

2. **Profile shell and hero**  
   - Align profile hero to web: gradient or gradient-placeholder (GradientSurface) instead of solid tint; keep same buttons.  
   - Use **VibelyText** for name, tagline, section titles; add **Premium chip** (Chip or inline) and **zodiac** when data exists.  
   - Optionally add **VerificationBadge** on photo when `profile.photo_verified` (or equivalent); link Verification section to web or minimal native step list.

3. **Profile section cards and rhythm**  
   - Use **Card variant="glass"** (or theme.surfaceSubtle + glassBorder + shadows.card) for profile sections to match web glass-card.  
   - Apply **layout.containerPadding** / **spacing['2xl']** for main padding and section gaps; use **SectionHeader** + VibelyText consistently.

4. **Conversation Starters and My Vibes**  
   - **Conversation Starters:** If profile has `prompts` (or equivalent from fetchMyProfile), render them (e.g. Q/A rows or simple cards); keep empty state when none.  
   - **My Vibes:** If profile has `vibes` array, render as chips/tags (Chip or VibeTag-like); keep "No vibes yet" when empty.

5. **Vibe Video card (profile)**  
   - Reshape to **16:9** card: thumbnail, play overlay, caption at bottom, Manage when ready; empty and processing states as in web. Reuse existing playback and delete logic.

6. **Verification section (profile)**  
   - Replace single paragraph with a **step list** (email, photo, phone) and actions (e.g. "Verify on web" or future native verification flows). No backend change.

7. **Settings sub-screens**  
   - Align account, notifications, credits headers to **GlassHeaderBar**; keep content as-is or add one-line copy from web.  
   - Optionally: native **Delete account** flow with reason picker and type-to-confirm (mirror DeleteAccountModal) without changing backend contract.

8. **Lifestyle (profile)**  
   - If profile API returns lifestyle fields, display key-value rows; else keep placeholder and "Edit" → web. No new backend.

---

## 5. Files to change first (by implementation order)

| Order | File(s) | Change |
|-------|---------|--------|
| 1 | `apps/mobile/app/settings/index.tsx` | GlassHeaderBar; Premium card (status or upgrade CTA); Credits row dynamic subtitle. |
| 2 | `apps/mobile/app/(tabs)/profile/index.tsx` | Hero gradient (or GradientSurface); VibelyText for identity/sections; Premium chip + zodiac; optional VerificationBadge. |
| 3 | `apps/mobile/app/(tabs)/profile/index.tsx` | Card variant="glass" (or glass-like styles); layout constants; SectionHeader + VibelyText. |
| 4 | `apps/mobile/app/(tabs)/profile/index.tsx` | Render prompts list when present; render vibes as chips when present. |
| 5 | `apps/mobile/app/(tabs)/profile/index.tsx` | Vibe Video: 16:9 container, thumbnail, play overlay, caption, Manage. |
| 6 | `apps/mobile/app/(tabs)/profile/index.tsx` | Verification: step list (email, photo, phone) + actions. |
| 7 | `apps/mobile/app/settings/account.tsx`, `notifications.tsx`, `credits.tsx` | GlassHeaderBar (or shared back-header pattern). |
| 8 | `apps/mobile/app/settings/index.tsx` (optional) | Delete flow: reason + type-to-confirm modal/screen. |

Dependencies: `lib/profileApi` (fetchMyProfile shape for prompts/vibes/lifestyle), `lib/creditsCheckout` or credits hook, existing premium/credits hooks. No new API contracts required for the above.

---

## 6. Backend / shared-contract confirmation

- **Profile:** fetchMyProfile, updateMyProfile, and profile fields (photos, prompts, vibes, lifestyle, verification flags, etc.) are already used on native. Rendering prompts/vibes/lifestyle and verification steps is UI-only. No backend or shared-contract changes required.
- **Settings:** useCredits, usePremium/useSubscription (or equivalent), delete-account edge function are already used. Premium card and Credits subtitle are presentational; Delete flow improvements (reason, confirm text) can stay client-only. No backend or provider changes required for this phase.
- **Routes/config:** No route removal or silent config changes. Adding new screens or modals (e.g. delete confirmation) will be explicit and documented.

---

## 7. Summary

| Area | Critical gaps | Medium gaps | Low / polish |
|------|----------------|------------|--------------|
| **Profile** | Conversation Starters not rendered; Verification only text | Hero gradient, Premium/zodiac, glass cards, VibelyText/rhythm, Vibe Video 16:9, vibes list | VerificationBadge, Lifestyle rows if API has data |
| **Settings** | Premium card content; Credits subtitle static | GlassHeaderBar; sub-screen headers | Delete modal (reason + confirm); Feedback drawer (or keep web link) |

Implementation can proceed in the order above, reusing existing primitives and theme tokens, without backend or provider changes. Any change that touches a shared surface (e.g. profile type exports, new layout constants) will be called out in the rebuild delta for this phase.
