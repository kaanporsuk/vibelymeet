# Phase 3 — Stage 4: Settings information architecture parity — summary

**Scope:** Rebuild native settings screen to match web hierarchy and Vibely product feel. No new features; behavior and provider/backend integrations preserved.

---

## Settings groups before vs after

### Before

| Group | Structure | Notes |
|-------|-----------|--------|
| Header | GlassSurface + ScreenHeader | Inconsistent with Dashboard/Matches (GlassHeaderBar). |
| Premium | Card (default) + SettingsRow | Single row. |
| Credits | Card + SettingsRow | Static subtitle. |
| Notifications | Card + SettingsRow | |
| Privacy | Card + SettingsRow | |
| Account | Card + SettingsRow | |
| Quick links | "QUICK LINKS" overline + Card with 4 SettingsRows | One card, dense. |
| Log out | View + DestructiveRow | marginTop spacing.lg. |
| Danger Zone | View + borderTop + "DANGER ZONE" + DestructiveRow | No helper text. |
| Main | paddingHorizontal spacing.lg, scrollContent paddingTop spacing.lg | |

### After

| Group | Structure | Notes |
|-------|-----------|--------|
| Header | **GlassHeaderBar** + back button + VibelyText "Settings" | Aligned with tab screens. |
| **Group 1: Premium** | **Card variant="glass"** + SettingsRow (icon, title, subtitle) | Same row; glass treatment. |
| **Group 2: Credits** | Card variant="glass" + SettingsRow | |
| **Group 3: Notifications** | Card variant="glass" + SettingsRow | |
| **Group 4: Privacy** | Card variant="glass" + SettingsRow | |
| **Group 5: Account** | Card variant="glass" + SettingsRow | |
| **Section break** | **"Quick links"** label (overline, sentence case, marginTop spacing.xl) | Clear break before next group. |
| **Group 6: Quick links** | Card variant="glass" + 4 SettingsRows (no card marginBottom) | Same rows; glass; label clarifies group. |
| **Log out** | View (marginTop spacing.lg) + DestructiveRow | Standalone action row. |
| **Danger Zone** | View (marginTop spacing.xl, paddingTop spacing.lg, borderTop) + **"Danger Zone"** title + **helper text** + DestructiveRow | Contained; helper: "Account deletion is permanent after the grace period." |
| Main | **paddingHorizontal layout.containerPadding**, **scrollContent paddingTop layout.mainContentPaddingTop** | Shared layout tokens. |

---

## Rows / components reused or created

| Component | Reused | Notes |
|-----------|--------|--------|
| **GlassHeaderBar** | Yes | Replaces GlassSurface + ScreenHeader for shell parity. |
| **Card** | Yes | variant="glass" for all six cards (5 nav + 1 quick links). |
| **SettingsRow** | Yes | All navigational and quick-link rows unchanged (icon, title, subtitle, onPress). |
| **DestructiveRow** | Yes | Log out and Delete My Account; no API changes. |
| **VibelyText** | Yes | Settings title in header (titleMD). |
| **New styles** | Created | headerRow, backBtn, headerTitle, navCard, quickCard, quickSection (gap), sectionLabel (updated), logoutWrap, dangerZone, dangerZoneTitle, dangerZoneHelper. |

No new primitives. All behavior (router.push, Linking.openURL, Alert.alert, delete-account fetch) unchanged.

---

## What changed visually and structurally

- **Header:** Single GlassHeaderBar with back + "Settings" (VibelyText); same padding/safe-area as other tab screens.
- **Navigation group (5 cards):** Premium, Credits, Notifications, Privacy, Account each in a glass card with spacing.lg between cards (web space-y-4).
- **Section break:** "Quick links" label with overline typography, marginTop spacing.xl, sentence case; separates nav group from links.
- **Quick links:** One glass card with four SettingsRows; no bottom margin so Log out sits clearly below.
- **Log out:** Own wrapper with marginTop spacing.lg; single DestructiveRow.
- **Danger Zone:** Border-top, uppercase "Danger Zone" title, one line of helper text, then Delete row. Destructive actions are visually contained.
- **Layout:** Main uses layout.containerPadding and layout.mainContentPaddingTop for consistency with profile/dashboard.

---

## Rows that may still need follow-up polish

| Row / area | Current state | Possible follow-up |
|------------|----------------|---------------------|
| **Credits subtitle** | Static "Extra Time · Extended Vibe" | If native gains useCredits/usePremium on this screen, subtitle could be dynamic (e.g. counts or "Premium · Expires …"). |
| **Quick links row density** | Same as before (SettingsRow) | Web uses outline Button style; native uses SettingsRow. No change in Stage 4; optional later: subtle divider between rows if design calls for it. |
| **Toggles** | Not present on native | Web has Notifications/Privacy drawers with toggles. Native routes to sub-screens or web; no toggles in this pass. |

No bugs or missing behavior identified; all entry points and destructive flows preserved.
