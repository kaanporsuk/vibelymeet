export type ChatVibeClipSmokePlatform = "web" | "ios" | "android";
export type ChatVibeClipSmokeScenarioId =
  | "happy-path"
  | "4g-throttle"
  | "kill-mid-tus"
  | "webhook-delayed";

export type ChatVibeClipSmokeScenario = {
  id: ChatVibeClipSmokeScenarioId;
  title: string;
  purpose: string;
  requiredEvidence: readonly string[];
  timeoutMs: number;
};

export type ChatVibeClipSmokeRow = ChatVibeClipSmokeScenario & {
  platform: ChatVibeClipSmokePlatform;
  rowId: `${ChatVibeClipSmokePlatform}:${ChatVibeClipSmokeScenarioId}`;
};

export const CHAT_VIBE_CLIP_SMOKE_PLATFORMS = ["web", "ios", "android"] as const;

export const CHAT_VIBE_CLIP_SMOKE_SCENARIOS: readonly ChatVibeClipSmokeScenario[] = [
  {
    id: "happy-path",
    title: "Happy path upload to playable bubble",
    purpose: "Proves create -> TUS upload -> complete -> message materialization -> playback surface.",
    requiredEvidence: [
      "create-chat-vibe-clip-upload 2xx",
      "complete-chat-vibe-clip-upload 2xx",
      "vibe-clip-bubble visible",
      "processing status reaches ready or explicit processing evidence is captured",
    ],
    timeoutMs: 120_000,
  },
  {
    id: "4g-throttle",
    title: "4G throttle upload",
    purpose: "Proves the same funnel under constrained latency and throughput.",
    requiredEvidence: [
      "network throttle enabled before clip selection",
      "create-chat-vibe-clip-upload 2xx",
      "complete-chat-vibe-clip-upload 2xx",
      "no duplicate client_request_id conflict",
    ],
    timeoutMs: 180_000,
  },
  {
    id: "kill-mid-tus",
    title: "Kill mid-TUS and recover",
    purpose: "Proves app interruption does not silently lose a queued Chat Vibe Clip.",
    requiredEvidence: [
      "upload disruption injected after create",
      "app relaunched or page reloaded",
      "user sees resumable, retryable, or safely failed state",
      "no duplicate published message for the same client_request_id",
    ],
    timeoutMs: 180_000,
  },
  {
    id: "webhook-delayed",
    title: "Webhook delayed recovery",
    purpose: "Proves a completed provider upload can be recovered by sync/polling if webhook arrival lags.",
    requiredEvidence: [
      "complete-chat-vibe-clip-upload 2xx",
      "sync-chat-vibe-clip-status invoked or webhook update observed",
      "bubble leaves indefinite processing or records explicit failed state",
      "trace logs include provider_object_id and client_request_id",
    ],
    timeoutMs: 240_000,
  },
];

export const CHAT_VIBE_CLIP_SMOKE_MATRIX: readonly ChatVibeClipSmokeRow[] =
  CHAT_VIBE_CLIP_SMOKE_PLATFORMS.flatMap((platform) =>
    CHAT_VIBE_CLIP_SMOKE_SCENARIOS.map((scenario) => ({
      ...scenario,
      platform,
      rowId: `${platform}:${scenario.id}` as const,
    }))
  );

export const CHAT_VIBE_CLIP_WEB_SMOKE_ENV = [
  "VIBELY_CVC_SMOKE",
  "VIBELY_CVC_WEB_CHAT_URL",
  "VIBELY_CVC_WEB_STORAGE_STATE",
  "VIBELY_CVC_FIXTURE_VIDEO",
] as const;

export const CHAT_VIBE_CLIP_NATIVE_SMOKE_ENV = [
  "VIBELY_CVC_NATIVE_SMOKE",
  "VIBELY_CVC_NATIVE_CHAT_DEEPLINK",
  "MAESTRO_RUN",
] as const;

