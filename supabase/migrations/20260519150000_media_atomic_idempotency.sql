-- Phase 5.1-5.4: media asset atomic idempotency foundation.
-- Adds server-hash tracking, upload receipts, atomic attach, and explicit
-- SQL ON CONFLICT upsert helpers for partial provider identity indexes.

BEGIN;

-- 5.1: media_assets can represent uploaded-but-not-yet-attached objects.
ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS content_sha256 text;

COMMENT ON COLUMN public.media_assets.content_sha256 IS
  'Lowercase hex SHA-256 of the provider bytes, computed by the server when available.';

ALTER TABLE public.media_assets
  DROP CONSTRAINT IF EXISTS media_assets_content_sha256_check;

ALTER TABLE public.media_assets
  ADD CONSTRAINT media_assets_content_sha256_check
  CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE public.media_assets
  DROP CONSTRAINT IF EXISTS media_assets_status_check;

ALTER TABLE public.media_assets
  ADD CONSTRAINT media_assets_status_check
  CHECK (status IN (
    'uploading',
    'uploaded',
    'active',
    'soft_deleted',
    'purge_ready',
    'purging',
    'purged',
    'failed'
  ));

COMMENT ON TABLE public.media_assets IS
  'One row per physical file or stream object across all providers.  '
  'Status lifecycle: uploading/uploaded → active → soft_deleted → purge_ready → purging → purged.';

CREATE INDEX IF NOT EXISTS idx_ma_owner_family_sha256
  ON public.media_assets (owner_user_id, media_family, content_sha256)
  WHERE content_sha256 IS NOT NULL;

-- Dedupe existing assets before enforcing provider identity uniqueness.
-- We preserve the best canonical row, repoint references/jobs/session attempts,
-- then delete duplicate asset rows so the unique partial indexes can be created.
CREATE TEMP TABLE media_asset_dedupe_map (
  duplicate_id uuid PRIMARY KEY,
  canonical_id uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE media_asset_duplicate_candidates (
  id uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO media_asset_duplicate_candidates (id)
SELECT ma.id
FROM public.media_assets ma
WHERE ma.provider_path IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.media_assets peer
    WHERE peer.id <> ma.id
      AND peer.provider = ma.provider
      AND peer.provider_path = ma.provider_path
  )
UNION
SELECT ma.id
FROM public.media_assets ma
WHERE ma.provider_object_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.media_assets peer
    WHERE peer.id <> ma.id
      AND peer.provider = ma.provider
      AND peer.provider_object_id = ma.provider_object_id
  );

CREATE TEMP TABLE media_asset_duplicate_edges (
  source_id uuid NOT NULL,
  target_id uuid NOT NULL,
  PRIMARY KEY (source_id, target_id)
) ON COMMIT DROP;

INSERT INTO media_asset_duplicate_edges (source_id, target_id)
SELECT a.id, b.id
FROM public.media_assets a
JOIN public.media_assets b
  ON b.id <> a.id
 AND b.provider = a.provider
 AND (
    (a.provider_path IS NOT NULL AND b.provider_path = a.provider_path)
    OR (a.provider_object_id IS NOT NULL AND b.provider_object_id = a.provider_object_id)
 )
JOIN media_asset_duplicate_candidates ac ON ac.id = a.id
JOIN media_asset_duplicate_candidates bc ON bc.id = b.id;

INSERT INTO media_asset_dedupe_map (duplicate_id, canonical_id)
WITH RECURSIVE connected(root_id, asset_id) AS (
  SELECT id, id
  FROM media_asset_duplicate_candidates
  UNION
  SELECT connected.root_id, edge.target_id
  FROM connected
  JOIN media_asset_duplicate_edges edge ON edge.source_id = connected.asset_id
),
components AS (
  SELECT asset_id AS id, min(root_id) AS component_id
  FROM connected
  GROUP BY asset_id
),
ranked AS (
  SELECT
    ma.id,
    first_value(ma.id) OVER (
      PARTITION BY components.component_id
      ORDER BY
        CASE ma.status
          WHEN 'active' THEN 0
          WHEN 'uploaded' THEN 1
          WHEN 'uploading' THEN 2
          WHEN 'soft_deleted' THEN 3
          WHEN 'purge_ready' THEN 4
          WHEN 'purging' THEN 5
          WHEN 'failed' THEN 6
          ELSE 7
        END,
        ma.created_at ASC,
        ma.id ASC
    ) AS canonical_id
  FROM public.media_assets ma
  JOIN components ON components.id = ma.id
)
SELECT id, canonical_id
FROM ranked
WHERE id <> canonical_id;

