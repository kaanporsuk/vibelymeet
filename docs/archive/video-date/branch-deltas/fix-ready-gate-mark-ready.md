# fix/ready-gate-mark-ready

## Scope
- Removes pre-ready Daily room/provider warmup from web and native Ready Gate overlays.
- Removes unused web/native `ensureVideoDateRoom` client wrappers and the obsolete web preconnect helper so new client code cannot accidentally recreate pre-ready provider metadata.
- Keeps camera/microphone permission prewarm and after-`both_ready` `prepareVideoDateEntry` handoff.
- Adds an additive Supabase wrapper for `ready_gate_transition(uuid, text, text)` that repairs stale pre-ready room metadata before delegating to the existing hardened transition implementation.
- Adds participant-safe Ready Gate truth fields to transition responses.
- Adds web structured diagnostics for Supabase/RPC and backend rejection payloads.

## Deployment Delta
- Supabase migration required: `supabase/migrations/20260505140000_ready_gate_pre_ready_room_metadata_repair.sql`.
- Edge Function deploy required: not required.
- Web rebuild/redeploy required: yes, to remove the old pre-ready warmup producer.
- Native rebuild required: yes, if shipping mobile parity for the same stale metadata producer removal.
- Env vars added/changed: none.

## Smoke
- Two users mutually vibe in the same live event.
- User A clicks "I'm Ready": no generic failure; A sees waiting state.
- User A duplicate click is disabled or idempotent.
- User B clicks "I'm Ready": both clients reach `both_ready`, run prepare-entry, and navigate to `/date/:sessionId`.
- Snooze and Step away still call `ready_gate_transition`.
