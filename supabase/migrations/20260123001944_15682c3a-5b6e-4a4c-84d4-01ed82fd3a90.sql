-- Create 'event-covers' storage bucket for event images
INSERT INTO storage.buckets (id, name, public) VALUES ('event-covers', 'event-covers', true)
ON CONFLICT (id) DO NOTHING;

-- Allow admins to upload event covers
CREATE POLICY "Admins can upload event covers"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'event-covers' AND
  public.has_role(auth.uid(), 'admin')
);

-- Allow admins to update event covers
CREATE POLICY "Admins can update event covers"
ON storage.objects
FOR UPDATE
TO public
USING (
  bucket_id = 'event-covers' AND
  public.has_role(auth.uid(), 'admin')
);

-- Allow admins to delete event covers
CREATE POLICY "Admins can delete event covers"
ON storage.objects
FOR DELETE
TO public
USING (
  bucket_id = 'event-covers' AND
  public.has_role(auth.uid(), 'admin')
);

-- Allow anyone to view event covers (public bucket)
CREATE POLICY "Anyone can view event covers"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'event-covers');