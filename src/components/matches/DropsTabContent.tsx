import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Droplet, Clock, X, Check, Send, MessageCircle, Sparkles, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useDailyDrop } from '@/hooks/useDailyDrop';
import {
  formatCountdownToNextDailyDropBatchUtc,
  DAILY_DROP_REPLY_MAX_LENGTH,
} from '@/lib/dailyDropSchedule';
import { VibeTag } from '@/components/VibeTag';
import { VibeVideoThumbnail } from '@/components/vibe-video/VibeVideoThumbnail';
import { resolvePrimaryProfilePhotoPath } from '../../../shared/profilePhoto/resolvePrimaryProfilePhotoPath';

function formatTimeRemaining(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function DropsTabContent() {
  const navigate = useNavigate();
  const {
    drop, partner, status, iHaveViewed, openerText, openerSentByMe,
    replyText, chatUnlocked, matchId, pickReasons, timeRemaining,
    isExpired, hasDrop, isLoading, pastDrops, generationRanToday,
    markViewed, sendOpener, sendReply, passDrop,
  } = useDailyDrop();

  const [openerInput, setOpenerInput] = useState('');
  const [replyInput, setReplyInput] = useState('');
  const [showPastDrops, setShowPastDrops] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (hasDrop && drop?.status === 'invalidated') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center justify-center py-12 text-center px-4">
          <div className="text-4xl mb-3" aria-hidden>⚡</div>
          <h3 className="font-semibold text-foreground mb-1">Drop no longer available</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            This drop was removed. Your next Daily Drop will appear after the next scheduled batch.
          </p>
          <p className="text-xs text-primary font-medium mt-3">
            Next batch in {formatCountdownToNextDailyDropBatchUtc()}
          </p>
        </div>
        <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} />
      </div>
    );
  }

  // STATE 7 — Passed
  if (status === 'passed') {
    const passedByMe = drop?.passed_by_user_id === drop?.user_a_id || drop?.passed_by_user_id === drop?.user_b_id;
    return (
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12 opacity-60">
          <X className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {drop?.passed_by_user_id === undefined ? 'This Daily Drop is no longer available' :
              'This Daily Drop has ended'}
          </h3>
          <p className="text-sm text-muted-foreground">Your next Daily Drop arrives after the next batch (UTC).</p>
        </motion.div>
        <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} />
      </div>
    );
  }

  // STATE 8 — Expired
  if (status?.startsWith('expired') || (hasDrop && isExpired)) {
    return (
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12 opacity-60">
          <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {status === 'expired_no_reply' ? 'No reply received before expiry' : 'This Daily Drop expired'}
          </h3>
          <p className="text-sm text-muted-foreground">A new Daily Drop arrives after the next batch.</p>
        </motion.div>
        <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} />
      </div>
    );
  }

  // STATE 1 — No drop today
  if (!hasDrop) {
    const emptyBody = generationRanToday
      ? "We looked for your best match today but couldn't find the right fit. Check back after the next Daily Drop batch."
      : "Your next Daily Drop will show up after the scheduled batch runs. Pull to refresh or check back soon.";
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <Droplet className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Daily Drop today</h3>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-3">{emptyBody}</p>
          <p className="text-xs text-primary font-medium">
            Next batch in {formatCountdownToNextDailyDropBatchUtc()}
          </p>
        </div>
        <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} />
      </div>
    );
  }

  // STATE 6 — Matched / chat unlocked
  if (chatUnlocked && matchId) {
    return (
      <div className="space-y-6">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center py-8 space-y-4">
          <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ duration: 0.5, delay: 0.2 }}>
            <Sparkles className="w-16 h-16 mx-auto text-primary" />
          </motion.div>
          <h3 className="text-xl font-display font-bold text-foreground">You're connected! 🎉</h3>

          {/* Mini chat preview */}
          <div className="max-w-sm mx-auto space-y-2 px-4">
            {openerText && (
              <div className={cn("px-4 py-2 rounded-2xl text-sm max-w-[80%]",
                openerSentByMe ? "ml-auto bg-primary text-primary-foreground" : "mr-auto bg-secondary text-foreground"
              )}>
                {openerText}
              </div>
            )}
            {replyText && (
              <div className={cn("px-4 py-2 rounded-2xl text-sm max-w-[80%]",
                !openerSentByMe ? "ml-auto bg-primary text-primary-foreground" : "mr-auto bg-secondary text-foreground"
              )}>
                {replyText}
              </div>
            )}
          </div>

          <Button
            variant="gradient"
            onClick={() => partner?.id && navigate(`/chat/${partner.id}`)}
            className="gap-2"
            disabled={!partner?.id}
          >
            <MessageCircle className="w-4 h-4" />
            Start Chatting
          </Button>
        </motion.div>
        <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} />
      </div>
    );
  }

  // STATE 2 — Not yet viewed (teaser)
  if (!iHaveViewed && (status === 'active_unopened' || status === 'active_viewed')) {
    return (
      <div className="space-y-6">
        <motion.button
          onClick={() => markViewed()}
          className="w-full"
          whileTap={{ scale: 0.98 }}
        >
          <motion.div
            animate={{ boxShadow: ['0 0 0 0 hsl(var(--primary) / 0.3)', '0 0 0 12px hsl(var(--primary) / 0)', '0 0 0 0 hsl(var(--primary) / 0.3)'] }}
            transition={{ repeat: Infinity, duration: 2 }}
            className="glass-card p-6 rounded-2xl text-center space-y-4"
          >
            <div className="relative w-24 h-24 mx-auto rounded-full overflow-hidden">
              {partner?.avatar_url && (
                <img src={partner.avatar_url} alt="" className="w-full h-full object-cover blur-[20px]" />
              )}
              {!partner?.avatar_url && <div className="w-full h-full bg-secondary" />}
            </div>
            <div>
              <p className="text-sm font-medium text-primary">💧 Today's Drop</p>
              <p className="text-xs text-muted-foreground mt-1">Tap to reveal who we picked for you</p>
            </div>
          </motion.div>
        </motion.button>
        <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} />
      </div>
    );
  }

  // STATE 5 — Partner sent opener, I can reply
  if (openerText && !openerSentByMe && !chatUnlocked) {
    return (
      <div className="space-y-4">
        <CountdownBadge seconds={timeRemaining} />
        <PartnerCard partner={partner} pickReasons={pickReasons} />

        {/* Their opener */}
        <div className="px-2">
          <div className="bg-secondary text-foreground rounded-2xl px-4 py-2 text-sm max-w-[80%]">
            {openerText}
          </div>
        </div>

        {/* Reply input */}
        <div className="flex gap-2">
          <Input
            value={replyInput}
            onChange={e => setReplyInput(e.target.value)}
            placeholder="Reply to unlock chat..."
            maxLength={DAILY_DROP_REPLY_MAX_LENGTH}
            className="flex-1"
          />
          <Button
            variant="gradient"
            disabled={!replyInput.trim() || replyInput.length > DAILY_DROP_REPLY_MAX_LENGTH}
            onClick={() => { sendReply(replyInput); setReplyInput(''); }}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-right">
          {replyInput.length}/{DAILY_DROP_REPLY_MAX_LENGTH}
        </p>
        <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} />
      </div>
    );
  }

  // STATE 4 — I sent opener, waiting
  if (openerSentByMe && !chatUnlocked) {
    return (
      <div className="space-y-4">
        <CountdownBadge seconds={timeRemaining} />
        <PartnerCard partner={partner} pickReasons={pickReasons} />

        <div className="px-2 flex justify-end">
          <div className="bg-primary text-primary-foreground rounded-2xl px-4 py-2 text-sm max-w-[80%]">
            {openerText}
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
          <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.5 }}
            className="w-2 h-2 rounded-full bg-primary" />
          Waiting for their reply...
        </div>
        <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} />
      </div>
    );
  }

  // STATE 3 — Viewed, no opener yet
  return (
    <div className="space-y-4">
      <CountdownBadge seconds={timeRemaining} />
      <PartnerCard partner={partner} pickReasons={pickReasons} />

      {/* Opener input */}
      <div className="flex gap-2">
        <Input
          value={openerInput}
          onChange={e => setOpenerInput(e.target.value)}
          placeholder="Say something..."
          maxLength={140}
          className="flex-1"
        />
        <Button
          variant="gradient"
          disabled={!openerInput.trim() || openerInput.length > 140}
          onClick={() => { sendOpener(openerInput); setOpenerInput(''); }}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground text-right">{openerInput.length}/140</p>

      <button onClick={() => { if (confirm('Pass on this drop? This closes it for both of you.')) passDrop(); }}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto block">
        Not feeling it?
      </button>
      <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} />
    </div>
  );
}

