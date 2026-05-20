# Bunny Geo Replication Runbook

Phase 9 expects Bunny Storage and Stream delivery to be operated as a multi-region service, not as an implicit dashboard setting.

## Required Zones

- Hot Storage zone: `BUNNY_STORAGE_ZONE`
- Archive Storage zone: `BUNNY_ARCHIVE_STORAGE_ZONE`
- Hot CDN hostname: `BUNNY_CDN_HOSTNAME`
- Archive CDN hostname, when exposed directly: `BUNNY_ARCHIVE_CDN_HOSTNAME`
- Stream CDN hostname for chat clips: `BUNNY_CHAT_STREAM_CDN_HOSTNAME`
- Stream CDN hostname for profile Vibe Videos: `BUNNY_STREAM_CDN_HOSTNAME`

## Dashboard Verification

For each Bunny Storage zone:

1. Open Bunny dashboard -> Storage -> zone.
2. Verify replication regions include the production residency set:
   - United States region for US users.
   - European Union region for EU users.
3. Confirm the pull zone / CDN hostname points at the same storage zone.
4. Confirm token authentication is enabled for private pull zones.
5. Record a screenshot of the region list and pull-zone security settings in the deployment ticket.

For Bunny Stream libraries:

1. Open Bunny dashboard -> Stream -> library.
2. Verify the CDN hostnames configured in Supabase secrets match the library hostname.
3. Confirm token security keys are present in Supabase secrets:
   - `BUNNY_CHAT_STREAM_TOKEN_SECURITY_KEY`
   - `BUNNY_STREAM_TOKEN_SECURITY_KEY`

## Synthetic Health

The `check-bunny-cdn-health` Edge Function runs every minute through pg_cron when Vault has `project_url` and `cron_secret`.

Required probe URLs:

- `BUNNY_CDN_HEALTH_STREAM_URL`: a known-good short Stream `playlist.m3u8`.
- `BUNNY_CDN_HEALTH_STORAGE_URL`: a known-good small Storage object.

The function writes per-probe state to `public.bunny_cdn_health_state`, emits `bunny_cdn_health` to PostHog, and sends Sentry after three consecutive failures.

## Cold Tiering

`process-media-delete-jobs` also archives eligible hot Bunny Storage objects when archive secrets are configured. A media asset is eligible when:

- `media_assets.status = 'active'`
- `media_assets.provider = 'bunny_storage'`
- `media_assets.storage_zone = 'hot'`
- `created_at` is older than 90 days
- `last_accessed_at` is null or older than 60 days

Signed/proxied media URL issuance calls `mark_media_asset_accessed`, so recently viewed objects stay hot.
