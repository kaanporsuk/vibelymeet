# Phase 2 cleanup: font parity

## Current state

- **Web (source of truth):** `src/index.css` loads Inter (body) and Space Grotesk (display) via Google Fonts. Body uses `font-family: 'Inter', ...`; headings use `'Space Grotesk'`.
- **Mobile:** `apps/mobile/app/_layout.tsx` uses `useFonts` from expo-font and loads only `SpaceMono-Regular.ttf`. `constants/theme.ts` has `fonts.body` and `fonts.display` as `undefined` (system fallback).

## Blocker

**Inter and Space Grotesk are not present as font assets in the mobile app.**  
`apps/mobile/assets/fonts/` contains only `SpaceMono-Regular.ttf`. Font parity cannot be completed in this pass without adding asset files.

## To complete font parity later

1. Add Inter and Space Grotesk `.ttf` (or `.otf`) files to `apps/mobile/assets/fonts/` (e.g. from [google-webfonts-helper](https://gwfh.mranftl.com/fonts) or `@expo-google-fonts/inter` / `@expo-google-fonts/space-grotesk` if you add that dependency).
2. In `apps/mobile/app/_layout.tsx`, add the new font keys to the `useFonts({ ... })` object so they load before splash hide.
3. In `apps/mobile/constants/theme.ts`, set `fonts.body` and `fonts.display` to the registered font family names (e.g. `'Inter'`, `'SpaceGrotesk'` or whatever name the loader exposes).
4. Ensure `VibelyText` and any typography primitives that use `theme.fonts.body` / `theme.fonts.display` are already wired (they are; when undefined, system font is used).

## Files involved

| File | Role |
|------|------|
| `apps/mobile/app/_layout.tsx` | Load fonts with `useFonts` before splash hide. |
| `apps/mobile/constants/theme.ts` | Define `fonts.body` and `fonts.display` after assets exist. |
| `apps/mobile/assets/fonts/` | Add Inter and Space Grotesk asset files. |
| `apps/mobile/components/ui.tsx` | `VibelyText` already uses `theme.fonts.body` / `theme.fonts.display` when set. |

No code changes were made to font loading in this cleanup pass; the above is the minimal path once assets are added.
