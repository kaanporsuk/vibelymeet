type NativeDiagnosticValue =
  | string
  | number
  | boolean
  | NativeDiagnosticValue[]
  | { [key: string]: NativeDiagnosticValue };

function sanitizeValue(value: unknown): NativeDiagnosticValue | undefined {
  if (value === null || value === undefined) return undefined;

  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return sanitizeObject({
      name: value.name,
      message: value.message,
    });
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => sanitizeValue(item))
      .filter((item): item is NativeDiagnosticValue => item !== undefined);
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === 'object') {
    return sanitizeObject(value as Record<string, unknown>);
  }

  return undefined;
}

function sanitizeObject(value: Record<string, unknown>): { [key: string]: NativeDiagnosticValue } | undefined {
  const entries = Object.entries(value)
    .map(([key, entry]) => [key, sanitizeValue(entry)] as const)
    .filter((entry): entry is readonly [string, NativeDiagnosticValue] => entry[1] !== undefined);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

export function sanitizeNativeDiagnosticRecord(
  data?: Record<string, unknown>
): Record<string, NativeDiagnosticValue> | undefined {
  if (!data) return undefined;
  return sanitizeObject(data);
}
