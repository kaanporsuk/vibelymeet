declare global {
  interface Window {
    OneSignalDeferred?: Array<(oneSignal: any) => void>;
  }
}

const ONESIGNAL_APP_ID = "97e52ea2-6a27-4486-a678-4dd8a0d49e94";

export const initOneSignal = () => {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal: any) => {
    await OneSignal.init({
      appId: ONESIGNAL_APP_ID,
      notifyButton: { enable: false },
      allowLocalhostAsSecureOrigin: true,
      serviceWorkerParam: { scope: "/" },
    });

    // Deep link handler — navigate on notification tap
    OneSignal.Notifications.addEventListener("click", (event: any) => {
      const url = event.notification?.data?.url;
      if (url && typeof url === "string") {
        window.location.href = url;
      }
    });
  });
};

export const promptForPush = (): Promise<boolean> => {
  return new Promise((resolve) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal: any) => {
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
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal: any) => {
      try {
        const id = await OneSignal.User.PushSubscription.id;
        resolve(id || null);
      } catch {
        resolve(null);
      }
    });
  });
};

export const isSubscribed = (): Promise<boolean> => {
  return new Promise((resolve) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal: any) => {
      try {
        const optedIn = OneSignal.User.PushSubscription.optedIn;
        resolve(!!optedIn);
      } catch {
        resolve(false);
      }
    });
  });
};

export const setExternalUserId = (userId: string) => {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal: any) => {
    try {
      await OneSignal.login(userId);
    } catch (e) {
      console.error("OneSignal login error:", e);
    }
  });
};

export const removeExternalUserId = () => {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal: any) => {
    try {
      await OneSignal.logout();
    } catch (e) {
      console.error("OneSignal logout error:", e);
    }
  });
};
