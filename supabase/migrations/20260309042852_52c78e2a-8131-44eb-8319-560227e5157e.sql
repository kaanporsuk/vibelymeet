
-- Drop old table and function
DROP TABLE IF EXISTS public.daily_drops CASCADE;
DROP FUNCTION IF EXISTS public.get_daily_drop_candidates CASCADE;

-- Create new daily_drops table
CREATE TABLE public.daily_drops (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_a_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  CHECK (user_a_id < user_b_id),
  drop_date DATE NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active_unopened' CHECK (status IN (
    'active_unopened', 'active_viewed', 'active_opener_sent',
    'matched', 'passed', 'expired_no_action', 'expired_no_reply', 'invalidated'
  )),
  user_a_viewed BOOLEAN DEFAULT false,
  user_b_viewed BOOLEAN DEFAULT false,
  opener_sender_id UUID REFERENCES auth.users(id),
  opener_text TEXT CHECK (char_length(opener_text) <= 140),
  opener_sent_at TIMESTAMPTZ,
  reply_sender_id UUID REFERENCES auth.users(id),
  reply_text TEXT,
  reply_sent_at TIMESTAMPTZ,
  chat_unlocked BOOLEAN DEFAULT false,
  match_id UUID REFERENCES public.matches(id),
  passed_by_user_id UUID REFERENCES auth.users(id),
  pick_reasons JSONB DEFAULT '[]',
  affinity_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_a_id, drop_date),
  UNIQUE(user_b_id, drop_date)
);

ALTER TABLE public.daily_drops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own drops"
ON public.daily_drops FOR SELECT TO authenticated
USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

CREATE POLICY "Users can update own drop interactions"
ON public.daily_drops FOR UPDATE TO authenticated
USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

CREATE POLICY "Admins can view all drops"
ON public.daily_drops FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Cooldowns table
CREATE TABLE IF NOT EXISTS public.daily_drop_cooldowns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_a_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  CHECK (user_a_id < user_b_id),
  cooldown_until DATE NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('no_action', 'viewed_no_opener', 'no_reply', 'passed', 'matched')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_a_id, user_b_id)
);

ALTER TABLE public.daily_drop_cooldowns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage cooldowns"
ON public.daily_drop_cooldowns FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_daily_drops_user_a ON public.daily_drops(user_a_id, drop_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_drops_user_b ON public.daily_drops(user_b_id, drop_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_drops_status ON public.daily_drops(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_daily_drop_cooldowns_pair ON public.daily_drop_cooldowns(user_a_id, user_b_id);
