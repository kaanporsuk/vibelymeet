import { isNetworkInvokeError, type FunctionInvokeErrorShape } from "../supabaseFunctionInvokeErrors";

export const DAILY_ROOM_ACTIONS = {
  CREATE: "create_date_room",
  JOIN: "join_date_room",
  PREPARE_ENTRY: "prepare_date_entry",
} as const;

export type DailyRoomAction = (typeof DAILY_ROOM_ACTIONS)[keyof typeof DAILY_ROOM_ACTIONS];

export type DailyRoomFailureKind =
  | "READY_GATE_NOT_READY"
  | "BLOCKED_PAIR"
  | "ACCESS_DENIED"
  | "SESSION_ENDED"
  | "SESSION_NOT_FOUND"
  | "ROOM_NOT_FOUND"
  | "DAILY_PROVIDER_ERROR"
  | "auth"
  | "network"
  | "unknown";

export type DailyRoomFailureClassification = {
  kind: DailyRoomFailureKind;
  httpStatus?: number;
  serverCode?: string;
  retryable: boolean;
};

type DailyRoomFailureInput = {
  action: DailyRoomAction;
  data?: unknown;
  invokeError?: unknown;
  response?: unknown;
  timedOut?: boolean;
};

type DailyRoomFailureBody = {
  code?: unknown;
  error?: unknown;
  message?: unknown;
};

function toServerCode(code: unknown): string | undefined {
  if (typeof code !== "string") return undefined;
  const trimmed = code.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readFailureBodyCode(data: unknown): string | undefined {
  if (data === null || typeof data !== "object") return undefined;
  const body = data as DailyRoomFailureBody;
  return toServerCode(body.code) ?? toServerCode(body.error) ?? toServerCode(body.message);
}

async function readFailureContext(
  source: unknown
): Promise<{ httpStatus?: number; serverCode?: string }> {
  if (!source || typeof source !== "object") return {};

  const base = source as { status?: unknown };
  const httpStatus = typeof base.status === "number" ? base.status : undefined;
  const response = source as Response;
  if (typeof response.clone !== "function" || typeof response.text !== "function") {
    return { httpStatus };
  }

  try {
    const text = await response.clone().text();
    if (!text) return { httpStatus };
    try {
      const parsed = JSON.parse(text) as DailyRoomFailureBody;
      return {
        httpStatus,
        serverCode: readFailureBodyCode(parsed),
      };
    } catch {
      return {
        httpStatus,
        serverCode: undefined,
      };
    }
  } catch {
    return { httpStatus };
  }
}

export function classifyDailyRoomFailureKind(input: {
  action: DailyRoomAction;
  httpStatus?: number;
  serverCode?: string;
  timedOut?: boolean;
  networkError?: boolean;
}): DailyRoomFailureKind {
  const { action, httpStatus, serverCode, timedOut, networkError } = input;
  const code = serverCode ?? "";

  if (timedOut || networkError) return "network";
  if (code === "UNAUTHORIZED" || httpStatus === 401) return "auth";
  if (code === "READY_GATE_NOT_READY") return "READY_GATE_NOT_READY";
  if (code === "BLOCKED_PAIR" || code === "blocked_pair") return "BLOCKED_PAIR";
  if (code === "ACCESS_DENIED" || httpStatus === 403) return "ACCESS_DENIED";
  if (code === "SESSION_ENDED" || httpStatus === 410) return "SESSION_ENDED";
  if (code === "SESSION_NOT_FOUND") return "SESSION_NOT_FOUND";
  if (code === "ROOM_NOT_FOUND") return "ROOM_NOT_FOUND";
  if (httpStatus === 404) {
    return action === DAILY_ROOM_ACTIONS.JOIN ? "ROOM_NOT_FOUND" : "SESSION_NOT_FOUND";
  }
  if (
    code === "DAILY_PROVIDER_ERROR" ||
    code === "MISSING_TOKEN" ||
    httpStatus === 500 ||
    httpStatus === 502 ||
    httpStatus === 503 ||
    httpStatus === 504
  ) {
    return "DAILY_PROVIDER_ERROR";
  }
  return "unknown";
}

export function isRetryableDailyRoomFailure(kind: DailyRoomFailureKind): boolean {
  return kind === "network" || kind === "DAILY_PROVIDER_ERROR";
}

export async function classifyDailyRoomInvokeFailure(
  input: DailyRoomFailureInput
): Promise<DailyRoomFailureClassification> {
  const bodyCode = readFailureBodyCode(input.data);
  const invokeError = input.invokeError as FunctionInvokeErrorShape | undefined;
  const networkError = input.timedOut === true || (invokeError ? isNetworkInvokeError(invokeError) : false);

  const fromResponse = await readFailureContext(input.response);
  const fromErrorContext = await readFailureContext(invokeError?.context);
  const httpStatus = fromResponse.httpStatus ?? fromErrorContext.httpStatus;
  const serverCode = bodyCode ?? fromResponse.serverCode ?? fromErrorContext.serverCode;
  const kind = classifyDailyRoomFailureKind({
    action: input.action,
    httpStatus,
    serverCode,
    timedOut: input.timedOut,
    networkError,
  });

  return {
    kind,
    httpStatus,
    serverCode,
    retryable: isRetryableDailyRoomFailure(kind),
  };
}
