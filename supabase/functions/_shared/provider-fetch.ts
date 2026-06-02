function numericEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export class ProviderFetchTimeoutError extends Error {
  provider: string;
  operation: string;
  timeoutMs: number;

  constructor(provider: string, operation: string, timeoutMs: number) {
    super(`${provider}.${operation} timed out after ${timeoutMs}ms`);
    this.name = "ProviderFetchTimeoutError";
    this.provider = provider;
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

export function providerFetchTimeoutMs(provider: string, operation: string, fallbackMs = 8_000): number {
  const providerKey = provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const operationKey = operation.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return numericEnv(
    `${providerKey}_${operationKey}_TIMEOUT_MS`,
    numericEnv(`${providerKey}_PROVIDER_TIMEOUT_MS`, fallbackMs, 500, 30_000),
    500,
    30_000,
  );
}

export async function fetchWithProviderTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  options: {
    provider: string;
    operation: string;
    timeoutMs?: number;
    includeBody?: boolean;
    signal?: AbortSignal;
  },
): Promise<Response> {
  const timeoutMs = Math.max(500, Math.trunc(options.timeoutMs ?? providerFetchTimeoutMs(options.provider, options.operation)));
  const controller = new AbortController();
  let timedOut = false;
  let cleanedUp = false;
  let timeout: ReturnType<typeof setTimeout>;
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
  const abortFromCaller = () => {
    controller.abort(options.signal?.reason);
    cleanup();
  };
  timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    cleanup();
  }, timeoutMs);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    if (!options.includeBody || !response.body) {
      cleanup();
      return response;
    }

    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        try {
          const next = await reader.read();
          if (next.done) {
            cleanup();
            streamController.close();
            return;
          }
          streamController.enqueue(next.value);
        } catch (error) {
          cleanup();
          streamController.error(
            timedOut
              ? new ProviderFetchTimeoutError(options.provider, options.operation, timeoutMs)
              : error,
          );
        }
      },
      async cancel(reason) {
        cleanup();
        await reader.cancel(reason).catch(() => undefined);
      },
    });

    return new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    cleanup();
    if (timedOut) {
      throw new ProviderFetchTimeoutError(options.provider, options.operation, timeoutMs);
    }
    throw error;
  } finally {
    if (!options.includeBody) cleanup();
  }
}
