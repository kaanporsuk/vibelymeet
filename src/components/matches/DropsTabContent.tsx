import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Droplet, Check, X, Clock, MessageCircle, Send, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MatchCandidate } from '@/types/dailyDrop';
import { calculateVibeScore, getVibeScoreColor } from '@/utils/vibeScoreUtils';

export interface DropMatch {
  id: string;
  candidate: MatchCandidate;
  status: 'sent' | 'received' | 'matched' | 'passed' | 'expired';
  sentAt: string;
  matchedAt?: string;
  hasUnreadMessage?: boolean;
  vibeScore?: number;
}

interface DropsTabContentProps {
  drops: DropMatch[];
  onOpenChat: (matchId: string) => void;
  onViewProfile: (dropId: string) => void;
}

export function DropsTabContent({ drops, onOpenChat, onViewProfile }: DropsTabContentProps) {
  const sentDrops = drops.filter(d => d.status === 'sent');
  const receivedDrops = drops.filter(d => d.status === 'received');
  const matchedDrops = drops.filter(d => d.status === 'matched');
  const passedDrops = drops.filter(d => d.status === 'passed' || d.status === 'expired');

  const getStatusBadge = (status: DropMatch['status']) => {
    switch (status) {
      case 'sent':
        return (
          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            Pending
          </span>
        );
      case 'received':
        return (
          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-neon-cyan/20 text-neon-cyan">
            <Droplet className="w-3 h-3" />
            New Reply
          </span>
        );
      case 'matched':
        return (
          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
            <Check className="w-3 h-3" />
            Matched
          </span>
        );
      case 'passed':
        return (
          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            <X className="w-3 h-3" />
            Passed
          </span>
        );
      case 'expired':
        return (
          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive">
            <Clock className="w-3 h-3" />
            Expired
          </span>
        );
    }
  };

  const renderDropCard = (drop: DropMatch, showActions = false) => {
    // Calculate vibe score if not provided
    const mockUserTags = ['Creative Soul', 'Night Owl', 'Adventure Seeker'];
    const vibeScore = drop.vibeScore ?? calculateVibeScore({
      userTags: mockUserTags,
      candidateTags: drop.candidate.vibeTags,
      candidateLastActiveAt: drop.candidate.lastActiveAt,
      candidateBioLength: drop.candidate.bio?.length || 0
    });
    const scoreColor = getVibeScoreColor(vibeScore);

    return (
      <motion.div
        key={drop.id}
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "p-4 rounded-xl border transition-all",
          drop.status === 'matched' && "bg-gradient-to-br from-primary/10 to-neon-cyan/10 border-primary/30",
          drop.status === 'sent' && "bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/30",
          drop.status === 'received' && "bg-gradient-to-br from-neon-cyan/10 to-primary/10 border-neon-cyan/30",
          (drop.status === 'passed' || drop.status === 'expired') && "bg-muted/50 border-border/50 opacity-60"
        )}
      >
        <div className="flex items-center gap-3">
          {/* Avatar with Vibe Score ring */}
          <div className="relative">
            <img
              src={drop.candidate.avatarUrl}
              alt={drop.candidate.name}
              className={cn(
                "w-14 h-14 rounded-full object-cover border-2",
                drop.status === 'matched' && "border-primary",
                drop.status === 'sent' && "border-amber-500",
                drop.status === 'received' && "border-neon-cyan",
                (drop.status === 'passed' || drop.status === 'expired') && "border-border grayscale"
              )}
            />
            {/* Vibe Score badge */}
            {drop.status !== 'passed' && drop.status !== 'expired' && (
              <motion.span 
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className={cn(
                  "absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-background border-2 border-current flex items-center justify-center text-[10px] font-bold",
                  scoreColor
                )}
              >
                {vibeScore}
              </motion.span>
            )}
            {drop.hasUnreadMessage && (
              <motion.span 
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive flex items-center justify-center"
              >
                <span className="text-[10px] text-destructive-foreground font-bold">!</span>
              </motion.span>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-foreground truncate">
                {drop.candidate.name}, {drop.candidate.age}
              </h4>
              {getStatusBadge(drop.status)}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-sm text-muted-foreground truncate">
                {drop.candidate.location}
              </p>
              {vibeScore >= 70 && (
                <span className="flex items-center gap-0.5 text-xs text-primary">
                  <Sparkles className="w-3 h-3" />
                  Strong match
                </span>
              )}
            </div>
            <div className="flex gap-1 mt-1">
              {drop.candidate.vibeTags.slice(0, 2).map((tag, i) => (
                <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Action */}
          {drop.status === 'matched' && (
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => onOpenChat(drop.id)}
              className="p-3 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
            >
              <MessageCircle className="w-5 h-5" />
            </motion.button>
          )}
        </div>
      </motion.div>
    );
  };

  if (drops.length === 0) {
    return (
      <div className="py-12 text-center">
        <Droplet className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">No Daily Drops Yet</h3>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
          Your daily curated matches and replies will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Matched Drops - Priority */}
      {matchedDrops.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            Matched ({matchedDrops.length})
          </h3>
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {matchedDrops.map(drop => renderDropCard(drop))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Pending Sent */}
      {sentDrops.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Send className="w-4 h-4 text-amber-400" />
            Waiting for Reply ({sentDrops.length})
          </h3>
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {sentDrops.map(drop => renderDropCard(drop))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Received Drops */}
      {receivedDrops.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Droplet className="w-4 h-4 text-neon-cyan" />
            New Replies ({receivedDrops.length})
          </h3>
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {receivedDrops.map(drop => renderDropCard(drop, true))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Passed/Expired - Collapsed */}
      {passedDrops.length > 0 && (
        <details className="group">
          <summary className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2 cursor-pointer list-none">
            <Clock className="w-4 h-4" />
            Past Drops ({passedDrops.length})
            <span className="ml-auto text-xs">tap to view</span>
          </summary>
          <div className="space-y-2 mt-3">
            <AnimatePresence mode="popLayout">
              {passedDrops.map(drop => renderDropCard(drop))}
            </AnimatePresence>
          </div>
        </details>
      )}
    </div>
  );
}
