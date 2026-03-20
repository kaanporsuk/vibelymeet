import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight,
  Sparkles,
  Users,
  Radio,
  MessageCircle,
  Droplet,
  UserPlus,
  Search,
  Video,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/BottomNav";
import { EventCover, ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { EventCardSkeleton, MatchAvatarSkeleton } from "@/components/Skeleton";
import { Skeleton } from "@/components/ui/skeleton";

import { DateReminderCard, MiniDateCountdown } from "@/components/schedule/DateReminderCard";
import { NotificationPermissionFlow, NotificationPermissionButton } from "@/components/notifications/NotificationPermissionFlow";
import { PullToRefresh } from "@/components/PullToRefresh";
import { ActiveCallBanner } from "@/components/events/ActiveCallBanner";
import { useNextRegisteredEvent, useEvents, useRealtimeEvents } from "@/hooks/useEvents";
import { useDashboardMatches } from "@/hooks/useMatches";
import { useSchedule } from "@/hooks/useSchedule";
import { useDateReminders } from "@/hooks/useDateReminders";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useNotifications } from "@/contexts/NotificationContext";
import { useUserProfile } from "@/contexts/AuthContext";
import { useOtherCityEvents } from "@/hooks/useVisibleEvents";
import { useDailyDropTabBadge } from "@/hooks/useDailyDropTabBadge";
import { supabase } from "@/integrations/supabase/client";
import { requestWebPushPermissionAndSync } from "@/lib/requestWebPushPermission";
import { differenceInSeconds, format, startOfDay } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { PhoneVerificationNudge } from "@/components/PhoneVerificationNudge";
import { DeletionRecoveryBanner } from "@/components/settings/DeletionRecoveryBanner";
import { useDeletionRecovery } from "@/hooks/useDeletionRecovery";

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

function isThisWeek(date: Date): boolean {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return date >= start && date < end;
}

function getTimeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

