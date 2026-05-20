import type {
  MediaUploadQueueRecord,
  MediaUploadQueueReconciler,
  MediaUploadServerRecord,
  MediaUploadServerState,
} from '@clientShared/media-sdk';
import { supabase } from '@/lib/supabase';

type ServerUploadRow = {
  status?: string | null;
  provider_object_id?: string | null;
  media_asset_id?: string | null;
  published_message_id?: string | null;
  error_detail?: string | null;
  expires_at?: string | null;
  updated_at?: string | null;
};

type StorageReceiptRow = {
  success?: boolean;
  error?: string | null;
  status?: string | null;
  asset_id?: string | null;
  provider_path?: string | null;
  provider_object_id?: string | null;
  content_sha256?: string | null;
  last_error?: string | null;
  last_failed_at?: string | null;
  next_retry_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

const STORAGE_RECEIPT_FAILED_TERMINAL_MS = 60 * 60 * 1000;
const STORAGE_RECOVERABLE_MISSING_STATES = new Set(['created', 'uploading', 'paused']);

const storageReceiptFamilyBySdkFamily: Partial<Record<MediaUploadQueueRecord['family'], string>> = {
  profile_photo: 'profile_photo',
  chat_photo: 'chat_image',
  event_cover: 'event_cover',
  voice_note: 'voice_message',
};

function parseTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function serverState(status: string | null | undefined): MediaUploadServerState {
  if (status === 'ready') return 'ready';
  if (status === 'failed') return 'failed';
  if (status === 'superseded') return 'superseded';
  if (status === 'processing') return 'processing';
  if (status === 'uploading') return 'uploading';
  return 'missing';
}

function storageReceiptState(status: string | null | undefined): MediaUploadServerState {
  if (status === 'reserved') return 'uploading';
  if (status === 'uploaded' || status === 'attached') return 'ready';
  if (status === 'failed') return 'failed';
  return 'missing';
}

function failedStorageReceiptState(row: StorageReceiptRow, nowMs = Date.now()): MediaUploadServerState {
  const failedAtMs = parseTimeMs(row.last_failed_at ?? row.updated_at ?? row.created_at);
  if (failedAtMs !== null && nowMs - failedAtMs >= STORAGE_RECEIPT_FAILED_TERMINAL_MS) {
    return 'failed';
  }
  const nextRetryAtMs = parseTimeMs(row.next_retry_at);
  return nextRetryAtMs !== null && nextRetryAtMs > nowMs ? 'processing' : 'uploading';
}

function fromRow(row: ServerUploadRow | null): MediaUploadServerRecord {
  if (!row) return { state: 'missing' };
  const state = serverState(row.status);
  return {
    state,
    result: {
      assetId: row.media_asset_id ?? null,
      providerObjectId: row.provider_object_id ?? null,
      mediaRef: row.published_message_id ?? row.provider_object_id ?? null,
      status: row.status ?? null,
    },
    error: state === 'failed' ? { code: row.error_detail ?? 'server_failed', retryable: true } : null,
    expiresAtMs: parseTimeMs(row.expires_at),
    updatedAtMs: parseTimeMs(row.updated_at),
  };
}

function fromStorageReceipt(row: StorageReceiptRow | null, record: MediaUploadQueueRecord): MediaUploadServerRecord {
  if (!row || row.status === 'missing') {
    if (STORAGE_RECOVERABLE_MISSING_STATES.has(record.state)) {
      return { state: 'uploading', updatedAtMs: record.updatedAtMs };
    }
    return { state: 'missing' };
  }
  const state = row.status === 'failed' ? failedStorageReceiptState(row) : storageReceiptState(row.status);
  return {
    state,
    result: {
      assetId: row.asset_id ?? null,
      providerObjectId: row.provider_object_id ?? null,
      providerPath: row.provider_path ?? null,
      mediaRef: row.provider_path ?? row.provider_object_id ?? null,
      contentSha256: row.content_sha256 ?? null,
      status: row.status ?? null,
    },
    error: state === 'failed' ? { code: row.last_error ?? 'server_failed', retryable: true } : null,
    expiresAtMs: state === 'processing' ? parseTimeMs(row.next_retry_at) : null,
    updatedAtMs: parseTimeMs(row.updated_at ?? row.created_at),
  };
}

async function fetchStorageReceiptRecord(record: MediaUploadQueueRecord): Promise<MediaUploadServerRecord | null> {
  const mediaFamily = storageReceiptFamilyBySdkFamily[record.family];
  if (!mediaFamily) return null;
  const { data, error } = await supabase.rpc('get_media_upload_receipt_status' as never, {
    p_media_family: mediaFamily,
    p_scope_key: record.scopeKey ?? '',
    p_client_request_id: record.clientRequestId,
  } as never);
  if (error) throw error;
  const row = (data ?? null) as StorageReceiptRow | null;
  if (row && row.success === false) throw new Error(String(row.error ?? 'receipt_status_lookup_failed'));
  return fromStorageReceipt(row, record);
}

async function fetchRecord(record: MediaUploadQueueRecord): Promise<MediaUploadServerRecord | null> {
  if (record.family === 'vibe_video') {
    const { data, error } = await supabase
      .from('vibe_video_uploads')
      .select('status,provider_object_id,media_asset_id,error_detail,expires_at,updated_at')
      .eq('client_request_id', record.clientRequestId)
      .maybeSingle();
    if (error) throw error;
    return fromRow(data as ServerUploadRow | null);
  }

  if (record.family === 'chat_vibe_clip') {
    const { data, error } = await supabase
      .from('chat_vibe_clip_uploads')
      .select('status,provider_object_id,media_asset_id,published_message_id,error_detail,expires_at,updated_at')
      .eq('client_request_id', record.clientRequestId)
      .maybeSingle();
    if (error) throw error;
    return fromRow(data as ServerUploadRow | null);
  }

  return fetchStorageReceiptRecord(record);
}

async function nudgeRecord(record: MediaUploadQueueRecord, server: MediaUploadServerRecord): Promise<MediaUploadServerRecord | null> {
  const providerObjectId = server.result?.providerObjectId;
  if (record.family === 'vibe_video' && providerObjectId) {
    const { error } = await supabase.functions.invoke('sync-vibe-video-status', {
      body: { provider_object_id: providerObjectId },
    });
    if (error) throw error;
    return fetchRecord(record);
  }

  if (record.family === 'chat_vibe_clip') {
    const { error } = await supabase.functions.invoke('sync-chat-vibe-clip-status', {
      body: { client_request_id: record.clientRequestId },
    });
    if (error) throw error;
    return fetchRecord(record);
  }

  return null;
}

export function createNativeMediaUploadReconciler(): MediaUploadQueueReconciler {
  return {
    fetch: fetchRecord,
    nudge: nudgeRecord,
  };
}
