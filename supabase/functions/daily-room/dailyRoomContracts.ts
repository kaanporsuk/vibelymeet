export type DateRoomAction =
  | "prepare_date_entry"
  | "video_date_leave";

export function videoDateRoomNameForSession(sessionId: string): string {
  return `date-${sessionId.replace(/-/g, "")}`;
}

export function videoDateRoomUrlForName(roomName: string, dailyDomain: string): string {
  return `https://${dailyDomain}/${roomName}`;
}

export const DAILY_ROOM_DOMAIN_FALLBACK = "vibelyapp.daily.co" as const;
export const DAILY_VIDEO_DATE_ROOM_TTL_SECONDS = 14_400 as const;
export const DAILY_VIDEO_DATE_ROOM_MAX_PARTICIPANTS = 2 as const;

export function buildVideoDateRoomProperties(params: {
  nowSeconds?: number;
  ttlSeconds?: number;
} = {}): {
  max_participants: typeof DAILY_VIDEO_DATE_ROOM_MAX_PARTICIPANTS;
  enable_chat: false;
  enable_screenshare: false;
  enable_recording: false;
  enable_knocking: false;
  enforce_unique_user_ids: true;
  start_video_off: false;
  start_audio_off: false;
  exp: number;
  eject_at_room_exp: true;
} {
  const nowSeconds = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttlSeconds = params.ttlSeconds ?? DAILY_VIDEO_DATE_ROOM_TTL_SECONDS;
  return {
    max_participants: DAILY_VIDEO_DATE_ROOM_MAX_PARTICIPANTS,
    enable_chat: false,
    enable_screenshare: false,
    enable_recording: false,
    enable_knocking: false,
    enforce_unique_user_ids: true,
    start_video_off: false,
    start_audio_off: false,
    exp: nowSeconds + ttlSeconds,
    eject_at_room_exp: true,
  };
}

export type DailyProductionConfigReadiness = {
  ready: boolean;
  blockers: string[];
};

export type DailyRuntimeConfig = {
  ok: boolean;
  code: "OK" | "DAILY_CONFIG_BLOCKED";
  dailyApiKey: string | null;
  dailyDomain: string;
  dailyDomainEnv: string | null;
  fallbackUsed: boolean;
  blockers: string[];
};

function isConfiguredSecretValue(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  return !/^(changeme|change-me|change_me|placeholder|example|dummy|test|todo)$/i.test(trimmed);
}

function isConfiguredDomainValue(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  if (/^(changeme|change-me|change_me|placeholder|example|dummy|test|todo)$/i.test(trimmed)) return false;
  return /^[a-z0-9.-]+$/i.test(trimmed);
}

function isExplicitLocalDailyEnvironment(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "local" ||
    normalized === "dev" ||
    normalized === "development" ||
    normalized === "test";
}

export function resolveDailyRuntimeConfig(params: {
  dailyApiKey?: string | null;
  dailyDomainEnv?: string | null;
  environment?: string | null;
  allowLocalFallback?: boolean;
  requireApiKey?: boolean;
}): DailyRuntimeConfig {
  const blockers: string[] = [];
  const dailyApiKey = params.dailyApiKey?.trim() || null;
  const dailyDomainEnv = params.dailyDomainEnv?.trim() || null;
  const canUseLocalFallback =
    params.allowLocalFallback === true &&
    isExplicitLocalDailyEnvironment(params.environment);
  const fallbackUsed = !dailyDomainEnv && canUseLocalFallback;
  const dailyDomain = dailyDomainEnv || DAILY_ROOM_DOMAIN_FALLBACK;

  if (params.requireApiKey !== false && !isConfiguredSecretValue(dailyApiKey)) {
    blockers.push("daily_api_key_missing");
  }

  if (!dailyDomainEnv) {
    if (!canUseLocalFallback) {
      blockers.push("daily_domain_missing");
      blockers.push("daily_domain_fallback_blocked");
    }
  } else if (!isConfiguredDomainValue(dailyDomainEnv)) {
    blockers.push("daily_domain_invalid");
  }

  return {
    ok: blockers.length === 0,
    code: blockers.length === 0 ? "OK" : "DAILY_CONFIG_BLOCKED",
    dailyApiKey,
    dailyDomain,
    dailyDomainEnv,
    fallbackUsed,
    blockers,
  };
}

