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

export const SLOW_TEXT_SEND_LABEL_AFTER_MS = 2_500;

export type OutboxStatusTone = 'quiet' | 'progress' | 'offline' | 'failed';

export type OutboxStatusPresentation = {
  visibleLabel: string | null;
  assistiveLabel: string;
  showSpinner: boolean;
  showCheckIntent: boolean;
  tone: OutboxStatusTone;
};

export type OutboxStatusPresentationOptions = {
  ageMs?: number;
  uploadPercent?: number | null;
};

function isTextPayload(payloadKind: OutboxPayloadKind): boolean {
  return !payloadKind || payloadKind === 'text';
}

function mediaProgressLabel(phase: OutboxPhaseForLabel, payloadKind: OutboxPayloadKind, uploadPercent?: number | null): string | null {
  const clip = payloadKind === 'video';
  const image = payloadKind === 'image';
  const voice = payloadKind === 'voice';

  switch (phase) {
    case 'queued':
      if (clip || image || voice) return 'Preparing…';
      return null;
    case 'sending':
      if (uploadPercent != null && Number.isFinite(uploadPercent)) {
        return `Uploading ${Math.max(0, Math.min(100, Math.round(uploadPercent)))}%`;
      }
      if (clip || image || voice) return 'Uploading…';
      return null;
    case 'awaiting_hydration':
      if (clip) return 'Processing…';
      if (image || voice) return 'Processing…';
      return null;
    default:
      return null;
  }
}

/**
 * Compact outgoing / optimistic presentation for durable outbox rows.
 * Text stays visually quiet during normal online sends, while media keeps progress.
 */
export function outboxPhaseStatusPresentation(
  phase: OutboxPhaseForLabel,
  payloadKind: OutboxPayloadKind,
  options: OutboxStatusPresentationOptions = {},
): OutboxStatusPresentation {
  const textPayload = isTextPayload(payloadKind);
  const slowTextSend = textPayload && (options.ageMs ?? 0) >= SLOW_TEXT_SEND_LABEL_AFTER_MS;

  switch (phase) {
    case 'queued':
      if (textPayload) {
        return {
          visibleLabel: slowTextSend ? 'Still sending…' : null,
          assistiveLabel: 'Message queued',
          showSpinner: false,
          showCheckIntent: false,
          tone: 'quiet',
        };
      }
      return {
        visibleLabel: mediaProgressLabel(phase, payloadKind, options.uploadPercent),
        assistiveLabel: 'Media preparing to send',
        showSpinner: true,
        showCheckIntent: false,
        tone: 'progress',
      };
    case 'waiting_for_network':
      return {
        visibleLabel: 'Offline - sends when back',
        assistiveLabel: 'Offline - sends when back',
        showSpinner: false,
        showCheckIntent: false,
        tone: 'offline',
      };
    case 'sending':
      if (textPayload) {
        return {
          visibleLabel: slowTextSend ? 'Still sending…' : null,
          assistiveLabel: 'Sending message',
          showSpinner: false,
          showCheckIntent: false,
          tone: 'quiet',
        };
      }
      return {
        visibleLabel: mediaProgressLabel(phase, payloadKind, options.uploadPercent),
        assistiveLabel: 'Uploading media',
        showSpinner: true,
        showCheckIntent: false,
        tone: 'progress',
      };
    case 'awaiting_hydration':
      if (textPayload) {
        return {
          visibleLabel: slowTextSend ? 'Still sending…' : null,
          assistiveLabel: 'Confirming message',
          showSpinner: false,
          showCheckIntent: false,
          tone: 'quiet',
        };
      }
      return {
        visibleLabel: mediaProgressLabel(phase, payloadKind, options.uploadPercent),
        assistiveLabel: 'Processing media',
        showSpinner: true,
        showCheckIntent: false,
        tone: 'progress',
      };
    case 'failed':
      return {
        visibleLabel: "Couldn't send · Tap Retry",
        assistiveLabel: "Message couldn't send. Tap Retry.",
        showSpinner: false,
        showCheckIntent: false,
        tone: 'failed',
      };
    case 'sent':
      return {
        visibleLabel: null,
        assistiveLabel: 'Sent',
        showSpinner: false,
        showCheckIntent: true,
        tone: 'quiet',
      };
    case 'canceled':
    default:
      return {
        visibleLabel: null,
        assistiveLabel: 'Not sent',
        showSpinner: false,
        showCheckIntent: false,
        tone: 'quiet',
      };
  }
}