type HomeProfile = {
  name: string | null;
  photos: string[] | null;
  about_me: string | null;
  avatar_url: string | null;
  vibeCount: number;
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useUserProfile();
  useRealtimeEvents();
  const { pendingDeletion, cancelDeletion, isCancelling } = useDeletionRecovery();

  const [activeSession, setActiveSession] = useState<{ sessionId: string; eventId: string } | null>(null);
  const [showDashboardPhoneNudge, setShowDashboardPhoneNudge] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    const dismissed = localStorage.getItem("vibely_phone_nudge_dashboard_dismissed");
    if (dismissed) return;

    const check = async () => {
      const { data } = await supabase.from("profiles").select("phone_verified").eq("id", user.id).maybeSingle();
      if (data && !data.phone_verified) {
        setShowDashboardPhoneNudge(true);
      }
    };
    void check();
  }, [user?.id]);

  useEffect(() => {
    const checkActive = async () => {
      if (!user?.id) return;

      const { data: reg } = await supabase
        .from("event_registrations")
        .select("event_id, current_room_id, queue_status")
        .eq("profile_id", user.id)
        .in("queue_status", ["in_handshake", "in_date", "in_ready_gate"])
        .not("current_room_id", "is", null)
        .maybeSingle();

      if (reg?.current_room_id) {
        const { data: session } = await supabase
          .from("video_sessions")
          .select("id, ended_at")
          .eq("id", reg.current_room_id)
          .is("ended_at", null)
          .maybeSingle();

        if (session) {
          setActiveSession({ sessionId: session.id, eventId: reg.event_id });
        }
      }
    };
    void checkActive();
  }, [user?.id]);

  const { data: nextEventData, isLoading: eventLoading, refetch: refetchNextEvent } = useNextRegisteredEvent();
  const { data: events = [], isLoading: eventsLoading, refetch: refetchEvents } = useEvents();
  const { data: matches = [], isLoading: matchesLoading, refetch: refetchMatches } = useDashboardMatches();
  const { proposals } = useSchedule();
  const { nextReminder, imminentReminders } = useDateReminders(proposals);
  const { isGranted, scheduleDateReminder, refreshSubscriptionState } = usePushNotifications();

  const handleRequestOneSignalPermission = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    const ok = await requestWebPushPermissionAndSync(user.id);
    await refreshSubscriptionState();
    if (ok) {
      window.dispatchEvent(new Event("vibely-onesignal-subscription-changed"));
    }
    return ok;
  }, [user?.id, refreshSubscriptionState]);
  const { unreadCount, markAllAsRead } = useNotifications();
  const { data: otherCities = [] } = useOtherCityEvents();
  const dropReady = useDailyDropTabBadge(user?.id);

  const { data: unreadMessageCount = 0, refetch: refetchUnread } = useQuery({
    queryKey: ["unread-home", user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;
      const { count, error } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .neq("sender_id", user.id)
        .is("read_at", null);
      if (error) {
        if (import.meta.env.DEV) console.warn("[home] unread messages count error:", error.message);
        throw error;
      }
      return count ?? 0;
    },
    enabled: !!user?.id,
    refetchInterval: 30_000,
  });

  const { data: homeProfile, isLoading: homeProfileLoading, refetch: refetchHomeProfile } = useQuery({
    queryKey: ["home-dashboard-profile", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<HomeProfile | null> => {
      if (!user?.id) return null;
      const { data: row, error } = await supabase
        .from("profiles")
        .select("name, photos, about_me, avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      const { count, error: vErr } = await supabase
        .from("profile_vibes")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", user.id);
      if (vErr && import.meta.env.DEV) console.warn("[home] profile_vibes count:", vErr.message);
      const r = row as {
        name?: string | null;
        photos?: string[] | null;
        about_me?: string | null;
        avatar_url?: string | null;
      } | null;
      return {
        name: r?.name ?? null,
        photos: r?.photos ?? null,
        about_me: r?.about_me ?? null,
        avatar_url: r?.avatar_url ?? null,
        vibeCount: count ?? 0,
      };
    },
  });

  const hasPhotos = (homeProfile?.photos?.length ?? 0) >= 2;
  const hasVibes = (homeProfile?.vibeCount ?? 0) >= 3;
  const hasAbout = !!homeProfile?.about_me && homeProfile.about_me.length >= 10;
  const isProfileComplete = hasPhotos && hasVibes && hasAbout;

  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [showNotificationFlow, setShowNotificationFlow] = useState(false);

  const nextEvent = nextEventData?.event;
  const isRegisteredForNextEvent = nextEventData?.isRegistered || false;
  const isLiveEvent = nextEvent?.isLive === true;

  const hoursUntilNext = useMemo(() => {
    if (!nextEvent?.eventDate) return Number.POSITIVE_INFINITY;
    return (nextEvent.eventDate.getTime() - Date.now()) / 36e5;
  }, [nextEvent?.eventDate]);

  const upcomingEvents = useMemo(() => {
    const start = startOfDay(new Date());
    return events.filter((e) => e.status !== "cancelled" && e.eventDate.getTime() >= start.getTime());
  }, [events]);

  const eventSectionTitle = useMemo(() => {
    if (upcomingEvents.some((e) => isToday(e.eventDate))) return "Tonight";
    if (upcomingEvents.some((e) => isThisWeek(e.eventDate))) return "This Week";
    return "Upcoming Events";
  }, [upcomingEvents]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      refetchNextEvent(),
      refetchEvents(),
      refetchMatches(),
      refetchUnread(),
      refetchHomeProfile(),
    ]);
  }, [refetchNextEvent, refetchEvents, refetchMatches, refetchUnread, refetchHomeProfile]);

  const handleNotificationClick = () => {
    markAllAsRead();
    setShowNotificationFlow(true);
  };

  useEffect(() => {
    if (isGranted && proposals.length > 0) {
      proposals
        .filter((p) => p.status === "accepted")
        .forEach((p) => scheduleDateReminder(p.senderName || "Your match", p.date, 15));
    }
  }, [isGranted, proposals, scheduleDateReminder]);

  useEffect(() => {
    if (!nextEvent?.eventDate || isLiveEvent) return;
    const updateCountdown = () => {
      const diff = differenceInSeconds(nextEvent.eventDate, new Date());
      if (diff <= 0) {
        setCountdown({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }
      setCountdown({
        days: Math.floor(diff / 86400),
        hours: Math.floor((diff % 86400) / 3600),
        minutes: Math.floor((diff % 3600) / 60),
        seconds: diff % 60,
      });
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [nextEvent?.eventDate, isLiveEvent]);

  const loading = eventLoading || eventsLoading || matchesLoading;
  const newMatchCount = matches.filter((m) => m.isNew).length;
  const hasUpcomingDate = proposals.length > 0;

  const firstName =
    homeProfile?.name?.trim().split(/\s+/)[0] ||
    user?.name?.trim().split(/\s+/)[0] ||
    user?.email?.split("@")[0] ||
    "there";

  const getSubline = (): string | null => {
    if (isLiveEvent && isRegisteredForNextEvent && nextEvent) return "You're live tonight";
    if (nextEvent && isRegisteredForNextEvent && hoursUntilNext < 24) return "Tonight looks promising";
    if (unreadMessageCount > 0)
      return `${unreadMessageCount} fresh conversation${unreadMessageCount > 1 ? "s" : ""}`;
    if (newMatchCount > 0) return "Someone new vibed with you";
    if (nextEvent && isRegisteredForNextEvent) return "Your next event is coming up";
    return null;
  };

  const subline = getSubline();

  const formatEventDateTime = (d: Date) => format(d, "EEE, MMM d · h:mm a");

  function QuickActionsRail() {
    const actions: Array<{
      icon: ReactNode;
      label: string;
      className: string;
      onClick: () => void;
    }> = [];

    if (isLiveEvent && isRegisteredForNextEvent && nextEvent) {
      actions.push({
        icon: <Radio className="w-4 h-4" />,
        label: "Lobby is live",
        className: "text-destructive bg-destructive/10 border-destructive/20",
        onClick: () => navigate(`/event/${nextEvent.id}/lobby`),
      });
    }
    if (unreadMessageCount > 0) {
      actions.push({
        icon: <MessageCircle className="w-4 h-4" />,
        label: `${unreadMessageCount} unread`,
        className: "text-accent bg-accent/10 border-accent/20",
        onClick: () => navigate("/matches"),
      });
    }
    if (dropReady) {
      actions.push({
        icon: <Droplet className="w-4 h-4" />,
        label: "Daily Drop",
        className: "text-neon-cyan bg-neon-cyan/10 border-neon-cyan/20",
        onClick: () => navigate("/matches"),
      });
    }
    if (hasUpcomingDate) {
      actions.push({
        icon: <Video className="w-4 h-4" />,
        label: "Date coming up",
        className: "text-neon-pink bg-neon-pink/10 border-neon-pink/20",
        onClick: () => navigate("/schedule"),
      });
    }
    if (!isProfileComplete) {
      actions.push({
        icon: <UserPlus className="w-4 h-4" />,
        label: "Complete profile",
        className: "text-primary bg-primary/10 border-primary/20",
        onClick: () => navigate("/profile"),
      });
    }
    if (actions.length < 4) {
      actions.push({
        icon: <Search className="w-4 h-4" />,
        label: "Browse events",
        className: "text-primary bg-primary/10 border-primary/20",
        onClick: () => navigate("/events"),
      });
    }

    const visible = actions.slice(0, 4);
    if (visible.length === 0) return null;

    return (
      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 py-1">
        {visible.map((a, i) => (
          <button
            key={`${a.label}-${i}`}
            type="button"
            onClick={a.onClick}
            className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-xl border whitespace-nowrap text-sm font-semibold transition-all hover:scale-[1.02] active:scale-95 ${a.className}`}
          >
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>
    );
  }

  function AmbientPulse() {
    const lines: string[] = [];
    if (upcomingEvents.length > 0)
      lines.push(
        `${upcomingEvents.length} event${upcomingEvents.length > 1 ? "s" : ""} coming up this week`,
      );
    if (unreadMessageCount > 0)
      lines.push(
        `${unreadMessageCount} conversation${unreadMessageCount > 1 ? "s" : ""} need your reply`,
      );
    if (newMatchCount > 0)
      lines.push(`${newMatchCount} new connection${newMatchCount > 1 ? "s" : ""} this week`);

    if (lines.length === 0) return null;

    return (
      <div className="glass-card p-4 space-y-2 border border-white/10">
        {lines.map((line, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            <p className="text-xs text-muted-foreground">{line}</p>
          </div>
        ))}
      </div>
    );
  }

  const showHeroSkeleton = eventLoading && !nextEvent;

  return (
    <PullToRefresh onRefresh={handleRefresh} className="min-h-screen bg-background pb-24">
      <NotificationPermissionFlow
        open={showNotificationFlow}
        onOpenChange={setShowNotificationFlow}
        onRequestPermission={handleRequestOneSignalPermission}
      />

      <header className="sticky top-0 z-40 glass-card border-b border-white/10 px-4 py-4">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="space-y-0.5 min-w-0 flex-1 pr-2">
            {homeProfileLoading && !homeProfile ? (
              <div className="space-y-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-32" />
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{getTimeGreeting()},</p>
                <h1 className="text-xl font-display font-bold text-foreground truncate">{firstName}</h1>
                {subline && <p className="text-xs text-primary">{subline}</p>}
              </>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {nextReminder && nextReminder.urgency !== "none" && (
              <MiniDateCountdown reminder={nextReminder} onClick={() => navigate("/schedule")} />
            )}
            <NotificationPermissionButton
              isGranted={isGranted}
              onClick={handleNotificationClick}
              unreadCount={unreadCount}
            />
            <button type="button" onClick={() => navigate("/profile")} className="w-8 h-8 shrink-0 rounded-full overflow-hidden">
              <ProfilePhoto
                photos={homeProfile?.photos?.length ? homeProfile.photos : undefined}
                avatarUrl={homeProfile?.avatar_url || user?.avatarUrl}
                name={firstName}
                size="sm"
                className="w-8 h-8"
              />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-8">
        <AnimatePresence>
          {activeSession && (
            <motion.div
              key="active-call"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <ActiveCallBanner
                sessionId={activeSession.sessionId}
                onRejoin={() => navigate(`/date/${activeSession.sessionId}`)}
                onEnd={async () => {
                  await supabase
                    .from("video_sessions")
                    .update({ ended_at: new Date().toISOString() })
                    .eq("id", activeSession.sessionId);
                  if (user?.id) {
                    await supabase
                      .from("event_registrations")
                      .update({
                        queue_status: "browsing",
                        current_room_id: null,
                        current_partner_id: null,
                      })
                      .eq("profile_id", user.id)
                      .eq("event_id", activeSession.eventId);
                  }
                  setActiveSession(null);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {pendingDeletion && (
          <DeletionRecoveryBanner
            scheduledDate={pendingDeletion.scheduled_deletion_at}
            onCancel={cancelDeletion}
            isCancelling={isCancelling}
          />
        )}

        <AnimatePresence>
          {showDashboardPhoneNudge && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <PhoneVerificationNudge
                variant="wizard"
                onDismiss={() => {
                  localStorage.setItem("vibely_phone_nudge_dashboard_dismissed", "true");
                  setShowDashboardPhoneNudge(false);
                }}
                onVerified={() => setShowDashboardPhoneNudge(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {imminentReminders.length > 0 && (
          <section className="space-y-3">
            {imminentReminders.map((reminder) => (
              <DateReminderCard
                key={reminder.id}
                reminder={reminder}
                onJoinDate={() => navigate("/video-date")}
                onEnableNotifications={() => setShowNotificationFlow(true)}
                notificationsEnabled={isGranted}
              />
            ))}
          </section>
        )}

        {/* 1. Hero — 4 states */}
        {showHeroSkeleton && (
          <div className="glass-card overflow-hidden border border-white/10">
            <EventCardSkeleton />
          </div>
        )}

        {!showHeroSkeleton && isLiveEvent && isRegisteredForNextEvent && nextEvent && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative glass-card overflow-hidden border border-white/10"
          >
            <div className="relative h-48">
              <EventCover
                src={nextEvent.image}
                title={nextEvent.title}
                className="!aspect-auto absolute inset-0 h-full w-full min-h-[12rem]"
                sizeHint="hero"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none" />
            </div>
            <div className="absolute top-4 left-4 flex items-center gap-1.5 px-3 py-1 rounded-full bg-destructive/20 border border-destructive/40 z-10">
              <div className="w-2 h-2 rounded-full bg-destructive animate-pulse shrink-0" />
              <span className="text-xs font-bold text-destructive uppercase tracking-wider">Live Now</span>
            </div>
            <div className="relative p-6 -mt-16 space-y-3 z-[1]">
              <h3 className="text-xl font-display font-bold text-foreground drop-shadow-sm">{nextEvent.title}</h3>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 shrink-0" /> People vibing right now
              </p>
              <Button variant="gradient" className="w-full" onClick={() => navigate(`/event/${nextEvent.id}/lobby`)}>
                Enter Lobby →
              </Button>
            </div>
          </motion.section>
        )}

        {!showHeroSkeleton &&
          !isLiveEvent &&
          nextEvent &&
          isRegisteredForNextEvent &&
          hoursUntilNext <= 24 && (
            <section className="space-y-3">
              <h2 className="text-lg font-display font-semibold text-foreground">Your Night Starts Soon</h2>
              <div
                className="glass-card overflow-hidden cursor-pointer border border-white/10"
                onClick={() => navigate(`/events/${nextEvent.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/events/${nextEvent.id}`);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="relative h-36">
                  <EventCover
                    src={nextEvent.image}
                    title={nextEvent.title}
                    className="!aspect-auto absolute inset-0 h-full w-full"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent pointer-events-none" />
                  <div className="absolute top-3 right-3 px-2 py-1 text-xs font-medium rounded-full bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30">
                    ✓ Registered
                  </div>
                  <div className="absolute bottom-3 left-3 pr-3">
                    <h3 className="text-lg font-display font-bold text-white drop-shadow-md">{nextEvent.title}</h3>
                    <p className="text-sm text-white/80 drop-shadow">{formatEventDateTime(nextEvent.eventDate)}</p>
                  </div>
                </div>
                <div className="flex justify-center gap-2 py-4">
                  {[
                    { val: countdown.days, label: "DAYS" },
                    { val: countdown.hours, label: "HRS" },
                    { val: countdown.minutes, label: "MIN" },
                    { val: countdown.seconds, label: "SEC" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="w-14 h-14 rounded-xl bg-secondary flex flex-col items-center justify-center"
                    >
                      <span className="text-lg font-bold gradient-text">{String(item.val).padStart(2, "0")}</span>
                      <span className="text-[10px] text-muted-foreground font-semibold">{item.label}</span>
                    </div>
                  ))}
                </div>
                <div className="px-4 pb-4">
                  <Button
                    variant="default"
                    size="sm"
                    className="w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/events/${nextEvent.id}`);
                    }}
                  >
                    View Event
                  </Button>
                </div>
              </div>
            </section>
          )}

        {!showHeroSkeleton &&
          !isLiveEvent &&
          nextEvent &&
          isRegisteredForNextEvent &&
          hoursUntilNext > 24 && (
            <section className="space-y-3">
              <h2 className="text-lg font-display font-semibold text-foreground">Next Event</h2>
              <div
                className="glass-card overflow-hidden cursor-pointer border border-white/10"
                onClick={() => navigate(`/events/${nextEvent.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/events/${nextEvent.id}`);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="relative h-32">
                  <EventCover
                    src={nextEvent.image}
                    title={nextEvent.title}
                    className="!aspect-auto absolute inset-0 h-full w-full"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent pointer-events-none" />
                  <div className="absolute top-3 right-3 px-2 py-1 text-xs font-medium rounded-full bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30">
                    ✓ Registered
                  </div>
                  <div className="absolute bottom-3 left-3 pr-3">
                    <h3 className="text-base font-display font-bold text-white drop-shadow-md">{nextEvent.title}</h3>
                    <p className="text-sm text-white/80 drop-shadow">{formatEventDateTime(nextEvent.eventDate)}</p>
                  </div>
                </div>
                <div className="px-4 pb-4 pt-2">
                  <Button
                    variant="default"
                    size="sm"
                    className="w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/events/${nextEvent.id}`);
                    }}
                  >
                    View Event
                  </Button>
                </div>
              </div>
            </section>
          )}

        {!showHeroSkeleton &&
          !(isLiveEvent && isRegisteredForNextEvent && nextEvent) &&
          !(nextEvent && isRegisteredForNextEvent) && (
          <div className="glass-card p-8 text-center space-y-4 border border-white/10">
            <Sparkles className="w-10 h-10 text-primary mx-auto" />
            <h3 className="text-xl font-display font-bold text-foreground">Find your next vibe</h3>
            <p className="text-sm text-muted-foreground">Join an event to meet amazing people live</p>
            <Button variant="gradient" className="w-full" onClick={() => navigate("/events")}>
              Explore Events
            </Button>
          </div>
        )}

        {/* 2. Quick actions */}
        <QuickActionsRail />

        {/* 3. Your Matches */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-display font-semibold text-foreground">Your Matches</h2>
            <button
              type="button"
              onClick={() => navigate("/matches")}
              className="flex items-center gap-0.5 text-sm font-medium text-primary"
            >
              See all
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex gap-4 overflow-x-auto scrollbar-hide py-2 -mx-4 px-4">
            {loading ? (
              Array(5)
                .fill(0)
                .map((_, i) => <MatchAvatarSkeleton key={i} />)
            ) : matches.length > 0 ? (
              matches.map((match) => (
                <button
                  key={match.id}
                  type="button"
                  onClick={() => navigate(`/chat/${match.id}`)}
                  className="flex flex-col items-center gap-2 min-w-fit"
                >
                  <div
                    className={`p-[3px] rounded-full ${match.isNew ? "bg-gradient-primary" : "bg-border"}`}
                  >
                    <div className="rounded-full bg-background p-[2px]">
                      <ProfilePhoto
                        avatarUrl={match.image}
                        name={match.name}
                        size="md"
                        rounded="full"
                        loading="eager"
                      />
                    </div>
                  </div>
                  <span className="text-xs text-foreground font-medium truncate max-w-[64px] text-center">
                    {match.name.split(" ")[0]}
                  </span>
                </button>
              ))
            ) : (
              <div className="text-center py-4 w-full space-y-3">
                <p className="text-sm text-muted-foreground">No matches yet. Join an event to start connecting!</p>
                <Button variant="secondary" size="sm" onClick={() => navigate("/events")}>
                  Browse Events
                </Button>
              </div>
            )}
          </div>
        </section>

        {/* 4. Events rail */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-display font-semibold text-foreground">{eventSectionTitle}</h2>
            <button
              type="button"
              onClick={() => navigate("/events")}
              className="flex items-center gap-0.5 text-sm font-medium text-primary"
            >
              All events
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-2">
            {loading ? (
              Array(2)
                .fill(0)
                .map((_, i) => (
                  <div key={i} className="min-w-[260px]">
                    <EventCardSkeleton />
                  </div>
                ))
            ) : upcomingEvents.length > 0 ? (
              upcomingEvents.slice(0, 5).map((event) => (
                <div
                  key={event.id}
                  className="min-w-[260px] glass-card overflow-hidden cursor-pointer shrink-0 border border-white/10 rounded-2xl"
                  onClick={() => navigate(`/events/${event.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(`/events/${event.id}`);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="relative h-[140px] overflow-hidden rounded-t-2xl">
                    <EventCover
                      src={event.image}
                      title={event.title}
                      className="!aspect-auto absolute inset-0 h-full w-full rounded-none"
                    />
                  </div>
                  <div className="p-3 space-y-1.5 bg-card/40 backdrop-blur-sm border-t border-white/5">
                    <h3 className="font-display font-semibold text-base text-foreground line-clamp-1">{event.title}</h3>
                    <p className="text-[13px] text-muted-foreground">
                      {format(event.eventDate, "EEE, MMM d")} · {format(event.eventDate, "h:mm a")}
                    </p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="w-3.5 h-3.5" />
                      {event.attendees} attending
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-6 w-full space-y-3">
                <p className="text-sm text-muted-foreground">No upcoming events</p>
                <Button variant="ghost" size="sm" onClick={() => navigate("/events")}>
                  Browse Events
                </Button>
              </div>
            )}
          </div>
        </section>

        {/* 5. Profile readiness */}
        {!homeProfileLoading && user?.id && !isProfileComplete && (
          <div
            className="glass-card p-4 flex items-center gap-3 cursor-pointer hover:bg-card/80 transition-colors border border-primary/20 bg-primary/5"
            onClick={() => navigate("/profile")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigate("/profile");
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Be more discoverable tonight</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {!hasPhotos
                  ? "Add photos for stronger first impressions"
                  : !hasVibes
                    ? "Select your vibes for better matching"
                    : "Add more about yourself for stronger intros"}
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-primary shrink-0" />
          </div>
        )}

        {/* 6. Ambient pulse */}
        <AmbientPulse />

        {/* 7. Other cities */}
        {otherCities.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-4 border border-primary/20 bg-gradient-to-r from-primary/5 to-accent/5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xl shrink-0">💎</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {otherCities.reduce((sum, c) => sum + Number(c.event_count), 0)} events in {otherCities.length}{" "}
                    {otherCities.length === 1 ? "city" : "cities"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {otherCities
                      .slice(0, 3)
                      .map((c) => c.city)
                      .join(" · ")}
                    {otherCities.length > 3 ? ` + ${otherCities.length - 3} more` : ""}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 text-xs border-primary/30 text-primary"
                onClick={() => navigate("/events")}
              >
                Go Premium →
              </Button>
            </div>
          </motion.div>
        )}
      </main>

      <BottomNav />
    </PullToRefresh>
  );
};

export default Dashboard;
