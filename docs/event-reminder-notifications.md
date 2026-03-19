# Event reminder notifications (30min + 5min)

## Flow

1. **Enqueue**: Events starting in 30 minutes or 5 minutes are enqueued in `event_reminder_queue` (one row per registration × reminder type).
2. **Process**: The `event-reminders` Edge Function reads pending rows, calls `send-notification` for each, and sets `sent_at`.

## If pg_cron is available (Supabase Cloud)

The migration `20260319130000_event_reminder_cron.sql` schedules `send_event_reminders()` every minute via pg_cron, which inserts into `event_reminder_queue`. You still need to run the **event-reminders** Edge Function every minute to process the queue (e.g. Supabase Dashboard → Edge Functions → event-reminders → Schedule, or external cron).

## If pg_cron is NOT available

1. Run **event-reminders** Edge Function on a 1-minute schedule (external cron or Supabase scheduled invocations).
2. Optionally, call an RPC or HTTP endpoint that runs `SELECT send_event_reminders()` to enqueue (e.g. from the same cron before invoking the Edge Function), or add enqueue logic inside the Edge Function so it both enqueues and processes in one invocation.

## Invoking event-reminders

```bash
curl -X POST "https://<project>.supabase.co/functions/v1/event-reminders" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

Set `CRON_SECRET` in Supabase Edge Function secrets and use it from your scheduler.
