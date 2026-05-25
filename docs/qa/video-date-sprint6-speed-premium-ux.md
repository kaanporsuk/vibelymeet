# Video Date Sprint 6 Speed And Premium UX QA

Use this checklist for screenshot/manual QA after the code-only Sprint 6 checks pass. Capture web desktop and mobile web screenshots, plus iOS and Android native screenshots for each state that is reachable in the test environment.

## Required Surfaces

- Web desktop: event lobby deck, empty/no-candidates state, queued state, Ready Gate, Daily setup/reconnect, survey confirmation.
- Mobile web: same states at the smallest supported viewport with safe-area insets visible.
- iOS native: event lobby, queued state, Ready Gate permissions, Ready Gate both-ready handoff, Daily reconnect, survey confirmation.
- Android native: event lobby, queued state, Ready Gate permissions, Ready Gate both-ready handoff, Daily reconnect, survey confirmation.

## Stress Cases

- Slow network: verify stable loading dimensions, no card/button layout shift, and clear retry copy.
- Denied permissions: verify camera/mic guidance, settings/retry actions, and non-blocking recovery.
- No candidates: verify empty copy is calm, action text wraps safely, and refresh does not shift layout.
- Queued users: verify queued count/copy, Ready Gate auto-open, and no stale lobby state after promotion.
- Reduced motion: verify animated lobby/Ready Gate states become short fades or static indicators.
- Small screens: verify long names, jobs, queue copy, retry banners, and survey confirmation never overflow.
