# Ready Gate Centering

## Summary

Mobile web Ready Gate was using the shared modal bottom-sheet alignment (`items-end sm:items-center`), which pushed the match confirmation card toward the bottom of Safari mobile viewports. This branch changes only the web Ready Gate overlay geometry so the dialog is centered on mobile and desktop.

## Changes

- Web Ready Gate overlay now centers on all viewport sizes.
- Safe-area-aware vertical padding keeps the card away from browser/device chrome.
- Compact devices can scroll inside the card instead of bottom-anchoring the modal.
- Native Ready Gate code is unchanged because the in-lobby native modal already centers.

## Validation

- Focused static regression test added to prevent mobile bottom-sheet alignment from returning.
- No backend, Supabase, Daily, timer, Pass/Vibe, token, or state-machine behavior changed.

## Deploy Notes

- Supabase migration requirement: none.
- Edge Function deploy requirement: none.
- Supabase cloud action: dry-run alignment check only.
- Web deploy: normal Vercel deployment from the merged PR.
