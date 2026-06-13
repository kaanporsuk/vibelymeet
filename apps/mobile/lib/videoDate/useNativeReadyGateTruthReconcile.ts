import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
} from "react";
import { useAuth } from "@/context/AuthContext";
import { RC_CATEGORY, rcBreadcrumb } from "@/lib/nativeRcDiagnostics";
import { supabase } from "@/lib/supabase";
import { preAuthNativeVideoDateDailyPrewarm, startNativeVideoDateDailyPrewarm } from "@/lib/videoDateDailyPrewarm";
import { ensureVideoDateStartableBeforeNavigation } from "@/lib/videoDateEntryStartable";
import { markNativeVideoDateLaunchIntent, videoDateLaunchBreadcrumb } from "@/lib/videoDateLaunchTrace";
import { clearDateEntryTransition, markVideoDateRouteOwned, navigateToDateSessionGuarded, videoDateNavigationIntents } from "@/lib/videoDateNavigationIntents";
import { prepareVideoDateEntry } from "@/lib/videoDatePrepareEntry";
import { isReadyGatePrepareEntryNonRetryable } from "@clientShared/matching/readyGateTerminalRecovery";
import { updateVideoDateEntryOwnerState } from "@clientShared/matching/videoDateEntryOwner";
import { resolveReadyGateTerminalRecoveryViaAdvisor as resolveReadyGateTerminalRecovery } from "@clientShared/matching/videoDateRecoveryAdvisor";
import { decideVideoDateSurfaceRoute } from "@clientShared/videoDate/routeDecision";
import { router } from "expo-router";

/**
 * Canonical-truth reconcile concern of the native Ready Gate screen: maps server session truth onto the local gate phase (single owner of reconcileFromCanonicalTruth).
 *
 * Video Date rebuild PR 8.5 extraction; body verbatim from
 * `apps/mobile/app/ready/[id].tsx`. Deps are destructured to their original
 * names so closure semantics and contract pins hold.
 */

export interface NativeReadyGateTruthReconcileDeps {
  cancelTerminalReadyGateWork: (cancelReason: string) => void;
  dateNavigationStartedRef: MutableRefObject<boolean>;
  eventId: string | null;
  nonRetryablePrepareBlockerRef: MutableRefObject<string | null>;
  pathname: string;
  sessionId: string;
  setPrepareEntryFailureCode: Dispatch<SetStateAction<string | null>>;
  setPrepareEntryFailureRetryable: Dispatch<SetStateAction<boolean>>;
  setTerminalActionError: Dispatch<SetStateAction<string | null>>;
  setTransitioning: Dispatch<SetStateAction<boolean>>;
  user: ReturnType<typeof useAuth>["user"];
}

