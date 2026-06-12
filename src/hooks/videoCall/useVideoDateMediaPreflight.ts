import {
  consumeWebVideoDateMediaHandoff,
} from "@/lib/videoDateMediaHandoff";
import {
  bucketVideoDateLatencyMs,
  buildReadyGateToDateLatencyPayload,
  recordReadyGateToDateLatencyCheckpoint,
} from "@clientShared/observability/videoDateOperatorMetrics";
import * as Sentry from "@sentry/react";
import { useCallback, useRef } from "react";
import { vdbg } from "@/lib/vdbg";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import { videoDateWebMediaStreamConstraints } from "@/lib/dailyCallObjectConfig";
import {
  VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER,
  isVideoDateCameraConstraintError,
  videoDateAspectRatio,
  type VideoDateWebMediaCaptureProfile,
} from "@clientShared/matching/videoDateMediaContract";
import {
  classifyMediaPermissionErrorWithBrowserState,
  mediaPermissionResultForStatus,
  type MediaPermissionQueryState,
} from "@clientShared/media/mediaPermissionResult";
import { getVideoDatePermissionHandoff } from "@clientShared/matching/videoDatePermissionHandoff";
import {
  describeMediaError,
  resolveWebVideoDateMediaCaptureReadiness,
  stopMediaStreamTracks,
  summarizeVideoTrackSettings,
  summarizeWebRuntime,
  VideoDateMediaPromptIntent,
  LiveVideoDateMediaTracks,
  getLiveVideoDateMediaTracks,
  missingLiveVideoDateMediaTrackReason,
  requireLiveVideoDateMediaTracks,
} from "@/lib/daily/webDailyMediaHelpers";
import type { VideoCallSharedRuntime } from "./videoCallRuntime";

/**
 * Media preflight concern of the web Video Date call (Video Date rebuild
 * PR 7.5 extraction; bodies verbatim from src/hooks/useVideoCall.ts).
 *
 * Owns the progressive portrait capture-profile preflight (app-acquired
 * media for the Daily handoff) and its release path. Must never fall back
 * to unconstrained { video: true } (pinned).
 */
