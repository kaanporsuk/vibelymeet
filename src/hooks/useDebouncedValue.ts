import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebounced(value), delayMs);
    return () => globalThis.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}
