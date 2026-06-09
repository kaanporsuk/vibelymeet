export type DateRoomAction =
  | "ensure_date_room"
  | "prepare_date_entry"
  | "prepare_diagnostic_entry"
  | "prepare_solo_entry"
  | "video_date_leave";

export type MatchCallStatus = "ringing" | "active" | "ended" | "missed" | "declined" | string | null;

export type OpenMatchCallForRetry = {
  id: string;
  match_id: string | null;
  caller_id: string;
  callee_id: string;
  call_type: string | null;
  daily_room_name: string | null;
  daily_room_url: string | null;
  status: MatchCallStatus;
};

export type MatchCallRetryRequest = {
  matchId: string;
  callerId: string;
  calleeId: string;
  callType: "voice" | "video";
};

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

export function videoDateDiagnosticRoomNameForUser(userId: string): string {
  return `date-diag-${userId.replace(/-/g, "").slice(0, 40)}`;
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

export function isOpenMatchCallStatus(status: MatchCallStatus): boolean {
  return status === "ringing" || status === "active";
}

export function isTerminalMatchCallStatus(status: MatchCallStatus): boolean {
  return status === "ended" || status === "missed" || status === "declined";
}

export function canReuseOpenMatchCallForCreateRetry(
  call: OpenMatchCallForRetry | null | undefined,
  request: MatchCallRetryRequest,
): call is OpenMatchCallForRetry & {
  match_id: string;
  call_type: "voice" | "video";
  daily_room_name: string;
} {
  return Boolean(
    call &&
      call.match_id === request.matchId &&
      call.caller_id === request.callerId &&
      call.callee_id === request.calleeId &&
      call.call_type === request.callType &&
      isOpenMatchCallStatus(call.status) &&
      call.daily_room_name,
  );
}

/**
 * Looser variant of canReuseOpenMatchCallForCreateRetry that allows the caller to rejoin an
 * existing open call when the requested call_type differs from the existing call's call_type.
 * Used by the rejoin contract: rather than returning 409, the edge function returns the existing
 * room + fresh token plus an `existing_call_type` flag so the client can adapt its UI.
 */
export function canReuseOpenMatchCallSameParticipants(
  call: OpenMatchCallForRetry | null | undefined,
  request: MatchCallRetryRequest,
): call is OpenMatchCallForRetry & {
  match_id: string;
  call_type: "voice" | "video";
  daily_room_name: string;
} {
  return Boolean(
    call &&
      call.match_id === request.matchId &&
      call.caller_id === request.callerId &&
      call.callee_id === request.calleeId &&
      isOpenMatchCallStatus(call.status) &&
      call.daily_room_name,
  );
}

/**
 * True when the open call exists for this match but the requesting user is the CALLEE of that
 * open call (i.e. an incoming call from the partner). The client should call `answer_match_call`
 * with the returned `call_id` rather than create a new call.
 */
export function isIncomingMatchCallForRequester(
  call: OpenMatchCallForRetry | null | undefined,
  request: MatchCallRetryRequest,
): boolean {
  return Boolean(
    call &&
      call.match_id === request.matchId &&
      call.caller_id === request.calleeId &&
      call.callee_id === request.callerId &&
      isOpenMatchCallStatus(call.status),
  );
}

export function canIssueAnswerTokenForMatchCallStatus(status: MatchCallStatus): boolean {
  return status === "ringing" || status === "active";
}

export type DeleteRoomSafetyInput =
  | {
      roomType: "video_date";
      endedAt?: string | null;
      state?: string | null;
      phase?: string | null;
    }
  | {
      roomType: "match_call";
      status?: MatchCallStatus;
      endedAt?: string | null;
      providerDeletedAt?: string | null;
    };

export type DeleteRoomSafetyDecision =
  | {
      shouldDelete: true;
      code: "SAFE_TO_DELETE";
      outcome: "delete_allowed";
    }
  | {
      shouldDelete: false;
      code:
        | "VIDEO_DATE_CLEANUP_OWNED_BY_CRON"
        | "MATCH_CALL_ACTIVE_ROOM_DELETE_SKIPPED"
        | "MATCH_CALL_ROOM_ALREADY_CLEANED"
        | "MATCH_CALL_NOT_TERMINAL";
      outcome:
        | "skipped_active_session"
        | "skipped_peer_joining"
        | "not_found_idempotent";
    };

export function classifyDeleteRoomSafety(input: DeleteRoomSafetyInput): DeleteRoomSafetyDecision {
  if (input.roomType === "video_date") {
    return {
      shouldDelete: false,
      code: "VIDEO_DATE_CLEANUP_OWNED_BY_CRON",
      outcome: input.endedAt ? "skipped_active_session" : "skipped_peer_joining",
    };
  }

  if (input.providerDeletedAt) {
    return {
      shouldDelete: false,
      code: "MATCH_CALL_ROOM_ALREADY_CLEANED",
      outcome: "not_found_idempotent",
    };
  }

  if (isOpenMatchCallStatus(input.status ?? null)) {
    return {
      shouldDelete: false,
      code: "MATCH_CALL_ACTIVE_ROOM_DELETE_SKIPPED",
      outcome: input.status === "ringing" ? "skipped_peer_joining" : "skipped_active_session",
    };
  }

  if (!isTerminalMatchCallStatus(input.status ?? null) || !input.endedAt) {
    return {
      shouldDelete: false,
      code: "MATCH_CALL_NOT_TERMINAL",
      outcome: "skipped_active_session",
    };
  }

  return {
    shouldDelete: true,
    code: "SAFE_TO_DELETE",
    outcome: "delete_allowed",
  };
}
