-- Add new columns to profiles table for complete profile data
-- This migration extends the existing profiles table with all required fields

-- Add birth_date (source of truth for age calculation and zodiac)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birth_date date;

-- Add tagline for profile header (max 30 chars enforced at app level)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tagline text;

-- Add interested_in for dating preferences
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS interested_in text[];

-- Add company for professional info
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company text;

-- Add about_me for bio (max 140 chars enforced at app level)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS about_me text;

-- Add looking_for for relationship intent
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS looking_for text;

-- Add lifestyle as JSONB for complex lifestyle data (drinking, smoking, exercise, diet, pets, children)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS lifestyle jsonb DEFAULT '{}'::jsonb;

-- Add prompts as JSONB for conversation starters
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS prompts jsonb DEFAULT '[]'::jsonb;

-- Add location_data for geocoordinates
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS location_data jsonb;

-- Add video_intro_url for vibe video
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS video_intro_url text;

-- Update any existing age values to birth_date (approximate conversion for existing data)
-- This creates a birth_date based on current age for existing profiles
UPDATE public.profiles 
SET birth_date = (current_date - (age * interval '1 year'))::date
WHERE birth_date IS NULL AND age IS NOT NULL;

-- Rename location column to location_city for clarity if it doesn't exist
-- First check if location exists, if so we'll use it as-is (it's already named location which works)

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.birth_date IS 'Date of birth - source of truth for age and zodiac calculation';
COMMENT ON COLUMN public.profiles.tagline IS 'Profile tagline/slogan - max 30 characters';
COMMENT ON COLUMN public.profiles.interested_in IS 'Dating preferences - array of genders interested in';
COMMENT ON COLUMN public.profiles.about_me IS 'Bio/about me section - max 140 characters';
COMMENT ON COLUMN public.profiles.looking_for IS 'Relationship intent: long-term, relationship, something-casual, new-friends, figuring-out';
COMMENT ON COLUMN public.profiles.lifestyle IS 'JSONB containing: drinking, smoking, exercise, diet, pets, children';
COMMENT ON COLUMN public.profiles.prompts IS 'JSONB array of conversation starters: [{question, answer}]';
COMMENT ON COLUMN public.profiles.location_data IS 'JSONB containing: {lat, lng} for geocoordinates';
COMMENT ON COLUMN public.profiles.video_intro_url IS 'URL to vibe intro video';