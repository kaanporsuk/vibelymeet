declare global {
  interface Window {
    OneSignalDeferred?: Array<(oneSignal: OneSignalWebSdk) => void>;
  }
}

import { isOneSignalWebOriginAllowed } from "@/lib/oneSignalWebOrigin";
import { vibelyOsLog } from "@/lib/onesignalWebDiagnostics";
import { classifyPushDeepLink, normalizePushDeepLinkHref, recordPushDeliveryTelemetry } from "@/lib/pushDeliveryTelemetry";
import { recordServiceWorkerState } from "@/lib/browserDiagnostics";
import { ackNotificationDispatchFromPayload, markNotificationOpenedV2FromPayload } from "@/lib/notificationDispatchAck";
import { resolveNotificationActionRoute } from "@/lib/notificationActions";
import {
  preloadVideoDatePushTargetsFromPayload,
  resolveVideoDatePushHrefFromCanonicalTruth,
} from "@/lib/videoDatePushPreload";
import type { PushSdkHealth } from "@clientShared/pushDeliveryHealth";

const PLAYER_ID_POLL_ATTEMPTS = 10;
const PLAYER_ID_INITIAL_POLL_MS = 500;
const PLAYER_ID_MAX_POLL_MS = 4000;
const ONESIGNAL_SDK_SRC = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
const ONESIGNAL_SCRIPT_ID = "onesignal-sdk-page";
const ONESIGNAL_INIT_FALLBACK_TIMEOUT_MS = 12_000;

type OneSignalClickEvent = {
  notification?: {
    notificationId?: string;
    id?: string;
    data?: {
      url?: unknown;
      [key: string]: unknown;
    };
  };
};

type OneSignalWebSdk = {
  init: (options: {
    appId: string;
    notifyButton: { enable: boolean };
    allowLocalhostAsSecureOrigin: boolean;
    serviceWorkerParam: { scope: string };
  }) => Promise<unknown>;
  Notifications: {
    addEventListener: (event: "click", listener: (event: OneSignalClickEvent) => void) => void;
    requestPermission: () => Promise<unknown>;
  };
  User?: {
    PushSubscription?: {
      id?: string | null;
      optedIn?: boolean | null;
      addEventListener?: (event: "change", listener: () => void) => void;
    };
  };
  login: (userId: string) => Promise<unknown>;
  logout: () => Promise<unknown>;
};

/** OneSignal domain restriction throws e.g. "This web push config can only be used on https://www.vibelymeet.com". */
function isOneSignalDomainError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /can only be used on|WrongSiteUrl|SdkInitError/i.test(msg);
}

let initEnqueued = false;
let initFinished: Promise<void> | null = null;
let resolveInit!: () => void;
let sdkUsable = false;
/** True after the deferred init callback has finished (success or catch). */
let initResolvedFlag = false;
let initTimedOut = false;
let initFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let legacySwCleanupRan = false;

/** Last user id passed to OneSignal.login — avoids duplicate login spam on re-renders / token refresh. */
let lastLoggedInUserId: string | null = null;
let loginInFlightUserId: string | null = null;
let activeIdentityUserId: string | null = null;
let identityGeneration = 0;

function ensureDeferredArray() {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
}

function clearOneSignalInitFallbackTimer() {
  if (!initFallbackTimer) return;
  clearTimeout(initFallbackTimer);
  initFallbackTimer = null;
}

function settleOneSignalInitUnavailable(reason: string) {
  if (initResolvedFlag) return;
  sdkUsable = false;
  clearOneSignalInitFallbackTimer();
  if (reason === "sdk_init_timeout") {
    initTimedOut = true;
    resolveInit?.();
    vibelyOsLog("onesignal:sdk unavailable", { reason });
    dispatchInitSettled();
    return;
  }
  initResolvedFlag = true;
  loginInFlightUserId = null;
  resolveInit?.();
  vibelyOsLog("onesignal:sdk unavailable", { reason });
  dispatchInitSettled();
}

function handleOneSignalSdkScriptError() {
  settleOneSignalInitUnavailable("sdk_script_failed");
}

function ensureOneSignalSdkScript() {
  if (typeof document === "undefined") return;
  const existingScript = document.getElementById(ONESIGNAL_SCRIPT_ID);
  if (existingScript instanceof HTMLScriptElement) {
    existingScript.onerror = handleOneSignalSdkScriptError;
    return;
  }
  const script = document.createElement("script");
  script.id = ONESIGNAL_SCRIPT_ID;
  script.src = ONESIGNAL_SDK_SRC;
  script.defer = true;
  script.async = true;
  script.onerror = handleOneSignalSdkScriptError;
  document.head.appendChild(script);
}

