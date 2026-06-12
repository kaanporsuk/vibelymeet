# Branch Delta — perf/video-date-golden-flow-lean-pass

Context: the 2026-06-10 ~23:40 UTC two-user run (event `a91c362f`, session `d0b93d6d-05ac-4ec1-b56b-313a9f8d1a92`) was the first confirmed end-to-end date start since the recovery program opened — zero 500s on the convoy-hardened backend. Its trace exposed three redundant client traffic patterns on the launch path. Full analysis in `docs/video-date-success-command-center.md` ("2026-06-11 First Confirmed Golden-Flow Success + Lean Pass").

## Changes

| File | Change |
| --- | --- |
| `supabase/migrations/20260610235546_video_date_launch_latency_batch_checkpoints.sql` | Additive batch RPC `record_video_date_launch_latency_checkpoints_v1(uuid, jsonb)`; each item delegates to the existing fail-soft single shell; cap 40; authenticated + service_role. Applied to cloud + live-probed. |
| `shared/observability/videoDateLaunchLatencyCheckpointObservability.ts` | Per-session checkpoint buffer; one batch flush at 1.5s / 10 items; `*_failure` + `first_remote_frame` flush immediately; per-item single-RPC fallback on batch failure. ~30 RPCs/launch -> ~4-6. |
| `shared/featureFlags/batchedFlagDetailFetcher.ts` (new) | 25ms collector coalescing concurrent single-flag cache misses into one `evaluate_client_feature_flags` call; per-flag detail fallback on batch failure. |
| `src/lib/clientFeatureFlags.ts`, `apps/mobile/lib/clientFeatureFlags.ts` | Single-flag path uses the batched fetcher. 12 RPCs at /date mount -> 1. Core semantics untouched. |
| `src/lib/videoDatePartnerProfile.ts` (new) | In-flight dedupe + 5-min TTL memo for `get_profile_for_viewer` on video-date surfaces; errors never cached. |
| `src/hooks/useReadyGate.ts`, `src/components/lobby/ReadyGateOverlay.tsx`, `src/pages/VideoDate.tsx` | Partner profile through the memoized helper; no direct RPC remains in these files. ~15 RPCs/launch -> 1-2. |
| `shared/matching/videoDateGoldenFlowLeanPass.test.ts` (new) | Contracts pinning all of the above; wired into `test:video-date-v4` + `test:video-date:red-flags`. |
| `shared/matching/videoDateEndToEndHardening.test.ts` | Profile assertion tracks the memoized helper, preserving its after-access-allowed intent. |
| `src/integrations/supabase/types.ts` | Regenerated (+4 lines: the new batch RPC). |

## Behavior notes

- All three optimizations are fail-open to the previous behavior (batch flush -> single RPCs; batch flags -> per-flag detail; memo errors not cached).
- Observability loss bound: <=1.5s of non-critical checkpoints on abrupt tab close.
- Native partner-profile memo parity is a follow-up; native flag batching IS included (shared module).

## Known-open (documented, not in this branch)

Compute upgrade (deferred 2026-06-10); /date session-row single-owner read (4+ select shapes today); overlapping start-snapshot pollers; stale Sprint 5 `submit_post_date_verdict_v2` test assertion (pre-existing on main).
