# Video Date — entry-clock / connect-latency overlap plan (option D)

Status: **plan only** (no code). Author context: 2026-06-13 connect-latency forensics
(`npm run latency:video-date`, session `84c6dbd1`). Companion: `docs/video-date-runbook.md`
("Committed operator tooling"), `docs/video-date-architecture.md`.

## Problem & evidence

First clean two-user run, both-ready → date-started = **25.6s**, broken down (PostHog
`ready_gate_to_date_latency_checkpoint` + `video_date_*` events):

| leg | cost | nature |
|---|---|---|
| session open → both ready (tap) | 4.3s | user pace |
| both ready → both joined Daily | 9.0s | `prepare_entry` (token mint + room create ~2.8s) **then** cold Daily `.join()` ~2s |
| both joined → entry_started | 11.3s | (see note) |
| entry_started → date_started | 5.3s | remote-frame gate (`stable_bilateral_media`) |

Two big chunks — `prepare_entry` room provisioning (~2.8s) and the cold Daily join (~2s) —
sit on the **post-both-ready** critical path. The Ready Gate already warms the call object +
camera + `preAuth` (`startWebVideoDateDailyPrewarm` / `preAuthWebVideoDateDailyPrewarm`), and
`joinWebVideoDateDailyPrewarm` is fully implemented **but deliberately never called**:

> `ReadyGateOverlay.tsx` ~1600: *"Pre-authenticate only — do NOT join Daily from the lobby.
> The real join (which starts the backend entry clock) is owned by /date … so the full
> warm-up window only begins once the user is on the stable date route."*

So the cold join is **intentional**, to protect the entry-clock invariant — not a bug.

## Invariant that must be preserved

The **entry clock** must begin only once the user is on the stable `/date` route, never during
the lobby/ready gate:
- `entry_started_at` stamp + the warm-up/grace timers + the date countdown,
- and everything keyed off them: entry/handshake deadlines, refund/credit accounting,
  reconnect-grace windows.

Starting any of these during the gate would let the date timer bleed into navigation and skew
refund/timeout logic. **No optimization may advance the entry clock before `/date`.**

## Core idea

Decouple two things that the current design conflates under "join":
1. **Media provisioning + warm** (room create, token mint, call-object, `preAuth`, and possibly
   the actual Daily room *join*) — safe to do during the gate.
2. **Entry-clock start** (`entry_started_at` + warm-up timer) — must stay `/date`-owned.

Crucially, the n=1 data already shows **provider-join at +9s did NOT stamp `entry_started_at`
(+20s)** — so the coupling may be looser than the code comment implies. Phase 0 must confirm
the exact stamp site before assuming join-prewarm is unsafe.

## Phased work

### Phase 0 — investigation (no code; gating decision)
- Pin the exact `entry_started_at` stamp site(s). Live functions that touch it include
  `video_date_transition` (single body, `20260611175511`), the prepare-entry lease
  (`20260503130000`), and the entry-contract bodies (`20260611114354`,
  `20260607123952`). Determine: is it stamped by the **client `/date` surface
  claim/transition**, by the **Daily provider-join webhook**, or by `prepare_entry`?
- Decide whether a lobby-time Daily join would advance `entry_started_at` / the warm-up timer.
- Collect **3–5 more two-user runs** via `npm run latency:video-date` for a real distribution
  (current data is n=1). Set a target (proposed: ready→date **< 12s** p50).
- Output: a one-page finding that greenlights Phase 1/2 or routes to Phase 3.

### Phase 1 — provision the room earlier (low risk)
- Start `prepareVideoDateEntry` at **single-ready** (the local "I'm Ready" tap) instead of
  **both-ready**, so the Daily room + token are ready before the partner readies. Idempotent
  and already token-cached (`video_date_prewarmed_token_used`).
- Guards: only when the event is active; rely on the existing room-cleanup cron for rooms whose
  date never starts; keep the both-ready path as the fallback if single-ready prepare missed.
- Expected win: removes ~2.8s from the post-both-ready path. **Does not touch the entry clock.**

### Phase 2 — wire join-prewarm behind the flag (medium risk; depends on Phase 0)
- Only if Phase 0 confirms the entry clock is `/date`-owned (not provider-join-owned): call
  `joinWebVideoDateDailyPrewarm` from the Ready Gate after `preAuth`, behind the **existing**
  `VITE_VIDEO_DATE_DAILY_JOIN_PREWARM` flag (keep default **OFF**). The consume side already
  detects `prejoined` / `join_in_flight` (telemetry flags exist), so the `/date` route inherits
  an already-joined call instead of joining cold.
- Hard acceptance: a 2-user run must show `entry_started_at` still stamped only after the
  `/date` surface claim — never during the gate.
- Expected win: removes ~1.7–2s cold join from the post-navigation path.

### Phase 3 — server decouple (only if Phase 0 shows join ⇒ entry clock)
- Introduce an explicit server distinction between **media-joined** (lobby-allowed; provider
  webhook may stamp `participant_*_provider_joined_at`) and **entry-started** (`/date`-only;
  stamped by the surface claim/`video_date_transition`). The warm-up timer keys off the latter.
- Migration + the two canonical docs + `active-doc-map.md` updated in the same branch.

## Risks
- **Entry-clock bleed** (date timer starts early) → refund/credit/timeout drift. Highest-severity;
  Phase 0 gates against it.
- **Rooms created for dates that never happen** (Phase 1) → Daily cost + room-cleanup load.
- **Double-join / call-object contention**, and the documented "remote sees black" reattach
  fragility (`audit:video-date-remote-frame` guards) — any join-path change runs the full audit.

## Validation / rollout (every phase)
- `npm run typecheck && npm run lint && npm run test:video-date-v4` + `npm run audit:video-date-remote-frame`.
- A fresh two-user `npm run livegate:video-date` + `npm run latency:video-date` showing the leg
  shrink **with `entry_started_at` still `/date`-owned** (the acceptance bar, not static tests).
- Flag-gated, default OFF; enable in a Vercel preview first, validate, then production.
- Rollback = flip the flag; no schema drops in Phase 1/2.
