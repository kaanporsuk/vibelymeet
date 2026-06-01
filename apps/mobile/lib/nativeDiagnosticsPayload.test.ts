import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeNativeDiagnosticRecord } from './nativeDiagnosticsPayload';

test('native diagnostics redact sensitive keys and provider URLs before Sentry breadcrumbs', () => {
  const sanitized = sanitizeNativeDiagnosticRecord({
    roomUrl: 'https://vibely.daily.co/room-1?token=secret',
    previousRoomUrl: 'https://vibely.daily.co/room-2',
    roomName: 'vibely-prod-sensitive-room',
    idempotencyKey: 'video-date:session:end:client',
    nested: {
      mediaPath: 'https://vz-bunny.b-cdn.net/video/playlist.m3u8?sig=secret',
      message: 'Bearer abc.def.ghi',
      previous_room_name: 'vibely-prod-previous-room',
    },
  });

  assert.equal(sanitized?.roomUrl, '[redacted]');
  assert.equal(sanitized?.previousRoomUrl, '[redacted]');
  assert.equal(sanitized?.roomName, '[redacted]');
  assert.equal(sanitized?.idempotencyKey, '[redacted]');
  assert.deepEqual(sanitized?.nested, {
    mediaPath: '[redacted]',
    message: '[redacted]',
    previous_room_name: '[redacted]',
  });
});
