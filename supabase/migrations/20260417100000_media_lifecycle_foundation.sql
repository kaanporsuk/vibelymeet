-- Sprint 1: Media lifecycle foundation
-- Creates the canonical media domain tables that decouple physical Bunny/Supabase
-- assets from product-level references.  All future media cleanup flows
-- (profile photos, vibe videos, chat media, event covers) will use this model.
--
-- Tables created:
--   media_retention_settings  — admin-configurable per-family retention policy
--   media_assets              — one row per physical file/stream object
--   media_references          — links assets to product entities (profiles, messages, events)
--   media_delete_jobs         — deletion work queue with retry/backoff/dry-run

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. media_retention_settings
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.media_retention_settings (
  media_family      text        PRIMARY KEY,
  retention_mode    text        NOT NULL DEFAULT 'soft_delete'
    CHECK (retention_mode IN (
      'soft_delete',            -- mark deleted, purge after retention_days
      'retain_until_eligible',  -- keep until all references released + optional days
      'immediate'               -- purge as soon as last reference released
    )),
  retention_days    integer     CHECK (retention_days IS NULL OR retention_days >= 0),
  eligible_days     integer     CHECK (eligible_days IS NULL OR eligible_days >= 0),
  worker_enabled    boolean     NOT NULL DEFAULT true,
  dry_run           boolean     NOT NULL DEFAULT false,
  batch_size        integer     NOT NULL DEFAULT 50
    CHECK (batch_size > 0 AND batch_size <= 500),
  max_attempts      integer     NOT NULL DEFAULT 5
    CHECK (max_attempts > 0 AND max_attempts <= 20),
  notes             text,
  updated_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.media_retention_settings IS
  'Admin-configurable retention policy per media family.  '
  'Workers read this at job-processing time so policy changes take effect immediately.';

-- Seed defaults
INSERT INTO public.media_retention_settings
  (media_family, retention_mode, retention_days, eligible_days, notes)
VALUES
  ('vibe_video',          'soft_delete',           30,  NULL, 'Profile vibe videos — 30d soft delete after removal'),
  ('profile_photo',       'soft_delete',           30,  NULL, 'Profile photos — 30d soft delete after removal'),
  ('event_cover',         'soft_delete',           90,  NULL, 'Event cover images — 90d soft delete after replacement'),
  -- Chat media families: retain_until_eligible with NULL eligible_days means
  -- NO automatic purge runs for these families until Sprint 3 implements the
  -- actual eligibility logic (both sides deleted chat / both accounts deleted /
  -- one account deleted + other side deleted chat).  These rows exist so that
  -- the media_family FK is valid for asset registration, but the worker will
  -- never promote or purge chat media until eligible_days is set and the
  -- reference-release logic is wired into message/match/account deletion flows.
  ('chat_image',          'retain_until_eligible', NULL, NULL, 'FOUNDATION ONLY — no auto-purge until Sprint 3 eligibility logic'),
  ('chat_video',          'retain_until_eligible', NULL, NULL, 'FOUNDATION ONLY — no auto-purge until Sprint 3 eligibility logic'),
  ('voice_message',       'retain_until_eligible', NULL, NULL, 'FOUNDATION ONLY — no auto-purge until Sprint 3 eligibility logic'),
  ('chat_video_thumbnail','retain_until_eligible', NULL, NULL, 'FOUNDATION ONLY — follows parent chat_video policy, Sprint 3'),
  ('verification_selfie', 'soft_delete',          180,  NULL, 'PROVISIONAL — verification selfie retention not yet product-approved. Worker disabled until policy confirmed.')
ON CONFLICT (media_family) DO NOTHING;

-- Verification selfie worker explicitly disabled until product owner confirms policy.
-- The row exists so the media_family FK is valid, but no automatic purge will run.
UPDATE public.media_retention_settings
SET worker_enabled = false
WHERE media_family = 'verification_selfie';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. media_assets
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.media_assets (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text        NOT NULL
    CHECK (provider IN ('bunny_stream', 'bunny_storage', 'supabase_storage')),
  media_family      text        NOT NULL
    REFERENCES public.media_retention_settings(media_family),
  owner_user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Provider-specific identifiers (at least one must be set)
  provider_object_id text,      -- Bunny Stream videoId
  provider_path      text,      -- Bunny Storage / Supabase Storage path

  mime_type         text,
  bytes             bigint      CHECK (bytes IS NULL OR bytes >= 0),

  status            text        NOT NULL DEFAULT 'active'
    CHECK (status IN (
      'uploading',    -- upload in progress, not yet referenced
      'active',       -- at least one active reference exists
      'soft_deleted', -- all references released, awaiting purge window
      'purge_ready',  -- retention window expired, ready for physical delete
      'purging',      -- delete job claimed, in progress
      'purged',       -- physically deleted from provider
      'failed'        -- purge failed after max attempts
    )),

  deleted_at        timestamptz,  -- when last reference was released / user action
  purge_after       timestamptz,  -- earliest time physical delete is allowed
  purged_at         timestamptz,  -- when physical delete was confirmed
  last_error        text,

  -- Backfill tracking: link back to legacy tables for migration
  legacy_table      text,         -- e.g. 'profiles', 'messages', 'events', 'draft_media_sessions'
  legacy_id         text,         -- original row id or composite key

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_provider_id_or_path
    CHECK (provider_object_id IS NOT NULL OR provider_path IS NOT NULL)
);

COMMENT ON TABLE public.media_assets IS
  'One row per physical file or stream object across all providers.  '
  'Status lifecycle: uploading → active → soft_deleted → purge_ready → purging → purged.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ma_owner
  ON public.media_assets (owner_user_id)
  WHERE owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ma_provider_object
  ON public.media_assets (provider, provider_object_id)
  WHERE provider_object_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ma_provider_path
  ON public.media_assets (provider, provider_path)
  WHERE provider_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ma_status_purge
  ON public.media_assets (status, purge_after)
  WHERE status IN ('soft_deleted', 'purge_ready');

CREATE INDEX IF NOT EXISTS idx_ma_family
  ON public.media_assets (media_family);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.ma_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_ma_updated_at
  BEFORE UPDATE ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.ma_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. media_references
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.media_references (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id    uuid        NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,

  ref_type    text        NOT NULL
    CHECK (ref_type IN (
      'profile_vibe_video',       -- profiles.bunny_video_uid
      'profile_photo_slot',       -- profiles.photos[n]
      'profile_avatar',           -- profiles.avatar_url
      'message_attachment',       -- messages.video_url / audio_url
      'event_cover',              -- events.cover_image
      'verification_selfie',      -- photo_verifications.selfie_url
      'verification_reference'    -- photo_verifications.profile_photo_url
    )),
  ref_table   text        NOT NULL,  -- 'profiles', 'messages', 'events', 'photo_verifications'
  ref_id      text        NOT NULL,  -- primary key of the referenced row (cast to text)
  ref_key     text,                  -- optional sub-key: 'photos[2]', 'audio_url', 'video_url'

  is_active   boolean     NOT NULL DEFAULT true,
  released_at timestamptz,           -- when reference was deactivated
  released_by text,                  -- 'user_action', 'replace', 'unmatch', 'account_delete', 'admin'

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.media_references IS
  'Links physical media_assets to product entities.  '
  'An asset is purge-eligible only when zero active references remain AND policy allows.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mref_asset
  ON public.media_references (asset_id);

CREATE INDEX IF NOT EXISTS idx_mref_active_asset
  ON public.media_references (asset_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_mref_ref
  ON public.media_references (ref_table, ref_id);

CREATE INDEX IF NOT EXISTS idx_mref_type
  ON public.media_references (ref_type)
  WHERE is_active = true;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.mref_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_mref_updated_at
  BEFORE UPDATE ON public.media_references
  FOR EACH ROW EXECUTE FUNCTION public.mref_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. media_delete_jobs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.media_delete_jobs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        uuid        NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
  provider        text        NOT NULL
    CHECK (provider IN ('bunny_stream', 'bunny_storage', 'supabase_storage')),

  job_type        text        NOT NULL DEFAULT 'purge'
    CHECK (job_type IN (
      'purge',          -- normal retention-driven delete
      'orphan_sweep',   -- found via reconciliation, no DB reference
      'admin_purge',    -- admin-initiated immediate delete
      'account_delete'  -- account deletion cascade
    )),

  status          text        NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',      -- waiting for next worker run
      'claimed',      -- worker picked it up
      'completed',    -- provider confirmed deletion
      'failed',       -- attempt failed, will retry
      'abandoned'     -- max attempts exceeded
    )),

  attempts        integer     NOT NULL DEFAULT 0
    CHECK (attempts >= 0),
  max_attempts    integer     NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  completed_at    timestamptz,

  -- NOTE: dry_run is an invocation-level concept on the worker, not per-job.
  -- The worker decides at call time whether to preview (read-only) or execute.

  -- Provider-specific payload copied from asset at enqueue time
  -- so the job is self-contained even if asset row changes
  provider_object_id text,
  provider_path      text,

  last_error      text,
  worker_id       text,       -- identifies which function invocation claimed this job

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.media_delete_jobs IS
  'Deletion work queue.  Workers claim pending jobs, execute provider deletes, '
  'and update status.  Supports retry with backoff and dry-run mode.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mdj_pending
  ON public.media_delete_jobs (status, next_attempt_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_mdj_asset
  ON public.media_delete_jobs (asset_id);

CREATE INDEX IF NOT EXISTS idx_mdj_provider
  ON public.media_delete_jobs (provider, status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.mdj_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_mdj_updated_at
  BEFORE UPDATE ON public.media_delete_jobs
  FOR EACH ROW EXECUTE FUNCTION public.mdj_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.media_retention_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_references         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_delete_jobs        ENABLE ROW LEVEL SECURITY;

-- Retention settings: read-only for authenticated (admin writes via service_role)
CREATE POLICY "Authenticated can read retention settings"
  ON public.media_retention_settings FOR SELECT
  USING (true);

CREATE POLICY "Service role full access to retention settings"
  ON public.media_retention_settings FOR ALL
  USING (auth.role() = 'service_role');

-- Assets: users can read own, service_role full
CREATE POLICY "Users can read own media assets"
  ON public.media_assets FOR SELECT
  USING (auth.uid() = owner_user_id);

CREATE POLICY "Service role full access to media assets"
  ON public.media_assets FOR ALL
  USING (auth.role() = 'service_role');

-- References: users can read refs to their assets, service_role full
CREATE POLICY "Users can read own media references"
  ON public.media_references FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.media_assets ma
      WHERE ma.id = asset_id AND ma.owner_user_id = auth.uid()
    )
  );

CREATE POLICY "Service role full access to media references"
  ON public.media_references FOR ALL
  USING (auth.role() = 'service_role');

-- Delete jobs: service_role only (workers)
CREATE POLICY "Service role full access to delete jobs"
  ON public.media_delete_jobs FOR ALL
  USING (auth.role() = 'service_role');


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RPCs for worker and asset management
-- ─────────────────────────────────────────────────────────────────────────────

-- 6a. Enqueue a delete job for an asset
CREATE OR REPLACE FUNCTION public.enqueue_media_delete(
  p_asset_id   uuid,
  p_job_type   text DEFAULT 'purge'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_asset   public.media_assets%ROWTYPE;
  v_policy  public.media_retention_settings%ROWTYPE;
  v_job_id  uuid;
BEGIN
  SELECT * INTO v_asset FROM public.media_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'asset_not_found');
  END IF;

  -- Already purged or purging
  IF v_asset.status IN ('purged', 'purging') THEN
    RETURN jsonb_build_object('success', true, 'already_purged', true);
  END IF;

  -- Check for existing pending/claimed job
  IF EXISTS (
    SELECT 1 FROM public.media_delete_jobs
    WHERE asset_id = p_asset_id AND status IN ('pending', 'claimed')
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_enqueued', true);
  END IF;

  SELECT * INTO v_policy
  FROM public.media_retention_settings
  WHERE media_family = v_asset.media_family;

  INSERT INTO public.media_delete_jobs (
    asset_id, provider, job_type,
    provider_object_id, provider_path,
    max_attempts
  ) VALUES (
    p_asset_id, v_asset.provider, p_job_type,
    v_asset.provider_object_id, v_asset.provider_path,
    COALESCE(v_policy.max_attempts, 5)
  )
  RETURNING id INTO v_job_id;

  -- Mark asset as purge_ready if not already
  IF v_asset.status = 'soft_deleted' THEN
    UPDATE public.media_assets SET status = 'purge_ready' WHERE id = p_asset_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'job_id', v_job_id);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_media_delete FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_media_delete TO service_role;


-- 6b. Release a media reference and check if asset should transition
CREATE OR REPLACE FUNCTION public.release_media_reference(
  p_reference_id uuid,
  p_released_by  text DEFAULT 'user_action'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_ref     public.media_references%ROWTYPE;
  v_asset   public.media_assets%ROWTYPE;
  v_policy  public.media_retention_settings%ROWTYPE;
  v_active  integer;
  v_purge   timestamptz;
BEGIN
  SELECT * INTO v_ref FROM public.media_references WHERE id = p_reference_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'reference_not_found');
  END IF;

  IF NOT v_ref.is_active THEN
    RETURN jsonb_build_object('success', true, 'already_released', true);
  END IF;

  -- Release the reference
  UPDATE public.media_references
  SET is_active = false, released_at = now(), released_by = p_released_by
  WHERE id = p_reference_id;

  -- Count remaining active references for this asset
  SELECT count(*) INTO v_active
  FROM public.media_references
  WHERE asset_id = v_ref.asset_id AND is_active = true AND id != p_reference_id;

  -- If no active references remain, transition asset to soft_deleted
  IF v_active = 0 THEN
    SELECT * INTO v_asset FROM public.media_assets WHERE id = v_ref.asset_id FOR UPDATE;
    SELECT * INTO v_policy
    FROM public.media_retention_settings WHERE media_family = v_asset.media_family;

    -- Compute purge_after based on policy
    IF v_policy.retention_mode = 'immediate' THEN
      v_purge := now();
    ELSIF v_policy.retention_mode = 'soft_delete' AND v_policy.retention_days IS NOT NULL THEN
      v_purge := now() + (v_policy.retention_days || ' days')::interval;
    ELSIF v_policy.retention_mode = 'retain_until_eligible' THEN
      -- eligible_days adds time after last reference release; NULL = indefinite until explicit purge
      IF v_policy.eligible_days IS NOT NULL THEN
        v_purge := now() + (v_policy.eligible_days || ' days')::interval;
      ELSE
        v_purge := NULL;  -- stays soft_deleted, not auto-purged
      END IF;
    ELSE
      v_purge := NULL;
    END IF;

    UPDATE public.media_assets
    SET status     = 'soft_deleted',
        deleted_at = COALESCE(deleted_at, now()),
        purge_after = v_purge
    WHERE id = v_ref.asset_id
      AND status = 'active';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'asset_id', v_ref.asset_id,
    'remaining_active_refs', v_active,
    'asset_transitioned', (v_active = 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_media_reference FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_media_reference TO service_role;


-- 6c. Claim a batch of pending delete jobs (worker use)
CREATE OR REPLACE FUNCTION public.claim_media_delete_jobs(
  p_worker_id    text,
  p_batch_size   integer DEFAULT 10,
  p_family_filter text DEFAULT NULL  -- optional: only process one family
)
RETURNS SETOF public.media_delete_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT j.id
    FROM public.media_delete_jobs j
    JOIN public.media_assets a ON a.id = j.asset_id
    JOIN public.media_retention_settings s ON s.media_family = a.media_family
    WHERE j.status IN ('pending', 'failed')
      AND j.next_attempt_at <= now()
      AND j.attempts < j.max_attempts
      AND s.worker_enabled = true
      AND (p_family_filter IS NULL OR a.media_family = p_family_filter)
    ORDER BY j.next_attempt_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF j SKIP LOCKED
  )
  UPDATE public.media_delete_jobs
  SET status     = 'claimed',
      started_at = now(),
      worker_id  = p_worker_id
  FROM claimable
  WHERE media_delete_jobs.id = claimable.id
  RETURNING media_delete_jobs.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_media_delete_jobs FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_media_delete_jobs TO service_role;


-- 6d. Complete a delete job (worker use)
-- NOTE: Dry-run mode is handled entirely in the worker Edge Function.
-- Dry-run never claims, completes, or mutates any job or asset row.
-- This RPC is only called for real (non-dry-run) execution results.
CREATE OR REPLACE FUNCTION public.complete_media_delete_job(
  p_job_id     uuid,
  p_success    boolean,
  p_error      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_job     public.media_delete_jobs%ROWTYPE;
  v_status  text;
  v_next    timestamptz;
BEGIN
  SELECT * INTO v_job FROM public.media_delete_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'job_not_found');
  END IF;

  IF p_success THEN
    v_status := 'completed';
  ELSE
    -- Failed: compute next retry with exponential backoff (1m, 5m, 25m, 2h, 10h)
    v_next := now() + (power(5, LEAST(v_job.attempts, 4)) || ' minutes')::interval;
    IF v_job.attempts + 1 >= v_job.max_attempts THEN
      v_status := 'abandoned';
    ELSE
      v_status := 'failed';
    END IF;
  END IF;

  UPDATE public.media_delete_jobs
  SET status          = v_status,
      attempts        = attempts + 1,
      completed_at    = CASE WHEN v_status IN ('completed', 'abandoned') THEN now() ELSE NULL END,
      next_attempt_at = COALESCE(v_next, next_attempt_at),
      last_error      = COALESCE(p_error, last_error)
  WHERE id = p_job_id;

  -- If completed, mark asset as purged
  IF v_status = 'completed' THEN
    UPDATE public.media_assets
    SET status = 'purged', purged_at = now()
    WHERE id = v_job.asset_id;
  ELSIF v_status = 'abandoned' THEN
    UPDATE public.media_assets
    SET status = 'failed', last_error = p_error
    WHERE id = v_job.asset_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'job_status', v_status,
    'attempts', v_job.attempts + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_media_delete_job FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_media_delete_job TO service_role;


-- 6e. Promote soft_deleted assets whose purge window has passed
-- Called by the worker before claiming jobs to seed the queue.
CREATE OR REPLACE FUNCTION public.promote_purgeable_assets(
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count integer := 0;
  v_asset record;
BEGIN
  FOR v_asset IN
    SELECT a.id
    FROM public.media_assets a
    JOIN public.media_retention_settings s ON s.media_family = a.media_family
    WHERE a.status = 'soft_deleted'
      AND a.purge_after IS NOT NULL
      AND a.purge_after <= now()
      AND s.worker_enabled = true
      AND NOT EXISTS (
        SELECT 1 FROM public.media_references r
        WHERE r.asset_id = a.id AND r.is_active = true
      )
    ORDER BY a.purge_after ASC
    LIMIT p_limit
    FOR UPDATE OF a SKIP LOCKED
  LOOP
    UPDATE public.media_assets SET status = 'purge_ready' WHERE id = v_asset.id;
    PERFORM public.enqueue_media_delete(v_asset.id, 'purge');
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_purgeable_assets FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_purgeable_assets TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Grants for admin dashboard read access (authenticated users with admin role
--    can view these tables directly; mutations go through service_role RPCs)
-- ─────────────────────────────────────────────────────────────────────────────

-- No additional grants needed: RLS policies above handle access.
-- Admin dashboard will use service_role for writes.
