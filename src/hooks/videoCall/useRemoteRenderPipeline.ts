import { useCallback, useEffect, useRef } from "react";
import { DailyParticipant } from "@daily-co/daily-js";
import { vdbg } from "@/lib/vdbg";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  buildStreamFromParticipant,
  dailyTrackHasLiveMedia,
  describeMediaError,
  getParticipantIdentity,
  getTrackIdsKey,
  hasFreshRemoteRenderFrame,
  hasRenderableRemoteFrame,
  normalizeRemoteRenderRecoveryScope,
  pruneRemoteRenderRecoveryAttempts,
  readRemoteRenderFrameState,
  RemoteRenderFrameState,
  RemoteRenderRecoveryAttemptEntry,
  RemoteRenderValidationOptions,
  RemoteVideoElementWithFrameCallback,
  RemoteVideoFrameCallbackMetadata,
  REMOTE_RENDER_FRAME_TIMEOUT_MS,
  REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_SCOPE,
  REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_TRACK,
  REMOTE_RENDER_VALIDATION_DELAY_MS,
  streamHasTrackId,
  summarizeVideoTrackSettings,
} from "@/lib/daily/webDailyMediaHelpers";
import type { VideoCallSharedRuntime } from "./videoCallRuntime";
import type { VideoDateRemoteSeenApi } from "./useVideoDateRemoteSeen";

/**
 * Remote-render pipeline concern of the web Video Date call (Video Date
 * rebuild PR 7.5 extraction; bodies verbatim from src/hooks/useVideoCall.ts).
 *
 * Owns track attach/reattach, same-track render validation
 * (requestVideoFrameCallback freshness), bounded per-track/per-scope render
 * recovery, and the periodic maintenance reattach interval.
 *
 * Invariant (pinned): `scheduleRemoteRenderValidationRef.current` is
 * assigned synchronously during render, never inside an effect, to avoid
 * early recovery races.
 */

type UseRemoteRenderPipelineDeps = VideoCallSharedRuntime &
  Pick<VideoDateRemoteSeenApi, "markRemoteFirstFrameRendered">;