function serviceWorkerScriptPaths(registration: ServiceWorkerRegistration): string[] {
  return [registration.active, registration.waiting, registration.installing]
    .map((worker) => worker?.scriptURL)
    .filter((url): url is string => Boolean(url))
    .map((url) => {
      try {
        return new URL(url).pathname;
      } catch {
        return url;
      }
    });
}

async function unregisterLegacyCustomServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const registrationDiagnostics = registrations.map((registration) => ({
      scope: registration.scope,
      scriptPaths: serviceWorkerScriptPaths(registration),
    }));
    vibelyOsLog("onesignal:sw registrations", { registrations: registrationDiagnostics });

    let cleanupRan = false;
    await Promise.all(
      registrations.map(async (registration) => {
        const paths = serviceWorkerScriptPaths(registration);
        const hasLegacySw = paths.includes("/sw.js");
        const hasOneSignalWorker = paths.some(
          (path) => path.includes("OneSignalSDK.sw.js") || path.includes("OneSignalSDKWorker.js")
        );
        if (!hasLegacySw || hasOneSignalWorker) return;
        cleanupRan = true;
        const didUnregister = await registration.unregister();
        vibelyOsLog("onesignal:legacy sw unregister", {
          scope: registration.scope,
          scriptPaths: paths,
          didUnregister,
        });
      })
    );
    legacySwCleanupRan = legacySwCleanupRan || cleanupRan;
    const oneSignalWorkerActive = registrationDiagnostics.some((entry) =>
      entry.scriptPaths.some(
        (path) => path.includes("OneSignalSDK.sw.js") || path.includes("OneSignalSDKWorker.js")
      )
    );
    vibelyOsLog("onesignal:sw cleanup summary", {
      cleanupRan,
      cleanupRanEver: legacySwCleanupRan,
      oneSignalWorkerActive,
    });
    void recordServiceWorkerState("onesignal_legacy_cleanup", {
      cleanup_ran: cleanupRan,
      cleanup_ran_ever: legacySwCleanupRan,
      one_signal_worker_active: oneSignalWorkerActive,
    });
  } catch (e) {
    vibelyOsLog("onesignal:legacy sw unregister failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    void recordServiceWorkerState("onesignal_legacy_cleanup_failed", {
      error_message: e instanceof Error ? e.message : String(e),
    });
  }
}

function dispatchInitSettled() {
  try {
    window.dispatchEvent(
      new CustomEvent("vibely-onesignal-init-settled", { detail: { sdkUsable } })
    );
  } catch {
    /* ignore */
  }
}

function createDeferredSdkFallbackResolver<T>(
  resolve: (value: T) => void,
  fallback: T,
): (value: T) => void {
  let settled = false;
  let removeInitSettledListener = () => undefined;
  const finish = (value: T) => {
    if (settled) return;
    settled = true;
    removeInitSettledListener();
    resolve(value);
  };

  if (initTimedOut && !initResolvedFlag) {
    const schedule = typeof window !== "undefined" && typeof window.queueMicrotask === "function"
      ? window.queueMicrotask.bind(window)
      : (callback: () => void) => setTimeout(callback, 0);
    schedule(() => finish(fallback));
    return finish;
  }

  if (!initResolvedFlag && typeof window !== "undefined") {
    const onInitSettled = () => {
      if (!sdkUsable) finish(fallback);
    };
    window.addEventListener("vibely-onesignal-init-settled", onInitSettled, { once: true });
    removeInitSettledListener = () => {
      window.removeEventListener("vibely-onesignal-init-settled", onInitSettled);
    };
  }

  return finish;
}

function clearInFlightLoginIfInitFails(userId: string) {
  if (initResolvedFlag || typeof window === "undefined") return;
  const onInitSettled = () => {
    if (!sdkUsable && loginInFlightUserId === userId) loginInFlightUserId = null;
  };
  window.addEventListener("vibely-onesignal-init-settled", onInitSettled, { once: true });
}

