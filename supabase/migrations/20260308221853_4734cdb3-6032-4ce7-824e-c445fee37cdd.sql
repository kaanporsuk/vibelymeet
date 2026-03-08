
CREATE OR REPLACE FUNCTION public.check_age_requirement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.birth_date IS NOT NULL AND
     EXTRACT(YEAR FROM AGE(NEW.birth_date)) < 18 THEN
    RAISE EXCEPTION 'User must be 18 or older';
  END IF;
  RETURN NEW;
END;
$$;
