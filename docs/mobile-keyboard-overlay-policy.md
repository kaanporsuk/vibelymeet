# Native mobile: keyboard-safe text overlays

Bottom sheets and drawers that include `TextInput` must not use a plain `react-native` `Modal` with only bottom-aligned content. On iOS, the keyboard covers the focused field and primary actions.

## Required patterns

- **Bottom sheet / drawer with typing:** wrap content in `KeyboardAwareBottomSheetModal` (`apps/mobile/components/keyboard/KeyboardAwareBottomSheetModal.tsx`).
- **Centered dialog with typing:** use `KeyboardAwareCenteredModal` (`apps/mobile/components/keyboard/KeyboardAwareCenteredModal.tsx`).

## Disallowed for new flows

Raw `Modal` + `TextInput` for sheet-style or centered text entry, unless there is a documented exception in code (see below).

## Regression check

From the repo root:

```bash
npm run audit:mobile-keyboard-overlays
```

## Documented exceptions

If a screen truly needs a different approach, add a single-line comment in that file:

```ts
// keyboard-overlay-audit: allow raw Modal+TextInput — <short reason>
```

Keep exceptions rare and review them in PRs.