function waitForActualInitSettled(): Promise<void> {
  if (initResolvedFlag || typeof window === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener("vibely-onesignal-init-settled", finish);
      resolve();
    };
    const timeout = setTimeout(finish, ONESIGNAL_INIT_FALLBACK_TIMEOUT_MS);
    window.addEventListener("vibely-onesignal-init-settled", finish, { once: true });
  });
}

export type OneSignalWebBootstrap = PushSdkHealth;

export type OneSignalWebClientSnapshot = {
  appIdConfigured: boolean;
  /** Host/protocol allowlisted in code for OneSignal.init (not the same as SDK init success). */
  originAllowed: boolean;
  initEnqueued: boolean;
  /** Deferred init callback has run (check sdkUsable for success). */
  initResolved: boolean;
  sdkUsable: boolean;
  sdkStatus: PushSdkHealth;
};

export function getOneSignalWebClientSnapshot(): OneSignalWebClientSnapshot {
  const appIdConfigured = Boolean((import.meta.env.VITE_ONESIGNAL_APP_ID as string | undefined)?.trim());
  const originAllowed = typeof window !== "undefined" && isOneSignalWebOriginAllowed();
  const sdkStatus: PushSdkHealth = !appIdConfigured
    ? "app_id_missing"
    : !originAllowed
      ? "unsupported_host"
      : !initEnqueued || !initResolvedFlag
        ? "pending"
        : sdkUsable
          ? "ready"
          : "init_failed";
  return {
    appIdConfigured,
    originAllowed,
    initEnqueued,
    initResolved: initResolvedFlag,
    sdkUsable,
    sdkStatus,
  };
}

/** Await first init attempt; recoverable timeout waits for the real deferred SDK outcome. */
export async function waitForOneSignalInitResult(): Promise<{
  initEnqueued: boolean;
  sdkUsable: boolean;
  sdkStatus: PushSdkHealth;
}> {
  if (!initEnqueued || !initFinished) {
    return {
      initEnqueued: false,
      sdkUsable: false,
      sdkStatus: getOneSignalWebClientSnapshot().sdkStatus,
    };
  }
  await initFinished;
  if (!initResolvedFlag) {
    await waitForActualInitSettled();
  }
  return { initEnqueued: true, sdkUsable, sdkStatus: getOneSignalWebClientSnapshot().sdkStatus };
}

export const initOneSignal = () => {
  if (initEnqueued) return;

  const appId = import.meta.env.VITE_ONESIGNAL_APP_ID as string | undefined;
  if (!appId || String(appId).trim() === "") {
    console.warn("OneSignal: VITE_ONESIGNAL_APP_ID not set, push disabled");
    return;
  }

  vibelyOsLog("onesignal:initOneSignal enqueue");
  initEnqueued = true;
  initFinished = new Promise<void>((resolve) => {
    resolveInit = resolve;
  });
  clearOneSignalInitFallbackTimer();
  initFallbackTimer = setTimeout(() => {
    settleOneSignalInitUnavailable("sdk_init_timeout");
  }, ONESIGNAL_INIT_FALLBACK_TIMEOUT_MS);

  ensureDeferredArray();
  window.OneSignalDeferred!.push(async (OneSignal: OneSignalWebSdk) => {
    try {
      await unregisterLegacyCustomServiceWorker();
      await OneSignal.init({
        appId,
        notifyButton: { enable: false },
        allowLocalhostAsSecureOrigin: true,
        serviceWorkerParam: { scope: "/" },
      });

      sdkUsable = true;
      vibelyOsLog("onesignal:init success", { appIdTail: appId.slice(-6) });

      OneSignal.Notifications.addEventListener("click", (event: OneSignalClickEvent) => {
        const data = event.notification?.data;
        const providerNotificationId = event.notification?.notificationId ?? event.notification?.id ?? null;
        if (data) {
          preloadVideoDatePushTargetsFromPayload(data);
          void ackNotificationDispatchFromPayload(data, "web_click", providerNotificationId);
          void markNotificationOpenedV2FromPayload(data);
        }
        const actionRoute = resolveNotificationActionRoute(data?.action);
        const settingsDrawerActionRoute = actionRoute === "/settings?drawer=notifications" ? actionRoute : null;
        const payloadUrl = data?.url ?? data?.deep_link;
        const url = actionRoute ?? payloadUrl;
        const deepLink = classifyPushDeepLink(url);
        recordPushDeliveryTelemetry("push_notification_tap", {
          platform: "web",
          surface: "onesignal_click",
          ...deepLink,
        });
        recordPushDeliveryTelemetry("push_notification_deeplink_result", {
          platform: "web",
          surface: "onesignal_click",
          ...deepLink,
        });
        if (settingsDrawerActionRoute) {
          window.location.href = settingsDrawerActionRoute;
          return;
        }
        const safeHref = normalizePushDeepLinkHref(actionRoute ?? payloadUrl);
        if (safeHref) {
          void resolveVideoDatePushHrefFromCanonicalTruth(safeHref).then((href) => {
            window.location.href = normalizePushDeepLinkHref(href) ?? safeHref;
          }).catch(() => {
            window.location.href = safeHref;
          });
        }
      });

      try {
        OneSignal.User?.PushSubscription?.addEventListener?.("change", () => {
          window.dispatchEvent(new Event("vibely-onesignal-subscription-changed"));
        });
      } catch {
        /* subscription change events are best-effort */
      }
    } catch (e) {
      sdkUsable = false;
      vibelyOsLog("onesignal:init failed", {
        domainError: isOneSignalDomainError(e),
        error: e instanceof Error ? e.message : String(e),
      });
      recordPushDeliveryTelemetry("push_registration_sync_result", {
        platform: "web",
        surface: "sdk_init",
        sdk_status: "init_failed",
        sync_result_code: "init_failed",
      });
      if (isOneSignalDomainError(e)) {
        console.warn("[OneSignal] Skipped on this origin (domain restriction).");
      } else {
        console.warn("[OneSignal] init error:", e);
      }
    } finally {
      const recoveredAfterTimeout = initTimedOut && sdkUsable;
      initResolvedFlag = true;
      initTimedOut = false;
      if (!sdkUsable) loginInFlightUserId = null;
      clearOneSignalInitFallbackTimer();
      resolveInit();
      if (recoveredAfterTimeout) {
        vibelyOsLog("onesignal:init recovered after timeout", {});
      }
      dispatchInitSettled();
    }
  });
  ensureOneSignalSdkScript();
};

