
-- Age gate blocks table (written by service role only)
CREATE TABLE IF NOT EXISTS public.age_gate_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  date_of_birth date,
  blocked_at timestamptz DEFAULT now()
);

ALTER TABLE public.age_gate_blocks ENABLE ROW LEVEL SECURITY;

-- Only service role can access this table
CREATE POLICY "Service role manages age gate blocks"
  ON public.age_gate_blocks
  FOR ALL USING (auth.role() = 'service_role');

-- Trigger to enforce 18+ age requirement on profiles
CREATE OR REPLACE FUNCTION public.check_age_requirement()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.birth_date IS NOT NULL AND
     EXTRACT(YEAR FROM AGE(NEW.birth_date)) < 18 THEN
    RAISE EXCEPTION 'User must be 18 or older';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_age_requirement
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.check_age_requirement();
