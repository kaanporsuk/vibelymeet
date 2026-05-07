-- Photo Verification admin hardening.
--
-- Migration classification: schema+policy.
-- Intent: keep user submissions strictly pending, expose reviewed_at to the
-- admin read model, and make photo verification updates refresh the /kaan tab.

ALTER TABLE public.photo_verifications
  ADD CONSTRAINT photo_verifications_status_check
  CHECK (status IN ('pending', 'approved', 'rejected')) NOT VALID;

ALTER TABLE public.photo_verifications
  ADD CONSTRAINT photo_verifications_selfie_url_not_blank
  CHECK (NULLIF(btrim(selfie_url), '') IS NOT NULL) NOT VALID;

ALTER TABLE public.photo_verifications
  ADD CONSTRAINT photo_verifications_profile_photo_url_not_blank
  CHECK (NULLIF(btrim(profile_photo_url), '') IS NOT NULL) NOT VALID;

ALTER TABLE public.photo_verifications
  ADD CONSTRAINT photo_verifications_client_confidence_score_range
  CHECK (
    client_confidence_score IS NULL
    OR client_confidence_score BETWEEN 0 AND 100
  ) NOT VALID;

ALTER TABLE public.photo_verifications
  ADD CONSTRAINT photo_verifications_pending_review_fields_null
  CHECK (
    status <> 'pending'
    OR (
      reviewed_by IS NULL
      AND reviewed_at IS NULL
      AND rejection_reason IS NULL
    )
  ) NOT VALID;

ALTER TABLE public.photo_verifications
  ADD CONSTRAINT photo_verifications_final_review_metadata_present
  CHECK (
    status = 'pending'
    OR (
      reviewed_by IS NOT NULL
      AND reviewed_at IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE public.photo_verifications
  ADD CONSTRAINT photo_verifications_rejected_reason_not_blank
  CHECK (
    status <> 'rejected'
    OR NULLIF(btrim(COALESCE(rejection_reason, '')), '') IS NOT NULL
  ) NOT VALID;

ALTER TABLE public.photo_verifications VALIDATE CONSTRAINT photo_verifications_status_check;
ALTER TABLE public.photo_verifications VALIDATE CONSTRAINT photo_verifications_selfie_url_not_blank;
ALTER TABLE public.photo_verifications VALIDATE CONSTRAINT photo_verifications_profile_photo_url_not_blank;
ALTER TABLE public.photo_verifications VALIDATE CONSTRAINT photo_verifications_client_confidence_score_range;
ALTER TABLE public.photo_verifications VALIDATE CONSTRAINT photo_verifications_pending_review_fields_null;
ALTER TABLE public.photo_verifications VALIDATE CONSTRAINT photo_verifications_final_review_metadata_present;
ALTER TABLE public.photo_verifications VALIDATE CONSTRAINT photo_verifications_rejected_reason_not_blank;

WITH ranked_pending AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY created_at DESC, id DESC
    ) AS pending_rank
  FROM public.photo_verifications
  WHERE status = 'pending'
)
DELETE FROM public.photo_verifications pv
USING ranked_pending rp
WHERE pv.id = rp.id
  AND rp.pending_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_verifications_one_pending_per_user
  ON public.photo_verifications (user_id)
  WHERE status = 'pending';

DROP POLICY IF EXISTS "Users can submit verifications" ON public.photo_verifications;
DROP POLICY IF EXISTS "Users can submit pending verifications" ON public.photo_verifications;

CREATE POLICY "Users can submit pending verifications"
  ON public.photo_verifications
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND rejection_reason IS NULL
    AND NULLIF(btrim(selfie_url), '') IS NOT NULL
    AND NULLIF(btrim(profile_photo_url), '') IS NOT NULL
    AND (
      client_confidence_score IS NULL
      OR client_confidence_score BETWEEN 0 AND 100
    )
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'photo_verifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.photo_verifications;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_photo_verifications(
  p_status text,
  p_reviewed_since timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_status text := lower(COALESCE(NULLIF(btrim(p_status), ''), 'pending'));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  IF v_status NOT IN ('pending', 'approved', 'rejected') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Photo verification status is invalid.');
  END IF;

  WITH verification_rows AS (
    SELECT
      pv.id,
      pv.user_id,
      pv.profile_photo_url,
      pv.selfie_url,
      pv.status,
      pv.created_at,
      pv.reviewed_at,
      pv.client_confidence_score,
      pv.client_match_result,
      pv.rejection_reason,
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'age', p.age,
        'avatar_url', p.avatar_url
      ) AS profile,
      row_number() OVER (
        ORDER BY
          CASE WHEN v_status = 'pending' THEN pv.created_at END ASC NULLS LAST,
          CASE WHEN v_status <> 'pending' THEN pv.reviewed_at END DESC NULLS LAST,
          CASE WHEN v_status <> 'pending' THEN pv.created_at END DESC NULLS LAST,
          pv.id ASC
      ) AS row_order
    FROM public.photo_verifications pv
    LEFT JOIN public.profiles p ON p.id = pv.user_id
    WHERE pv.status = v_status
      AND (
        v_status = 'pending'
        OR p_reviewed_since IS NULL
        OR pv.reviewed_at >= p_reviewed_since
      )
    ORDER BY
      CASE WHEN v_status = 'pending' THEN pv.created_at END ASC NULLS LAST,
      CASE WHEN v_status <> 'pending' THEN pv.reviewed_at END DESC NULLS LAST,
      CASE WHEN v_status <> 'pending' THEN pv.created_at END DESC NULLS LAST,
      pv.id ASC
    LIMIT v_limit
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'user_id', user_id,
        'profile_photo_url', profile_photo_url,
        'selfie_url', selfie_url,
        'status', status,
        'created_at', created_at,
        'reviewed_at', reviewed_at,
        'client_confidence_score', client_confidence_score,
        'client_match_result', client_match_result,
        'rejection_reason', rejection_reason,
        'profile', profile
      )
      ORDER BY row_order
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM verification_rows;

  RETURN public.admin_json_success(jsonb_build_object(
    'rows', v_rows,
    'limit', v_limit
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_photo_verifications(text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_photo_verifications(text, timestamptz, integer) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507170000',
  'Photo Verification admin hardening',
  'schema+policy',
  'Adds constraints and a stricter user insert policy for photo_verifications, collapses duplicate pending submissions before the unique index, enrolls the table in realtime when needed, and replaces the admin list read model to expose reviewed_at and sort reviewed rows by review time.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_list_photo_verifications(text, timestamptz, integer) IS
  'Read-only /kaan photo verification list read model with profile summary and reviewed_at ordering.';
