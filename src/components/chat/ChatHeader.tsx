import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Video,
  MoreVertical,
  BellOff,
  Bell,
  ShieldAlert,
  UserX,
  Flag,
  Archive,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileDetailDrawer } from "@/components/ProfileDetailDrawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { UnmatchDialog } from "@/components/UnmatchDialog";
import { ArchiveMatchDialog } from "@/components/ArchiveMatchDialog";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import ReportWizard from "@/components/safety/ReportWizard";
import { useUndoableUnmatch } from "@/hooks/useUnmatch";
import { useArchiveMatch } from "@/hooks/useArchiveMatch";
import { useBlockUser } from "@/hooks/useBlockUser";
import { useMuteMatch, MuteDuration } from "@/hooks/useMuteMatch";
import { PhotoVerifiedMark } from "@/components/PhotoVerifiedMark";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";

interface ChatUser {
  id: string;
  name: string;
  age: number;
  avatar_url: string;
  vibes: string[];
  isOnline: boolean;
  lastSeen?: string;
  photoVerified?: boolean;
}

interface ChatHeaderProps {
  user: ChatUser;
  isTyping: boolean;
  matchId?: string;
  onBack: () => void;
  onVideoCall: () => void;
  onFocusInput: () => void;
}

export const ChatHeader = ({
  user,
  isTyping,
  matchId,
  onBack,
  onVideoCall,
  onFocusInput,
}: ChatHeaderProps) => {
  const navigate = useNavigate();
  const [showUnmatchDialog, setShowUnmatchDialog] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [showReportSheet, setShowReportSheet] = useState(false);
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);

  const { initiateUnmatch } = useUndoableUnmatch();
  const { archiveMatch, isArchiving } = useArchiveMatch();
  const { blockUser, isBlocking } = useBlockUser();
  const { muteMatch, unmuteMatch, isMatchMuted, getMuteExpiry } = useMuteMatch();

  const isMuted = matchId ? isMatchMuted(matchId) : false;

  const getStatusText = () => {
    if (isTyping) return null;
    if (user.isOnline) return "Online now";
    if (user.lastSeen) return `Last seen ${user.lastSeen}`;
    return "Offline";
  };

  const handleViewProfile = () => {
    setShowProfileDrawer(true);
  };

  const handleMuteNotifications = (duration: MuteDuration) => {
    if (matchId) {
      muteMatch(matchId, user.name, duration);
    }
  };

  const handleUnmuteNotifications = () => {
    if (matchId) {
      unmuteMatch(matchId, user.name);
    }
  };

  const handleArchive = () => {
    if (matchId) {
      archiveMatch(matchId, user.name);
      navigate("/matches");
    }
  };

  const handleBlock = (reason?: string) => {
    blockUser(user.id, user.name, reason);
    setShowBlockDialog(false);
    navigate("/matches");
  };

  const handleUnmatch = () => {
    setShowUnmatchDialog(false);
    
    if (matchId) {
      // Use undoable unmatch with 5-second delay
      initiateUnmatch(matchId, user.name);
    }
    
    // Navigate back immediately - user can undo via toast
    navigate("/matches");
  };

  const handleOpenReport = () => {
    setShowUnmatchDialog(false);
    setShowReportSheet(true);
  };

  const handleReportComplete = () => {
    setShowReportSheet(false);
    toast.success("Report submitted", {
      description: "Our team will review it within 24 hours",
    });
    navigate("/matches");
  };

  const handleVideoCall = () => {
    navigate("/video-date");
  };

  return (
    <>
      <header className="relative z-40 glass-card border-b border-border/50 px-4 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-xl hover:bg-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>

          <ProfileDetailDrawer
            match={{
              id: user.id,
              name: user.name,
              age: user.age,
              image: user.avatar_url,
              vibes: user.vibes,
            }}
            trigger={
              <div className="flex items-center gap-3 flex-1 cursor-pointer hover:opacity-80 transition-opacity">
                <div className="relative">
                  <ProfilePhoto
                    avatarUrl={user.avatar_url}
                    name={user.name}
                    size="sm"
                    rounded="full"
                    loading="eager"
                    className="ring-2 ring-primary/30"
                  />
                  {/* Verified badge */}
                  {user.photoVerified && (
                    <PhotoVerifiedMark verified className="absolute -bottom-0.5 -right-0.5" />
                  )}
                  {/* Online indicator with glow - show in different position if verified */}
                  <AnimatePresence>
                    {user.isOnline && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        className={cn(
                          "absolute w-3 h-3 rounded-full border-2 border-background",
                          user.photoVerified ? "-top-0.5 -right-0.5" : "bottom-0 right-0"
                        )}
                      >
                        <div className="w-full h-full rounded-full bg-green-500 animate-pulse" />
                        <div className="absolute inset-0 rounded-full bg-green-500/50 animate-ping" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h2 className="font-semibold text-foreground truncate">
                      {user.name}, {user.age}
                    </h2>
                    {user.photoVerified && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neon-cyan/20 text-neon-cyan font-medium">
                        Verified
                      </span>
                    )}
                  </div>
                  <div className="h-4 overflow-hidden">
                    <AnimatePresence mode="wait">
                      {isTyping ? (
                        <motion.div
                          key="vibing"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                          className="flex items-center gap-1"
                        >
                          <span className="text-xs font-medium bg-gradient-to-r from-neon-violet to-neon-pink bg-clip-text text-transparent">
                            Vibing...
                          </span>
                          <motion.div className="flex gap-0.5">
                            {[0, 1, 2].map((i) => (
                              <motion.span
                                key={i}
                                className="w-1 h-1 rounded-full bg-neon-violet"
                                animate={{
                                  y: [0, -3, 0],
                                  opacity: [0.5, 1, 0.5],
                                }}
                                transition={{
                                  duration: 0.6,
                                  repeat: Infinity,
                                  delay: i * 0.15,
                                }}
                              />
                            ))}
                          </motion.div>
                        </motion.div>
                      ) : (
                        <motion.p
                          key="status"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                          className={cn(
                            "text-xs",
                            user.isOnline ? "text-green-500" : "text-muted-foreground"
                          )}
                        >
                          {getStatusText()}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            }
            onMessage={onFocusInput}
            onVideoCall={handleVideoCall}
          />

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-xl"
              onClick={handleVideoCall}
            >
              <Video className="w-5 h-5 text-muted-foreground" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-xl">
                  <MoreVertical className="w-5 h-5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={handleViewProfile}>
                  View Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowArchiveDialog(true)}>
                  <Archive className="w-4 h-4 mr-2" />
                  Archive Chat
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    {isMuted ? (
                      <>
                        <Bell className="w-4 h-4 mr-2" />
                        Unmute Notifications
                      </>
                    ) : (
                      <>
                        <BellOff className="w-4 h-4 mr-2" />
                        Mute Notifications
                      </>
                    )}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {isMuted ? (
                      <DropdownMenuItem onClick={handleUnmuteNotifications}>
                        <Bell className="w-4 h-4 mr-2" />
                        Turn on notifications
                      </DropdownMenuItem>
                    ) : (
                      <>
                        <DropdownMenuItem onClick={() => handleMuteNotifications("1hour")}>
                          <Clock className="w-4 h-4 mr-2" />
                          1 hour
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleMuteNotifications("1day")}>
                          <Clock className="w-4 h-4 mr-2" />
                          1 day
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleMuteNotifications("1week")}>
                          <Clock className="w-4 h-4 mr-2" />
                          1 week
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleMuteNotifications("forever")}>
                          <BellOff className="w-4 h-4 mr-2" />
                          Until I turn it back on
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setShowReportSheet(true)}
                  className="text-amber-500 focus:text-amber-500"
                >
                  <Flag className="w-4 h-4 mr-2" />
                  Report {user.name}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setShowBlockDialog(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <ShieldAlert className="w-4 h-4 mr-2" />
                  Block {user.name}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setShowUnmatchDialog(true)}
                >
                  <UserX className="w-4 h-4 mr-2" />
                  Unmatch
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Unmatch Dialog */}
      <UnmatchDialog
        isOpen={showUnmatchDialog}
        onClose={() => setShowUnmatchDialog(false)}
        onConfirm={handleUnmatch}
        onReport={handleOpenReport}
        userName={user.name}
        userAvatar={user.avatar_url}
        isLoading={false}
      />

      {/* Archive Dialog */}
      <ArchiveMatchDialog
        isOpen={showArchiveDialog}
        onClose={() => setShowArchiveDialog(false)}
        onConfirm={handleArchive}
        userName={user.name}
        userAvatar={user.avatar_url}
        isLoading={isArchiving}
      />

      {/* Block Dialog */}
      <BlockUserDialog
        isOpen={showBlockDialog}
        onClose={() => setShowBlockDialog(false)}
        onConfirm={handleBlock}
        userName={user.name}
        userAvatar={user.avatar_url}
        isLoading={isBlocking}
      />
      {/* Report Sheet */}
      <Sheet open={showReportSheet} onOpenChange={setShowReportSheet}>
        <SheetContent side="bottom" className="h-[85vh] p-0 rounded-t-3xl">
          <ReportWizard
            onBack={() => setShowReportSheet(false)}
            onComplete={handleReportComplete}
          />
        </SheetContent>
      </Sheet>
    </>
  );
};