export function useNativeReadyGateTruthReconcile(deps: NativeReadyGateTruthReconcileDeps) {
  const {
    cancelTerminalReadyGateWork,
    dateNavigationStartedRef,
    eventId,
    nonRetryablePrepareBlockerRef,
    pathname,
    sessionId,
    setPrepareEntryFailureCode,
    setPrepareEntryFailureRetryable,
    setTerminalActionError,
    setTransitioning,
    user,
  } = deps;

  const reconcileFromCanonicalTruth = useCallback(
    async (source: string) => {
      if (!sessionId || !user?.id) return false;
      const sid = String(sessionId);
      const [startable, regRes] = await Promise.all([
        ensureVideoDateStartableBeforeNavigation({
          sessionId: sid,
          source: `ready_standalone_${source}`,
          userId: user.id,
        }),
        supabase
          .from('event_registrations')
          .select('queue_status, current_room_id')
          .eq('profile_id', user.id)
          .eq('current_room_id', sid)
          .maybeSingle(),
      ]);
      const reg = regRes.data;
      const vs = startable.truth;
      const routedTo = startable.ok
        ? 'date'
        : startable.recommend === 'ready'
          ? 'ready'
          : startable.recommend === 'survey'
            ? 'survey'
            : startable.recommend === 'ended'
              ? 'ended'
              : 'lobby';
      rcBreadcrumb(RC_CATEGORY.readyGate, 'date_route_decision', {
        session_id: sid,
        user_id: user.id,
        startable_ok: startable.ok,
        startable_reason: startable.reason,
        routed_to: routedTo,
        source,
        queue_status: reg?.queue_status ?? null,
        current_room_id: reg?.current_room_id ?? null,
        vs_state: vs?.state ?? null,
        vs_phase: vs?.phase ?? null,
        entry_started_at: Boolean(vs?.entry_started_at),
        ready_gate_status: vs?.ready_gate_status ?? null,
        ready_gate_expires_at:
          vs?.ready_gate_expires_at == null
            ? null
            : String(vs.ready_gate_expires_at),
      });

      if (startable.ok) {
        if (dateNavigationStartedRef.current) {
          rcBreadcrumb(
            RC_CATEGORY.readyGate,
            'standalone_duplicate_date_nav_suppressed',
            {
              session_id: sid,
              source,
              startable_reason: startable.reason,
            },
          );
          return true;
        }
        dateNavigationStartedRef.current = true;
        setPrepareEntryFailureCode(null);
        setPrepareEntryFailureRetryable(false);
        const prepared = await prepareVideoDateEntry(sid, {
          eventId: eventId ?? null,
          userId: user.id,
          source: `ready_standalone_${source}`,
        });
        if (prepared.ok !== true) {
          setPrepareEntryFailureCode(prepared.code);
          setPrepareEntryFailureRetryable(prepared.retryable);
          setTerminalActionError(null);
          const prepareRecoveryInput = {
            code: prepared.code,
            errorCode: prepared.code,
            httpStatus: prepared.httpStatus ?? null,
            reason: prepared.message ?? null,
            source: 'prepare_entry',
          };
          rcBreadcrumb(
            RC_CATEGORY.readyGate,
            'standalone_prepare_entry_failed_date_owned',
            {
              session_id: sid,
              user_id: user.id,
              event_id: eventId,
              source,
              code: prepared.code,
              retryable: prepared.retryable,
            },
          );
          if (isReadyGatePrepareEntryNonRetryable(prepareRecoveryInput)) {
            const recovery = resolveReadyGateTerminalRecovery(prepareRecoveryInput);
            dateNavigationStartedRef.current = false;
            nonRetryablePrepareBlockerRef.current = `${sid}:${prepared.code}:prepare_entry`;
            clearDateEntryTransition(sid);
            cancelTerminalReadyGateWork(
              `ready_standalone_prepare_entry_nonretryable_${recovery.category}`,
            );
            setTransitioning(false);
            setTerminalActionError(recovery.body);
            return true;
          }
          setTransitioning(true);
          updateVideoDateEntryOwnerState({
            sessionId: sid,
            userId: user.id,
            state: 'navigating',
            source: 'ready_standalone_prepare_failed_date_owned',
            entryAttemptId: prepared.entryAttemptId ?? null,
            videoDateTraceId: prepared.entryAttemptId ?? null,
            failureCode: prepared.code,
            failureMessage: prepared.message ?? null,
          });
          markVideoDateRouteOwned(sid, user.id);
          const navigated = navigateToDateSessionGuarded({
            sessionId: sid,
            pathname,
            mode: 'replace',
            onSuppressed: ({ reason: suppressReason, target }) => {
              rcBreadcrumb(
                RC_CATEGORY.readyGate,
                'standalone_prepare_failed_date_nav_suppressed',
                {
                  session_id: sid,
                  reason: suppressReason,
                  target: String(target),
                  source,
                },
              );
            },
          });
          if (!navigated) {
            setTransitioning(false);
          }
          if (source === 'both_ready' && navigated) {
            videoDateLaunchBreadcrumb(
              'ready_standalone_prepare_failed_date_owned',
              {
                session_id: sid,
              },
            );
            markNativeVideoDateLaunchIntent(
              'ready_standalone_prepare_failed_date_owned',
            );
          }
          return true;
        }
        void startNativeVideoDateDailyPrewarm({
          sessionId: sid,
          userId: user.id,
          eventId: eventId ?? null,
          roomName: prepared.data.room_name,
          roomUrl: prepared.data.room_url,
          source: `ready_standalone_${source}`,
        })
          .then((prewarm) => {
            if (prewarm.ok) {
              // Pre-authenticate only — do NOT join Daily from the ready route. The
              // real join (which starts the backend entry clock) is owned by
              // /date (useVideoCall.startCall) so the warm-up window starts there.
              void preAuthNativeVideoDateDailyPrewarm({
                sessionId: sid,
                userId: user.id,
                eventId: eventId ?? null,
                roomName: prepared.data.room_name,
                roomUrl: prepared.data.room_url,
                token: prepared.data.token,
                source: `ready_standalone_${source}`,
              });
            }
          })
          .catch((error) => {
            rcBreadcrumb(
              RC_CATEGORY.readyGate,
              'standalone_daily_prewarm_failed_before_date_nav',
              {
                session_id: sid,
                user_id: user.id,
                event_id: eventId,
                source,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          });
        rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_navigate_to_date', {
          session_id: sid,
          source,
          startable_reason: startable.reason,
          ready_gate_status: vs?.ready_gate_status ?? null,
          ready_gate_expires_at:
            vs?.ready_gate_expires_at == null
              ? null
              : String(vs.ready_gate_expires_at),
        });
        setTransitioning(true);
        updateVideoDateEntryOwnerState({
          sessionId: sid,
          userId: user.id,
          state: 'navigating',
          source: `ready_standalone_${source}`,
          roomName: prepared.data.room_name,
          entryAttemptId: prepared.data.entry_attempt_id ?? null,
          videoDateTraceId: prepared.data.video_date_trace_id ?? null,
        });
        markVideoDateRouteOwned(sid, user.id);
        const navigated = navigateToDateSessionGuarded({
          sessionId: sid,
          pathname,
          mode: 'replace',
          onSuppressed: ({ reason: suppressReason, target }) => {
            rcBreadcrumb(
              RC_CATEGORY.readyGate,
              'standalone_navigate_to_date_suppressed',
              {
                session_id: sid,
                reason: suppressReason,
                target: String(target),
                source,
              },
            );
          },
        });
        if (!navigated) {
          setTransitioning(false);
        }
        if (source === 'both_ready' && navigated) {
          videoDateLaunchBreadcrumb('ready_standalone_navigate_to_date', {
            session_id: sid,
          });
          markNativeVideoDateLaunchIntent('ready_standalone_both_ready');
        }
        return true;
      }

      // Not startable — caller stays on /ready unless we have a definitive non-ready route to take.
      if (startable.recommend === 'ready') {
        // Ownership/latch suppression is the shared controller's decision:
        // an owned date route wins over hosting a stale Ready Gate here.
        const surfaceDecision = decideVideoDateSurfaceRoute({
          surface: 'ready_redirect',
          sessionId: sid,
          profileId: user.id,
          intents: videoDateNavigationIntents,
          canonicalInput: {
            eventId: eventId ?? null,
            truth: vs,
            registration: {
              queue_status: reg?.queue_status ?? null,
              current_room_id: reg?.current_room_id ?? null,
              event_id: eventId ?? null,
            },
          },
        });
        if (surfaceDecision.target === 'date' && surfaceDecision.navigate) {
          rcBreadcrumb(
            RC_CATEGORY.readyGate,
            'standalone_ready_redirect_suppressed_by_date_route_ownership',
            {
              session_id: sid,
              source,
              startable_reason: startable.reason,
              suppressed_by: surfaceDecision.suppressedBy,
            },
          );
          navigateToDateSessionGuarded({
            sessionId: sid,
            pathname,
            mode: 'replace',
          });
          return true;
        }
        return false;
      }

      // Terminal / lobby fallback. Always clear latch so the new route cannot be suppressed by a
      // stale entry latch from a previous attempt.
      clearDateEntryTransition(sid);
      cancelTerminalReadyGateWork(`ready_standalone_terminal_${startable.reason}`);
      if (
        startable.reason === 'prepare_entry_event_inactive' ||
        isReadyGatePrepareEntryNonRetryable({
          code: startable.reason,
          errorCode: startable.reason,
          source: 'prepare_entry',
        })
      ) {
        nonRetryablePrepareBlockerRef.current = `${sid}:${startable.reason}`;
      }
      router.replace(startable.recommendHref);
      return true;
    },
    [
      cancelTerminalReadyGateWork,
      dateNavigationStartedRef,
      eventId,
      nonRetryablePrepareBlockerRef,
      pathname,
      sessionId,
      setPrepareEntryFailureCode,
      setPrepareEntryFailureRetryable,
      setTerminalActionError,
      setTransitioning,
      user?.id,
    ],
  );

  return {
    reconcileFromCanonicalTruth,
  };
}

export type NativeReadyGateTruthReconcileApi = ReturnType<typeof useNativeReadyGateTruthReconcile>;
