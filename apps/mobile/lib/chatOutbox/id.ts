function randomUuidV4(): string {
  // RFC4122-ish UUID v4 without crypto deps (same style as gamesApi fallback).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const n = (Math.random() * 16) | 0;
    return (ch === 'x' ? n : (n & 0x3) | 0x8).toString(16);
  });
}

export function newOutboxId(): string {
  return randomUuidV4();
}

export function newClientRequestId(): string {
  return randomUuidV4();
}