async function afterInit(): Promise<boolean> {
  if (!initEnqueued || !initFinished) return false;
  await initFinished;
  if (!initResolvedFlag) {
    await waitForActualInitSettled();
  }
  return sdkUsable;
}

function normalizePermissionResult(permission: unknown): boolean {
  return permission === true || permission === "granted";
}

export const promptForPush = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (!initEnqueued || !initFinished) {
      vibelyOsLog("promptForPush:early_exit", { initEnqueued, hasInitFinished: Boolean(initFinished) });
      resolve(false);
      return;
    }
    if (initResolvedFlag && !sdkUsable) {
      resolve(false);
      return;
    }
    const finish = createDeferredSdkFallbackResolver(resolve, false);
    ensureDeferredArray();
    window.OneSignalDeferred!.push(async (OneSignal: OneSignalWebSdk) => {
      const ok = await afterInit();
      if (!ok) {
        finish(false);
        return;
      }
      try {
        vibelyOsLog("promptForPush:before requestPermission");
        const permission = await OneSignal.Notifications.requestPermission();
        const granted = normalizePermissionResult(permission);
        vibelyOsLog("promptForPush:after requestPermission", { permission, granted });
        finish(granted);
      } catch (err) {
        vibelyOsLog("promptForPush:requestPermission threw", { error: String(err) });
        finish(false);
      }
    });
  });
};

export type GetPlayerIdOptions = {
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
};

function playerIdPollDelay(attempt: number, initialDelayMs: number, maxDelayMs: number): number {
  return Math.min(maxDelayMs, Math.round(initialDelayMs * Math.pow(1.65, attempt)));
}

export const getPlayerId = (options: GetPlayerIdOptions = {}): Promise<string | null> => {
  const attempts = options.attempts ?? PLAYER_ID_POLL_ATTEMPTS;
  const initialDelayMs = options.initialDelayMs ?? PLAYER_ID_INITIAL_POLL_MS;
  const maxDelayMs = options.maxDelayMs ?? PLAYER_ID_MAX_POLL_MS;
  return new Promise((resolve) => {
    if (!initEnqueued || !initFinished) {
      vibelyOsLog("getPlayerId:early_exit", { initEnqueued, hasInitFinished: Boolean(initFinished) });
      resolve(null);
      return;
    }
    if (initResolvedFlag && !sdkUsable) {
      resolve(null);
      return;
    }
    const finish = createDeferredSdkFallbackResolver<string | null>(resolve, null);
    ensureDeferredArray();
    window.OneSignalDeferred!.push(async (OneSignal: OneSignalWebSdk) => {
      const ok = await afterInit();
      if (!ok) {
        finish(null);
        return;
      }
      try {
        for (let i = 0; i < attempts; i++) {
          const id = await OneSignal.User?.PushSubscription?.id;
          vibelyOsLog("getPlayerId:poll", { attempt: i + 1, hasId: Boolean(id) });
          if (id) {
            finish(id);
            return;
          }
          await new Promise((r) => setTimeout(r, playerIdPollDelay(i, initialDelayMs, maxDelayMs)));
        }
        vibelyOsLog("getPlayerId:exhausted", {});
        finish(null);
      } catch {
        finish(null);
      }
    });
  });
};

