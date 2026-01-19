-- Add new event fields for enhanced admin management
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS vibes text[] DEFAULT ARRAY[]::text[];
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS max_male_attendees integer DEFAULT NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS max_female_attendees integer DEFAULT NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS max_nonbinary_attendees integer DEFAULT NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS is_location_specific boolean DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS location_name text DEFAULT NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS location_address text DEFAULT NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS visibility text DEFAULT 'all' CHECK (visibility IN ('all', 'premium', 'vip'));
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS price_amount decimal(10,2) DEFAULT 0;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS price_currency text DEFAULT 'EUR' CHECK (price_currency IN ('EUR', 'USD', 'GBP', 'PLN'));
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS is_free boolean DEFAULT true;

-- Add attendance tracking fields to event_registrations
ALTER TABLE public.event_registrations ADD COLUMN IF NOT EXISTS attendance_marked boolean DEFAULT false;
ALTER TABLE public.event_registrations ADD COLUMN IF NOT EXISTS attendance_marked_at timestamp with time zone DEFAULT NULL;
ALTER TABLE public.event_registrations ADD COLUMN IF NOT EXISTS attendance_marked_by uuid DEFAULT NULL;