import {
  createInitialMediaUploadSnapshot,
  isMediaUploadTerminalState,
  transitionMediaUploadState,
  type MediaUploadTransition,
} from "./state-machine";
import type { MediaTelemetry } from "./telemetry";
import { noopMediaTelemetry } from "./telemetry";
import type {
  MediaUploadInput,
  MediaUploadPlatform,
  MediaUploadSnapshot,
  MediaUploadTask,
  MediaUploadTaskEvent,
  MediaUploadTaskListener,
} from "./types";

export type MediaTaskLifecycleControls = {
  pause?: () => Promise<void> | void;
  resume?: () => Promise<void> | void;
  cancel?: () => Promise<void> | void;
};

export type MediaTaskRunContext = {
  input: MediaUploadInput;
  snapshot: () => MediaUploadSnapshot;
  dispatch: (transition: MediaUploadTransition) => MediaUploadSnapshot;
  bindLifecycle: (controls: MediaTaskLifecycleControls) => void;
  emitTelemetry: (name: string, fields?: Record<string, string | number | boolean | null | undefined>) => void;
};

export type MediaTaskRunner = (context: MediaTaskRunContext) => Promise<void> | void;

function randomMediaId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn("[media-sdk] crypto.randomUUID/getRandomValues unavailable; falling back to Math.random id generation");
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const n = Math.floor(Math.random() * 16);
    return (ch === "x" ? n : (n & 0x3) | 0x8).toString(16);
  });
}

