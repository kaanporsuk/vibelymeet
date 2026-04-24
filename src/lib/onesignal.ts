declare global {
  interface Window {
    OneSignalDeferred?: Array<(oneSignal: any) => void>;
  }
}

import { isOneSignalWebOriginAllowed } from "@/lib/oneSignalWebOrigin";
import { vibelyOsLog } from "@/lib/onesignalWebDiagnostics";

const PLAYER_ID_POLL_ATTEMPTS = 8;
const PLAYER_ID_POLL_MS = 1000;

/** OneSignal domain restriction throws e.g. "This web push config can only be used on https://vibelymeet.com". */
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

/** Last user id passed to OneSignal.login — avoids duplicate login spam on re-renders / token refresh. */
let lastLoggedInUserId: string | null = null;

function ensureDeferredArray() {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
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
    await Promise.all(
      registrations.map(async (registration) => {
        const paths = serviceWorkerScriptPaths(registration);
        if (!paths.includes("/sw.js")) return;
        const didUnregister = await registration.unregister();
        vibelyOsLog("onesignal:legacy sw unregister", {
          scope: registration.scope,
          scriptPaths: paths,
          didUnregister,
        });
      })
    );
  } catch (e) {
    vibelyOsLog("onesignal:legacy sw unregister failed", {
      error: e instanceof Error ? e.message : String(e),
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

export type OneSignalWebBootstrap = 'unsupported_host' | 'pending' | 'ready' | 'init_failed';

export type OneSignalWebClientSnapshot = {
  /** Host/protocol allowlisted in code for OneSignal.init (not the same as SDK init success). */
  originAllowed: boolean;
  initEnqueued: boolean;
  /** Deferred init callback has run (check sdkUsable for success). */
  initResolved: boolean;
  sdkUsable: boolean;
};

export function getOneSignalWebClientSnapshot(): OneSignalWebClientSnapshot {
  return {
    originAllowed: typeof window !== "undefined" && isOneSignalWebOriginAllowed(),
    initEnqueued,
    initResolved: initResolvedFlag,
    sdkUsable,
  };
}

/** Await first init attempt; use to avoid treating "init never ran" as "user not subscribed". */
export async function waitForOneSignalInitResult(): Promise<{
  initEnqueued: boolean;
  sdkUsable: boolean;
}> {
  if (!initEnqueued || !initFinished) {
    return { initEnqueued: false, sdkUsable: false };
  }
  await initFinished;
  return { initEnqueued: true, sdkUsable };
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
  window.OneSignalDeferred!.push(async (OneSignal: any) => {
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

      OneSignal.Notifications.addEventListener("click", (event: any) => {
        const url = event.notification?.data?.url;
        if (url && typeof url === "string") {
          window.location.href = url;
        }
      });
    } catch (e) {
      sdkUsable = false;
      vibelyOsLog("onesignal:init failed", {
        domainError: isOneSignalDomainError(e),
        error: e instanceof Error ? e.message : String(e),
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
    window.OneSignalDeferred!.push(async (OneSignal: any) => {
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

export const getPlayerId = (): Promise<string | null> => {
  return new Promise((resolve) => {
    if (!initEnqueued || !initFinished) {
      vibelyOsLog("getPlayerId:early_exit", { initEnqueued, hasInitFinished: Boolean(initFinished) });
      resolve(null);
      return;
    }
    ensureDeferredArray();
    window.OneSignalDeferred!.push(async (OneSignal: any) => {
      const ok = await afterInit();
      if (!ok) {
        resolve(null);
        return;
      }
      try {
        for (let i = 0; i < PLAYER_ID_POLL_ATTEMPTS; i++) {
          const id = await OneSignal.User.PushSubscription.id;
          vibelyOsLog("getPlayerId:poll", { attempt: i + 1, hasId: Boolean(id) });
          if (id) {
            resolve(id);
            return;
          }
          await new Promise((r) => setTimeout(r, PLAYER_ID_POLL_MS));
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
    window.OneSignalDeferred!.push(async (OneSignal: any) => {
      const ok = await afterInit();
      if (!ok) {
        resolve(false);
        return;
      }
      try {
        const optedIn = OneSignal.User.PushSubscription.optedIn;
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

/**
 * Link Supabase user to OneSignal. Waits for init; skips if already linked to this id (no TOKEN_REFRESHED spam).
 */
export const setExternalUserId = (userId: string) => {
  if (!initEnqueued || !initFinished) return;
  if (lastLoggedInUserId === userId) return;

  ensureDeferredArray();
  window.OneSignalDeferred!.push(async (OneSignal: any) => {
    const ok = await afterInit();
    if (!ok) return;
    if (lastLoggedInUserId === userId) return;
    lastLoggedInUserId = userId;
    try {
      await OneSignal.login(userId);
    } catch (e) {
      console.warn("OneSignal login failed:", e);
      lastLoggedInUserId = null;
    }
  });
};

/**
 * Clear OneSignal user. Sync-clear local link state so login isn't re-skipped, then SDK logout.
 */
export const removeExternalUserId = () => {
  if (!initEnqueued || !initFinished) return;
  const hadLinked = lastLoggedInUserId !== null;
  lastLoggedInUserId = null;
  if (!hadLinked) return;

  ensureDeferredArray();
  window.OneSignalDeferred!.push(async (OneSignal: any) => {
    const ok = await afterInit();
    if (!ok) return;
    try {
      await OneSignal.logout();
    } catch (e) {
      console.warn("OneSignal logout failed:", e);
    }
  });
};
