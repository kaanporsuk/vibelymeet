import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
} from "react";
import {
  useAuth,
} from "@/context/AuthContext";
import {
  eventLobbyHref,
} from "@/lib/activeSessionRoutes";
import {
  supabase,
} from "@/lib/supabase";
import {
  vdbg,
  vdbgRedirect,
} from "@/lib/vdbg";
import {
  createNativeVideoDateClientInstanceId,
  createNativeVideoDateSurfaceOwnerId,
  NATIVE_VIDEO_DATE_SURFACE_CLAIM_REFRESH_MS,
  NATIVE_VIDEO_DATE_SURFACE_CLAIM_RELEASE_GRACE_MS,
  NATIVE_VIDEO_DATE_SURFACE_CLAIM_TTL_SECONDS,
  nativeVideoDateActiveSurfaceKey,
  nativeVideoDateActiveSurfaceOwners,
  type NativeVideoDateSurfaceClaimResult,
  nextNativeSurfaceClaimBackoffMs,
} from "@/lib/videoDate/nativeVideoDateSurfaceClient";
import {
  useVideoDateSession,
} from "@/lib/videoDateApi";
import {
  router,
} from "expo-router";
import type { NativeVideoDateCallEndCleanupApi } from "./useNativeVideoDateCallEndCleanup";

/**
 * Surface-claim concern of the native Video Date screen: claim/blocked/takeover handling plus the active-surface claim loop effect.
 *
 * Video Date rebuild PR 8.5 extraction; body verbatim from
 * `apps/mobile/app/date/[id].tsx`. Deps are destructured to their original
 * names so closure semantics and contract pins hold.
 */

export interface NativeVideoDateSurfaceClaimDeps {
  cleanupForAbortWithoutServerEnd: NativeVideoDateCallEndCleanupApi["cleanupForAbortWithoutServerEnd"];
  dateEntryPermissionEligible: boolean;
  eventId: string;
  hasStartedJoinRef: MutableRefObject<boolean>;
  isConnecting: boolean;
  joining: boolean;
  localInDailyRoom: boolean;
  nativeSurfaceClientReady: boolean;
  phase: ReturnType<typeof useVideoDateSession>["phase"];
  phaseRef: MutableRefObject<ReturnType<typeof useVideoDateSession>["phase"]>;
  sessionId: string;
  setJoinAttemptNonce: Dispatch<SetStateAction<number>>;
  setSurfaceClaimBlockedState: (value: boolean) => void;
  setSurfaceClaimTakeoverBusy: Dispatch<SetStateAction<boolean>>;
  showFeedback: boolean;
  surfaceClaimBackoffUntilRef: MutableRefObject<number>;
  surfaceClaimBlockedRef: MutableRefObject<boolean>;
  surfaceClaimFailureCountRef: MutableRefObject<number>;
  surfaceClaimInFlightPromiseRef: MutableRefObject<Promise<NativeVideoDateSurfaceClaimResult> | null>;
  surfaceClaimInFlightRef: MutableRefObject<boolean>;
  surfaceClaimTakeoverBusy: boolean;
  user: ReturnType<typeof useAuth>["user"];
  videoDateClientInstanceIdRef: MutableRefObject<ReturnType<typeof createNativeVideoDateClientInstanceId>>;
  videoDateSurfaceOwnerIdRef: MutableRefObject<ReturnType<typeof createNativeVideoDateSurfaceOwnerId>>;
}

