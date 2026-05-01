# Screenshot-Led Native Visual Parity

Branch: `fix/screenshot-led-native-visual-parity`
Date: 2026-05-01

## Problem

After the backend/provider/native contract streams, Stream 18 starts the first screenshot-led native visual parity pass. The goal is to compare the native app against the web product source of truth and fix concrete visual mismatches only when evidence exists.

## Screenshots Available

No comparable web/native screen captures were present in the repository.

The repository contains icon, logo, splash, social, and generated native image assets, but no screen-by-screen web/native captures for the target surfaces. Because this stream forbids inventing visual differences without screenshots or code evidence, no visual mismatch was fabricated.

## Screens Audited From Source

Target screen source paths were mapped for:

1. Auth / sign in / sign up
2. Onboarding
3. Dashboard/home
4. Events list
5. Event details
6. Event lobby
7. Ready Gate overlay and `/ready/[id]`
8. Video date route
9. Matches list
10. Chat thread
11. Profile Studio
12. Settings
13. Push permission / notification surfaces
14. Vibe Video surfaces

The mapping is captured in `docs/qa/screenshot-led-native-visual-parity-capture-plan.md`.

## Differences Found

No screenshot-backed visual differences were found because screenshots were unavailable.

The older `docs/phase8-stage1-parity-and-functionality-audit.md` remains useful product-parity context, but it is not a screenshot evidence pack. Many of its findings are functional/backlog-sized and out of Stream 18 scope.

## Fixes Made

No native UI fixes were made in this pass. This is intentional: without actual screenshots, making visual changes would violate the screenshot-led operating model.

Docs/tests added:

- `docs/qa/screenshot-led-native-visual-parity-capture-plan.md`
- `shared/matching/screenshotLedNativeVisualParity.test.ts`
- this branch delta

## Capture Plan

The capture plan includes:

- web-as-source-of-truth principle
- screenshot inventory
- capture output naming
- web viewport settings
- native device settings
- controlled test data requirements
- all 14 target screens and required states
- comparison rubric
- completion criteria

## Deferred Screenshot / Device Execution

Manual screenshot capture remains required before visual fixes can be made:

- capture web source-of-truth screens at `1440 x 900` and `390 x 844`
- capture native iOS large and compact device screens
- capture Android if available
- compare states screen by screen
- implement only concrete, high-confidence native UI mismatches

## Deploy Requirements

- Supabase migration deploy: not required.
- Supabase DB push: not required.
- Edge Function deploy: not required.
- Supabase deploy: not required.
- Web/static deploy: normal host deployment after merge for docs/test only.
- EAS/native binary build: not required.

## Safety Confirmations

- No Docker used.
- No local Supabase used.
- No Supabase DB push.
- No Supabase migration added.
- No Edge Function changed.
- No Supabase deploy required.
- No env vars changed.
- No native modules added.
- No `expo-av` import or package added.
- No backend contract changed.
- No live provider smoke mutation run.

## Remaining Follow-Up

- Execute the screenshot capture plan.
- Attach or store sanitized screenshot evidence.
- Run a second visual parity pass with screenshot-backed diffs.
- Fix concrete native UI issues found from that evidence.
