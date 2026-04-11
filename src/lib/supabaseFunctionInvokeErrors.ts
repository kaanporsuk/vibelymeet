/**
 * Shared parsing for `supabase.functions.invoke` failures so web + native match.
 */

export type FunctionInvokeErrorShape = {
  name?: string;
  message?: string;
  details?: string;
  context?: unknown;
};

const NETWORK_ERROR_PATTERNS = [
  /network request failed/i,
  /failed to fetch/i,
  /network error/i,
  /load failed/i,
];

export function isNetworkInvokeError(invokeError: FunctionInvokeErrorShape): boolean {
  const text = `${invokeError.name ?? ""} ${invokeError.message ?? ""} ${invokeError.details ?? ""}`;
  return invokeError.name === "FunctionsFetchError" || NETWORK_ERROR_PATTERNS.some((p) => p.test(text));
}

/**
 * Prefer JSON `error` from response body (`data`), then parse Edge Function response from `error.context`.
 */
export async function resolveSupabaseFunctionErrorMessage(
  invokeError: unknown,
  data: unknown,
  networkFallback: string,
): Promise<string> {
  const payloadError =
    typeof data === "object" && data !== null && typeof (data as { error?: unknown }).error === "string"
      ? (data as { error: string }).error
      : null;
  if (payloadError) return payloadError;
  if (!invokeError) return networkFallback;

  const fnError = invokeError as FunctionInvokeErrorShape;
  if (isNetworkInvokeError(fnError)) return networkFallback;

  const context = fnError.context;
  let statusCode: number | null = null;
  let serverMessage: string | null = null;

  if (context && typeof context === "object") {
    const contextWithStatus = context as { status?: unknown };
    if (typeof contextWithStatus.status === "number") statusCode = contextWithStatus.status;

    if (typeof (context as Response).text === "function") {
      try {
        const text = await (context as Response).clone().text();
        if (text) {
          try {
            const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
            if (typeof parsed.error === "string") serverMessage = parsed.error;
            else if (typeof parsed.message === "string") serverMessage = parsed.message;
          } catch {
            serverMessage = text;
          }
        }
      } catch {
        // Ignore context parse failures and fall back below.
      }
    }
  }

  if (!serverMessage && typeof fnError.details === "string" && fnError.details.trim().length > 0) {
    serverMessage = fnError.details;
  }
  if (
    !serverMessage &&
    typeof fnError.message === "string" &&
    fnError.message.trim().length > 0 &&
    !/non-2xx status code/i.test(fnError.message)
  ) {
    serverMessage = fnError.message;
  }

  if (serverMessage && statusCode) return `${serverMessage} (HTTP ${statusCode})`;
  if (serverMessage) return serverMessage;
  if (statusCode) return `Request failed (HTTP ${statusCode}).`;
  return networkFallback;
}
