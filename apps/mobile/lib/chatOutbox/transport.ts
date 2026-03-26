import { supabase } from '@/lib/supabase';
import { uploadChatImageMessage, uploadVoiceMessage, uploadChatVideoMessage } from '@/lib/chatMediaUpload';
import { formatChatImageMessageContent } from '@/lib/chatMessageContent';
import type { ChatOutboxPayload } from '@/lib/chatOutbox/types';

type SendResult = { serverMessageId: string | null };

function pickServerMessageId(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const id = (row as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() ? id : null;
}

function isPgUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

async function loadExistingByClientRequestId(matchId: string, clientRequestId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('messages')
    .select('id')
    .eq('match_id', matchId)
    .eq('structured_payload->>client_request_id', clientRequestId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return typeof data?.id === 'string' && data.id ? data.id : null;
}

export async function sendOutboxItem(params: {
  matchId: string;
  senderId: string;
  clientRequestId: string;
  payload: ChatOutboxPayload;
}): Promise<SendResult> {
  const { matchId, senderId, clientRequestId, payload } = params;

  if (payload.kind === 'text') {
    const { data, error } = await supabase.functions.invoke('send-message', {
      body: { match_id: matchId, content: payload.text.trim(), client_request_id: clientRequestId },
      headers: { 'x-client-request-id': clientRequestId },
    });
    if (error) throw error;
    const envelope = data as { success?: boolean; message?: unknown; error?: string };
    if (!envelope?.success) throw new Error(envelope?.error || 'Send failed');
    return { serverMessageId: pickServerMessageId(envelope.message) };
  }

  if (payload.kind === 'image') {
    const publicUrl = await uploadChatImageMessage(payload.uri, payload.mimeType);
    const content = formatChatImageMessageContent(publicUrl);
    const { data, error } = await supabase.functions.invoke('send-message', {
      body: { match_id: matchId, content, client_request_id: clientRequestId },
      headers: { 'x-client-request-id': clientRequestId },
    });
    if (error) throw error;
    const envelope = data as { success?: boolean; message?: unknown; error?: string };
    if (!envelope?.success) throw new Error(envelope?.error || 'Send failed');
    return { serverMessageId: pickServerMessageId(envelope.message) };
  }

  if (payload.kind === 'voice') {
    const audioUrl = await uploadVoiceMessage(payload.uri, matchId);
    const structured_payload = { client_request_id: clientRequestId };
    const { data, error } = await supabase
      .from('messages')
      .insert({
        match_id: matchId,
        sender_id: senderId,
        content: '🎤 Voice message',
        audio_url: audioUrl,
        audio_duration_seconds: Math.round(payload.durationSeconds),
        structured_payload,
      })
      .select('id')
      .single();
    if (error) {
      if (isPgUniqueViolation(error)) {
        const existingId = await loadExistingByClientRequestId(matchId, clientRequestId);
        return { serverMessageId: existingId };
      }
      throw error;
    }
    return { serverMessageId: typeof data?.id === 'string' ? data.id : null };
  }

  // video
  const videoUrl = await uploadChatVideoMessage(payload.uri, matchId, payload.mimeType || 'video/mp4');
  const structured_payload = { client_request_id: clientRequestId };
  const { data, error } = await supabase
    .from('messages')
    .insert({
      match_id: matchId,
      sender_id: senderId,
      content: '📹 Video message',
      video_url: videoUrl,
      video_duration_seconds: Math.round(payload.durationSeconds),
      structured_payload,
    })
    .select('id')
    .single();
  if (error) {
    if (isPgUniqueViolation(error)) {
      const existingId = await loadExistingByClientRequestId(matchId, clientRequestId);
      return { serverMessageId: existingId };
    }
    throw error;
  }
  return { serverMessageId: typeof data?.id === 'string' ? data.id : null };
}

