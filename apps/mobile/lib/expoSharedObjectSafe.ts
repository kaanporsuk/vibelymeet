type SharedObjectSubscription = { remove?: () => void } | null | undefined;

type SafeExpoSharedObjectOptions<T> = {
  label?: string;
  fallback?: T;
  swallowAll?: boolean;
  onError?: (error: unknown) => void;
};

function describeError(error: unknown, depth = 0): string {
  if (depth > 2) return '';
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return [
      error.name,
      error.message,
      cause ? describeError(cause, depth + 1) : '',
    ].filter(Boolean).join(' ');
  }
  if (error && typeof error === 'object') {
    const maybe = error as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
    return [
      typeof maybe.name === 'string' ? maybe.name : '',
      typeof maybe.code === 'string' ? maybe.code : '',
      typeof maybe.message === 'string' ? maybe.message : '',
      maybe.cause ? describeError(maybe.cause, depth + 1) : '',
    ].filter(Boolean).join(' ');
  }
  return String(error ?? '');
}

export function isExpoSharedObjectReleasedError(error: unknown): boolean {
  const description = describeError(error);
  if (
    /NativeSharedObjectNotFoundException|Unable to find the native shared object|DynamicSharedObjectType\.swift/i.test(
      description,
    )
  ) {
    return true;
  }

  return /FunctionCallException/i.test(description) && /native shared object|DynamicSharedObject|NativeSharedObject/i.test(description);
}

function handleExpoSharedObjectError<T>(
  error: unknown,
  options?: SafeExpoSharedObjectOptions<T>,
): T | undefined {
  const shouldSwallow = options?.swallowAll === true || isExpoSharedObjectReleasedError(error);
  if (!shouldSwallow) throw error;
  options?.onError?.(error);
  if (typeof __DEV__ !== 'undefined' && __DEV__ && options?.label) {
    console.warn(`[expo-shared-object-safe] ${options.label}`, describeError(error));
  }
  return options?.fallback;
}

export function safeExpoSharedObjectCall<T>(
  fn: () => T,
  options?: SafeExpoSharedObjectOptions<T>,
): T | undefined {
  try {
    return fn();
  } catch (error) {
    return handleExpoSharedObjectError(error, options);
  }
}

export async function safeExpoSharedObjectAsync<T>(
  fn: () => Promise<T>,
  options?: SafeExpoSharedObjectOptions<T>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    return handleExpoSharedObjectError(error, options);
  }
}

export function safeExpoSharedObjectRead<T>(fn: () => T, fallback: T, label?: string): T {
  const result = safeExpoSharedObjectCall(fn, { fallback, label });
  return result ?? fallback;
}

export function safeRemoveExpoSharedObjectSubscription(
  subscription: SharedObjectSubscription,
  label?: string,
) {
  safeExpoSharedObjectCall(() => subscription?.remove?.(), {
    label,
    swallowAll: true,
  });
}

export function attachSafeExpoSharedObjectPromise<T>(
  result: T | PromiseLike<T> | undefined,
  onRejected?: (error: unknown) => void,
  label?: string,
) {
  if (!result || typeof (result as PromiseLike<T>).then !== 'function') return;
  void Promise.resolve(result).catch((error) => {
    if (isExpoSharedObjectReleasedError(error)) {
      if (typeof __DEV__ !== 'undefined' && __DEV__ && label) {
        console.warn(`[expo-shared-object-safe] ${label}`, describeError(error));
      }
      return;
    }
    onRejected?.(error);
  });
}