// ── Sub-components ──

function CountdownBadge({ seconds }: { seconds: number }) {
  if (seconds <= 0) return null;
  return (
    <div className="flex items-center justify-center gap-1.5 text-xs text-destructive">
      <Clock className="w-3.5 h-3.5" />
      Expires in {formatTimeRemaining(seconds)}
    </div>
  );
}

function PartnerCard({ partner, pickReasons }: { partner: any; pickReasons: string[] }) {
  if (!partner) return null;

  const photo = resolvePrimaryProfilePhotoPath({
    photos: partner.photos,
    avatar_url: partner.avatar_url,
  });

  return (
    <div className="glass-card overflow-hidden rounded-2xl">
      {photo && (
        <div className="relative aspect-[3/4] bg-secondary">
          <img src={photo} alt={partner.name} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <h2 className="text-2xl font-display font-bold text-foreground">
              {partner.name}, {partner.age}
            </h2>
          </div>
        </div>
      )}

      <div className="p-4 space-y-3">
        {partner.vibes?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {partner.vibes.slice(0, 5).map((v: string, i: number) => (
              <VibeTag key={i} label={v} />
            ))}
          </div>
        )}

        {partner.about_me && (
          <p className="text-sm text-muted-foreground line-clamp-3">{partner.about_me}</p>
        )}

        {partner.bunny_video_uid && partner.bunny_video_status === 'ready' && (
          <div className="flex items-center gap-2 text-xs text-primary">
            <Sparkles className="w-3.5 h-3.5" />
            Has a Vibe Video
          </div>
        )}

        {pickReasons.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Why this pick</p>
            <div className="flex flex-wrap gap-1.5">
              {pickReasons.map((r, i) => (
                <span key={i} className="bg-primary/10 border border-primary/20 text-primary text-xs rounded-full px-3 py-1">
                  {r}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PastDropsSection({ pastDrops, showPastDrops, setShowPastDrops }: {
  pastDrops: any[];
  showPastDrops: boolean;
  setShowPastDrops: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  if (!pastDrops.length) return null;

  return (
    <div>
      <button
        onClick={() => setShowPastDrops(!showPastDrops)}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground w-full py-2"
      >
        <ChevronDown className={cn("w-4 h-4 transition-transform", showPastDrops && "rotate-180")} />
        Past Drops ({pastDrops.length})
      </button>

      <AnimatePresence>
        {showPastDrops && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden space-y-2">
            {pastDrops.map(d => (
              <div
                key={d.id}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-xl bg-secondary/30",
                  d.match_id && d.partner_id && "cursor-pointer hover:bg-secondary/50"
                )}
                onClick={() => d.match_id && d.partner_id && navigate(`/chat/${d.partner_id}`)}
              >
                <div className="w-10 h-10 rounded-full overflow-hidden bg-secondary shrink-0">
                  {d.partner_avatar ? (
                    <img src={d.partner_avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-muted" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{d.partner_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(d.drop_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </p>
                </div>
                <StatusBadge status={d.status} />
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'matched') {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3" />Connected</span>;
  }
  if (status === 'invalidated') {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Removed</span>;
  }
  if (status === 'passed') {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Passed</span>;
  }
  if (status === 'expired_no_reply') {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">No reply</span>;
  }
  return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Expired</span>;
}
