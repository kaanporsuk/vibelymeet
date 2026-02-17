
-- Make profile-photos bucket public so getPublicUrl works reliably
UPDATE storage.buckets SET public = true WHERE id = 'profile-photos';
