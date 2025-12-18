-- Create vibe_tags master table
CREATE TABLE public.vibe_tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  emoji TEXT NOT NULL,
  category TEXT DEFAULT 'lifestyle',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  age INTEGER NOT NULL CHECK (age >= 18 AND age <= 99),
  gender TEXT NOT NULL,
  job TEXT,
  height_cm INTEGER CHECK (height_cm >= 100 AND height_cm <= 250),
  location TEXT,
  bio TEXT,
  avatar_url TEXT,
  photos TEXT[] DEFAULT '{}',
  events_attended INTEGER DEFAULT 0,
  total_matches INTEGER DEFAULT 0,
  total_conversations INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create profile_vibes junction table
CREATE TABLE public.profile_vibes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  vibe_tag_id UUID NOT NULL REFERENCES public.vibe_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(profile_id, vibe_tag_id)
);

-- Create events table
CREATE TABLE public.events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  cover_image TEXT NOT NULL,
  event_date TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER DEFAULT 60,
  max_attendees INTEGER DEFAULT 50,
  current_attendees INTEGER DEFAULT 0,
  tags TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'completed', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create event_registrations table
CREATE TABLE public.event_registrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  registered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  attended BOOLEAN DEFAULT false,
  UNIQUE(event_id, profile_id)
);

-- Create matches table (mutual matches from video dates)
CREATE TABLE public.matches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id_1 UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  profile_id_2 UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  matched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_message_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(profile_id_1, profile_id_2),
  CHECK (profile_id_1 < profile_id_2)
);

-- Create messages table
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create video_sessions table for tracking video dates
CREATE TABLE public.video_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  participant_1_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  participant_2_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ended_at TIMESTAMP WITH TIME ZONE,
  participant_1_liked BOOLEAN,
  participant_2_liked BOOLEAN,
  duration_seconds INTEGER
);

-- Enable RLS on all tables
ALTER TABLE public.vibe_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_vibes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for vibe_tags (public read)
CREATE POLICY "Anyone can view vibe tags" ON public.vibe_tags
  FOR SELECT USING (true);

-- RLS Policies for profiles
CREATE POLICY "Anyone can view profiles" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- RLS Policies for profile_vibes
CREATE POLICY "Anyone can view profile vibes" ON public.profile_vibes
  FOR SELECT USING (true);

CREATE POLICY "Users can manage own vibes" ON public.profile_vibes
  FOR INSERT WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can delete own vibes" ON public.profile_vibes
  FOR DELETE USING (auth.uid() = profile_id);

-- RLS Policies for events (public read)
CREATE POLICY "Anyone can view events" ON public.events
  FOR SELECT USING (true);

-- RLS Policies for event_registrations
CREATE POLICY "Anyone can view registrations" ON public.event_registrations
  FOR SELECT USING (true);

CREATE POLICY "Users can register for events" ON public.event_registrations
  FOR INSERT WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can unregister from events" ON public.event_registrations
  FOR DELETE USING (auth.uid() = profile_id);

-- RLS Policies for matches
CREATE POLICY "Users can view own matches" ON public.matches
  FOR SELECT USING (auth.uid() = profile_id_1 OR auth.uid() = profile_id_2);

-- RLS Policies for messages
CREATE POLICY "Users can view messages in their matches" ON public.messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.matches m 
      WHERE m.id = match_id 
      AND (m.profile_id_1 = auth.uid() OR m.profile_id_2 = auth.uid())
    )
  );

CREATE POLICY "Users can send messages in their matches" ON public.messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM public.matches m 
      WHERE m.id = match_id 
      AND (m.profile_id_1 = auth.uid() OR m.profile_id_2 = auth.uid())
    )
  );

-- RLS Policies for video_sessions
CREATE POLICY "Participants can view own sessions" ON public.video_sessions
  FOR SELECT USING (auth.uid() = participant_1_id OR auth.uid() = participant_2_id);

