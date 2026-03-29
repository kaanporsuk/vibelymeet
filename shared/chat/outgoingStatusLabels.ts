/** Mirrors `ChatOutboxQueueState` in apps/mobile (shared must not import app code). */
export type OutboxPhaseForLabel =
  | 'queued'
  | 'waiting_for_network'
  | 'sending'
  | 'awaiting_hydration'
  | 'failed'
  | 'sent'
  | 'canceled';

export type OutboxPayloadKind = 'text' | 'image' | 'voice' | 'video' | undefined;

/**
 * Compact outgoing / optimistic labels for native durable outbox rows.
 * Keep in sync with UX expectations in chat threads (secondary, single-line).
 */
export function outboxPhaseStatusLabel(phase: OutboxPhaseForLabel, payloadKind: OutboxPayloadKind): string {
  const clip = payloadKind === 'video';
  const image = payloadKind === 'image';
  const voice = payloadKind === 'voice';

  switch (phase) {
    case 'queued':
      if (clip) return 'Preparing…';
      if (image || voice) return 'Preparing…';
      return 'Queued';
    case 'waiting_for_network':
      if (clip) return 'Offline — sends when back';
      return 'Offline — sends when back';
    case 'sending':
      if (clip) return 'Uploading…';
      if (image || voice) return 'Uploading…';
      return 'Sending…';
    case 'awaiting_hydration':
      if (clip) return 'Processing…';
      return 'Sending…';
    case 'failed':
      return "Couldn't send · Tap Retry";
    case 'sent':
    case 'canceled':
    default:
      return '';
  }
}
