-- Extend the chat reaction allowlist for the refreshed picker set.
-- Adds 😍 (interest), 👍 (agreement), and 🥺 (soft aww) to the allowed reaction emojis.
-- 👎 is intentionally KEPT in the allowlist so any reactions stored before it was retired
-- from the web/native pickers remain valid and continue to display. The pickers
-- (src/components/chat/EmojiBar.tsx, apps/mobile/components/chat/ReactionPicker.tsx) no
-- longer offer 👎, but the database still accepts it for backward compatibility.
--
-- Non-destructive: the new set is a strict superset of the previous five, so every
-- existing row satisfies the new CHECK and no data is touched. Keep in sync with the
-- canonical allowlist in shared/chat/messageReactionModel.ts.

ALTER TABLE public.message_reactions
  DROP CONSTRAINT IF EXISTS message_reactions_emoji_allowed;

ALTER TABLE public.message_reactions
  ADD CONSTRAINT message_reactions_emoji_allowed CHECK (
    emoji IN ('❤️', '😍', '🔥', '🤣', '😮', '👍', '🥺', '👎')
  );
