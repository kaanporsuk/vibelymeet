# Media Lifecycle

## Phase 5 Storage Uploads

Storage-backed media uploads use `media_upload_receipts` as the canonical
idempotency ledger. Client SDK queue rows reconcile through
`get_media_upload_receipt_status`, which is owner-scoped with `auth.uid()`; the
receipt table itself remains service-role only.

New Bunny Storage object paths are deterministic and scoped:

- Profile photos: `photos/{user_id}/req-{token32}.{ext}`
- Chat photos: `photos/match-{match_id}/{user_id}/req-{token32}.{ext}`
- Voice notes: `voice/match-{match_id}/{user_id}/req-{token32}.{ext}`
- Event covers: `events/{event_id}/req-{token32}.{ext}` or `events/covers/req-{token32}.{ext}`

The path token is a 32-character SHA-256 prefix. Receipt uniqueness remains the
canonical conflict guarantee.

Event-cover uploads remain admin-only. The current `events` schema has no
owner/host column that can safely authorize non-admin cover changes, so
`upload-event-cover` gates writes through `user_roles.role = 'admin'` until the
event ownership model changes.

## Delete Worker Cadence

`process-media-delete-jobs` is scheduled by pg_cron as
`media-delete-worker-every-15m`, so the normal cadence is every 15 minutes.

Each default invocation uses `batch_size = 20`:

- uploaded-orphan enqueue: `batch_size * 2`, capped by SQL at 500
- purgeable soft-delete promotion: `batch_size * 2`
- claimed delete jobs: `batch_size`

At the default cadence, uploaded-orphan catch-up is 160 assets/hour. With the
worker batch raised to 200, catch-up is 1600 assets/hour, still below the SQL
hard cap of 500 per enqueue call.

Operators can preview a run from the admin media lifecycle panel. The dry run
uses `preview_media_delete_worker_run`, performs zero mutations, and includes
queued jobs, promotable assets, and uploaded-orphan candidates.