export const isSubscribed = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (!initEnqueued || !initFinished) {
      vibelyOsLog("isSubscribed:early_exit", { initEnqueued, hasInitFinished: Boolean(initFinished) });
      resolve(false);
      return;
    }
    if (initResolvedFlag && !sdkUsable) {
      resolve(false);
      return;
    }
    const finish = createDeferredSdkFallbackResolver(resolve, false);
    ensureDeferredArray();
    window.OneSignalDeferred!.push(async (OneSignal: OneSignalWebSdk) => {
      const ok = await afterInit();
      if (!ok) {
        finish(false);
        return;
      }
      try {
        const optedIn = OneSignal.User?.PushSubscription?.optedIn;
        const sub = !!optedIn;
        vibelyOsLog("isSubscribed:result", { optedIn: sub });
        finish(sub);
      } catch {
        vibelyOsLog("isSubscribed:error", {});
        finish(false);
      }
    });
  });
};

export function getOneSignalIdentityGeneration(): number {
  return identityGeneration;
}

export function isCurrentOneSignalIdentity(userId: string, generation: number): boolean {
  return activeIdentityUserId === userId && identityGeneration === generation;
}

/**
 * Link Supabase user to OneSignal. Waits for init; skips if already linked to this id (no TOKEN_REFRESHED spam).
 */
export const setExternalUserId = (userId: string): number => {
  if (activeIdentityUserId !== userId) {
    identityGeneration += 1;
    activeIdentityUserId = userId;
    lastLoggedInUserId = null;
    loginInFlightUserId = null;
  }
  const generation = identityGeneration;
  if (!initEnqueued || !initFinished) return generation;
  if (lastLoggedInUserId === userId) return generation;
  if (loginInFlightUserId === userId) return generation;
  if (initResolvedFlag && !sdkUsable) return generation;
  loginInFlightUserId = userId;
  clearInFlightLoginIfInitFails(userId);

  ensureDeferredArray();
  window.OneSignalDeferred!.push(async (OneSignal: OneSignalWebSdk) => {
    const ok = await afterInit();
    if (!ok) {
      if (loginInFlightUserId === userId) loginInFlightUserId = null;
      return;
    }
    if (!isCurrentOneSignalIdentity(userId, generation)) {
      if (loginInFlightUserId === userId) loginInFlightUserId = null;
      return;
    }
    if (lastLoggedInUserId === userId) {
      if (loginInFlightUserId === userId) loginInFlightUserId = null;
      return;
    }
    try {
      await OneSignal.login(userId);
      if (!isCurrentOneSignalIdentity(userId, generation)) return;
      lastLoggedInUserId = userId;
    } catch (e) {
      console.warn("OneSignal login failed:", e);
      lastLoggedInUserId = null;
    } finally {
      if (loginInFlightUserId === userId) loginInFlightUserId = null;
    }
  });
  return generation;
};

/**
 * Clear OneSignal user. Sync-clear local link state so login isn't re-skipped, then SDK logout.
 */
export const removeExternalUserId = () => {
  identityGeneration += 1;
  activeIdentityUserId = null;
  const generation = identityGeneration;
  lastLoggedInUserId = null;
  loginInFlightUserId = null;
  if (!initEnqueued || !initFinished) return;

  ensureDeferredArray();
  window.OneSignalDeferred!.push(async (OneSignal: OneSignalWebSdk) => {
    const ok = await afterInit();
    if (!ok) return;
    if (generation !== identityGeneration) return;
    try {
      await OneSignal.logout();
    } catch (e) {
      console.warn("OneSignal logout failed:", e);
    }
  });
};