WITH duplicate_rollup AS (
  SELECT
    mapped.canonical_id,
    max(ma.owner_user_id) FILTER (WHERE ma.owner_user_id IS NOT NULL) AS owner_user_id,
    max(ma.provider_object_id) FILTER (WHERE ma.provider_object_id IS NOT NULL) AS provider_object_id,
    max(ma.provider_path) FILTER (WHERE ma.provider_path IS NOT NULL) AS provider_path,
    max(ma.mime_type) FILTER (WHERE ma.mime_type IS NOT NULL) AS mime_type,
    max(ma.bytes) FILTER (WHERE ma.bytes IS NOT NULL) AS bytes,
    max(ma.content_sha256) FILTER (WHERE ma.content_sha256 IS NOT NULL) AS content_sha256,
    max(ma.legacy_table) FILTER (WHERE ma.legacy_table IS NOT NULL) AS legacy_table,
    max(ma.legacy_id) FILTER (WHERE ma.legacy_id IS NOT NULL) AS legacy_id
  FROM media_asset_dedupe_map mapped
  JOIN public.media_assets ma ON ma.id = mapped.duplicate_id
  GROUP BY mapped.canonical_id
)
UPDATE public.media_assets canonical
SET owner_user_id = COALESCE(canonical.owner_user_id, duplicate_rollup.owner_user_id),
    provider_object_id = COALESCE(canonical.provider_object_id, duplicate_rollup.provider_object_id),
    provider_path = COALESCE(canonical.provider_path, duplicate_rollup.provider_path),
    mime_type = COALESCE(canonical.mime_type, duplicate_rollup.mime_type),
    bytes = COALESCE(canonical.bytes, duplicate_rollup.bytes),
    content_sha256 = COALESCE(canonical.content_sha256, duplicate_rollup.content_sha256),
    legacy_table = COALESCE(canonical.legacy_table, duplicate_rollup.legacy_table),
    legacy_id = COALESCE(canonical.legacy_id, duplicate_rollup.legacy_id)
FROM duplicate_rollup
WHERE canonical.id = duplicate_rollup.canonical_id;

UPDATE public.media_references r
SET asset_id = mapped.canonical_id
FROM media_asset_dedupe_map mapped
WHERE r.asset_id = mapped.duplicate_id;

UPDATE public.media_delete_jobs j
SET asset_id = mapped.canonical_id
FROM media_asset_dedupe_map mapped
WHERE j.asset_id = mapped.duplicate_id;

UPDATE public.profile_vibe_videos v
SET asset_id = mapped.canonical_id
FROM media_asset_dedupe_map mapped
WHERE v.asset_id = mapped.duplicate_id;

UPDATE public.chat_vibe_clip_uploads u
SET media_asset_id = mapped.canonical_id
FROM media_asset_dedupe_map mapped
WHERE u.media_asset_id = mapped.duplicate_id;

UPDATE public.vibe_video_uploads u
SET media_asset_id = mapped.canonical_id
FROM media_asset_dedupe_map mapped
WHERE u.media_asset_id = mapped.duplicate_id;

DELETE FROM public.media_assets ma
USING media_asset_dedupe_map mapped
WHERE ma.id = mapped.duplicate_id;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_media_assets_provider_path
  ON public.media_assets (provider, provider_path)
  WHERE provider_path IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_media_assets_provider_object_id
  ON public.media_assets (provider, provider_object_id)
  WHERE provider_object_id IS NOT NULL;