export function useRemoteRenderPipeline(deps: UseRemoteRenderPipelineDeps) {
  const {
    activeRemoteCameraSwitchRenderWatchRef,
    captureProfileRef,
    firstRemoteWatchdogRef,
    lastLocalMountedTrackKeyRef,
    lastRemoteMountedTrackKeyRef,
    lastRemoteRenderParticipantIdRef,
    latestLocalParticipantRef,
    latestRemoteParticipantRef,
    localVideoRef,
    markRemoteFirstFrameRendered,
    optionsRef,
    playbackBlockedRef,
    reconnectGraceActiveRef,
    remoteVideoRef,
    roomNameRef,
    setRemotePlayback,
  } = deps;

  const remoteRenderValidationDelayRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const remoteRenderValidationTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const remoteRenderValidationFrameCallbackRef = useRef<number | null>(null);
  const remoteRenderValidationSeqRef = useRef(0);
  const remoteRenderRecoveryReattachTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const remoteRenderRecoveryTrackAttemptsRef = useRef<
    Map<string, RemoteRenderRecoveryAttemptEntry>
  >(new Map());
  const remoteRenderRecoveryScopedAttemptsRef = useRef<
    Map<string, RemoteRenderRecoveryAttemptEntry>
  >(new Map());
  const remoteRenderRecoveryInFlightRef = useRef<{
    trackKey: string;
    scopeKey: string;
    trackAttempt: number;
    scopeAttempt: number;
    source: string;
  } | null>(null);
  const scheduleRemoteRenderValidationRef = useRef<
    | ((
        participant: DailyParticipant | undefined,
        source: string,
        roomName: string | null,
        recoveryScope?: string,
        options?: RemoteRenderValidationOptions,
      ) => void)
    | null
  >(null);

  const attachTracks = useCallback(
    (
      participant: DailyParticipant | undefined,
      videoEl: HTMLVideoElement | null,
      isLocal: boolean,
    ) => {
      if (!isLocal && participant) {
        setRemotePlayback((prev) => ({ ...prev, participantPresent: true }));
      }
      if (!videoEl || !participant?.tracks) return;
      const stream = new MediaStream();
      const videoTrack = participant.tracks.video?.persistentTrack;
      const audioTrack = participant.tracks.audio?.persistentTrack;
      const remoteTrackKey = isLocal ? "" : getTrackIdsKey(participant, true);
      if (videoTrack) stream.addTrack(videoTrack);
      if (audioTrack && !isLocal) stream.addTrack(audioTrack);
      const hasRemoteVideo = !isLocal && Boolean(videoTrack);
      const hasRemoteMedia =
        !isLocal && (Boolean(videoTrack) || Boolean(audioTrack));
      try {
        videoEl.srcObject = stream;
        if (!isLocal) {
          setRemotePlayback((prev) => ({
            ...prev,
            participantPresent: true,
            mediaAttached: hasRemoteMedia,
            playRejected: hasRemoteMedia ? false : prev.playRejected,
            error: hasRemoteMedia ? undefined : prev.error,
          }));
          if (hasRemoteVideo) {
            videoEl.addEventListener(
              "loadeddata",
              () => markRemoteFirstFrameRendered("loadeddata"),
              { once: true },
            );
            videoEl.addEventListener(
              "playing",
              () => markRemoteFirstFrameRendered("playing"),
              { once: true },
            );
          }
          // Muted autoplay is never blocked by the browser autoplay policy, so
          // the remote frame renders immediately instead of flashing a frozen
          // "Tap to resume" frame during the initial track-attach race. Audio is
          // restored by unmuting on play success below.
          videoEl.defaultMuted = true;
          videoEl.muted = true;
          const playPromise = videoEl.play();
          if (playPromise && typeof playPromise.then === "function") {
            void playPromise
              .then(() => {
                const recoveredFromBlock = playbackBlockedRef.current;
                playbackBlockedRef.current = false;
                // Restore audio after the muted bootstrap. If the browser blocks
                // audible playback without a qualifying gesture it pauses the
                // element shortly after unmute; recover by re-muting + replaying
                // (frame keeps rendering) and surface the existing tap-to-resume
                // path so one tap enables sound — never a frozen frame, never a
                // silent audio loss.
                if (videoEl.muted) {
                  videoEl.defaultMuted = false;
                  videoEl.muted = false;
                  const onUnmutePause = () => {
                    videoEl.removeEventListener("pause", onUnmutePause);
                    if (videoEl.ended) return;
                    videoEl.defaultMuted = true;
                    videoEl.muted = true;
                    void videoEl.play().catch(() => undefined);
                    setRemotePlayback((prev) => ({
                      ...prev,
                      playRejected: true,
                      error: "Remote video paused. Tap to resume.",
                    }));
                  };
                  videoEl.addEventListener("pause", onUnmutePause, {
                    once: true,
                  });
                  window.setTimeout(
                    () => videoEl.removeEventListener("pause", onUnmutePause),
                    1200,
                  );
                }
                if (!isLocal && remoteTrackKey) {
                  const recovery = remoteRenderRecoveryInFlightRef.current;
                  if (recovery?.trackKey === remoteTrackKey) {
                    vdbg("daily_remote_render_recovery_play_resolved", {
                      sessionId: optionsRef.current?.roomId ?? null,
                      eventId: optionsRef.current?.eventId ?? null,
                      userId: optionsRef.current?.userId ?? null,
                      participantSessionId: participant.session_id ?? null,
                      videoTrackId: videoTrack?.id ?? null,
                      audioTrackId: audioTrack?.id ?? null,
                      source: recovery.source,
                      scopeKey: recovery.scopeKey,
                      trackAttempt: recovery.trackAttempt,
                      scopeAttempt: recovery.scopeAttempt,
                      videoElementReadyState: videoEl.readyState,
                      videoElementWidth: videoEl.videoWidth,
                      videoElementHeight: videoEl.videoHeight,
                    });
                  }
                }
                setRemotePlayback((prev) => ({
                  ...prev,
                  playSucceeded: true,
                  playRejected: false,
                  error: undefined,
                }));
                if (recoveredFromBlock) {
                  trackEvent(
                    LobbyPostDateEvents.VIDEO_DATE_PLAYBACK_RECOVERED,
                    {
                      platform: "web",
                      session_id: optionsRef.current?.roomId ?? null,
                      event_id: optionsRef.current?.eventId ?? null,
                    },
                  );
                }
              })
              .catch((error: unknown) => {
                playbackBlockedRef.current = true;
                if (!isLocal && remoteTrackKey) {
                  const recovery = remoteRenderRecoveryInFlightRef.current;
                  if (recovery?.trackKey === remoteTrackKey) {
                    vdbg("daily_remote_render_recovery_failed", {
                      sessionId: optionsRef.current?.roomId ?? null,
                      eventId: optionsRef.current?.eventId ?? null,
                      userId: optionsRef.current?.userId ?? null,
                      participantSessionId: participant.session_id ?? null,
                      videoTrackId: videoTrack?.id ?? null,
                      audioTrackId: audioTrack?.id ?? null,
                      source: recovery.source,
                      scopeKey: recovery.scopeKey,
                      trackAttempt: recovery.trackAttempt,
                      scopeAttempt: recovery.scopeAttempt,
                      error:
                        error instanceof Error
                          ? { name: error.name, message: error.message }
                          : String(error),
                    });
                    remoteRenderRecoveryInFlightRef.current = null;
                  }
                }
                setRemotePlayback((prev) => ({
                  ...prev,
                  playSucceeded: false,
                  playRejected: true,
                  error: describeMediaError(error),
                }));
                vdbg("daily_remote_video_play_rejected", {
                  sessionId: optionsRef.current?.roomId ?? null,
                  eventId: optionsRef.current?.eventId ?? null,
                  userId: optionsRef.current?.userId ?? null,
                  participantSessionId: participant.session_id ?? null,
                  videoTrackId: videoTrack?.id ?? null,
                  audioTrackId: audioTrack?.id ?? null,
                  error:
                    error instanceof Error
                      ? { name: error.name, message: error.message }
                      : String(error),
                });
                trackEvent(
                  LobbyPostDateEvents.VIDEO_DATE_REMOTE_PLAYBACK_REQUIRES_GESTURE,
                  {
                    platform: "web",
                    session_id: optionsRef.current?.roomId ?? null,
                    event_id: optionsRef.current?.eventId ?? null,
                  },
                );
                trackEvent(LobbyPostDateEvents.VIDEO_DATE_PLAYBACK_BLOCKED, {
                  platform: "web",
                  session_id: optionsRef.current?.roomId ?? null,
                  event_id: optionsRef.current?.eventId ?? null,
                  reason: error instanceof Error ? error.name : "play_rejected",
                });
              });
          }
        }
      } catch (error) {
        if (!isLocal) {
          setRemotePlayback((prev) => ({
            ...prev,
            mediaAttached: false,
            playRejected: true,
            error: describeMediaError(error),
          }));
        }
        vdbg(
          isLocal
            ? "daily_local_video_attach_failed"
            : "daily_remote_video_attach_failed",
          {
            sessionId: optionsRef.current?.roomId ?? null,
            eventId: optionsRef.current?.eventId ?? null,
            userId: optionsRef.current?.userId ?? null,
            participantSessionId: participant.session_id ?? null,
            videoTrackId: videoTrack?.id ?? null,
            audioTrackId: isLocal ? null : (audioTrack?.id ?? null),
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          },
        );
      }
    },
    [markRemoteFirstFrameRendered, optionsRef, playbackBlockedRef, setRemotePlayback],
  );

  const needsTrackReattach = useCallback(
    (
      videoEl: HTMLVideoElement | null,
      participant: DailyParticipant | undefined,
      isLocal: boolean,
    ) => {
      if (!videoEl || !participant?.tracks) return false;

      const expectedVideoId =
        participant.tracks.video?.persistentTrack?.id ?? "";
      const expectedAudioId = isLocal
        ? ""
        : (participant.tracks.audio?.persistentTrack?.id ?? "");
      if (!expectedVideoId && !expectedAudioId) return false;

      const current = videoEl.srcObject as MediaStream | null;
      if (!current) return true;

      const hasExpectedVideo =
        !expectedVideoId || streamHasTrackId(current, expectedVideoId);
      const hasExpectedAudio =
        !expectedAudioId || streamHasTrackId(current, expectedAudioId);
      return !(hasExpectedVideo && hasExpectedAudio);
    },
    [],
  );

  const logTrackMounted = useCallback(
    (
      source: string,
      opts: {
        isLocal: boolean;
        participant: DailyParticipant | undefined;
        roomName: string | null;
      },
    ) => {
      const videoTrack = opts.participant?.tracks?.video?.persistentTrack;
      const videoTrackId = videoTrack?.id ?? "";
      const audioTrackId = opts.isLocal
        ? ""
        : (opts.participant?.tracks?.audio?.persistentTrack?.id ?? "");
      const mountedKey = `${videoTrackId}|${audioTrackId}`;
      if (!mountedKey || mountedKey === "|") return;

      const mountedRef = opts.isLocal
        ? lastLocalMountedTrackKeyRef
        : lastRemoteMountedTrackKeyRef;
      if (mountedRef.current === mountedKey) return;
      mountedRef.current = mountedKey;

      vdbg(
        opts.isLocal
          ? "daily_local_track_mounted"
          : "daily_remote_track_mounted",
        {
          sessionId: optionsRef.current?.roomId ?? null,
          eventId: optionsRef.current?.eventId ?? null,
          userId: optionsRef.current?.userId ?? null,
          roomName: opts.roomName,
          source,
          captureProfile: captureProfileRef.current,
          videoTrackId: videoTrackId || null,
          videoTrack: summarizeVideoTrackSettings(videoTrack),
          audioTrackId: audioTrackId || null,
        },
      );
    },
    [
      captureProfileRef,
      lastLocalMountedTrackKeyRef,
      lastRemoteMountedTrackKeyRef,
      optionsRef,
    ],
  );

  const clearFirstRemoteWatchdog = useCallback(() => {
    if (!firstRemoteWatchdogRef.current) return;
    clearTimeout(firstRemoteWatchdogRef.current);
    firstRemoteWatchdogRef.current = null;
  }, [firstRemoteWatchdogRef]);

  const remoteRenderDiagnostics = useCallback(
    (
      participant: DailyParticipant | undefined,
      videoEl: HTMLVideoElement | null,
    ) => {
      const videoTrack = participant?.tracks?.video?.persistentTrack;
      const audioTrack = participant?.tracks?.audio?.persistentTrack;
      return {
        sessionId: optionsRef.current?.roomId ?? null,
        eventId: optionsRef.current?.eventId ?? null,
        userId: optionsRef.current?.userId ?? null,
        participantSessionId: participant?.session_id ?? null,
        remoteTrackKey: getTrackIdsKey(participant, true) || null,
        videoTrackId: videoTrack?.id ?? null,
        audioTrackId: audioTrack?.id ?? null,
        videoTrackReadyState: videoTrack?.readyState ?? null,
        videoTrackMuted:
          typeof videoTrack?.muted === "boolean" ? videoTrack.muted : null,
        videoTrackEnabled:
          typeof videoTrack?.enabled === "boolean" ? videoTrack.enabled : null,
        videoElementReadyState: videoEl?.readyState ?? null,
        videoElementPaused: videoEl?.paused ?? null,
        videoElementWidth: videoEl?.videoWidth ?? null,
        videoElementHeight: videoEl?.videoHeight ?? null,
        videoElementCurrentTime:
          typeof videoEl?.currentTime === "number"
            ? Number(videoEl.currentTime.toFixed(3))
            : null,
      };
    },
    [optionsRef],
  );

  const resetRemoteRenderRecoveryAttempts = useCallback(() => {
    remoteRenderRecoveryTrackAttemptsRef.current.clear();
    remoteRenderRecoveryScopedAttemptsRef.current.clear();
    remoteRenderRecoveryInFlightRef.current = null;
  }, []);

  const clearRemoteRenderValidation = useCallback(
    (options?: { cancelReattach?: boolean }) => {
      remoteRenderValidationSeqRef.current += 1;
      if (remoteRenderValidationDelayRef.current) {
        clearTimeout(remoteRenderValidationDelayRef.current);
        remoteRenderValidationDelayRef.current = null;
      }
      if (remoteRenderValidationTimeoutRef.current) {
        clearTimeout(remoteRenderValidationTimeoutRef.current);
        remoteRenderValidationTimeoutRef.current = null;
      }
      const videoEl =
        remoteVideoRef.current as RemoteVideoElementWithFrameCallback | null;
      if (
        videoEl &&
        remoteRenderValidationFrameCallbackRef.current != null &&
        typeof videoEl.cancelVideoFrameCallback === "function"
      ) {
        videoEl.cancelVideoFrameCallback(
          remoteRenderValidationFrameCallbackRef.current,
        );
      }
      remoteRenderValidationFrameCallbackRef.current = null;
      if (
        options?.cancelReattach !== false &&
        remoteRenderRecoveryReattachTimeoutRef.current
      ) {
        clearTimeout(remoteRenderRecoveryReattachTimeoutRef.current);
        remoteRenderRecoveryReattachTimeoutRef.current = null;
      }
    },
    [remoteVideoRef],
  );

  const resetRemoteRenderRecoveryForParticipant = useCallback(
    (participant: DailyParticipant | undefined) => {
      const participantId = getParticipantIdentity(participant);
      if (
        !participantId ||
        participantId === lastRemoteRenderParticipantIdRef.current
      )
        return;
      lastRemoteRenderParticipantIdRef.current = participantId;
      resetRemoteRenderRecoveryAttempts();
    },
    [lastRemoteRenderParticipantIdRef, resetRemoteRenderRecoveryAttempts],
  );

  const forceRemoteMediaReattach = useCallback(
    (
      participant: DailyParticipant | undefined,
      source: string,
      roomName: string | null,
      recoveryScope = source,
      validationOptions: RemoteRenderValidationOptions = {},
    ) => {
      const videoEl = remoteVideoRef.current;
      const remoteKey = getTrackIdsKey(participant, true);
      const scopeKey = normalizeRemoteRenderRecoveryScope(recoveryScope);
      const scopedAttemptKey = `${remoteKey}:${scopeKey}`;
      const videoTrack = participant?.tracks?.video?.persistentTrack;
      if (!videoEl || !participant?.tracks || !remoteKey || !videoTrack) {
        vdbg("daily_remote_render_recovery_skipped", {
          ...remoteRenderDiagnostics(participant, videoEl),
          source,
          recoveryScope,
          scopeKey,
          reason: !videoEl
            ? "missing_video_element"
            : !remoteKey || !videoTrack
              ? "missing_video_track"
              : "missing_tracks",
        });
        return;
      }

      const currentRecovery = remoteRenderRecoveryInFlightRef.current;
      if (
        currentRecovery?.trackKey === remoteKey &&
        currentRecovery.scopeKey === scopeKey &&
        validationOptions.recoveryFollowUp !== true
      ) {
        vdbg("daily_remote_render_recovery_skipped", {
          ...remoteRenderDiagnostics(participant, videoEl),
          source,
          recoveryScope,
          scopeKey,
          reason: "recovery_already_in_flight",
          recoveryFollowUp: Boolean(validationOptions.recoveryFollowUp),
          trackAttempt: currentRecovery.trackAttempt,
          scopeAttempt: currentRecovery.scopeAttempt,
          originalSource: currentRecovery.source,
        });
        return;
      }

      const nowMs = Date.now();
      pruneRemoteRenderRecoveryAttempts(
        remoteRenderRecoveryTrackAttemptsRef.current,
        nowMs,
      );
      pruneRemoteRenderRecoveryAttempts(
        remoteRenderRecoveryScopedAttemptsRef.current,
        nowMs,
      );
      const trackAttempts =
        remoteRenderRecoveryTrackAttemptsRef.current.get(remoteKey)?.attempts ??
        0;
      const scopeAttempts =
        remoteRenderRecoveryScopedAttemptsRef.current.get(scopedAttemptKey)
          ?.attempts ?? 0;
      // Camera-switch hints get a single last-resort reattach. The freshness
      // watchdog already gave the natural keyframe ~3s to arrive; if it
      // didn't, one teardown-and-rebind is enough. A second one would just
      // produce another black-screen window.
      const maxScopeAttemptsForScope =
        scopeKey === "camera_switch_hint"
          ? 1
          : REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_SCOPE;
      if (
        trackAttempts >= REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_TRACK ||
        scopeAttempts >= maxScopeAttemptsForScope
      ) {
        if (remoteRenderRecoveryInFlightRef.current?.trackKey === remoteKey) {
          remoteRenderRecoveryInFlightRef.current = null;
        }
        if (remoteRenderRecoveryReattachTimeoutRef.current) {
          clearTimeout(remoteRenderRecoveryReattachTimeoutRef.current);
          remoteRenderRecoveryReattachTimeoutRef.current = null;
        }
        vdbg("daily_remote_render_recovery_skipped", {
          ...remoteRenderDiagnostics(participant, videoEl),
          source,
          recoveryScope,
          scopeKey,
          reason: "max_attempts_exhausted",
          trackAttempts,
          scopeAttempts,
          maxTrackAttempts: REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_TRACK,
          maxScopeAttempts: maxScopeAttemptsForScope,
        });
        setRemotePlayback((prev) => ({
          ...prev,
          mediaAttached: true,
          playSucceeded: false,
          playRejected: true,
          error: "Remote video paused. Tap to resume.",
        }));
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_PLAYBACK_BLOCKED, {
          platform: "web",
          session_id: optionsRef.current?.roomId ?? null,
          event_id: optionsRef.current?.eventId ?? null,
          reason: "remote_render_recovery_exhausted",
        });
        return;
      }

      const nextTrackAttempt = trackAttempts + 1;
      const nextScopeAttempt = scopeAttempts + 1;
      remoteRenderRecoveryTrackAttemptsRef.current.set(remoteKey, {
        attempts: nextTrackAttempt,
        updatedAtMs: nowMs,
      });
      remoteRenderRecoveryScopedAttemptsRef.current.set(scopedAttemptKey, {
        attempts: nextScopeAttempt,
        updatedAtMs: nowMs,
      });
      pruneRemoteRenderRecoveryAttempts(
        remoteRenderRecoveryTrackAttemptsRef.current,
        nowMs,
      );
      pruneRemoteRenderRecoveryAttempts(
        remoteRenderRecoveryScopedAttemptsRef.current,
        nowMs,
      );
      remoteRenderRecoveryInFlightRef.current = {
        trackKey: remoteKey,
        scopeKey,
        trackAttempt: nextTrackAttempt,
        scopeAttempt: nextScopeAttempt,
        source,
      };
      clearRemoteRenderValidation({ cancelReattach: true });

      vdbg("daily_remote_render_recovery_started", {
        ...remoteRenderDiagnostics(participant, videoEl),
        source,
        recoveryScope,
        scopeKey,
        trackAttempt: nextTrackAttempt,
        scopeAttempt: nextScopeAttempt,
        maxTrackAttempts: REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_TRACK,
        maxScopeAttempts: maxScopeAttemptsForScope,
      });

      try {
        videoEl.pause();
        videoEl.srcObject = null;
      } catch {
        videoEl.srcObject = null;
      }

      remoteRenderRecoveryReattachTimeoutRef.current = setTimeout(() => {
        remoteRenderRecoveryReattachTimeoutRef.current = null;
        const latestParticipant =
          latestRemoteParticipantRef.current ?? participant;
        const latestKey = getTrackIdsKey(latestParticipant, true);
        if (latestKey !== remoteKey) {
          vdbg("daily_remote_render_recovery_skipped", {
            ...remoteRenderDiagnostics(
              latestParticipant,
              remoteVideoRef.current,
            ),
            source,
            reason: "stale_track_key",
            expectedTrackKey: remoteKey,
            latestTrackKey: latestKey || null,
            trackAttempt: nextTrackAttempt,
            scopeAttempt: nextScopeAttempt,
          });
          if (remoteRenderRecoveryInFlightRef.current?.trackKey === remoteKey) {
            remoteRenderRecoveryInFlightRef.current = null;
          }
          return;
        }
        attachTracks(latestParticipant, remoteVideoRef.current, false);
        logTrackMounted("remote_render_recovery", {
          isLocal: false,
          participant: latestParticipant,
          roomName,
        });
        scheduleRemoteRenderValidationRef.current?.(
          latestParticipant,
          "remote_render_recovery_followup",
          roomName,
          scopeKey,
          {
            allowRecovery: true,
            recoveryFollowUp: true,
            requireFreshFrame: validationOptions.requireFreshFrame,
            freshFrameBaseline: validationOptions.freshFrameBaseline,
          },
        );
      }, 0);
    },
    [
      attachTracks,
      clearRemoteRenderValidation,
      latestRemoteParticipantRef,
      logTrackMounted,
      optionsRef,
      remoteRenderDiagnostics,
      remoteVideoRef,
      setRemotePlayback,
    ],
  );

  const scheduleRemoteRenderValidation = useCallback(
    (
      participant: DailyParticipant | undefined,
      source: string,
      roomName: string | null,
      recoveryScope = source,
      validationOptions: RemoteRenderValidationOptions = {},
    ) => {
      const videoEl = remoteVideoRef.current;
      const remoteKey = getTrackIdsKey(participant, true);
      const videoTrack = participant?.tracks?.video?.persistentTrack;
      const requireFreshFrame = validationOptions.requireFreshFrame === true;
      const freshFrameBaseline =
        validationOptions.freshFrameBaseline !== undefined
          ? validationOptions.freshFrameBaseline
          : requireFreshFrame
            ? readRemoteRenderFrameState(videoEl)
            : null;
      if (
        !videoEl ||
        !participant?.tracks ||
        !remoteKey ||
        !videoTrack ||
        videoTrack.readyState === "ended"
      ) {
        clearRemoteRenderValidation({ cancelReattach: true });
        vdbg("daily_remote_render_validation_skipped", {
          ...remoteRenderDiagnostics(participant, videoEl),
          source,
          recoveryScope,
          requireFreshFrame,
          freshFrameBaseline,
          reason: !videoEl
            ? "missing_video_element"
            : !remoteKey || !videoTrack
              ? "missing_video_track"
              : videoTrack?.readyState === "ended"
                ? "video_track_ended"
                : "missing_tracks",
        });
        return;
      }

      clearRemoteRenderValidation({ cancelReattach: true });
      const validationSeq = remoteRenderValidationSeqRef.current + 1;
      remoteRenderValidationSeqRef.current = validationSeq;
      remoteRenderValidationDelayRef.current = setTimeout(() => {
        remoteRenderValidationDelayRef.current = null;
        if (remoteRenderValidationSeqRef.current !== validationSeq) return;

        const latestParticipant =
          latestRemoteParticipantRef.current ?? participant;
        const latestVideoEl = remoteVideoRef.current;
        const latestKey = getTrackIdsKey(latestParticipant, true);
        if (!latestVideoEl || latestKey !== remoteKey) {
          vdbg("daily_remote_render_validation_skipped", {
            ...remoteRenderDiagnostics(latestParticipant, latestVideoEl),
            source,
            reason: !latestVideoEl
              ? "missing_video_element"
              : "stale_track_key",
            expectedTrackKey: remoteKey,
            latestTrackKey: latestKey || null,
          });
          return;
        }

        const effectiveFrameTimeoutMs =
          typeof validationOptions.freshFrameTimeoutMs === "number" &&
          Number.isFinite(validationOptions.freshFrameTimeoutMs) &&
          validationOptions.freshFrameTimeoutMs > 0
            ? validationOptions.freshFrameTimeoutMs
            : REMOTE_RENDER_FRAME_TIMEOUT_MS;

        vdbg("daily_remote_same_track_render_validation_started", {
          ...remoteRenderDiagnostics(latestParticipant, latestVideoEl),
          source,
          delayMs: REMOTE_RENDER_VALIDATION_DELAY_MS,
          timeoutMs: effectiveFrameTimeoutMs,
          requireFreshFrame,
          freshFrameBaseline,
        });

        function finishTimedOut(reason: string) {
          if (remoteRenderValidationSeqRef.current !== validationSeq) return;
          if (remoteRenderValidationTimeoutRef.current) {
            clearTimeout(remoteRenderValidationTimeoutRef.current);
            remoteRenderValidationTimeoutRef.current = null;
          }
          remoteRenderValidationFrameCallbackRef.current = null;
          const latestFrameState = readRemoteRenderFrameState(latestVideoEl);
          if (reconnectGraceActiveRef.current) {
            vdbg("daily_remote_render_validation_deferred", {
              ...remoteRenderDiagnostics(latestParticipant, latestVideoEl),
              source,
              recoveryScope,
              reason: "reconnect_grace_active",
              timeoutReason: reason,
              requireFreshFrame,
              freshFrameBaseline,
              latestFrameState,
            });
            return;
          }
          vdbg("daily_remote_render_validation_timed_out", {
            ...remoteRenderDiagnostics(latestParticipant, latestVideoEl),
            source,
            recoveryScope,
            recoveryFollowUp: Boolean(validationOptions.recoveryFollowUp),
            reason,
            timeoutMs: effectiveFrameTimeoutMs,
            requireFreshFrame,
            freshFrameBaseline,
            latestFrameState,
          });
          if (validationOptions.allowRecovery === false) {
            setRemotePlayback((prev) => ({
              ...prev,
              mediaAttached: true,
              playSucceeded: false,
              playRejected: true,
              error: "Remote video paused. Tap to resume.",
            }));
            return;
          }
          forceRemoteMediaReattach(
            latestParticipant,
            `${source}:${reason}`,
            roomName,
            recoveryScope,
            {
              ...validationOptions,
              requireFreshFrame,
              freshFrameBaseline,
            },
          );
        }

        function finishValidated(
          method: string,
          metadata?: RemoteVideoFrameCallbackMetadata,
        ) {
          if (remoteRenderValidationSeqRef.current !== validationSeq) return;
          const latestFrameState = readRemoteRenderFrameState(latestVideoEl);
          if (
            requireFreshFrame &&
            !hasFreshRemoteRenderFrame(
              freshFrameBaseline,
              latestFrameState,
              metadata,
            )
          ) {
            finishTimedOut("fresh_frame_not_observed");
            return;
          }
          if (remoteRenderValidationTimeoutRef.current) {
            clearTimeout(remoteRenderValidationTimeoutRef.current);
            remoteRenderValidationTimeoutRef.current = null;
          }
          remoteRenderValidationFrameCallbackRef.current = null;
          const recovery = remoteRenderRecoveryInFlightRef.current;
          if (recovery?.trackKey === remoteKey) {
            remoteRenderRecoveryTrackAttemptsRef.current.delete(remoteKey);
            remoteRenderRecoveryScopedAttemptsRef.current.delete(
              `${remoteKey}:${recovery.scopeKey}`,
            );
            remoteRenderRecoveryInFlightRef.current = null;
            vdbg("daily_remote_render_recovery_succeeded", {
              ...remoteRenderDiagnostics(latestParticipant, latestVideoEl),
              source: recovery.source,
              validationSource: source,
              scopeKey: recovery.scopeKey,
              trackAttempt: recovery.trackAttempt,
              scopeAttempt: recovery.scopeAttempt,
              method,
              presentedFrames: metadata?.presentedFrames ?? null,
              mediaTime: metadata?.mediaTime ?? null,
              frameWidth: metadata?.width ?? null,
              frameHeight: metadata?.height ?? null,
              requireFreshFrame,
              freshFrameBaseline,
              latestFrameState,
            });
          }
          if (recoveryScope === "camera_switch_hint") {
            activeRemoteCameraSwitchRenderWatchRef.current = null;
            // The receiver kept decoding the same persistentTrack and observed
            // a fresh frame on its own. No srcObject teardown was needed.
            // This is the desired path; track its frequency to confirm the
            // fix is preventing unnecessary reattachments.
            vdbg("daily_camera_switch_no_reattach_needed", {
              ...remoteRenderDiagnostics(latestParticipant, latestVideoEl),
              source,
              method,
              presentedFrames: metadata?.presentedFrames ?? null,
              mediaTime: metadata?.mediaTime ?? null,
              frameWidth: metadata?.width ?? null,
              frameHeight: metadata?.height ?? null,
              freshFrameBaseline,
              latestFrameState,
            });
          }
          setRemotePlayback((prev) => ({
            ...prev,
            mediaAttached: true,
            playRejected: false,
            error: undefined,
          }));
          markRemoteFirstFrameRendered(
            method === "request_video_frame_callback"
              ? "request_video_frame_callback"
              : "first_remote_frame",
          );
          vdbg("daily_remote_same_track_render_validated", {
            ...remoteRenderDiagnostics(latestParticipant, latestVideoEl),
            source,
            recoveryScope,
            recoveryFollowUp: Boolean(validationOptions.recoveryFollowUp),
            method,
            presentedFrames: metadata?.presentedFrames ?? null,
            mediaTime: metadata?.mediaTime ?? null,
            frameWidth: metadata?.width ?? null,
            frameHeight: metadata?.height ?? null,
            requireFreshFrame,
            freshFrameBaseline,
            latestFrameState,
          });
        }

        const videoWithFrameCallback =
          latestVideoEl as RemoteVideoElementWithFrameCallback;
        if (
          typeof videoWithFrameCallback.requestVideoFrameCallback === "function"
        ) {
          remoteRenderValidationFrameCallbackRef.current =
            videoWithFrameCallback.requestVideoFrameCallback((_now, metadata) =>
              finishValidated("request_video_frame_callback", metadata),
            );
          remoteRenderValidationTimeoutRef.current = setTimeout(
            () => finishTimedOut("request_video_frame_callback_timeout"),
            effectiveFrameTimeoutMs,
          );
          return;
        }

        remoteRenderValidationTimeoutRef.current = setTimeout(() => {
          const hasRenderableMedia =
            latestVideoEl.readyState >= 2 &&
            latestVideoEl.videoWidth > 0 &&
            latestVideoEl.videoHeight > 0;
          if (hasRenderableMedia) {
            finishValidated("ready_state_fallback");
            return;
          }
          finishTimedOut("ready_state_fallback_timeout");
        }, effectiveFrameTimeoutMs);
      }, REMOTE_RENDER_VALIDATION_DELAY_MS);
    },
    [
      activeRemoteCameraSwitchRenderWatchRef,
      clearRemoteRenderValidation,
      forceRemoteMediaReattach,
      latestRemoteParticipantRef,
      markRemoteFirstFrameRendered,
      reconnectGraceActiveRef,
      remoteRenderDiagnostics,
      remoteVideoRef,
      setRemotePlayback,
    ],
  );

  scheduleRemoteRenderValidationRef.current = scheduleRemoteRenderValidation;
  useEffect(() => {
    const intervalId = setInterval(() => {
      const localParticipant = latestLocalParticipantRef.current;
      const remoteParticipant = latestRemoteParticipantRef.current;

      if (
        localVideoRef.current &&
        needsTrackReattach(localVideoRef.current, localParticipant, true)
      ) {
        attachTracks(localParticipant, localVideoRef.current, true);
        logTrackMounted("maintenance_reattach", {
          isLocal: true,
          participant: localParticipant,
          roomName: roomNameRef.current,
        });
      }

      if (
        remoteVideoRef.current &&
        needsTrackReattach(remoteVideoRef.current, remoteParticipant, false)
      ) {
        attachTracks(remoteParticipant, remoteVideoRef.current, false);
        logTrackMounted("maintenance_reattach", {
          isLocal: false,
          participant: remoteParticipant,
          roomName: roomNameRef.current,
        });
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [
    attachTracks,
    latestLocalParticipantRef,
    latestRemoteParticipantRef,
    localVideoRef,
    logTrackMounted,
    needsTrackReattach,
    remoteVideoRef,
    roomNameRef,
  ]);
  return {
    attachTracks,
    needsTrackReattach,
    logTrackMounted,
    clearFirstRemoteWatchdog,
    remoteRenderDiagnostics,
    resetRemoteRenderRecoveryAttempts,
    clearRemoteRenderValidation,
    resetRemoteRenderRecoveryForParticipant,
    forceRemoteMediaReattach,
    scheduleRemoteRenderValidation,
    scheduleRemoteRenderValidationRef,
  };
}

export type RemoteRenderPipelineApi = ReturnType<typeof useRemoteRenderPipeline>;
