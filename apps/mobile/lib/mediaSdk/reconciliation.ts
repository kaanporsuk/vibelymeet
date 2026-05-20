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

  return null;
}

async function nudgeRecord(record: MediaUploadQueueRecord, server: MediaUploadServerRecord): Promise<MediaUploadServerRecord | null> {
  const providerObjectId = server.result?.providerObjectId;
  if (record.family === 'vibe_video' && providerObjectId) {
    const { error } = await supabase.functions.invoke('sync-vibe-video-status', {
      body: { videoId: providerObjectId },
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