-- 5.2: idempotency ledger for reserve-before-PUT upload families.
CREATE TABLE IF NOT EXISTS public.media_upload_receipts (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_family       text        NOT NULL REFERENCES public.media_retention_settings(media_family),
  scope_key          text        NOT NULL DEFAULT '',
  client_request_id  text        NOT NULL CHECK (length(client_request_id) BETWEEN 1 AND 128),
  content_sha256     text        NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  provider           text        NOT NULL CHECK (provider IN ('bunny_stream', 'bunny_storage', 'supabase_storage')),
  provider_path      text,
  provider_object_id text,
  asset_id           uuid        REFERENCES public.media_assets(id) ON DELETE SET NULL,
  status             text        NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'uploaded', 'attached', 'failed')),
  metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT media_upload_receipts_provider_identity_check
    CHECK (provider_path IS NOT NULL OR provider_object_id IS NOT NULL),
  CONSTRAINT media_upload_receipts_idempotency_unique
    UNIQUE (owner_user_id, media_family, scope_key, client_request_id)
);

COMMENT ON TABLE public.media_upload_receipts IS
  'Idempotency ledger for client media uploads keyed by owner, family, scope, and client_request_id.';

CREATE INDEX IF NOT EXISTS idx_mur_asset
  ON public.media_upload_receipts (asset_id)
  WHERE asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mur_owner_family_status
  ON public.media_upload_receipts (owner_user_id, media_family, status);

CREATE OR REPLACE FUNCTION public.mur_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mur_updated_at ON public.media_upload_receipts;
CREATE TRIGGER trg_mur_updated_at
  BEFORE UPDATE ON public.media_upload_receipts
  FOR EACH ROW EXECUTE FUNCTION public.mur_set_updated_at();

ALTER TABLE public.media_upload_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS media_upload_receipts_service_role_all ON public.media_upload_receipts;
CREATE POLICY media_upload_receipts_service_role_all
  ON public.media_upload_receipts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.media_upload_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_upload_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_media_upload(
  p_owner_user_id uuid,
  p_media_family text,
  p_scope_key text,
  p_client_request_id text,
  p_content_sha256 text,
  p_provider text,
  p_provider_path text DEFAULT NULL,
  p_provider_object_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_scope_key text := COALESCE(p_scope_key, '');
  v_client_request_id text := btrim(COALESCE(p_client_request_id, ''));
  v_content_sha256 text := lower(btrim(COALESCE(p_content_sha256, '')));
  v_receipt public.media_upload_receipts%ROWTYPE;
BEGIN
  IF p_owner_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'owner_user_id_required');
  END IF;

  IF v_client_request_id = '' OR length(v_client_request_id) > 128 THEN
    RETURN jsonb_build_object('success', false, 'error', 'client_request_id_required');
  END IF;

  IF v_content_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'content_sha256_required');
  END IF;

  IF p_provider NOT IN ('bunny_stream', 'bunny_storage', 'supabase_storage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_provider');
  END IF;

  IF p_provider_path IS NULL AND p_provider_object_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'provider_identity_required');
  END IF;

  INSERT INTO public.media_upload_receipts (
    owner_user_id,
    media_family,
    scope_key,
    client_request_id,
    content_sha256,
    provider,
    provider_path,
    provider_object_id,
    metadata
  )
  VALUES (
    p_owner_user_id,
    p_media_family,
    v_scope_key,
    v_client_request_id,
    v_content_sha256,
    p_provider,
    p_provider_path,
    p_provider_object_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (owner_user_id, media_family, scope_key, client_request_id)
  DO NOTHING;

  SELECT *
  INTO v_receipt
  FROM public.media_upload_receipts
  WHERE owner_user_id = p_owner_user_id
    AND media_family = p_media_family
    AND scope_key = v_scope_key
    AND client_request_id = v_client_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'receipt_reserve_failed');
  END IF;

  IF v_receipt.content_sha256 IS DISTINCT FROM v_content_sha256 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'client_request_id_conflict',
      'code', 'client_request_id_conflict'
    );
  END IF;

  IF v_receipt.provider IS DISTINCT FROM p_provider
    OR (v_receipt.provider_path IS NOT NULL AND p_provider_path IS NOT NULL AND v_receipt.provider_path IS DISTINCT FROM p_provider_path)
    OR (v_receipt.provider_object_id IS NOT NULL AND p_provider_object_id IS NOT NULL AND v_receipt.provider_object_id IS DISTINCT FROM p_provider_object_id)
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'client_request_provider_conflict',
      'code', 'client_request_provider_conflict'
    );
  END IF;

  IF (v_receipt.provider_path IS NULL AND p_provider_path IS NOT NULL)
    OR (v_receipt.provider_object_id IS NULL AND p_provider_object_id IS NOT NULL)
    OR COALESCE(p_metadata, '{}'::jsonb) <> '{}'::jsonb
  THEN
    UPDATE public.media_upload_receipts
    SET provider_path = COALESCE(provider_path, p_provider_path),
        provider_object_id = COALESCE(provider_object_id, p_provider_object_id),
        metadata = metadata || COALESCE(p_metadata, '{}'::jsonb)
    WHERE id = v_receipt.id
    RETURNING * INTO v_receipt;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt.id,
    'status', v_receipt.status,
    'asset_id', v_receipt.asset_id,
    'provider', v_receipt.provider,
    'provider_path', v_receipt.provider_path,
    'provider_object_id', v_receipt.provider_object_id,
    'content_sha256', v_receipt.content_sha256,
    'metadata', v_receipt.metadata
  );