export function evaluateDailyProductionConfigReadiness(params: {
  dailyApiKey?: string | null;
  dailyDomainEnv?: string | null;
  dailyWebhookSecret?: string | null;
  cleanupCronSecret?: string | null;
}): DailyProductionConfigReadiness {
  const blockers: string[] = [];

  if (!isConfiguredSecretValue(params.dailyApiKey)) blockers.push("daily_api_key_missing");

  const domain = params.dailyDomainEnv?.trim() ?? "";
  if (!domain) {
    blockers.push("daily_domain_missing");
    blockers.push("daily_domain_fallback_used");
  } else if (!isConfiguredDomainValue(domain)) {
    blockers.push("daily_domain_invalid");
  }

  if (!isConfiguredSecretValue(params.dailyWebhookSecret)) blockers.push("daily_webhook_secret_missing");
  if (!isConfiguredSecretValue(params.cleanupCronSecret)) blockers.push("daily_cleanup_cron_secret_missing");

  return {
    ready: blockers.length === 0,
    blockers,
  };
}

export function isDailyRoomUrlForName(value: string, roomName: string, dailyDomain: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === dailyDomain &&
      url.pathname.replace(/\/+$/, "") === `/${roomName}`;
  } catch {
    return false;
  }
}

export function resolveCanonicalVideoDateRoom(params: {
  sessionId: string;
  dailyDomain: string;
  existingRoomName?: string | null;
  existingRoomUrl?: string | null;
}): {
  roomName: string;
  roomUrl: string;
  metadataMatchesCanonical: boolean;
} {
  const roomName = videoDateRoomNameForSession(params.sessionId);
  const roomUrl = videoDateRoomUrlForName(roomName, params.dailyDomain);
  return {
    roomName,
    roomUrl,
    metadataMatchesCanonical:
      params.existingRoomName === roomName &&
      params.existingRoomUrl === roomUrl,
  };
}

export function buildMeetingTokenProperties(params: {
  roomName: string;
  userId: string;
  ttlSeconds: number;
  nowSeconds?: number;
  ejectAtTokenExp?: boolean;
}): {
  room_name: string;
  user_id: string;
  enable_screenshare: false;
  exp: number;
  eject_at_token_exp?: true;
} {
  const nowSeconds = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  return {
    room_name: params.roomName,
    user_id: params.userId,
    enable_screenshare: false,
    exp: nowSeconds + params.ttlSeconds,
    ...(params.ejectAtTokenExp ? { eject_at_token_exp: true as const } : {}),
  };
}

export function isDailyRoomAlreadyExistsErrorText(text: string): boolean {
  return text.toLowerCase().includes("already exists");
}

export type DailyProviderRoomState = {
  exists: boolean;
  expired: boolean;
};

export type DailyProviderRoomRecoveryPlan =
  | {
      shouldCreate: false;
      shouldDeleteExpired: false;
      providerRoomRecreated: false;
      providerRoomRecovered: false;
      reason: "exists";
    }
  | {
      shouldCreate: true;
      shouldDeleteExpired: boolean;
      providerRoomRecreated: true;
      providerRoomRecovered: true;
      reason: "missing" | "expired";
    };

export function planDailyProviderRoomRecovery(state: DailyProviderRoomState): DailyProviderRoomRecoveryPlan {
  if (!state.exists) {
    return {
      shouldCreate: true,
      shouldDeleteExpired: false,
      providerRoomRecreated: true,
      providerRoomRecovered: true,
      reason: "missing",
    };
  }

  if (state.expired) {
    return {
      shouldCreate: true,
      shouldDeleteExpired: true,
      providerRoomRecreated: true,
      providerRoomRecovered: true,
      reason: "expired",
    };
  }

  return {
    shouldCreate: false,
    shouldDeleteExpired: false,
    providerRoomRecreated: false,
    providerRoomRecovered: false,
    reason: "exists",
  };
}

export type DeleteRoomSafetyInput = {
  roomType: "video_date";
  endedAt?: string | null;
  state?: string | null;
  phase?: string | null;
};

export type DeleteRoomSafetyDecision =
  | {
      shouldDelete: true;
      code: "SAFE_TO_DELETE";
      outcome: "delete_allowed";
    }
  | {
      shouldDelete: false;
      code: "VIDEO_DATE_CLEANUP_OWNED_BY_CRON";
      outcome: "skipped_active_session" | "skipped_peer_joining";
    };

export function classifyDeleteRoomSafety(input: DeleteRoomSafetyInput): DeleteRoomSafetyDecision {
  return {
    shouldDelete: false,
    code: "VIDEO_DATE_CLEANUP_OWNED_BY_CRON",
    outcome: input.endedAt ? "skipped_active_session" : "skipped_peer_joining",
  };
}
