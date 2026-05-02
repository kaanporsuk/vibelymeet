declare global {
  interface Window {
    OneSignalDeferred?: Array<(oneSignal: OneSignalWebSdk) => void>;
  }
}

import { isOneSignalWebOriginAllowed } from "@/lib/oneSignalWebOrigin";
import { vibelyOsLog } from "@/lib/onesignalWebDiagnostics";
import { classifyPushDeepLink, recordPushDeliveryTelemetry } from "@/lib/pushDeliveryTelemetry";
import { recordServiceWorkerState } from "@/lib/browserDiagnostics";
import type { PushSdkHealth } from "@clientShared/pushDeliveryHealth";

const PLAYER_ID_POLL_ATTEMPTS = 10;
const PLAYER_ID_INITIAL_POLL_MS = 500;
const PLAYER_ID_MAX_POLL_MS = 4000;
const ONESIGNAL_SDK_SRC = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
const ONESIGNAL_SCRIPT_ID = "onesignal-sdk-page";

type OneSignalClickEvent = {
  notification?: {
    data?: {
      url?: unknown;
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
let legacySwCleanupRan = false;

/** Last user id passed to OneSignal.login — avoids duplicate login spam on re-renders / token refresh. */
let lastLoggedInUserId: string | null = null;
let activeIdentityUserId: string | null = null;
let identityGeneration = 0;

function ensureDeferredArray() {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
}

function ensureOneSignalSdkScript() {
  if (typeof document === "undefined") return;
  if (document.getElementById(ONESIGNAL_SCRIPT_ID)) return;
  const script = document.createElement("script");
  script.id = ONESIGNAL_SCRIPT_ID;
  script.src = ONESIGNAL_SDK_SRC;
  script.defer = true;
  script.async = true;
  script.onerror = () => {
    sdkUsable = false;
    initResolvedFlag = true;
    resolveInit?.();
    vibelyOsLog("onesignal:sdk script failed", {});
    dispatchInitSettled();
  };
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

/** Await first init attempt; use to avoid treating "init never ran" as "user not subscribed". */
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
        const url = event.notification?.data?.url;
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
        if (url && typeof url === "string") {
          window.location.href = url;
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
      initResolvedFlag = true;
      resolveInit();
      dispatchInitSettled();
    }
  });
  ensureOneSignalSdkScript();
};

async function afterInit(): Promise<boolean> {
  if (!initEnqueued || !initFinished) return false;
  await initFinished;
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
    ensureDeferredArray();
    window.OneSignalDeferred!.push(async (OneSignal: OneSignalWebSdk) => {
      const ok = await afterInit();
      if (!ok) {
        resolve(false);
        return;
      }
      try {
        vibelyOsLog("promptForPush:before requestPermission");
        const permission = await OneSignal.Notifications.requestPermission();
        const granted = normalizePermissionResult(permission);
        vibelyOsLog("promptForPush:after requestPermission", { permission, granted });
        resolve(granted);
      } catch (err) {
        vibelyOsLog("promptForPush:requestPermission threw", { error: String(err) });
        resolve(false);
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
    ensureDeferredArray();
    window.OneSignalDeferred!.push(async (OneSignal: OneSignalWebSdk) => {
      const ok = await afterInit();
      if (!ok) {
        resolve(null);
        return;
      }
      try {
        for (let i = 0; i < attempts; i++) {
          const id = await OneSignal.User?.PushSubscription?.id;
          vibelyOsLog("getPlayerId:poll", { attempt: i + 1, hasId: Boolean(id) });
          if (id) {
            resolve(id);
            return;
          }
          await new Promise((r) => setTimeout(r, playerIdPollDelay(i, initialDelayMs, maxDelayMs)));
        }
        vibelyOsLog("getPlayerId:exhausted", {});
        resolve(null);
      } catch {
        resolve(null);
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
    ensureDeferredArray();
    window.OneSignalDeferred!.push(async (OneSignal: OneSignalWebSdk) => {
      const ok = await afterInit();
      if (!ok) {
        resolve(false);
        return;
      }
      try {
        const optedIn = OneSignal.User?.PushSubscription?.optedIn;
        const sub = !!optedIn;
        vibelyOsLog("isSubscribed:result", { optedIn: sub });
        resolve(sub);
      } catch {
        vibelyOsLog("isSubscribed:error", {});
        resolve(false);
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
  }
  const generation = identityGeneration;
  if (!initEnqueued || !initFinished) return generation;
  if (lastLoggedInUserId === userId) return generation;

  ensureDeferredArray();
  window.OneSignalDeferred!.push(async (OneSignal: OneSignalWebSdk) => {
    const ok = await afterInit();
    if (!ok) return;
    if (!isCurrentOneSignalIdentity(userId, generation)) return;
    if (lastLoggedInUserId === userId) return;
    try {
      await OneSignal.login(userId);
      if (!isCurrentOneSignalIdentity(userId, generation)) return;
      lastLoggedInUserId = userId;
    } catch (e) {
      console.warn("OneSignal login failed:", e);
      lastLoggedInUserId = null;
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
  if (!initEnqueued || !initFinished) return;
  lastLoggedInUserId = null;

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
