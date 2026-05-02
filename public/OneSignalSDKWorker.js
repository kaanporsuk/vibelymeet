// Keep a top-level message handler for browsers that require it during initial worker evaluation.
self.addEventListener("message", () => {});

function importOneSignalWorkerWithInitialSetup() {
  const originalSetTimeout = self.setTimeout;

  self.setTimeout = (callback, delay, ...args) => {
    if (delay === 0 && typeof callback === "function") {
      callback(...args);
      return 0;
    }
    return originalSetTimeout.call(self, callback, delay, ...args);
  };

  try {
    importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
  } finally {
    self.setTimeout = originalSetTimeout;
  }
}

importOneSignalWorkerWithInitialSetup();
