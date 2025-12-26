-- Drop the overly permissive public policy
DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;

-- Create a new policy that requires authentication to view profiles
CREATE POLICY "Authenticated users can view profiles" ON public.profiles
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );