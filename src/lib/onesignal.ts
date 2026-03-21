declare global {
  interface Window {
    OneSignalDeferred?: Array<(oneSignal: any) => void>;
  }
}

const ONESIGNAL_APP_ID_FALLBACK = "97e52ea2-6a27-4486-a678-4dd8a0d49e94";
const ONESIGNAL_APP_ID =
  import.meta.env.VITE_ONESIGNAL_APP_ID || ONESIGNAL_APP_ID_FALLBACK;

/** OneSignal domain restriction throws e.g. "This web push config can only be used on https://vibelymeet.com". */
function isOneSignalDomainError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /can only be used on|WrongSiteUrl|SdkInitError/i.test(msg);
}

let initEnqueued = false;
let initFinished: Promise<void> | null = null;
let resolveInit!: () => void;
let sdkUsable = false;

/** Last user id passed to OneSignal.login — avoids duplicate login spam on re-renders / token refresh. */
let lastLoggedInUserId: string | null = null;

function ensureDeferredArray() {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
}

export const initOneSignal = () => {
  if (initEnqueued) return;
  initEnqueued = true;
  initFinished = new Promise<void>((resolve) => {
    resolveInit = resolve;
  });

  ensureDeferredArray();
  window.OneSignalDeferred!.push(async (OneSignal: any) => {
    try {
      await OneSignal.init({
        appId: ONESIGNAL_APP_ID,
        notifyButton: { enable: false },
        allowLocalhostAsSecureOrigin: true,
        serviceWorkerParam: { scope: "/" },
      });

      sdkUsable = true;

      OneSignal.Notifications.addEventListener("click", (event: any) => {
        const url = event.notification?.data?.url;
        if (url && typeof url === "string") {
          window.location.href = url;
        }
      });
    } catch (e) {
      sdkUsable = false;
      if (isOneSignalDomainError(e)) {
        console.warn("[OneSignal] Skipped on this origin (domain restriction).");
      } else {
        console.warn("[OneSignal] init error:", e);
      }
    } finally {
      resolveInit();
    }
  });
};

async function afterInit(): Promise<boolean> {
  if (!initEnqueued || !initFinished) return false;
  await initFinished;
  return sdkUsable;
}

export const promptForPush = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (!initEnqueued || !initFinished) {
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
        const permission = await OneSignal.Notifications.requestPermission();
        resolve(permission);
      } catch {
        resolve(false);
      }
    });
  });
};

export const getPlayerId = (): Promise<string | null> => {
  return new Promise((resolve) => {
    if (!initEnqueued || !initFinished) {
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
        for (let i = 0; i < 5; i++) {
          const id = await OneSignal.User.PushSubscription.id;
          if (id) {
            resolve(id);
            return;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
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
        resolve(!!optedIn);
      } catch {
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
