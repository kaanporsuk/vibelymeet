import type { PermissionUxStatus } from '@clientShared/permissions/permissionUx';

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return String(error ?? '');
}

export function isNativeMediaPermissionError(error: unknown): boolean {
  const message = errorText(error);
  return /\b(permission|denied|access|authorized|authorization|not\s+authorized|not\s+allowed)\b/i.test(message);
}

export function classifyNativeMediaCaptureError(error: unknown): PermissionUxStatus {
  const message = errorText(error);
  if (isNativeMediaPermissionError(error)) return 'blocked_settings';
  if (/\b(no\s+camera|no\s+microphone|not\s+found|missing|unavailable|no\s+device)\b/i.test(message)) {
    return 'hardware_missing';
  }
  if (/\b(unsupported|not\s+supported)\b/i.test(message)) return 'unsupported';
  if (/\b(in\s+use|busy|another\s+app|camera\s+is\s+running|could\s+not\s+start|failed\s+to\s+start)\b/i.test(message)) {
    return 'in_use';
  }
  return 'in_use';
}

