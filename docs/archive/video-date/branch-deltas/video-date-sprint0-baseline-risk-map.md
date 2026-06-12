# Video Date Sprint 0 Baseline And Risk Map

Date: 2026-05-25
Reviewed source baseline before Sprint 0 additions: `main` at `903eaf389`

## Summary

Sprint 0 adds an implementation-grade audit baseline for Vibely Video Date. The artifact maps the actual end-to-end flow from registration through lobby, deck, swiping, queueing, Ready Gate, Daily room preparation, warmup/date, post-date survey, continuation, nudges, and safety. It covers web, native/mobile, Supabase, shared contracts, and Daily without adding new product functionality.

## Files

| File | Purpose |
| --- | --- |
| `docs/audits/video-date-sprint0-baseline-risk-map-2026-05-25.md` | Canonical Sprint 0 baseline, state ownership matrix, parity matrix, feature flag inventory, ranked risk map, and exit criteria. |
| `shared/matching/videoDateSprint0BaselineContracts.test.ts` | Contract test that keeps the Sprint 0 audit discoverable, complete, wired into the Video Date V4 suite, and tied to existing critical web/native/shared/Supabase files. |
| `docs/active-doc-map.md` | Adds the Sprint 0 audit to the active documentation index. |
| `package.json` | Wires the Sprint 0 contract test into `npm run test:video-date-v4`. |

## Verification

```bash
npx tsx shared/matching/videoDateSprint0BaselineContracts.test.ts
npm run test:daily-room-contract
npm run test:video-date-v4
npm run typecheck
```

## Follow-Up Sprints

Sprint 1 should begin with shared state/route convergence and Ready Gate taxonomy hardening. Sprint 2 should cover Daily preparation, prewarm semantics, survey exact-once recovery, and broadcast gap recovery. Later sprints should cover multi-device dedupe, safety reachability, load/idempotency, and observability.
