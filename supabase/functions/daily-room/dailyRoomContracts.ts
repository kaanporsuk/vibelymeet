export type DateRoomAction =
  | "ensure_date_room"
  | "create_date_room"
  | "join_date_room"
  | "prepare_date_entry"
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