CREATE POLICY "Participants can update own feedback" ON public.video_sessions
  FOR UPDATE USING (auth.uid() = participant_1_id OR auth.uid() = participant_2_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Add triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function to update match last_message_at
CREATE OR REPLACE FUNCTION public.update_match_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.matches SET last_message_at = NEW.created_at WHERE id = NEW.match_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER on_message_created
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.update_match_last_message();

-- Function to update event attendee count
CREATE OR REPLACE FUNCTION public.update_event_attendees()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.events SET current_attendees = current_attendees + 1 WHERE id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.events SET current_attendees = current_attendees - 1 WHERE id = OLD.event_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER on_registration_change
  AFTER INSERT OR DELETE ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public.update_event_attendees();

-- SEED DATA: Vibe Tags
INSERT INTO public.vibe_tags (id, label, emoji, category) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'Foodie', '🍜', 'lifestyle'),
  ('a2222222-2222-2222-2222-222222222222', 'Gamer', '🎮', 'hobby'),
  ('a3333333-3333-3333-3333-333333333333', 'Night Owl', '🦉', 'lifestyle'),
  ('a4444444-4444-4444-4444-444444444444', 'Fitness', '💪', 'lifestyle'),
  ('a5555555-5555-5555-5555-555555555555', 'Creative', '🎨', 'hobby'),
  ('a6666666-6666-6666-6666-666666666666', 'Traveler', '✈️', 'lifestyle'),
  ('a7777777-7777-7777-7777-777777777777', 'Music Lover', '🎵', 'hobby'),
  ('a8888888-8888-8888-8888-888888888888', 'Bookworm', '📚', 'hobby'),
  ('a9999999-9999-9999-9999-999999999999', 'Tech Nerd', '💻', 'hobby'),
  ('aa111111-1111-1111-1111-111111111111', 'Nature', '🌿', 'lifestyle'),
  ('aa222222-2222-2222-2222-222222222222', 'Film Buff', '🎬', 'hobby'),
  ('aa333333-3333-3333-3333-333333333333', 'Coffee Addict', '☕', 'lifestyle');

