-- Make profile-photos bucket private
UPDATE storage.buckets SET public = false WHERE id = 'profile-photos';

-- Drop the existing permissive policy
DROP POLICY IF EXISTS "Anyone can view profile photos" ON storage.objects;

-- Create helper function to check photo access (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.can_view_profile_photo(photo_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    -- Own photos
    auth.uid() = photo_owner_id
    OR
    -- Matched users
    EXISTS (
      SELECT 1 FROM public.matches
      WHERE (profile_id_1 = auth.uid() AND profile_id_2 = photo_owner_id)
         OR (profile_id_2 = auth.uid() AND profile_id_1 = photo_owner_id)
    )
    OR
    -- Event co-attendees
    EXISTS (
      SELECT 1 FROM public.event_registrations er1
      JOIN public.event_registrations er2 ON er1.event_id = er2.event_id
      WHERE er1.profile_id = auth.uid()
        AND er2.profile_id = photo_owner_id
    )
$$;

-- Policy: Users can view photos they have access to
CREATE POLICY "Users can view accessible profile photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'profile-photos'
  AND public.can_view_profile_photo((storage.foldername(name))[1]::uuid)
);

-- Keep existing upload/update/delete policies (users can manage own photos)