export type ContractError = {
  code: string;
  message: string;
  retryable: boolean;
};

export function normalizeContractError(
  error: unknown,
  fallbackCode = 'unknown_error',
  fallbackMessage = 'Something went wrong. Please try again.',
): ContractError {
  const row = (error ?? {}) as { code?: string; message?: string; status?: number };
  const status = typeof row.status === 'number' ? row.status : null;
  const code = typeof row.code === 'string' && row.code ? row.code : fallbackCode;
  const message = typeof row.message === 'string' && row.message ? row.message : fallbackMessage;

  const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

  return { code, message, retryable };
}

export function toError(input: ContractError): Error {
  const err = new Error(input.message);
  (err as Error & { code?: string; retryable?: boolean }).code = input.code;
  (err as Error & { code?: string; retryable?: boolean }).retryable = input.retryable;
  return err;
}
