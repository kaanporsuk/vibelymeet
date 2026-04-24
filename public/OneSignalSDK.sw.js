// OneSignal web push service worker shim for Vibely.
// This file must be served from the site root so that
// https://vibelymeet.com/OneSignalSDK.sw.js?appId=... can load without 404.
// It simply delegates to the official OneSignal CDN-hosted worker.

// Chromium warns if a worker adds its `message` handler after async initialization.
// Register a no-op handler during initial evaluation before delegating to OneSignal.
self.addEventListener("message", () => {});

importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
