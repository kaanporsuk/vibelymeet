# Media SDK Background Upload Policy

Phase 7 background uploads are closed as **NO-GO research-only**. Production upload reliability comes from the foreground persistent queue, idempotent server state, foreground reconciliation, and explicit recovery UI.

Canonical decision: [../media-background-upload-phase7-decision.md](../media-background-upload-phase7-decision.md)

Runtime enforcement lives in `shared/media-sdk/background-upload-policy.ts`:

- `shouldEnableOsBackgroundUploads()` always returns `false`.
- Web/native SDK factories emit `media_sdk_initialized` with the active policy fields.
- `ReviewAfter` is `2026-11-19`; `npm run launch:preflight` warns after that date.

The no-go may only be revisited after measured browser/device matrices prove at least 95 percent recovery, zero duplicate assets, zero duplicate publishes, and no regression to OneSignal push scope or foreground queue authority.
