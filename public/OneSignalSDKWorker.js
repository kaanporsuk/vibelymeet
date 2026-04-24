// Keep a top-level message handler for browsers that require it during initial worker evaluation.
self.addEventListener("message", () => {});

importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
