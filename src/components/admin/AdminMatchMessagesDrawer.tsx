import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  X,
  MessageSquare,
  ChevronRight,
  ArrowLeft,
  User,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { format } from "date-fns";
import { avatarUrl as avatarPreset } from "@/utils/imageUrl";
import { callAdminRpc, type AdminRpcPayload } from "@/lib/adminRpc";

interface AdminMatchMessagesDrawerProps {
  userId: string;
  userName: string;
  isOpen: boolean;
  onClose: () => void;
}

interface Match {
  id: string;
  profile_id_1: string;
  profile_id_2: string;
  matched_at: string;
  last_message_at: string | null;
  archived_at: string | null;
  message_count?: number | null;
  other_user?: MatchProfile | null;
}

interface Message {
  id: string;
  content: string;
  sender_id: string;
  created_at: string;
  read_at: string | null;
}

interface MatchProfile {
  id: string;
  name: string | null;
  avatar_url: string | null;
  photos: string[] | null;
  age: number | null;
  gender: string | null;
  avatarUrl: string | null;
}

type MatchThreadsPayload = AdminRpcPayload & {
  matches?: Array<Omit<Match, "other_user"> & {
    other_user?: Omit<MatchProfile, "avatarUrl"> | null;
  }>;
  total_matches?: number;
};

type MatchThreadMessagesPayload = AdminRpcPayload & {
  messages?: Message[];
};

const AdminMatchMessagesDrawer = ({
  userId,
  userName,
  isOpen,
  onClose,
}: AdminMatchMessagesDrawerProps) => {
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [selectedOtherUser, setSelectedOtherUser] = useState<MatchProfile | null>(null);

  const { data: matchThreadData, isLoading: matchesLoading, isError: matchesError } = useQuery({
    queryKey: ["admin-user-match-threads", userId],
    queryFn: async () => {
      const payload = await callAdminRpc<MatchThreadsPayload>("admin_get_user_match_threads", {
        p_user_id: userId,
        p_limit: 200,
      });

      const matches = (payload.matches ?? []).map((match) => {
        const otherUser = match.other_user
          ? {
              ...match.other_user,
              avatarUrl: avatarPreset(match.other_user.avatar_url || match.other_user.photos?.[0] || null),
            }
          : null;

        return {
          ...match,
          other_user: otherUser,
        };
      });

      return {
        matches,
        totalMatches: Number(payload.total_matches ?? matches.length),
      };
    },
    enabled: isOpen,
  });

  const matches = matchThreadData?.matches ?? [];
  const totalMatches = matchThreadData?.totalMatches ?? matches.length;

  const { data: messages, isLoading: messagesLoading, isError: messagesError } = useQuery({
    queryKey: ["admin-match-thread-messages", userId, selectedMatchId],
    queryFn: async () => {
      if (!selectedMatchId) return [];

      const payload = await callAdminRpc<MatchThreadMessagesPayload>("admin_get_match_thread_messages", {
        p_user_id: userId,
        p_match_id: selectedMatchId,
        p_limit: 500,
      });
      return payload.messages ?? [];
    },
    enabled: isOpen && !!selectedMatchId,
  });

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background z-[60] flex flex-col"
    >
      {/* Header - Fixed */}
      <div className="shrink-0 border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {selectedMatchId && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setSelectedMatchId(null);
                  setSelectedOtherUser(null);
                }}
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
            )}
            <div>
              <h2 className="text-xl font-bold font-display text-foreground">
                {selectedMatchId ? `Chat with ${selectedOtherUser?.name || "User"}` : `${userName}'s Matches`}
              </h2>
              <p className="text-sm text-muted-foreground">
                {selectedMatchId
                  ? messagesError
                    ? "Messages unavailable"
                    : `${messages?.length || 0} messages`
                  : `${totalMatches} total matches`}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto p-4 pb-24">
          {!selectedMatchId ? (
            // Match list view
            <div className="space-y-3">
              {matchesLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-20 bg-secondary/50 rounded-xl animate-pulse" />
                ))
              ) : matchesError ? (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  Match data unavailable.
                </div>
              ) : matches.length === 0 ? (
                <div className="text-center py-16">
                  <MessageSquare className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-lg font-medium text-foreground mb-2">No matches found</p>
                  <p className="text-sm text-muted-foreground">This user doesn't have any matches yet.</p>
                </div>
              ) : (
                matches.map((match, index) => {
                  const otherUser = match.other_user;
                  const msgCount = match.message_count;
                  const msgCountLabel =
                    typeof msgCount === "number" ? `${msgCount} messages` : "Messages unavailable";

                  return (
                    <motion.button
                      key={match.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => {
                        setSelectedMatchId(match.id);
                        setSelectedOtherUser(otherUser ?? null);
                      }}
                      className="w-full glass-card p-4 rounded-xl flex items-center gap-4 text-left"
                    >
                      <Avatar className="h-14 w-14 border-2 border-pink-500/30">
                        <AvatarImage src={otherUser?.avatarUrl || otherUser?.photos?.[0]} />
                        <AvatarFallback className="bg-primary/20 text-primary">
                          {otherUser?.name?.[0] || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium text-foreground truncate">
                            {otherUser?.name || "Unknown"}
                          </p>
                          {otherUser?.age && (
                            <span className="text-sm text-muted-foreground">{otherUser.age}</span>
                          )}
                          {match.archived_at && (
                            <Badge variant="outline" className="text-xs">
                              Archived
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {format(new Date(match.matched_at), "MMM d, yyyy")}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageSquare className="w-3 h-3" />
                            {msgCountLabel}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </motion.button>
                  );
                })
              )}
            </div>
          ) : (
            // Messages view
            <div className="space-y-4">
              {messagesLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : messagesError ? (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  Messages unavailable.
                </div>
              ) : messages?.length === 0 ? (
                <div className="text-center py-16">
                  <MessageSquare className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-lg font-medium text-foreground mb-2">No messages yet</p>
                  <p className="text-sm text-muted-foreground">This conversation is empty.</p>
                </div>
              ) : (
                messages?.map((msg, index) => {
                  const isFromUser = msg.sender_id === userId;
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.02 }}
                      className={`flex ${isFromUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] p-3 rounded-2xl ${
                          isFromUser
                            ? "bg-primary text-primary-foreground rounded-br-sm"
                            : "bg-secondary text-foreground rounded-bl-sm"
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                        <div className={`flex items-center gap-2 mt-1 ${isFromUser ? "justify-end" : "justify-start"}`}>
                          <span className={`text-xs ${isFromUser ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                            {format(new Date(msg.created_at), "MMM d, HH:mm")}
                          </span>
                          {!isFromUser && msg.read_at && (
                            <span className="text-xs text-muted-foreground">• Read</span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer - Fixed */}
      <div className="shrink-0 border-t border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="text-sm text-muted-foreground">
            {selectedMatchId ? (
              messagesError ? (
                <>Messages unavailable</>
              ) : (
                <>
                  <span className="text-foreground font-medium">{messages?.length || 0}</span> messages in this conversation
                </>
              )
            ) : (
              <>
                <span className="text-foreground font-medium">{totalMatches}</span> total matches
              </>
            )}
          </div>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

export default AdminMatchMessagesDrawer;