EXCEPTION
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_media_family');
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_media_upload(uuid, text, text, text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_media_upload(uuid, text, text, text, text, text, text, text, jsonb)
  TO service_role;

-- 5.3: atomic active reference attach + uploaded -> active promotion.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY asset_id, ref_type, ref_table, ref_id, COALESCE(ref_key, '')
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.media_references
  WHERE is_active = true
)
UPDATE public.media_references r
SET is_active = false,
    released_at = COALESCE(released_at, now()),
    released_by = COALESCE(released_by, 'duplicate_active_reference')
FROM ranked
WHERE ranked.rn > 1
  AND r.id = ranked.id;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_media_references_active_ref
  ON public.media_references (asset_id, ref_type, ref_table, ref_id, (COALESCE(ref_key, '')))
  WHERE is_active = true;

CREATE OR REPLACE FUNCTION public.attach_media_reference(
  p_asset_id uuid,
  p_ref_type text,
  p_ref_table text,
  p_ref_id text,
  p_ref_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_asset public.media_assets%ROWTYPE;
  v_reference_id uuid;
  v_created boolean;
BEGIN
  IF p_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'asset_id_required');
  END IF;

  IF btrim(COALESCE(p_ref_type, '')) = ''
    OR btrim(COALESCE(p_ref_table, '')) = ''
    OR btrim(COALESCE(p_ref_id, '')) = ''
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'reference_required');
  END IF;

  SELECT *
  INTO v_asset
  FROM public.media_assets
  WHERE id = p_asset_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'asset_not_found');
  END IF;

  IF v_asset.status IN ('purging', 'purged') THEN
    RETURN jsonb_build_object('success', false, 'error', 'asset_not_attachable');
  END IF;

  INSERT INTO public.media_references (
    asset_id,
    ref_type,
    ref_table,
    ref_id,
    ref_key,
    is_active,
    released_at,
    released_by
  )
  VALUES (
    p_asset_id,
    p_ref_type,
    p_ref_table,
    p_ref_id,
    NULLIF(p_ref_key, ''),
    true,
    NULL,
    NULL
  )
  ON CONFLICT (asset_id, ref_type, ref_table, ref_id, (COALESCE(ref_key, '')))
  WHERE is_active = true
  DO UPDATE
    SET is_active = true,
        released_at = NULL,
        released_by = NULL
  RETURNING id, (xmax = 0) INTO v_reference_id, v_created;

  UPDATE public.media_assets
  SET status = 'active',
      deleted_at = NULL,
      purge_after = NULL,
      purged_at = NULL,
      last_error = NULL
  WHERE id = p_asset_id
    AND status IS DISTINCT FROM 'active';

  RETURN jsonb_build_object(
    'success', true,
    'asset_id', p_asset_id,
    'reference_id', v_reference_id,
    'created', v_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.attach_media_reference(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_media_reference(uuid, text, text, text, text)
  TO service_role;

-- 5.4: explicit SQL upsert for partial provider identity indexes.
CREATE OR REPLACE FUNCTION public.upsert_media_asset(
  p_provider text,
  p_media_family text,
  p_owner_user_id uuid DEFAULT NULL,
  p_provider_object_id text DEFAULT NULL,
  p_provider_path text DEFAULT NULL,
  p_mime_type text DEFAULT NULL,
  p_bytes bigint DEFAULT NULL,
  p_content_sha256 text DEFAULT NULL,
  p_status text DEFAULT 'active',
  p_legacy_table text DEFAULT NULL,
  p_legacy_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_status text := COALESCE(p_status, 'active');
  v_content_sha256 text := NULLIF(lower(btrim(COALESCE(p_content_sha256, ''))), '');
  v_asset_id uuid;
  v_created boolean;
BEGIN
  IF p_provider NOT IN ('bunny_stream', 'bunny_storage', 'supabase_storage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_provider');
  END IF;

  IF p_provider_object_id IS NULL AND p_provider_path IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'provider_identity_required');
  END IF;

  IF v_status NOT IN ('uploading', 'uploaded', 'active', 'soft_deleted', 'purge_ready', 'purging', 'purged', 'failed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_status');
  END IF;

  IF v_content_sha256 IS NOT NULL AND v_content_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_content_sha256');
  END IF;

  IF p_provider_path IS NOT NULL THEN
    INSERT INTO public.media_assets (
      provider,
      media_family,
      owner_user_id,
      provider_object_id,
      provider_path,
      mime_type,
      bytes,
      content_sha256,
      status,
      legacy_table,
      legacy_id,
      deleted_at,
      purge_after,
      purged_at,
      last_error
    )
    VALUES (
      p_provider,
      p_media_family,
      p_owner_user_id,
      p_provider_object_id,
      p_provider_path,
      p_mime_type,
      p_bytes,
      v_content_sha256,
      v_status,
      p_legacy_table,
      p_legacy_id,
      CASE WHEN v_status IN ('active', 'uploaded', 'uploading') THEN NULL ELSE now() END,
      NULL,
      NULL,
      NULL
    )
    ON CONFLICT (provider, provider_path)
    WHERE provider_path IS NOT NULL
    DO UPDATE
      SET media_family = EXCLUDED.media_family,
          owner_user_id = COALESCE(public.media_assets.owner_user_id, EXCLUDED.owner_user_id),
          provider_object_id = COALESCE(public.media_assets.provider_object_id, EXCLUDED.provider_object_id),
          mime_type = COALESCE(EXCLUDED.mime_type, public.media_assets.mime_type),
          bytes = COALESCE(EXCLUDED.bytes, public.media_assets.bytes),
          content_sha256 = COALESCE(public.media_assets.content_sha256, EXCLUDED.content_sha256),
          status = CASE
            WHEN EXCLUDED.status = 'active' THEN 'active'
            WHEN public.media_assets.status = 'active' THEN 'active'
            ELSE EXCLUDED.status
          END,
          legacy_table = COALESCE(EXCLUDED.legacy_table, public.media_assets.legacy_table),
          legacy_id = COALESCE(EXCLUDED.legacy_id, public.media_assets.legacy_id),
          deleted_at = CASE WHEN EXCLUDED.status IN ('active', 'uploaded', 'uploading') THEN NULL ELSE public.media_assets.deleted_at END,
          purge_after = CASE WHEN EXCLUDED.status IN ('active', 'uploaded', 'uploading') THEN NULL ELSE public.media_assets.purge_after END,
          purged_at = CASE WHEN EXCLUDED.status IN ('active', 'uploaded', 'uploading') THEN NULL ELSE public.media_assets.purged_at END,
          last_error = CASE WHEN EXCLUDED.status IN ('active', 'uploaded', 'uploading') THEN NULL ELSE public.media_assets.last_error END
      WHERE public.media_assets.content_sha256 IS NULL
         OR EXCLUDED.content_sha256 IS NULL
         OR public.media_assets.content_sha256 = EXCLUDED.content_sha256
    RETURNING id, (xmax = 0) INTO v_asset_id, v_created;
  ELSE
    INSERT INTO public.media_assets (
      provider,
      media_family,
      owner_user_id,
      provider_object_id,
      provider_path,
      mime_type,
      bytes,
      content_sha256,
      status,
      legacy_table,
      legacy_id,
      deleted_at,
      purge_after,
      purged_at,
      last_error
    )
    VALUES (
      p_provider,
      p_media_family,
      p_owner_user_id,
      p_provider_object_id,
      p_provider_path,
      p_mime_type,
      p_bytes,
      v_content_sha256,
      v_status,
      p_legacy_table,
      p_legacy_id,
      CASE WHEN v_status IN ('active', 'uploaded', 'uploading') THEN NULL ELSE now() END,
      NULL,
      NULL,
      NULL
    )
    ON CONFLICT (provider, provider_object_id)
    WHERE provider_object_id IS NOT NULL
    DO UPDATE
      SET media_family = EXCLUDED.media_family,
          owner_user_id = COALESCE(public.media_assets.owner_user_id, EXCLUDED.owner_user_id),
          provider_path = COALESCE(public.media_assets.provider_path, EXCLUDED.provider_path),
          mime_type = COALESCE(EXCLUDED.mime_type, public.media_assets.mime_type),
          bytes = COALESCE(EXCLUDED.bytes, public.media_assets.bytes),
          content_sha256 = COALESCE(public.media_assets.content_sha256, EXCLUDED.content_sha256),
          status = CASE
            WHEN EXCLUDED.status = 'active' THEN 'active'
            WHEN public.media_assets.status = 'active' THEN 'active'
            ELSE EXCLUDED.status
          END,
          legacy_table = COALESCE(EXCLUDED.legacy_table, public.media_assets.legacy_table),
          legacy_id = COALESCE(EXCLUDED.legacy_id, public.media_assets.legacy_id),
          deleted_at = CASE WHEN EXCLUDED.status IN ('active', 'uploaded', 'uploading') THEN NULL ELSE public.media_assets.deleted_at END,
          purge_after = CASE WHEN EXCLUDED.status IN ('active', 'uploaded', 'uploading') THEN NULL ELSE public.media_assets.purge_after END,
          purged_at = CASE WHEN EXCLUDED.status IN ('active', 'uploaded', 'uploading') THEN NULL ELSE public.media_assets.purged_at END,
          last_error = CASE WHEN EXCLUDED.status IN ('active', 'uploaded', 'uploading') THEN NULL ELSE public.media_assets.last_error END
      WHERE public.media_assets.content_sha256 IS NULL
         OR EXCLUDED.content_sha256 IS NULL
         OR public.media_assets.content_sha256 = EXCLUDED.content_sha256
    RETURNING id, (xmax = 0) INTO v_asset_id, v_created;
  END IF;

  IF v_asset_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'provider_identity_content_conflict',
      'code', 'provider_identity_content_conflict'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'asset_id', v_asset_id,
    'created', COALESCE(v_created, false)
  );
EXCEPTION
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_media_family');
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'provider_identity_conflict');
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_media_asset(text, text, uuid, text, text, text, bigint, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_media_asset(text, text, uuid, text, text, text, bigint, text, text, text, text)
  TO service_role;

COMMIT;
