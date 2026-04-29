# Video Date Remote Frame Hardening - 2026-04-29

## Executive verdict

The web Vibe Video Date root cause was deterministic: the remote participant video used `object-cover`, so any mismatch between the encoded camera frame and the viewer viewport silently cropped the remote user's camera. Commit `6644dd134f` changed the web date remote video to `object-contain` on a black container. The current production bundle at `https://vibelymeet.com/` includes the equivalent `bg-black` + `object-contain` remote date video cluster.

This sprint locks the product invariant on web and native:

- Remote Vibe Video Date video preserves the full encoded camera frame.
- Letterboxing or pillarboxing is acceptable.
- Silent crop/zoom is not acceptable for the only visible remote date video.
- Self-view PIP and match/chat full-bleed calls may crop only because they are documented as separate intentional surfaces.

## Evidence trail

- Web date Daily track attach path: `src/hooks/useVideoCall.ts` builds a `MediaStream` from Daily participant persistent tracks and assigns it to `remoteVideoRef.current.srcObject`.
- Web date remote render path: `src/pages/VideoDate.tsx` renders the remote `<video>` in `REMOTE_DATE_VIDEO_CONTAINER_CLASS` with `REMOTE_DATE_VIDEO_CLASS`.
- Web date sizing invariant: `REMOTE_DATE_VIDEO_CONTAINER_CLASS = "flex-1 relative bg-black"` and `REMOTE_DATE_VIDEO_CLASS = "w-full h-full object-contain object-center"`.
- Web self-view PIP: `src/components/video-date/SelfViewPIP.tsx` intentionally uses `object-cover` and mirrored local preview inside a small draggable portrait tile.
- Web match/chat calls: `src/components/chat/ActiveCallOverlay.tsx` intentionally use full-bleed `object-cover`; this is not the Vibe Video Date surface.
- Native Daily support was verified from installed package source:
  - `apps/mobile/node_modules/@daily-co/react-native-daily-js/dist/DailyMediaView.d.ts` exposes `objectFit?: RTCViewProps['objectFit']`.
  - `apps/mobile/node_modules/@daily-co/react-native-daily-js/dist/DailyMediaView.js` passes `objectFit` through to `RTCView`.
  - `apps/mobile/node_modules/@daily-co/react-native-webrtc/src/RTCView.ts` supports `objectFit?: 'contain' | 'cover'` and defaults to `cover`.

## Root cause confirmation

Primary root cause:

- Web `/date/:id` previously rendered the remote participant as `object-cover`, which scales the video until the container is filled and clips the extra dimension. A portrait camera in a landscape viewport, or a landscape camera in a portrait/narrow viewport, appears zoomed/cropped.

Secondary contributors:

- Native `DailyMediaView` defaults to `cover`, so the native date flow had the same latent crop behavior unless `objectFit` was explicit.
- Match/chat call surfaces also use full-bleed crop behavior, but those are separate surfaces and now documented as intentional.
- Local/self PIP uses a portrait crop by design and is now documented separately from the remote participant invariant.

## Recommended fix implemented

- Keep web date remote video on `object-contain object-center` with a black container.
- Add a dev-only layout diagnostic for the web remote date video that records intrinsic video size, rendered rect, container rect, objectFit, objectPosition, transform, track settings, participant track id, and phase.
- Set native date remote `DailyMediaView objectFit="contain"` and black remote container background.
- Set native match/chat remote `DailyMediaView objectFit="cover"` explicitly where the product still uses full-bleed calls.
- Add a source audit that fails if web or native Vibe Video Date remote video drifts back to crop-only layout.

## Alternative option

If product wants cinematic full-bleed Vibe Video Date visuals later, use two layers:

- Decorative background layer: blurred/cropped `cover` version.
- Foreground actual remote participant layer: `contain`, centered, black letterbox background.

The foreground remote video must remain the source of truth for the participant's real camera framing.

## Regression guardrails

- `npm run audit:video-date-remote-frame`
  - Fails if web date remote container stops being black.
  - Fails if web date remote video stops being `object-contain object-center`.
  - Fails if crop tokens such as `object-cover`, `scale-*`, transform utilities, or `overflow-hidden` enter the web remote date video constants.
  - Fails if native date remote `DailyMediaView` is not explicitly `objectFit="contain"`.
  - Fails if intentional crop surfaces lose their explanatory comments.
- Dev-only `vdbg("remote_date_video_layout", ...)` gives field evidence when diagnosing future reports without logging in production by default.

## QA checklist

- Chrome desktop web to Chrome desktop web: handshake phase.
- Chrome desktop web to Chrome desktop web: date phase.
- Safari desktop web to Chrome desktop web, if available.
- Web to native.
- Portrait camera feed from remote participant.
- Landscape camera feed from remote participant.
- Full desktop viewport.
- Narrow desktop/mobile-width viewport.
- Browser resize during an active call.
- Handshake to date phase transition.
- Remote leave and rejoin.
- Reconnect after temporary network interruption.
- Open and close partner profile sheet during the call.
- Verify self-view PIP may crop and mirror local preview only.
- Verify match/chat video calls remain intentionally full-bleed and separate from `/date/:id`.

## Rebuild delta

- Routes changed: none added or removed.
- Edge Functions changed: none.
- Schema/storage changed: none.
- Env/secrets changed: none.
- Provider/dashboard changes: none.
- Supabase deploy required: no.
