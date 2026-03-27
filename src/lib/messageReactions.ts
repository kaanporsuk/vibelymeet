import { supabase } from "@/integrations/supabase/client";
import type { ReactionEmoji } from "../../shared/chat/messageReactionModel";

export async function setMessageReaction(params: {
  matchId: string;
  messageId: string;
  emoji: ReactionEmoji | null;
}): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  if (params.emoji === null) {
    const { error } = await supabase
      .from("message_reactions")
      .delete()
      .eq("message_id", params.messageId)
      .eq("profile_id", user.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("message_reactions").upsert(
    {
      match_id: params.matchId,
      message_id: params.messageId,
      profile_id: user.id,
      emoji: params.emoji,
    },
    { onConflict: "message_id,profile_id" },
  );
  if (error) throw error;
}