-- SEED DATA: Sample Profiles (demo users without auth)
INSERT INTO public.profiles (id, name, age, gender, job, height_cm, location, bio, avatar_url, photos, events_attended, total_matches, total_conversations) VALUES
  ('b1111111-1111-1111-1111-111111111111', 'Emma', 26, 'woman', 'Marketing Manager', 168, 'Brooklyn, NY', 'Marketing by day, dancing queen by night. Looking for someone who can keep up with my spontaneous adventures and appreciate a good brunch spot.', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400', ARRAY['https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400'], 5, 8, 4),
  ('b2222222-2222-2222-2222-222222222222', 'Alex', 28, 'man', 'Software Engineer', 183, 'Manhattan, NY', 'Building apps and building connections. Weekend hiker, weekday coder. My ideal date involves good coffee and even better conversation.', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400', ARRAY['https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400'], 7, 12, 6),
  ('b3333333-3333-3333-3333-333333333333', 'Sofia', 24, 'woman', 'Graphic Designer', 165, 'Queens, NY', 'Creating beautiful things and chasing sunsets. Art museum dates are my love language. Let''s get lost in a gallery together.', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400', ARRAY['https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400'], 3, 5, 2),
  ('b4444444-4444-4444-4444-444444444444', 'Jordan', 27, 'non-binary', 'Personal Trainer', 178, 'Williamsburg, NY', 'Living for those endorphin highs and mountain views. Looking for a workout buddy who can also debate the best hiking trails over dinner.', 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=400', ARRAY['https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=400'], 6, 9, 5),
  ('b5555555-5555-5555-5555-555555555555', 'Taylor', 25, 'woman', 'Food Blogger', 170, 'SoHo, NY', 'Professional taste-tester (yes, that''s a thing). I''ve eaten my way through 30 countries and counting. Swipe right if you know the best hidden gems.', 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400', ARRAY['https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400'], 4, 6, 3);

-- SEED DATA: Profile Vibes
INSERT INTO public.profile_vibes (profile_id, vibe_tag_id) VALUES
  ('b1111111-1111-1111-1111-111111111111', 'a7777777-7777-7777-7777-777777777777'),
  ('b1111111-1111-1111-1111-111111111111', 'a6666666-6666-6666-6666-666666666666'),
  ('b1111111-1111-1111-1111-111111111111', 'a3333333-3333-3333-3333-333333333333'),
  ('b2222222-2222-2222-2222-222222222222', 'a9999999-9999-9999-9999-999999999999'),
  ('b2222222-2222-2222-2222-222222222222', 'aa333333-3333-3333-3333-333333333333'),
  ('b2222222-2222-2222-2222-222222222222', 'a4444444-4444-4444-4444-444444444444'),
  ('b3333333-3333-3333-3333-333333333333', 'a5555555-5555-5555-5555-555555555555'),
  ('b3333333-3333-3333-3333-333333333333', 'a7777777-7777-7777-7777-777777777777'),
  ('b3333333-3333-3333-3333-333333333333', 'aa222222-2222-2222-2222-222222222222'),
  ('b4444444-4444-4444-4444-444444444444', 'a4444444-4444-4444-4444-444444444444'),
  ('b4444444-4444-4444-4444-444444444444', 'aa111111-1111-1111-1111-111111111111'),
  ('b4444444-4444-4444-4444-444444444444', 'a6666666-6666-6666-6666-666666666666'),
  ('b5555555-5555-5555-5555-555555555555', 'a1111111-1111-1111-1111-111111111111'),
  ('b5555555-5555-5555-5555-555555555555', 'a6666666-6666-6666-6666-666666666666'),
  ('b5555555-5555-5555-5555-555555555555', 'aa333333-3333-3333-3333-333333333333');

-- SEED DATA: Events
INSERT INTO public.events (id, title, description, cover_image, event_date, duration_minutes, max_attendees, current_attendees, tags, status) VALUES
  ('c1111111-1111-1111-1111-111111111111', '90s Music Lovers Night', 'Relive the golden era of music! Join fellow 90s enthusiasts for speed dating while the best hits play in the background.', 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600', NOW() + INTERVAL '1 day', 90, 30, 24, ARRAY['Music', 'Retro'], 'upcoming'),
  ('c2222222-2222-2222-2222-222222222222', 'Tech Professionals Mixer', 'Connect with fellow tech enthusiasts. Whether you''re into startups, AI, or just love a good code review meme.', 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=600', NOW() + INTERVAL '3 days', 60, 40, 18, ARRAY['Tech', 'Networking'], 'upcoming'),
  ('c3333333-3333-3333-3333-333333333333', 'Foodies Unite', 'For those who speak fluent foodie. Discuss your favorite restaurants, hidden gems, and controversial hot takes on pineapple pizza.', 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600', NOW() + INTERVAL '5 days', 75, 25, 32, ARRAY['Food', 'Wine'], 'upcoming'),
  ('c4444444-4444-4444-4444-444444444444', 'Adventure Seekers', 'Calling all adrenaline junkies! Share your craziest travel stories and find someone to explore with.', 'https://images.unsplash.com/photo-1533130061792-64b345e4a833?w=600', NOW() + INTERVAL '7 days', 60, 35, 16, ARRAY['Travel', 'Adventure'], 'upcoming'),
  ('c5555555-5555-5555-5555-555555555555', 'Book Club Singles', 'For those who''d rather read than swipe. Discuss your favorite books and find someone who appreciates a quiet night in.', 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=600', NOW() + INTERVAL '9 days', 60, 20, 12, ARRAY['Books', 'Intellectual'], 'upcoming'),
  ('c6666666-6666-6666-6666-666666666666', 'Fitness & Wellness', 'Active lifestyle? Same. Find your gym buddy, hiking partner, or yoga companion.', 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=600', NOW() + INTERVAL '12 days', 45, 30, 20, ARRAY['Fitness', 'Wellness'], 'upcoming');

-- SEED DATA: Event Registrations
INSERT INTO public.event_registrations (event_id, profile_id) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111'),
  ('c1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222'),
  ('c1111111-1111-1111-1111-111111111111', 'b3333333-3333-3333-3333-333333333333'),
  ('c2222222-2222-2222-2222-222222222222', 'b2222222-2222-2222-2222-222222222222'),
  ('c3333333-3333-3333-3333-333333333333', 'b5555555-5555-5555-5555-555555555555'),
  ('c4444444-4444-4444-4444-444444444444', 'b4444444-4444-4444-4444-444444444444');

-- SEED DATA: Matches (pre-existing matches)
INSERT INTO public.matches (id, profile_id_1, profile_id_2, event_id, matched_at, last_message_at) VALUES
  ('d1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', 'c1111111-1111-1111-1111-111111111111', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '5 minutes'),
  ('d2222222-2222-2222-2222-222222222222', 'b1111111-1111-1111-1111-111111111111', 'b3333333-3333-3333-3333-333333333333', 'c1111111-1111-1111-1111-111111111111', NOW() - INTERVAL '1 day', NOW() - INTERVAL '3 hours'),
  ('d3333333-3333-3333-3333-333333333333', 'b2222222-2222-2222-2222-222222222222', 'b4444444-4444-4444-4444-444444444444', 'c2222222-2222-2222-2222-222222222222', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day'),
  ('d4444444-4444-4444-4444-444444444444', 'b3333333-3333-3333-3333-333333333333', 'b5555555-5555-5555-5555-555555555555', 'c3333333-3333-3333-3333-333333333333', NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 days');

-- SEED DATA: Messages
INSERT INTO public.messages (match_id, sender_id, content, created_at, read_at) VALUES
  ('d1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'Hey! It was so nice meeting you at the 90s night event! 🎶', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '55 minutes'),
  ('d1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', 'Same here! I loved your music taste, you really know your 90s hits!', NOW() - INTERVAL '50 minutes', NOW() - INTERVAL '45 minutes'),
  ('d1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'Haha thanks! The Backstreet Boys will always be my guilty pleasure 😅', NOW() - INTERVAL '40 minutes', NOW() - INTERVAL '35 minutes'),
  ('d1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', 'No judgment here! Would you want to grab coffee sometime?', NOW() - INTERVAL '5 minutes', NULL),
  ('d2222222-2222-2222-2222-222222222222', 'b3333333-3333-3333-3333-333333333333', 'Your design portfolio is incredible! Love your style 🎨', NOW() - INTERVAL '4 hours', NOW() - INTERVAL '3 hours'),
  ('d2222222-2222-2222-2222-222222222222', 'b1111111-1111-1111-1111-111111111111', 'Thank you so much! Your art gallery recommendation was spot on', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '2 hours');

-- Enable realtime for tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;