
-- Drop any existing category CHECK constraint
ALTER TABLE vibe_tags DROP CONSTRAINT IF EXISTS vibe_tags_category_check;

-- Clean up orphaned profile_vibes before deleting tags
DELETE FROM profile_vibes WHERE vibe_tag_id IN (SELECT id FROM vibe_tags);

-- Clear existing vibe_tags
DELETE FROM vibe_tags;

-- Insert ENERGY tags
INSERT INTO vibe_tags (label, emoji, category) VALUES
  ('Playful', '😄', 'energy'),
  ('Deep Talker', '💬', 'energy'),
  ('Witty', '⚡', 'energy'),
  ('Warm', '🤗', 'energy'),
  ('Bold', '🔥', 'energy'),
  ('Calm', '🌊', 'energy'),
  ('Flirty', '😏', 'energy'),
  ('Curious', '🔍', 'energy');

-- Insert SOCIAL STYLE tags
INSERT INTO vibe_tags (label, emoji, category) VALUES
  ('Spontaneous', '🎲', 'social_style'),
  ('Planner', '📅', 'social_style'),
  ('One-on-One', '🫂', 'social_style'),
  ('Social Butterfly', '🦋', 'social_style'),
  ('Night Owl', '🦉', 'social_style'),
  ('Slow Burner', '🕯️', 'social_style'),
  ('Voice-Note Person', '🎙️', 'social_style'),
  ('Comfortable on Video', '📹', 'social_style');

-- Insert SHARED SCENES tags
INSERT INTO vibe_tags (label, emoji, category) VALUES
  ('Live Music', '🎵', 'shared_scenes'),
  ('Foodie', '🍜', 'shared_scenes'),
  ('Artsy', '🎨', 'shared_scenes'),
  ('Outdoorsy', '🌿', 'shared_scenes'),
  ('Fitness', '💪', 'shared_scenes'),
  ('Bookworm', '📚', 'shared_scenes'),
  ('Film Buff', '🎬', 'shared_scenes'),
  ('Traveler', '✈️', 'shared_scenes');

-- Clean any remaining orphaned profile_vibes
DELETE FROM profile_vibes WHERE vibe_tag_id NOT IN (SELECT id FROM vibe_tags);

-- Add category constraint
ALTER TABLE vibe_tags ADD CONSTRAINT vibe_tags_category_check 
  CHECK (category IN ('energy', 'social_style', 'shared_scenes'));
