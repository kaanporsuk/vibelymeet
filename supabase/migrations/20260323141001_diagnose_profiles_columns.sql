-- Diagnosis: log profiles column names/types (see migration logs / Supabase SQL output).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
    ORDER BY ordinal_position
  LOOP
    RAISE NOTICE 'Column: % — Type: %', r.column_name, r.data_type;
  END LOOP;
END;
$$;
