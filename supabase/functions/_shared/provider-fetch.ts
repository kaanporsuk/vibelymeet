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
    signal?: AbortSignal;
  },
): Promise<Response> {
  const timeoutMs = Math.max(500, Math.trunc(options.timeoutMs ?? providerFetchTimeoutMs(options.provider, options.operation)));
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new ProviderFetchTimeoutError(options.provider, options.operation, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