export function createMediaUploadTask(params: {
  id?: string;
  initialSnapshot?: MediaUploadSnapshot | null;
  autoStart?: boolean;
  input: MediaUploadInput;
  platform: MediaUploadPlatform;
  telemetry?: MediaTelemetry;
  runner: MediaTaskRunner;
  beforeStart?: (
    initialSnapshot: MediaUploadSnapshot,
    currentSnapshot: () => MediaUploadSnapshot,
  ) => Promise<void> | void;
  nowMs?: number;
}): MediaUploadTask {
  const id = params.id?.trim() || params.initialSnapshot?.id || randomMediaId();
  const clientRequestId =
    params.input.options?.clientRequestId?.trim() ||
    params.initialSnapshot?.clientRequestId ||
    id;
  const telemetry = params.telemetry ?? noopMediaTelemetry;
  const abortSignal = params.input.options?.signal ?? null;
  let lifecycleControls: MediaTaskLifecycleControls = {};
  let running = false;
  let rerunAfterCurrent = false;
  let abortListenerArmed = false;
  let snapshot = params.initialSnapshot
    ? { ...params.initialSnapshot, id, clientRequestId, family: params.input.family, platform: params.platform }
    : createInitialMediaUploadSnapshot({
        id,
        clientRequestId,
        family: params.input.family,
        platform: params.platform,
        nowMs: params.nowMs,
      });
  const listeners = new Map<MediaUploadTaskEvent, Set<MediaUploadTaskListener>>();

  const emit = (event: MediaUploadTaskEvent) => {
    for (const listener of listeners.get(event) ?? []) {
      try {
        listener(snapshot);
      } catch (error) {
        telemetry.exception(error, {
          family: snapshot.family,
          platform: snapshot.platform,
          state: snapshot.state,
          client_request_id: snapshot.clientRequestId,
          event,
        });
      }
    }
  };

  const removeAbortListener = () => {
    if (!abortListenerArmed) return;
    abortSignal?.removeEventListener?.("abort", handleAbort);
    abortListenerArmed = false;
  };

  const armAbortListener = () => {
    if (!abortSignal || abortSignal.aborted || abortListenerArmed) return;
    abortSignal.addEventListener?.("abort", handleAbort, { once: true });
    abortListenerArmed = true;
  };

  const dispatch = (transition: MediaUploadTransition): MediaUploadSnapshot => {
    const previous = snapshot;
    snapshot = transitionMediaUploadState(snapshot, transition);
    if (snapshot === previous) return snapshot;
    if (snapshot.state !== previous.state) emit("state");
    if (snapshot.progress !== previous.progress) emit("progress");
    if (transition.type === "fail") emit("error");
    if (snapshot.state === "ready" || snapshot.state === "failed" || snapshot.state === "cancelled") {
      removeAbortListener();
    }
    return snapshot;
  };

  const cancelTask = async (reason = "user_cancelled") => {
    try {
      await lifecycleControls.cancel?.();
    } finally {
      dispatch({ type: "cancel", reason });
    }
  };

  function handleAbort() {
    void cancelTask("aborted").catch((error) => {
      telemetry.exception(error, {
        family: snapshot.family,
        platform: snapshot.platform,
        client_request_id: snapshot.clientRequestId,
      });
    });
  }

  const run = async () => {
    if (running) return;
    running = true;
    lifecycleControls = {};
    try {
      if (snapshot.state !== "created") return;
      await params.beforeStart?.(snapshot, () => snapshot);
      if (snapshot.state !== "created") return;
      const started = dispatch({ type: "begin_upload" });
      if (started.state !== "uploading") return;
      await params.runner({
        input: params.input,
        snapshot: () => snapshot,
        dispatch,
        bindLifecycle: (controls) => {
          lifecycleControls = controls;
        },
        emitTelemetry: (name, fields) => {
          telemetry.emit({
            name,
            family: snapshot.family,
            platform: snapshot.platform,
            state: snapshot.state,
            clientRequestId: snapshot.clientRequestId,
            fields,
          });
          emit("telemetry");
        },
      });
    } catch (error) {
      telemetry.exception(error, {
        family: snapshot.family,
        platform: snapshot.platform,
        client_request_id: snapshot.clientRequestId,
      });
      dispatch({
        type: "fail",
        error: {
          code: error instanceof Error ? error.name : "upload_exception",
          message: error instanceof Error ? error.message : "Upload failed",
          retryable: true,
        },
      });
    } finally {
      running = false;
      if (rerunAfterCurrent && snapshot.state === "created") {
        rerunAfterCurrent = false;
        await run();
      }
    }
  };

  const start = () => {
    void run();
  };
  const runFromCreated = async () => {
    if (abortSignal?.aborted) {
      await cancelTask("aborted");
      return;
    }
    armAbortListener();
    if (running) rerunAfterCurrent = true;
    else await run();
  };
  if (abortSignal?.aborted) {
    void cancelTask("aborted").catch((error) => {
      telemetry.exception(error, {
        family: snapshot.family,
        platform: snapshot.platform,
        client_request_id: snapshot.clientRequestId,
      });
    });
  } else {
    armAbortListener();
  }
  if (params.autoStart !== false) {
    if (typeof queueMicrotask === "function") queueMicrotask(start);
    else setTimeout(start, 0);
  }

  return {
    id,
    clientRequestId,
    family: params.input.family,
    on(event, cb) {
      const set = listeners.get(event) ?? new Set<MediaUploadTaskListener>();
      set.add(cb);
      listeners.set(event, set);
      return () => {
        set.delete(cb);
      };
    },
    applyServerSnapshot(serverSnapshot) {
      if (serverSnapshot.state === "ready") {
        return dispatch({
          type: "ready",
          result: serverSnapshot.result ?? null,
          atMs: serverSnapshot.atMs,
        });
      }
      if (serverSnapshot.state === "failed") {
        return dispatch({
          type: "fail",
          error: serverSnapshot.error ?? { code: "server_failed", retryable: true },
          atMs: serverSnapshot.atMs,
        });
      }
      if (serverSnapshot.state === "cancelled") {
        return dispatch({ type: "cancel", reason: serverSnapshot.error?.message ?? "server_cancelled", atMs: serverSnapshot.atMs });
      }
      if (serverSnapshot.state === "processing") {
        if (snapshot.state === "paused") dispatch({ type: "resume", atMs: serverSnapshot.atMs });
        return dispatch({ type: "upload_complete", atMs: serverSnapshot.atMs });
      }
      if (serverSnapshot.state === "uploading" && snapshot.state === "paused") {
        return dispatch({ type: "resume", atMs: serverSnapshot.atMs });
      }
      return snapshot;
    },
    async pause() {
      if (!lifecycleControls.pause) {
        telemetry.emit({
          name: "media_upload_pause_requested",
          family: snapshot.family,
          platform: snapshot.platform,
          state: snapshot.state,
          clientRequestId: snapshot.clientRequestId,
          fields: { reason: "unsupported" },
        });
        emit("telemetry");
        return;
      }
      try {
        await lifecycleControls.pause();
      } catch (error) {
        telemetry.exception(error, {
          family: snapshot.family,
          platform: snapshot.platform,
          state: snapshot.state,
          client_request_id: snapshot.clientRequestId,
          event: "pause",
        });
        throw error;
      }
      dispatch({ type: "pause" });
      telemetry.emit({
        name: "media_upload_pause_requested",
        family: snapshot.family,
        platform: snapshot.platform,
        state: snapshot.state,
        clientRequestId: snapshot.clientRequestId,
      });
      emit("telemetry");
    },
    async resume() {
      if (!lifecycleControls.resume) {
        telemetry.emit({
          name: "media_upload_resume_requested",
          family: snapshot.family,
          platform: snapshot.platform,
          state: snapshot.state,
          clientRequestId: snapshot.clientRequestId,
          fields: { reason: "unsupported" },
        });
        emit("telemetry");
        return;
      }
      try {
        await lifecycleControls.resume();
      } catch (error) {
        telemetry.exception(error, {
          family: snapshot.family,
          platform: snapshot.platform,
          state: snapshot.state,
          client_request_id: snapshot.clientRequestId,
          event: "resume",
        });
        throw error;
      }
      dispatch({ type: "resume" });
      telemetry.emit({
        name: "media_upload_resume_requested",
        family: snapshot.family,
        platform: snapshot.platform,
        state: snapshot.state,
        clientRequestId: snapshot.clientRequestId,
      });
      emit("telemetry");
    },
    async cancel(reason = "user_cancelled") {
      await cancelTask(reason);
    },
    async retry() {
      if (snapshot.state === "created") {
        await runFromCreated();
        return;
      }
      if (running && (snapshot.state === "uploading" || snapshot.state === "paused")) return;
      const before = snapshot;
      const next = dispatch({ type: "retry" });
      if (next !== before) await runFromCreated();
    },
    snapshot() {
      return snapshot;
    },
  };
}

export function waitForMediaUploadTaskTerminal(task: MediaUploadTask): Promise<MediaUploadSnapshot> {
  const current = task.snapshot();
  if (isMediaUploadTerminalState(current.state)) return Promise.resolve(current);

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    let unsubscribeAfterSubscribe = false;
    const maybeResolve = (snapshot: MediaUploadSnapshot) => {
      if (settled || !isMediaUploadTerminalState(snapshot.state)) return;
      settled = true;
      if (unsubscribe) unsubscribe();
      else unsubscribeAfterSubscribe = true;
      resolve(snapshot);
    };

    unsubscribe = task.on("state", maybeResolve);
    if (unsubscribeAfterSubscribe) unsubscribe();
    maybeResolve(task.snapshot());
  });
}
