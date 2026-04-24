# Video date native launch latency audit (2026-04-24)

Branch: `perf/video-date-launch-latency`

## Launch sequence (Ready Gate both-ready → playable handshake)

1. **Both-ready observed** — `useReadyGate` realtime / polling; `rcBreadcrumb` + PostHog where already wired.
2. **Standalone `/ready/[id]`** — `reconcileFromCanonicalTruth('both_ready')`: parallel `fetchVideoSessionDateEntryTruthCoalesced` + `event_registrations`; `decideVideoSessionRouteFromTruth` / `canAttemptDailyRoomFromVideoSessionTruth`; on success `markNativeVideoDateLaunchIntent` (only when `source === 'both_ready'`), `markVideoDateEntryPipelineStarted`, `navigateToDateSessionGuarded` → `/date/[id]`.
3. **Lobby overlay** — `ReadyGateOverlay.handleBothReady`: same latch + immediate `onNavigateToDate` (no artificial delay); `markNativeVideoDateLaunchIntent('ready_lobby_overlay_both_ready')`.
4. **`/date/[id]` mount** — `useLayoutEffect`: latch + `consumeNativeVideoDateLaunchIntent` → Sentry `video-date-launch` breadcrumb `date_route_layout_after_nav_intent` with `duration_ms_since_nav_intent`.
5. **Route guard** — `fetchVideoSessionDateEntryTruthCoalesced` + registration row; bounce to `/ready` / lobby if truth requires.
6. **`useVideoDateSession`** — initial `video_sessions` select (narrow columns) + partner profile row; realtime subscription.
7. **Prejoin `run()`** — permissions → `truth0` (coalesced) → optional `enter_handshake` RPC → **non-blocking** `refetchVideoSession()` → `truth1` (fresh `fetchVideoSessionDateEntryTruth` for Daily gate) → `daily-room` `create_date_room` → `Daily.createCallObject` → `call.join` → `markVideoDateDailyJoined` (async) → optional `refetchVideoSession`.

Instrumentation: Sentry breadcrumbs `video-date-launch` (`prejoin_*` segment deltas, `enter_handshake_rpc`, `daily_room_edge_invoke`, `prejoin_pipeline_total`); vdbg gated (`date_bootstrap_timing_*`, `prejoin_*`); never tokens.

## Duplicate / blocking data calls (before this change)

| Call | Where | Blocking? |
|------|-------|-----------|
| `video_sessions` truth | Route guard + prejoin `truth0` | Sequential; overlap coalesced now |
| `fetchVideoSessionDateEntryTruth` | Prejoin `truth1` after handshake | Blocking (required for Daily gate) |
| `refetchVideoSession` (full row + partner) | Immediately after `enter_handshake` | **Was blocking** Daily room; now fire-and-forget |
| `select('*')` on mount | `/date` mount | Non-blocking `.then` but wasteful on prod → **VDBG/`__DEV__` only** |
| Partner profile (full) | `fetchPartnerProfile` on mount | Was parallel to prejoin; **deferred until `localInDailyRoom`** |
| Vibe questions / credits | On mount | **Deferred until `localInDailyRoom`** |

## Fixed artificial delays

| Location | Before | After |
|----------|--------|-------|
| `apps/mobile/app/ready/[id].tsx` both-ready → reconcile | 1500 ms `setTimeout` | Immediate `reconcileFromCanonicalTruth` |
| `apps/mobile/components/lobby/ReadyGateOverlay.tsx` | 1200 ms before `onNavigateToDate` | Immediate navigation |

## `daily-room` `create_date_room` provider verification

- **Before:** If `daily_room_name` existed, **every** token request did `GET /rooms/:name` before minting token.
- **After:** If `handshake_started_at` is present and **&lt; 120s** old, skip provider GET (log `date_room_provider_verify_skipped`). Older sessions, missing handshake timestamp, or failed joins still use full verify/recreate path. **Deploy:** redeploy Edge Function `daily-room`.

## `handshake_started_at` vs UI

Set by server in `video_date_transition` / `enter_handshake` before RPC returns. Native handshake countdown uses `useVideoDateSession` + realtime; post-change, full refetch after handshake is non-blocking, so the timer may briefly follow realtime until the async refetch completes—same authoritative server time, negligible skew.

## Latency budget (indicative)

| Segment | p50-ish (typical) | p95 risk |
|---------|-------------------|----------|
| Removed ready delays | **−1.2 to −1.5 s** | — |
| Dropped blocking refetch before Daily | **−0.2 to −0.8 s** | Large partner rows |
| Skip Daily provider GET (warm handshake) | **−0.15 to −0.4 s** | Geo / Daily API variance |
| Deferred profile / vibes / credits | **−0.1 to −0.5 s** | Parallel with join |
| Coalesced truth | Saves duplicate RTT when guard + prejoin overlap | Small |

**Remaining bottlenecks:** `enter_handshake` RPC, `daily-room` cold path (create room + token), `call.join` (Daily SFU), first ICE/media (native).

## Before / after timing table

Captured in **two-device native smoke** with VDBG + Sentry breadcrumbs (`video-date-launch`). Replace placeholders after your run:

| Milestone | Before (observed / est.) | After (fill in) |
|-----------|-------------------------|-----------------|
| Both-ready → `/date` layout | ~1.5 s + reconcile + nav | ~reconcile + nav |
| Route mount → local Daily join complete | ~11 s total (reported) | TBD |
| `enter_handshake` RPC | Sentry `duration_ms` | |
| `daily_room` invoke | Sentry `duration_ms` | |

## Prewarm Daily at Ready Gate (design only)

Creating a Daily room before `enter_handshake` would advance provider state without starting the server handshake timer in a safe way only if the product defined a **server** state for “room reserved, timer not started”—today `create_date_room` gates on `both_ready` / handshake / date. **Not implemented**; would need RPC + `daily-room` contract changes and web parity.

## Rebuild / deploy checklist

- **Supabase Edge Function:** redeploy `daily-room` after merge (no migration).
- **Mobile app:** normal OTA / store build; no new env vars.
- **Web:** unchanged; shared `activeSession` / prejoin types unchanged except mobile-only coalescing in `videoDateApi.ts`.

## Safety checklist (unchanged intent)

- `video_date_transition` / `ready_gate_transition` ownership preserved.
- Stale ready gate: latch + truth still prevent `/date` → `/ready` bounce mid-pipeline.
- Ended sessions: truth + Edge gates unchanged.
- Non-participants: RLS + Edge participant checks unchanged.
- Daily cleanup: skip-verify is time-bounded; stale/expired path still recreates.
- Post-date survey / reconnect: untouched logic paths.

## Remaining risks

1. **Non-blocking `refetchVideoSession`:** UI may rely on full row for a few hundred ms; realtime should follow `enter_handshake`.
2. **Provider verify skip:** Rare mismatch if Daily deleted room but DB still has name within 120s of handshake—join or token path should fail; user retry hits full verify.
3. **Deferred partner sheet:** Full profile loads after local join; sheet empty briefly if opened instantly (edge).
