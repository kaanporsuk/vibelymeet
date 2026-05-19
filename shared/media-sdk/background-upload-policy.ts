export const MEDIA_BACKGROUND_UPLOAD_PHASE = "phase_7_background_upload_spike" as const;
export const MEDIA_BACKGROUND_UPLOAD_SOURCE_OF_TRUTH =
  "phase_1_6_foreground_persistent_queue_and_recovery" as const;
export const MEDIA_BACKGROUND_UPLOAD_PRODUCTION_ENABLED = false as const;

export type MediaBackgroundUploadPlatform = "web" | "ios" | "android";
export type MediaBackgroundUploadDecision = "no_go_research_only";

export type MediaBackgroundUploadPlatformGate = {
  readonly platform: MediaBackgroundUploadPlatform;
  readonly candidate: string;
  readonly productionEnabled: false;
  readonly prototypeOnly: true;
  readonly blockingRisks: readonly string[];
  readonly requiredManualProof: readonly string[];
  readonly goCriteria: readonly string[];
};

export type MediaBackgroundUploadPolicy = {
  readonly phase: typeof MEDIA_BACKGROUND_UPLOAD_PHASE;
  readonly decidedAt: string;
  readonly productionCutover: MediaBackgroundUploadDecision;
  readonly productionEnabled: false;
  readonly sourceOfTruth: typeof MEDIA_BACKGROUND_UPLOAD_SOURCE_OF_TRUTH;
  readonly productGate: string;
  readonly platforms: Record<MediaBackgroundUploadPlatform, MediaBackgroundUploadPlatformGate>;
  readonly prohibitedInPhase7: readonly string[];
  readonly manualOnlyGates: readonly string[];
};

export const MEDIA_BACKGROUND_UPLOAD_POLICY: MediaBackgroundUploadPolicy = {
  phase: MEDIA_BACKGROUND_UPLOAD_PHASE,
  decidedAt: "2026-05-19",
  productionCutover: "no_go_research_only",
  productionEnabled: MEDIA_BACKGROUND_UPLOAD_PRODUCTION_ENABLED,
  sourceOfTruth: MEDIA_BACKGROUND_UPLOAD_SOURCE_OF_TRUTH,
  productGate:
    "Do not route production uploads through OS-level background execution until every platform gate has measured pass data.",
  platforms: {
    web: {
      platform: "web",
      candidate: "non_root_service_worker_background_sync_probe",
      productionEnabled: false,
      prototypeOnly: true,
      blockingRisks: [
        "Background Sync is connectivity-deferred and not available in every major browser.",
        "Periodic Background Sync is experimental and not a long-transfer guarantee.",
        "OneSignal owns the root-scoped service worker today, so media workers must not collide with root push scope.",
        "File and Blob source recovery after page close must be proven per browser before any upload can depend on it.",
      ],
      requiredManualProof: [
        "Chrome, Edge, Firefox, Android Chrome, iOS Safari, and desktop Safari support matrix.",
        "Kill-tab, reload, offline, online, and lock-screen recovery matrix with user-selected media.",
        "OneSignal registration, subscription, push receipt, and notification click behavior unchanged.",
        "Zero duplicate assets and zero duplicate message/profile publishes under retry and source replacement.",
      ],
      goCriteria: [
        "At least 95 percent recovery completion in supported browsers for photo and voice uploads.",
        "No production impact to OneSignal web push service worker scope or registration.",
        "Unsupported browsers fall back to the foreground persistent queue without user-visible regression.",
      ],
    },
    ios: {
      platform: "ios",
      candidate: "native_background_urlsession_or_bgprocessing_recovery_probe",
      productionEnabled: false,
      prototypeOnly: true,
      blockingRisks: [
        "Expo background tasks are deferrable and may not run immediately after scheduling.",
        "Reliable iOS upload continuation requires file-backed native URLSession background transfers.",
        "A JavaScript TUS upload cannot be assumed to continue after suspension or termination.",
        "Any native background-task dependency or URLSession bridge requires a native rebuild and device proof.",
      ],
      requiredManualProof: [
        "Native dev-client or store-binary build with entitlement and background-mode configuration.",
        "Suspend, terminate, reconnect, low-power, and poor-network matrix on real iOS devices.",
        "File-backed upload continuation with progress, completion, and delegate restoration evidence.",
        "No duplicate assets and no stale replacement overwrite after app restart.",
      ],
      goCriteria: [
        "At least 95 percent recovery completion for photo and voice uploads on supported iOS versions.",
        "OS-compliant background behavior with no hidden long-running JavaScript upload assumption.",
        "Foreground SDK queue remains authoritative when the OS declines to run the background task.",
      ],
    },
    android: {
      platform: "android",
      candidate: "workmanager_or_user_visible_foreground_service_probe",
      productionEnabled: false,
      prototypeOnly: true,
      blockingRisks: [
        "WorkManager is persistent scheduling, not a blanket guarantee for arbitrary long uploads.",
        "Long-running upload work needs foreground/user-visible handling and notification policy compliance.",
        "A native worker must share idempotency and source binding with the SDK queue to avoid duplicate publishes.",
        "Any WorkManager bridge requires native code, manifest policy, rebuild, and real-device proof.",
      ],
      requiredManualProof: [
        "Real-device Android matrix across app background, force-stop-adjacent flows, network migration, and reboot.",
        "Foreground-service notification behavior when uploads are user-visible or long-running.",
        "Queue handoff proof between JavaScript foreground uploads and native worker retries.",
        "Zero duplicate assets and zero duplicate message/profile publishes under retries.",
      ],
      goCriteria: [
        "At least 95 percent recovery completion for photo and voice uploads on supported Android versions.",
        "User-visible background work complies with current foreground-service and WorkManager limits.",
        "Foreground SDK queue remains authoritative when scheduled work is delayed or cancelled.",
      ],
    },
  },
  prohibitedInPhase7: [
    "Do not register a media service worker at runtime.",
    "Do not add expo-background-task or expo-task-manager dependencies.",
    "Do not add native WorkManager or URLSession upload bridge code.",
    "Do not run web builds, native builds, device QA, browser automation, Supabase mutations, or rollout flag changes.",
  ],
  manualOnlyGates: [
    "Browser service-worker and Background Sync support matrix.",
    "OneSignal root service-worker compatibility probe.",
    "Native rebuild with iOS and Android background capability configuration.",
    "Real-device suspend, terminate, network migration, low-power, and retry matrix.",
    "Measured success-rate floors and duplicate-publish proof before any production flag exists.",
  ],
};

export function shouldEnableOsBackgroundUploads(): false {
  return MEDIA_BACKGROUND_UPLOAD_PRODUCTION_ENABLED;
}

export function getMediaBackgroundUploadPolicy(): MediaBackgroundUploadPolicy {
  return MEDIA_BACKGROUND_UPLOAD_POLICY;
}
