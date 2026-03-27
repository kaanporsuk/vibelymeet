-- Shared message reactions (1:1 matches; one emoji per participant per message).
-- Used by web + native for text bubbles and Vibe Clips; extensible to other kinds.

CREATE TABLE public.message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_reactions_emoji_allowed CHECK (
    emoji IN ('❤️', '🔥', '🤣', '😮', '👎')
  ),
  CONSTRAINT message_reactions_message_profile_unique UNIQUE (message_id, profile_id)
);

CREATE INDEX message_reactions_match_id_idx ON public.message_reactions (match_id);
CREATE INDEX message_reactions_message_id_idx ON public.message_reactions (message_id);

CREATE OR REPLACE FUNCTION public.message_reactions_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match uuid;
BEGIN
  IF TG_OP = 'INSERT'
     OR (TG_OP = 'UPDATE' AND (
       NEW.message_id IS DISTINCT FROM OLD.message_id
       OR NEW.match_id IS DISTINCT FROM OLD.match_id
     ))
  THEN
    SELECT m.match_id INTO v_match FROM public.messages m WHERE m.id = NEW.message_id;
    IF v_match IS NULL THEN
      RAISE EXCEPTION 'message not found';
    END IF;
    IF NEW.match_id IS DISTINCT FROM v_match THEN
      RAISE EXCEPTION 'match_id does not match message';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_message_reactions_before_write
  BEFORE INSERT OR UPDATE ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.message_reactions_before_write();

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view reactions in own matches"
  ON public.message_reactions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.matches mt
      WHERE mt.id = message_reactions.match_id
        AND (auth.uid() = mt.profile_id_1 OR auth.uid() = mt.profile_id_2)
    )
  );

CREATE POLICY "Users can insert own reactions in own matches"
  ON public.message_reactions
  FOR INSERT
  WITH CHECK (
    auth.uid() = profile_id
    AND EXISTS (
      SELECT 1
      FROM public.matches mt
      WHERE mt.id = message_reactions.match_id
        AND (auth.uid() = mt.profile_id_1 OR auth.uid() = mt.profile_id_2)
    )
  );

CREATE POLICY "Users can update own reactions"
  ON public.message_reactions
  FOR UPDATE
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can delete own reactions"
  ON public.message_reactions
  FOR DELETE
  USING (auth.uid() = profile_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;

COMMENT ON TABLE public.message_reactions IS
  'Per-user emoji reactions on chat messages; match_id denormalized for RLS and Realtime filters.';
