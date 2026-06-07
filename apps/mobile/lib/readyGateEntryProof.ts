import { supabase } from '@/lib/supabase';

export type ReadyGateEntryProofResult = {
  ok?: boolean;
  success?: boolean;
  code?: string;
  error?: string;
  session_id?: string;
  event_id?: string;
  participant_slot?: number;
  ready_gate_status?: string;
  both_participants_entered?: boolean;
  first_entry_for_participant?: boolean;
  ttl_extended?: boolean;
  ready_gate_expires_at?: string | null;
  ready_gate_expires_at_before?: string | null;
  server_now?: string | null;
};

type RecordReadyGateEnteredInput = {
  sessionId: string;
  platform: 'native';
  surface: string;
  source: string;
  readyGateStatus?: string | null;
  routePath?: string | null;
};

let readyGateEntryClientInstanceId: string | null = null;

function createReadyGateEntryClientInstanceId(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return `rg-native-${cryptoApi.randomUUID()}`;
  }
  return `rg-native-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getReadyGateEntryClientInstanceId(): string {
  if (!readyGateEntryClientInstanceId) {
    readyGateEntryClientInstanceId = createReadyGateEntryClientInstanceId();
  }
  return readyGateEntryClientInstanceId;
}

export async function recordReadyGateEntered({
  sessionId,
  platform,
  surface,
  source,
  readyGateStatus,
  routePath,
}: RecordReadyGateEnteredInput): Promise<ReadyGateEntryProofResult> {
  const { data, error } = await supabase.rpc(
    'record_video_date_ready_gate_entered_v1' as never,
    {
      p_session_id: sessionId,
      p_surface: surface,
      p_platform: platform,
      p_source: source,
      p_client_instance_id: getReadyGateEntryClientInstanceId(),
      p_route_path: routePath ?? null,
      p_client_ready_gate_status: readyGateStatus ?? null,
    } as never,
  );

  if (error) {
    return {
      ok: false,
      success: false,
      code: error.code ?? 'READY_GATE_ENTRY_PROOF_RPC_FAILED',
      error: error.message,
    };
  }

  if (!data || typeof data !== 'object') {
    return {
      ok: false,
      success: false,
      code: 'READY_GATE_ENTRY_PROOF_EMPTY_RESPONSE',
    };
  }

  return data as ReadyGateEntryProofResult;
}