export function useNativeVideoDateSurfaceClaim(deps: NativeVideoDateSurfaceClaimDeps) {
  const {
    cleanupForAbortWithoutServerEnd,
    dateEntryPermissionEligible,
    eventId,
    hasStartedJoinRef,
    isConnecting,
    joining,
    localInDailyRoom,
    nativeSurfaceClientReady,
    phase,
    phaseRef,
    sessionId,
    setJoinAttemptNonce,
    setSurfaceClaimBlockedState,
    setSurfaceClaimTakeoverBusy,
    showFeedback,
    surfaceClaimBackoffUntilRef,
    surfaceClaimBlockedRef,
    surfaceClaimFailureCountRef,
    surfaceClaimInFlightPromiseRef,
    surfaceClaimInFlightRef,
    surfaceClaimTakeoverBusy,
    user,
    videoDateClientInstanceIdRef,
    videoDateSurfaceOwnerIdRef,
  } = deps;

  const claimNativeVideoDateSurface = useCallback(
    async (takeover = false): Promise<NativeVideoDateSurfaceClaimResult> => {
      if (
        !sessionId ||
        !user?.id ||
        showFeedback ||
        phaseRef.current === "ended"
      ) {
        surfaceClaimBackoffUntilRef.current = 0;
        surfaceClaimFailureCountRef.current = 0;
        setSurfaceClaimBlockedState(false);
        return { canContinue: true, confirmed: true };
      }
      if (!nativeSurfaceClientReady) {
        surfaceClaimBackoffUntilRef.current = 0;
        surfaceClaimFailureCountRef.current = 0;
        setSurfaceClaimBlockedState(false);
        vdbg("native_video_date_surface_claim_waiting_for_client_identity", {
          sessionId,
          userId: user.id,
          takeover,
        });
        return { canContinue: true, confirmed: false };
      }
      const profileId = user.id;
      const now = Date.now();
      if (takeover) {
        surfaceClaimBackoffUntilRef.current = 0;
        surfaceClaimFailureCountRef.current = 0;
      } else if (
        surfaceClaimInFlightRef.current &&
        surfaceClaimInFlightPromiseRef.current
      ) {
        return surfaceClaimInFlightPromiseRef.current;
      } else if (now < surfaceClaimBackoffUntilRef.current) {
        return {
          canContinue: !surfaceClaimBlockedRef.current,
          confirmed: false,
        };
      }
      surfaceClaimInFlightRef.current = true;
      const surfaceOwnerId = videoDateSurfaceOwnerIdRef.current;
      const claimPromise =
        (async (): Promise<NativeVideoDateSurfaceClaimResult> => {
          const clientInstanceId = videoDateClientInstanceIdRef.current;
          nativeVideoDateActiveSurfaceOwners.set(
            nativeVideoDateActiveSurfaceKey(sessionId, profileId),
            {
              owner: surfaceOwnerId,
              clientInstanceId,
            },
          );
          const { data, error } = await supabase.rpc(
            "claim_video_date_surface" as never,
            {
              p_session_id: sessionId,
              p_surface: "video_date",
              p_client_instance_id: clientInstanceId,
              p_takeover: takeover,
              p_ttl_seconds: NATIVE_VIDEO_DATE_SURFACE_CLAIM_TTL_SECONDS,
            } as never,
          );
          const payload = data as {
            success?: boolean;
            code?: string;
            retryable?: boolean;
          } | null;
          if (error || payload?.success === false) {
            const blocked =
              payload?.code === "SURFACE_CLAIM_CONFLICT" &&
              payload.retryable !== true;
            setSurfaceClaimBlockedState(blocked);
            if (!blocked) {
              surfaceClaimFailureCountRef.current += 1;
              surfaceClaimBackoffUntilRef.current =
                Date.now() +
                nextNativeSurfaceClaimBackoffMs(
                  surfaceClaimFailureCountRef.current,
                );
            }
            vdbg("native_video_date_surface_claim_result", {
              sessionId,
              userId: profileId,
              clientInstanceId,
              ok: false,
              takeover,
              blocked,
              code: payload?.code ?? null,
              retryable: payload?.retryable === true,
              backoffUntil: blocked
                ? null
                : surfaceClaimBackoffUntilRef.current,
              error: error
                ? { code: error.code, message: error.message }
                : null,
            });
            return { canContinue: !blocked, confirmed: false };
          }
          surfaceClaimBackoffUntilRef.current = 0;
          surfaceClaimFailureCountRef.current = 0;
          setSurfaceClaimBlockedState(false);
          vdbg("native_video_date_surface_claim_result", {
            sessionId,
            userId: profileId,
            clientInstanceId,
            ok: true,
            takeover,
          });
          return { canContinue: true, confirmed: true };
        })();
      surfaceClaimInFlightPromiseRef.current = claimPromise;
      try {
        return await claimPromise;
      } finally {
        if (surfaceClaimInFlightPromiseRef.current === claimPromise) {
          surfaceClaimInFlightPromiseRef.current = null;
          surfaceClaimInFlightRef.current = false;
        }
      }
    },
    [
      nativeSurfaceClientReady,
      phaseRef,
      sessionId,
      setSurfaceClaimBlockedState,
      showFeedback,
      surfaceClaimBackoffUntilRef,
      surfaceClaimBlockedRef,
      surfaceClaimFailureCountRef,
      surfaceClaimInFlightPromiseRef,
      surfaceClaimInFlightRef,
      user?.id,
      videoDateClientInstanceIdRef,
      videoDateSurfaceOwnerIdRef,
    ],
  );

  const handleSwitchDeviceHere = useCallback(async () => {
    if (surfaceClaimTakeoverBusy) return;
    setSurfaceClaimTakeoverBusy(true);
    try {
      const claim = await claimNativeVideoDateSurface(true);
      if (claim.confirmed) {
        setSurfaceClaimBlockedState(false);
        hasStartedJoinRef.current = false;
        vdbg("native_video_date_surface_takeover_retry", {
          sessionId: sessionId ?? null,
          userId: user?.id ?? null,
        });
        setJoinAttemptNonce((n) => n + 1);
      }
    } finally {
      setSurfaceClaimTakeoverBusy(false);
    }
  }, [
    claimNativeVideoDateSurface,
    hasStartedJoinRef,
    sessionId,
    setJoinAttemptNonce,
    setSurfaceClaimBlockedState,
    setSurfaceClaimTakeoverBusy,
    surfaceClaimTakeoverBusy,
    user?.id,
  ]);

  const handleLeaveBlockedSurface = useCallback(async () => {
    try {
      await cleanupForAbortWithoutServerEnd();
    } catch (error) {
      vdbg("native_surface_claim_cleanup_failed", {
        sessionId: sessionId ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (eventId) {
      const target = eventLobbyHref(eventId);
      vdbgRedirect(target, "native_surface_claim_back", {
        sessionId: sessionId ?? null,
        eventId,
      });
      router.replace(target);
      return;
    }
    const target = "/(tabs)/events";
    vdbgRedirect(target, "native_surface_claim_back", {
      sessionId: sessionId ?? null,
    });
    router.replace(target);
  }, [cleanupForAbortWithoutServerEnd, eventId, sessionId]);

  useEffect(() => {
    const profileId = user?.id ?? null;
    const activeVideoSurface =
      Boolean(sessionId) &&
      Boolean(profileId) &&
      nativeSurfaceClientReady &&
      !showFeedback &&
      (dateEntryPermissionEligible ||
        phase === "entry" ||
        phase === "date" ||
        isConnecting ||
        joining ||
        localInDailyRoom);
    if (!activeVideoSurface) {
      setSurfaceClaimBlockedState(false);
      return;
    }
    let cancelled = false;
    const activeSurfaceKey =
      sessionId && profileId
        ? nativeVideoDateActiveSurfaceKey(sessionId, profileId)
        : null;
    const clientInstanceId = videoDateClientInstanceIdRef.current;
    const surfaceOwnerId = videoDateSurfaceOwnerIdRef.current;
    if (activeSurfaceKey) {
      nativeVideoDateActiveSurfaceOwners.set(activeSurfaceKey, {
        owner: surfaceOwnerId,
        clientInstanceId,
      });
    }
    const tick = async () => {
      const claim = await claimNativeVideoDateSurface(false);
      if (!cancelled && !claim.canContinue) {
        vdbg("native_video_date_surface_claim_blocked", {
          sessionId,
          userId: profileId,
          phase,
        });
      }
    };
    void tick();
    const interval = setInterval(() => {
      void tick();
    }, NATIVE_VIDEO_DATE_SURFACE_CLAIM_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      const activeOwner = activeSurfaceKey
        ? nativeVideoDateActiveSurfaceOwners.get(activeSurfaceKey)
        : null;
      if (
        activeSurfaceKey &&
        activeOwner?.owner === surfaceOwnerId &&
        activeOwner.clientInstanceId === clientInstanceId
      ) {
        nativeVideoDateActiveSurfaceOwners.delete(activeSurfaceKey);
      }
      if (sessionId) {
        setTimeout(() => {
          if (
            activeSurfaceKey &&
            nativeVideoDateActiveSurfaceOwners.get(activeSurfaceKey)
              ?.clientInstanceId === clientInstanceId
          ) {
            return;
          }
          void supabase.rpc(
            "release_video_date_surface_claim" as never,
            {
              p_session_id: sessionId,
              p_client_instance_id: clientInstanceId,
            } as never,
          );
        }, NATIVE_VIDEO_DATE_SURFACE_CLAIM_RELEASE_GRACE_MS);
      }
    };
  }, [
    claimNativeVideoDateSurface,
    dateEntryPermissionEligible,
    isConnecting,
    joining,
    localInDailyRoom,
    nativeSurfaceClientReady,
    phase,
    sessionId,
    setSurfaceClaimBlockedState,
    showFeedback,
    user?.id,
    videoDateClientInstanceIdRef,
    videoDateSurfaceOwnerIdRef,
  ]);

  return {
    claimNativeVideoDateSurface,
    handleSwitchDeviceHere,
    handleLeaveBlockedSurface,
  };
}

export type NativeVideoDateSurfaceClaimApi = ReturnType<typeof useNativeVideoDateSurfaceClaim>;
