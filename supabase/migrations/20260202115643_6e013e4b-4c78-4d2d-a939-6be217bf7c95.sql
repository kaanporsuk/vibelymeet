-- Create table for pre-event vibes (interest expressions before events start)
CREATE TABLE public.event_vibes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- Ensure unique vibe per sender/receiver/event combo
  CONSTRAINT unique_event_vibe UNIQUE (event_id, sender_id, receiver_id),
  -- Prevent self-vibes
  CONSTRAINT no_self_vibe CHECK (sender_id != receiver_id)
);

-- Enable RLS
ALTER TABLE public.event_vibes ENABLE ROW LEVEL SECURITY;

-- Users can send vibes to other event attendees
CREATE POLICY "Users can create vibes for events they're registered for"
ON public.event_vibes
FOR INSERT
WITH CHECK (
  auth.uid() = sender_id
  AND is_registered_for_event(auth.uid(), event_id)
  AND is_registered_for_event(receiver_id, event_id)
  AND NOT is_blocked(sender_id, receiver_id)
);

-- Users can view vibes they sent or received
CREATE POLICY "Users can view own vibes"
ON public.event_vibes
FOR SELECT
USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- Users can delete vibes they sent
CREATE POLICY "Users can delete own vibes"
ON public.event_vibes
FOR DELETE
USING (auth.uid() = sender_id);

-- Create index for efficient lookups
CREATE INDEX idx_event_vibes_event_receiver ON public.event_vibes(event_id, receiver_id);
CREATE INDEX idx_event_vibes_event_sender ON public.event_vibes(event_id, sender_id);