import { supabase } from '@/lib/supabase';
import {
  normalizeEventTicketPaymentStatus,
  type EventTicketPaymentStatus,
} from '@clientShared/matching/videoDatePublicApi';

export type { EventTicketPaymentStatus };

export async function fetchEventTicketPaymentStatus(eventId: string): Promise<EventTicketPaymentStatus> {
  if (!eventId) {
    return normalizeEventTicketPaymentStatus({ ok: false, error: 'missing_event_id' });
  }

  const { data, error } = await supabase.rpc('get_event_ticket_payment_status_v1' as never, {
    p_event_id: eventId,
  } as never);
  if (error) {
    return normalizeEventTicketPaymentStatus({ ok: false, event_id: eventId, error: error.code || 'rpc_error' });
  }

  return normalizeEventTicketPaymentStatus(data);
}
