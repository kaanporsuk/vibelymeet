import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Archive, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useArchiveMatch } from "@/hooks/useArchiveMatch";
import { Match } from "@/hooks/useMatches";
import { ConversationListPreviewLabel } from "@/components/ConversationListPreviewLabel";

interface ArchivedMatchesSectionProps {
  archivedMatches: Match[];
}

export const ArchivedMatchesSection = ({ archivedMatches }: ArchivedMatchesSectionProps) => {
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(false);
  const { unarchiveMatch, isUnarchiving } = useArchiveMatch();

  if (archivedMatches.length === 0) return null;

  return (
    <div className="mx-4 mt-6">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 glass-card rounded-2xl hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
            <Archive className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="text-left">
            <p className="font-medium text-foreground">Archived</p>
            <p className="text-sm text-muted-foreground">
              {archivedMatches.length} conversation{archivedMatches.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-5 h-5 text-muted-foreground" />
        )}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-2 space-y-2">
              {archivedMatches.map((match) => (
                <motion.div
                  key={match.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors"
                >
                  <img
                    src={match.image}
                    alt={match.name}
                    className="w-12 h-12 rounded-full object-cover cursor-pointer"
                    onClick={() => navigate(`/chat/${match.id}`)}
                  />
                  <div 
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => navigate(`/chat/${match.id}`)}
                  >
                    <p className="font-medium text-foreground truncate">
                      {match.name}, {match.age}
                    </p>
                    <p className="text-sm text-muted-foreground min-w-0">
                      <ConversationListPreviewLabel
                        preview={match.conversationPreview}
                        unread={false}
                      />
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 gap-1 text-xs"
                    onClick={() => unarchiveMatch(match.matchId, match.name)}
                    disabled={isUnarchiving}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restore
                  </Button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
