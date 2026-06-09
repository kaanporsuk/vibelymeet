# Branch Delta: Video Date Hot-Path No-Throw Shells And Daily Same-Session Adoption

Date: 2026-06-09

## Problem

The latest two-user production run still failed after Ready Gate handoff. Users reached `both_ready`, moved toward `/date/:sessionId`, and then sat in `Opening the room...` / `Still connecting...` instead of stabilizing bilateral media.

The backend stable-media gate correctly refused to promote the session because durable bilateral provider-backed media never stabilized. The remaining failure class was the active-entry path itself: hot-path RPCs could still emit raw 500 responses, and the Daily start path could treat a fresh same-session call object from route entry, retry, remount recovery, or a legitimate Ready Gate prewarm as `external_call_busy` instead of using the existing same-session owner safely.

## Changes

- Added migration `20260609130139_video_date_hot_path_no_throw_daily_adoption.sql`.
- The migration preserves the existing active-path function bodies under service-role-only base names and recreates public no-throw shells for:
  - `claim_video_date_surface(uuid,text,text,boolean,integer)`
  - `mark_video_date_daily_alive(uuid,text,text,text,text,text)`
  - `mark_video_date_daily_joined(uuid,text,text,text,text,text)`
  - `video_date_transition(uuid,text,text)`
  - `video_session_mark_ready_v2(uuid,text,text)`
  - `record_video_date_launch_latency_checkpoint(uuid,text,jsonb,integer)`
- Public wrappers now return sanitized retryable JSON on unexpected helper/observability failures, with direct last-resort JSON if the richer exception-payload helper itself fails.
- Web and native/mobile Daily guard helpers now tag fresh Daily call objects with session and room markers.
- Route entry, retry, and remount recovery now pass those markers and can adopt the current/protected same-session call instead of reporting `external_call_busy`.
- Ready Gate prewarm passes the same session/room markers but intentionally does **not** adopt a route-owned active call; if `/date` already owns Daily, prewarm fails soft with guard diagnostics rather than wrapping the live call in prewarm TTL/fallback cleanup.
- Web `/date/:sessionId` adds bounded automatic retry for retryable start failures while the active route shell still owns the date and the user has not explicitly exited.
- Added diagnostics for adopted current calls, adopted same-session protected calls, protected-call owner/requested session-room markers, and bounded start-retry scheduling/firing/exhaustion.
- Updated contract coverage so web and native/mobile route adoption paths, prewarm non-adoption, and the final public no-throw shell shape are locked.

## Verification

- `npx tsx shared/matching/videoDateActiveEntryFailsoftShellContracts.test.ts`
- `npx tsx shared/matching/videoDateDefinitiveOwnershipContracts.test.ts`
- `npx tsx shared/matching/reviewComments1256_1262Followups.test.ts`
- `npx tsx shared/matching/videoDateStableBilateralMediaGateContracts.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm run test:video-date:red-flags`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`

At local verification time, the linked Supabase dry-run showed exactly this migration pending. Publish close-out must apply it to linked cloud and then re-run the post-apply dry-run before claiming source/cloud alignment.

## Still Unproven

This is implementation evidence only. Product acceptance still requires a fresh disposable two-user production run through match, Ready Gate, same Daily room, stable bilateral provider-backed media/date, date end, and survey completion by both users, plus short leave/rejoin and prolonged absence checks.