export function useVideoDateMediaPreflight(deps: VideoCallSharedRuntime) {
  const {
    appAcquiredMediaRef,
    captureProfileRef,
    lastMediaHandoffMissReasonRef,
    lastMediaHandoffUsedRef,
    optionsRef,
    setCaptureProfile,
    setHasPermission,
    setMediaPermissionError,
    setMediaPermissionResult,
  } = deps;

  const mediaPermissionDeniedRef = useRef(false);

  const releaseAppAcquiredMedia = useCallback((reason: string) => {
    const entry = appAcquiredMediaRef.current;
    if (!entry) return;
    appAcquiredMediaRef.current = null;
    stopMediaStreamTracks(entry.stream);
    vdbg("daily_app_acquired_media_released", {
      sessionId: optionsRef.current?.roomId ?? null,
      eventId: optionsRef.current?.eventId ?? null,
      userId: optionsRef.current?.userId ?? null,
      captureProfile: entry.captureProfile,
      consumedByDaily: entry.consumedByDaily,
      reason,
      ageMs: Math.max(0, Date.now() - entry.acquiredAtMs),
    });
  }, []);

  const preflightMediaPermission = useCallback(
    async (
      sessionId: string,
      eventId: string | null | undefined,
      userId: string | null | undefined,
      promptIntent: VideoDateMediaPromptIntent = "auto",
    ) => {
      const permissionStartedAt = Date.now();
      lastMediaHandoffUsedRef.current = false;
      lastMediaHandoffMissReasonRef.current = null;
      const startedContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: "web",
        eventId: eventId ?? null,
        sourceSurface: "video_date_daily",
        checkpoint: "permission_check_started",
        nowMs: permissionStartedAt,
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: startedContext,
          checkpoint: "permission_check_started",
          sourceAction: "permission_check_started",
          outcome: "success",
        }),
      );
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_PERMISSION_CHECK_STARTED, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId ?? null,
        source_surface: "video_date_daily",
        source_action: "permission_check_started",
      });
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        const permissionResult = mediaPermissionResultForStatus({
          status: "unsupported",
          kind: "camera_microphone",
          permissionState: "unsupported",
          rawErrorName: "media_devices_unavailable",
        });
        releaseAppAcquiredMedia("media_devices_unavailable");
        mediaPermissionDeniedRef.current = true;
        setHasPermission(false);
        setMediaPermissionResult(permissionResult);
        setMediaPermissionError(
          "Camera and microphone access are not available in this browser.",
        );
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_DENIED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          source_surface: "video_date_daily",
          source_action: "permission_check_unsupported",
          reason: "media_devices_unavailable",
          permission_status: permissionResult.status,
          permission_state: permissionResult.permissionState,
          recovery_action: permissionResult.recoveryAction,
          media_handoff_miss_reason: null,
        });
        return false;
      }

      const mediaHandoff = userId
        ? consumeWebVideoDateMediaHandoff({ sessionId, userId })
        : { ok: false as const, reason: "missing_user" };
      if (mediaHandoff.ok === true) {
        releaseAppAcquiredMedia("media_handoff_stream_reused");
        const mediaTracks = getLiveVideoDateMediaTracks(mediaHandoff.stream);
        if (mediaTracks) {
          const { videoTrack, audioTrack } = mediaTracks;
          const videoTrackSettings = summarizeVideoTrackSettings(videoTrack);
          lastMediaHandoffUsedRef.current = true;
          lastMediaHandoffMissReasonRef.current = null;
          captureProfileRef.current = mediaHandoff.captureProfile;
          setCaptureProfile(mediaHandoff.captureProfile);
          appAcquiredMediaRef.current = {
            stream: mediaHandoff.stream,
            captureProfile: mediaHandoff.captureProfile,
            acquiredAtMs: mediaHandoff.acquiredAtMs,
            consumedByDaily: false,
          };
          setHasPermission(true);
          setMediaPermissionResult(null);
          setMediaPermissionError(null);
          const durationMs = Math.max(0, Date.now() - permissionStartedAt);
          const successContext = recordReadyGateToDateLatencyCheckpoint({
            sessionId,
            platform: "web",
            eventId: eventId ?? null,
            sourceSurface: "video_date_daily",
            checkpoint: "permission_check_success",
            permissionHandoffUsed: true,
          });
          trackEvent(
            LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
            buildReadyGateToDateLatencyPayload({
              context: successContext,
              checkpoint: "permission_check_success",
              sourceAction: "media_handoff_stream",
              outcome: "success",
              durationMs,
            }),
          );
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_PERMISSION_CHECK_SUCCESS, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId ?? null,
            source_surface: "video_date_daily",
            source_action: "media_handoff_stream",
            duration_ms: durationMs,
            latency_bucket: bucketVideoDateLatencyMs(durationMs),
            media_handoff_used: true,
            media_handoff_miss_reason: null,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_SENDER_CAPTURE_DIAGNOSTIC, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId ?? null,
            source_surface: "video_date_daily",
            source_action: "media_handoff_stream",
            diagnostic_scope: "sender_capture",
            capture_profile: mediaHandoff.captureProfile,
            app_acquired_media: true,
            media_handoff_used: true,
            media_handoff_miss_reason: null,
            media_handoff_source: mediaHandoff.source,
            audio_track_present: Boolean(audioTrack),
            video_track_present: true,
            video_track_width: videoTrackSettings?.width ?? null,
            video_track_height: videoTrackSettings?.height ?? null,
            video_track_aspect_ratio: videoTrackSettings?.aspectRatio ?? null,
            video_track_frame_rate: videoTrackSettings?.frameRate ?? null,
            video_track_facing_mode: videoTrackSettings?.facingMode ?? null,
            ...summarizeWebRuntime(),
          });
          vdbg("daily_media_handoff_stream_used", {
            sessionId,
            eventId: eventId ?? null,
            userId,
            captureProfile: mediaHandoff.captureProfile,
            handoffSource: mediaHandoff.source,
            videoTrack: videoTrackSettings,
          });
          return true;
        }
        lastMediaHandoffMissReasonRef.current =
          missingLiveVideoDateMediaTrackReason(mediaHandoff.stream);
        stopMediaStreamTracks(mediaHandoff.stream);
      } else {
        lastMediaHandoffMissReasonRef.current = mediaHandoff.reason;
      }
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_SENDER_CAPTURE_DIAGNOSTIC, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId ?? null,
        source_surface: "video_date_daily",
        source_action: "media_handoff_miss",
        diagnostic_scope: "sender_capture",
        app_acquired_media: false,
        media_handoff_used: false,
        media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
        ...summarizeWebRuntime(),
      });

      let deferredMediaPermissionError: unknown = null;
      const permissionHandoff = userId
        ? getVideoDatePermissionHandoff(sessionId, userId)
        : null;
      const captureReadiness = await resolveWebVideoDateMediaCaptureReadiness(
        promptIntent,
        Boolean(permissionHandoff),
      );
      let mediaPermissionFailureSourceAction = captureReadiness.sourceAction;
      if (!captureReadiness.canAcquire) {
        releaseAppAcquiredMedia("media_permission_preflight_prompt_required");
        mediaPermissionDeniedRef.current = true;
        setHasPermission(false);
        const permissionResult = mediaPermissionResultForStatus({
          status:
            captureReadiness.permissionState === "denied"
              ? "denied"
              : "promptable",
          kind: "camera_microphone",
          permissionState: captureReadiness.permissionState,
          rawErrorName: captureReadiness.reasonCode,
          rawErrorMessage:
            "Camera and microphone access needs a tap before this browser can ask.",
        });
        setMediaPermissionResult(permissionResult);
        setMediaPermissionError(
          "Camera and microphone access is needed before this date can start.",
        );
        vdbg("daily_media_permission_preflight_prompt_required", {
          sessionId,
          eventId: eventId ?? null,
          userId: userId ?? null,
          promptIntent,
          permissionState: captureReadiness.permissionState,
          sourceAction: captureReadiness.sourceAction,
          reasonCode: captureReadiness.reasonCode,
          mediaHandoffMissReason: lastMediaHandoffMissReasonRef.current,
        });
        trackEvent(LobbyPostDateEvents.CAMERA_PERMISSION_DENIED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          source: captureReadiness.sourceAction,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_DENIED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          source_surface: "video_date_daily",
          source_action: captureReadiness.sourceAction,
          reason:
            captureReadiness.reasonCode ?? "media_permission_prompt_required",
          permission_status: permissionResult.status,
          permission_state: permissionResult.permissionState,
          recovery_action: permissionResult.recoveryAction,
          media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
        });
        return false;
      }
      if (permissionHandoff) {
        releaseAppAcquiredMedia("permission_handoff_media_restart");
        let handoffCaptureProfile: VideoDateWebMediaCaptureProfile =
          permissionHandoff.captureProfile ?? "ideal";
        let handoffStream: MediaStream | null = null;
        let handoffMediaAcquired = false;
        try {
          for (const profile of VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER) {
            try {
              handoffStream = await navigator.mediaDevices.getUserMedia(
                videoDateWebMediaStreamConstraints(profile),
              );
              handoffCaptureProfile = profile;
              break;
            } catch (profileError) {
              if (
                !isVideoDateCameraConstraintError(profileError) ||
                profile === "fallback"
              ) {
                throw profileError;
              }
              vdbg("daily_media_permission_handoff_constraint_fallback", {
                sessionId,
                eventId: eventId ?? null,
                userId: userId ?? null,
                attemptedProfile: profile,
                error:
                  profileError instanceof Error
                    ? { name: profileError.name, message: profileError.message }
                    : String(profileError),
              });
            }
          }
          if (handoffStream) {
            const { videoTrack, audioTrack } = requireLiveVideoDateMediaTracks(
              handoffStream,
              "Video Date permission handoff media acquire",
            );
            const videoTrackSettings = summarizeVideoTrackSettings(videoTrack);
            appAcquiredMediaRef.current = {
              stream: handoffStream,
              captureProfile: handoffCaptureProfile,
              acquiredAtMs: Date.now(),
              consumedByDaily: false,
            };
            handoffMediaAcquired = true;
            handoffStream = null;
            trackEvent(
              LobbyPostDateEvents.VIDEO_DATE_SENDER_CAPTURE_DIAGNOSTIC,
              {
                platform: "web",
                session_id: sessionId,
                event_id: eventId ?? null,
                source_surface: "video_date_daily",
                source_action: "permission_handoff_media_acquired",
                diagnostic_scope: "sender_capture",
                capture_profile: handoffCaptureProfile,
                app_acquired_media: true,
                media_handoff_used: false,
                media_handoff_miss_reason:
                  lastMediaHandoffMissReasonRef.current,
                audio_track_present: Boolean(audioTrack),
                video_track_present: true,
                video_track_width: videoTrackSettings?.width ?? null,
                video_track_height: videoTrackSettings?.height ?? null,
                video_track_aspect_ratio:
                  videoTrackSettings?.aspectRatio ?? null,
                video_track_frame_rate: videoTrackSettings?.frameRate ?? null,
                video_track_facing_mode: videoTrackSettings?.facingMode ?? null,
                ...summarizeWebRuntime(),
              },
            );
          }
        } catch (error) {
          vdbg("daily_media_permission_handoff_media_acquire_failed", {
            sessionId,
            eventId: eventId ?? null,
            userId: userId ?? null,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          });
          deferredMediaPermissionError = error;
          mediaPermissionFailureSourceAction =
            "permission_handoff_media_failed";
        } finally {
          stopMediaStreamTracks(handoffStream);
        }
        if (handoffMediaAcquired) {
          captureProfileRef.current = handoffCaptureProfile;
          setCaptureProfile(handoffCaptureProfile);
          setHasPermission(true);
          setMediaPermissionResult(null);
          setMediaPermissionError(null);
          const durationMs = Math.max(0, Date.now() - permissionStartedAt);
          const successContext = recordReadyGateToDateLatencyCheckpoint({
            sessionId,
            platform: "web",
            eventId: eventId ?? null,
            sourceSurface: "video_date_daily",
            checkpoint: "permission_check_success",
            permissionHandoffUsed: true,
          });
          trackEvent(
            LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
            buildReadyGateToDateLatencyPayload({
              context: successContext,
              checkpoint: "permission_check_success",
              sourceAction: "permission_handoff",
              outcome: "success",
              durationMs,
            }),
          );
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_PERMISSION_CHECK_SUCCESS, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId ?? null,
            source_surface: "video_date_daily",
            source_action: "permission_handoff",
            duration_ms: durationMs,
            latency_bucket: bucketVideoDateLatencyMs(durationMs),
            media_handoff_used: false,
            media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
          });
          vdbg("daily_media_permission_handoff_used", {
            sessionId,
            eventId: eventId ?? null,
            userId,
            handoffSource: permissionHandoff.source,
            mediaHandoffMissReason: lastMediaHandoffMissReasonRef.current,
          });
          return true;
        }
        if (deferredMediaPermissionError) {
          vdbg(
            "daily_media_permission_handoff_failed_without_preflight_retry",
            {
              sessionId,
              eventId: eventId ?? null,
              userId,
              handoffSource: permissionHandoff.source,
              mediaHandoffMissReason: lastMediaHandoffMissReasonRef.current,
            },
          );
        } else {
          vdbg("daily_media_permission_handoff_fallback_to_preflight", {
            sessionId,
            eventId: eventId ?? null,
            userId,
            handoffSource: permissionHandoff.source,
            mediaHandoffMissReason: lastMediaHandoffMissReasonRef.current,
          });
        }
      }

      try {
        if (deferredMediaPermissionError) {
          releaseAppAcquiredMedia("permission_handoff_media_failed");
          throw deferredMediaPermissionError;
        }
        releaseAppAcquiredMedia("media_permission_preflight_restart");
        let stream: MediaStream | null = null;
        let nextCaptureProfile: VideoDateWebMediaCaptureProfile = "ideal";
        let lastConstraintError: unknown = null;

        for (const profile of VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(
              videoDateWebMediaStreamConstraints(profile),
            );
            nextCaptureProfile = profile;
            break;
          } catch (profileError) {
            if (
              !isVideoDateCameraConstraintError(profileError) ||
              profile === "fallback"
            ) {
              throw profileError;
            }
            lastConstraintError = profileError;
            vdbg("daily_media_permission_preflight_constraint_fallback", {
              sessionId,
              eventId: eventId ?? null,
              userId: userId ?? null,
              attemptedProfile: profile,
              nextProfiles: VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER.slice(
                VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER.indexOf(profile) + 1,
              ),
              error:
                profileError instanceof Error
                  ? { name: profileError.name, message: profileError.message }
                  : String(profileError),
            });
          }
        }

        if (!stream) {
          throw (
            lastConstraintError ??
            new Error("Media permission preflight returned no stream")
          );
        }

        captureProfileRef.current = nextCaptureProfile;
        setCaptureProfile(nextCaptureProfile);
        let mediaTracks: LiveVideoDateMediaTracks;
        try {
          mediaTracks = requireLiveVideoDateMediaTracks(
            stream,
            "Video Date media permission preflight",
          );
        } catch (error) {
          stopMediaStreamTracks(stream);
          throw error;
        }
        const { videoTrack, audioTrack } = mediaTracks;
        const videoTrackSettings = summarizeVideoTrackSettings(videoTrack);
        appAcquiredMediaRef.current = {
          stream,
          captureProfile: nextCaptureProfile,
          acquiredAtMs: Date.now(),
          consumedByDaily: false,
        };
        setHasPermission(true);
        setMediaPermissionResult(null);
        setMediaPermissionError(null);
        const durationMs = Math.max(0, Date.now() - permissionStartedAt);
        const successContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: "web",
          eventId: eventId ?? null,
          sourceSurface: "video_date_daily",
          checkpoint: "permission_check_success",
          permissionHandoffUsed: false,
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: successContext,
            checkpoint: "permission_check_success",
            sourceAction: "media_permission_preflight_succeeded",
            outcome: "success",
            durationMs,
          }),
        );
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_PERMISSION_CHECK_SUCCESS, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          source_surface: "video_date_daily",
          source_action: "media_permission_preflight_succeeded",
          duration_ms: durationMs,
          latency_bucket: bucketVideoDateLatencyMs(durationMs),
          media_handoff_used: false,
          media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_SENDER_CAPTURE_DIAGNOSTIC, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          source_surface: "video_date_daily",
          source_action: "media_permission_preflight_succeeded",
          diagnostic_scope: "sender_capture",
          capture_profile: nextCaptureProfile,
          app_acquired_media: true,
          media_handoff_used: false,
          media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
          audio_track_present: Boolean(audioTrack),
          video_track_present: Boolean(videoTrack),
          video_track_width: videoTrackSettings?.width ?? null,
          video_track_height: videoTrackSettings?.height ?? null,
          video_track_aspect_ratio: videoTrackSettings?.aspectRatio ?? null,
          video_track_frame_rate: videoTrackSettings?.frameRate ?? null,
          video_track_facing_mode: videoTrackSettings?.facingMode ?? null,
          ...summarizeWebRuntime(),
        });
        vdbg("daily_media_permission_preflight_succeeded", {
          sessionId,
          eventId: eventId ?? null,
          userId: userId ?? null,
          promptIntent,
          captureReadinessSourceAction: captureReadiness.sourceAction,
          captureProfile: nextCaptureProfile,
          appAcquiredMedia: true,
          mediaHandoffMissReason: lastMediaHandoffMissReasonRef.current,
          audioTrackPresent: Boolean(audioTrack),
          videoTrack: videoTrackSettings,
        });
        if (mediaPermissionDeniedRef.current) {
          mediaPermissionDeniedRef.current = false;
          trackEvent(
            LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_RECOVERED,
            {
              platform: "web",
              session_id: sessionId,
              event_id: eventId ?? null,
            },
          );
        }
        return true;
      } catch (error) {
        releaseAppAcquiredMedia("media_permission_preflight_failed");
        mediaPermissionDeniedRef.current = true;
        setHasPermission(false);
        const permissionResult =
          await classifyMediaPermissionErrorWithBrowserState(
            error,
            "camera_microphone",
          );
        const description = describeMediaError(error);
        setMediaPermissionResult(permissionResult);
        setMediaPermissionError(
          description || "Camera or microphone permission was denied.",
        );
        vdbg("daily_media_permission_preflight_failed", {
          sessionId,
          eventId: eventId ?? null,
          userId: userId ?? null,
          sourceAction: mediaPermissionFailureSourceAction,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        });
        trackEvent(LobbyPostDateEvents.CAMERA_PERMISSION_DENIED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          source: mediaPermissionFailureSourceAction,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_DENIED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          source_surface: "video_date_daily",
          source_action: mediaPermissionFailureSourceAction,
          reason: permissionResult.rawErrorName ?? "media_permission_error",
          permission_status: permissionResult.status,
          permission_state: permissionResult.permissionState,
          recovery_action: permissionResult.recoveryAction,
          media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
        });
        Sentry.captureMessage("video_date_media_permission_denied", {
          level: "warning",
          extra: {
            sessionId,
            eventId: eventId ?? null,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          },
        });
        return false;
      }
    },
    [releaseAppAcquiredMedia],
  );
  return {
    releaseAppAcquiredMedia,
    preflightMediaPermission,
  };
}

export type VideoDateMediaPreflightApi = ReturnType<
  typeof useVideoDateMediaPreflight
>;
