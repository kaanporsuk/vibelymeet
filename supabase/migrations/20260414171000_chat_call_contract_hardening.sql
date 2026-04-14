-- Harden chat/call write ownership:
-- - message creation now flows through send-message (service role / security definer surfaces)
-- - match_call creation flows through daily-room
-- - match_call lifecycle changes flow through match_call_transition
--
-- Keep message DELETE policy in place for existing block/unmatch cleanup paths.

DROP POLICY IF EXISTS "Users can send valid messages in own matches" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages in own matches" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages in their matches" ON public.messages;
DROP POLICY IF EXISTS "Users can update own messages" ON public.messages;

DROP POLICY IF EXISTS "Users can insert calls for their matches" ON public.match_calls;
DROP POLICY IF EXISTS "Users can update their own calls" ON public.match_calls;

COMMENT ON TABLE public.match_calls IS
  'Chat voice/video call rows. Created via daily-room; lifecycle transitions must use match_call_transition.';
