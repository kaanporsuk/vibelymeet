import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight,
  Sparkles,
  Users,
  Radio,
  UserPlus,
  Search,
  Video,
  Heart,
  Clock,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/navigation/BottomNav";
import { EventCover, ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { EventCardSkeleton, MatchAvatarSkeleton } from "@/components/Skeleton";
import { Skeleton } from "@/components/ui/skeleton";

import { DateReminderCard, MiniDateCountdown } from "@/components/schedule/DateReminderCard";
import { NotificationPermissionFlow, NotificationPermissionButton } from "@/components/notifications/NotificationPermissionFlow";
import { PullToRefresh } from "@/components/PullToRefresh";
import { ActiveCallBanner } from "@/components/events/ActiveCallBanner";
import { useNextRegisteredEvent, useRealtimeEvents } from "@/hooks/useEvents";
import { useVisibleEvents, useOtherCityEvents } from "@/hooks/useVisibleEvents";
import { useDashboardMatches } from "@/hooks/useMatches";
import { useDateReminders } from "@/hooks/useDateReminders";
import { useScheduleHub } from "@/hooks/useScheduleHub";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useNotifications } from "@/contexts/NotificationContext";
import { useSessionHydration } from "@/contexts/SessionHydrationContext";
import { useUserProfile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { requestWebPushPermissionAndSync } from "@/lib/requestWebPushPermission";
import { differenceInSeconds, differenceInMinutes, differenceInHours, format } from "date-fns";
import { isWithinDiscoverHomeGraceWindow } from "@clientShared/discoverEventVisibility";
import { motion, AnimatePresence } from "framer-motion";
import { PhoneVerificationNudge } from "@/components/PhoneVerificationNudge";
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

const PROFILE_READINESS_DISMISS_KEY = "vibely_profile_readiness_dismissed_at";
const PROFILE_READINESS_COOLDOWN_MS = 7 * 86400000;

function formatStartsInSoon(eventDate: Date): string {
  const totalMin = differenceInMinutes(eventDate, new Date());
  if (totalMin <= 0) return "Starting now";
  if (totalMin < 60) return `Starts in ${totalMin} minutes`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `Starts in ${h}h ${m}m` : `Starts in ${h}h`;
}

function formatLongCountdownToEvent(eventDate: Date): string {
  const diff = differenceInSeconds(eventDate, new Date());
  if (diff <= 0) return "Starting soon";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  if (d > 0) return `${d} day${d !== 1 ? "s" : ""}, ${h} hr${h !== 1 ? "s" : ""}`;
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `${h} hr${h !== 1 ? "s" : ""}, ${m} min`;
  return `${m} min`;
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

  const { activeSession, hydrated: sessionHydrated, refetch: refetchActiveSession } = useSessionHydration();
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

  const { data: nextEventData, isLoading: eventLoading, refetch: refetchNextEvent } = useNextRegisteredEvent();
  const { data: visibleEventsRaw = [], isLoading: eventsLoading, refetch: refetchEvents } = useVisibleEvents();
  const { data: matches = [], isLoading: matchesLoading, refetch: refetchMatches } = useDashboardMatches();
  const { reminderSources } = useScheduleHub();
  const { nextReminder, imminentReminders } = useDateReminders(reminderSources);
  const { isGranted, isBrowserPermissionGranted, scheduleDateReminder, refreshSubscriptionState } =
    usePushNotifications();

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

  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [showNotificationFlow, setShowNotificationFlow] = useState(false);
  const [profileReadinessDismissed, setProfileReadinessDismissed] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(PROFILE_READINESS_DISMISS_KEY);
    if (!raw) return;
    const ts = parseInt(raw, 10);
    if (!Number.isNaN(ts) && Date.now() - ts < PROFILE_READINESS_COOLDOWN_MS) {
      setProfileReadinessDismissed(true);
    }
  }, []);

  const nextEvent = nextEventData?.event;
  const isConfirmedForNextEvent = nextEventData?.isRegistered || false;
  const isWaitlistedForNextEvent = nextEventData?.isWaitlisted || false;
  const hasEventAdmissionForNext =
    nextEventData?.hasEventAdmission ?? (isConfirmedForNextEvent || isWaitlistedForNextEvent);
  const isLiveEvent = nextEvent?.isLive === true;

  const hoursUntilNext = useMemo(() => {
    if (!nextEvent?.eventDate) return Number.POSITIVE_INFINITY;
    return (nextEvent.eventDate.getTime() - Date.now()) / 36e5;
  }, [nextEvent?.eventDate]);

  const startingSoonWithin2h = useMemo(() => {
    return (
      !!nextEvent &&
      hasEventAdmissionForNext &&
      !isLiveEvent &&
      hoursUntilNext > 0 &&
      hoursUntilNext <= 2
    );
  }, [nextEvent, hasEventAdmissionForNext, isLiveEvent, hoursUntilNext]);

  const profileCompletenessPercent = useMemo(() => {
    const photoScore = Math.min((homeProfile?.photos?.length ?? 0) / 2, 1);
    const vibeScore = Math.min((homeProfile?.vibeCount ?? 0) / 3, 1);
    const aboutLen = homeProfile?.about_me?.length ?? 0;
    const aboutScore = aboutLen >= 10 ? 1 : Math.min(aboutLen / 10, 1);
    return Math.round(((photoScore + vibeScore + aboutScore) / 3) * 100);
  }, [homeProfile?.photos, homeProfile?.vibeCount, homeProfile?.about_me]);

  const events = useMemo(() => {
    return visibleEventsRaw.map((e) => {
      const eventDate = new Date(e.event_date);
      const durationMinutes = e.duration_minutes ?? 60;
      return {
        id: e.id,
        title: e.title,
        image: e.cover_image,
        date: format(eventDate, "MMM d"),
        time: format(eventDate, "h a"),
        attendees: e.current_attendees,
        tags: e.tags,
        status: e.computed_status || e.status,
        eventDate,
        duration_minutes: durationMinutes,
      };
    });
  }, [visibleEventsRaw]);

  /** Home rail: same window as `get_visible_events` (effective end + 6h). */
  const upcomingEvents = useMemo(
    () =>
      events.filter((e) =>
        isWithinDiscoverHomeGraceWindow({
          status: e.status,
          eventDate: e.eventDate,
          durationMinutes: e.duration_minutes,
        })
      ),
    [events],
  );

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
    if (isBrowserPermissionGranted && reminderSources.length > 0) {
      reminderSources.forEach((reminder) => scheduleDateReminder(reminder.senderName || "Your match", reminder.date, 15));
    }
  }, [isBrowserPermissionGranted, reminderSources, scheduleDateReminder]);

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
  const firstName =
    homeProfile?.name?.trim().split(/\s+/)[0] ||
    user?.name?.trim().split(/\s+/)[0] ||
    user?.email?.split("@")[0] ||
    "there";

  const contextualSubline = useMemo(() => {
    if (isLiveEvent && isConfirmedForNextEvent && nextEvent) return "Your event is live now";
    if (isLiveEvent && isWaitlistedForNextEvent && nextEvent) return "Your event is live — you're on the waitlist";
    if (startingSoonWithin2h && nextEvent)
      return `Get ready — ${nextEvent.title} starts soon`;
    if (newMatchCount > 0)
      return `You have ${newMatchCount} new vibe${newMatchCount !== 1 ? "s" : ""} to explore`;
    if (profileCompletenessPercent < 80) return "Complete your profile to get discovered";
    return "Let's find your vibe today";
  }, [
    isLiveEvent,
    isConfirmedForNextEvent,
    isWaitlistedForNextEvent,
    nextEvent,
    startingSoonWithin2h,
    newMatchCount,
    profileCompletenessPercent,
  ]);

  const formatEventDateTime = (d: Date) => format(d, "EEE, MMM d · h:mm a");

  function QuickActionsRail() {
    type QA = { key: string; icon: ReactNode; label: string; className: string; onClick: () => void };
    const actions: QA[] = [];

    if (isLiveEvent && isConfirmedForNextEvent && nextEvent) {
      actions.push({
        key: "lobby",
        icon: <Radio className="w-4 h-4 shrink-0" />,
        label: "Enter Lobby",
        className:
          "text-white border-transparent bg-gradient-to-r from-neon-violet to-neon-pink shadow-[0_0_20px_-4px_rgba(139,92,246,0.45)]",
        onClick: () => navigate(`/event/${nextEvent.id}/lobby`),
      });
    }
    if (startingSoonWithin2h && nextEvent) {
      actions.push({
        key: "ready",
        icon: <Clock className="w-4 h-4 shrink-0" />,
        label: "Get Ready",
        className: "border border-amber-500/30 bg-amber-500/20 text-amber-400",
        onClick: () => navigate(`/events/${nextEvent.id}`),
      });
    }
    if (newMatchCount > 0) {
      actions.push({
        key: "vibes-waiting",
        icon: <Heart className="w-4 h-4 shrink-0" />,
        label: `${newMatchCount} Vibes Waiting`,
        className: "border border-pink-500/30 bg-pink-500/20 text-pink-400",
        onClick: () => navigate("/matches"),
      });
    }
    if (profileCompletenessPercent < 80) {
      actions.push({
        key: "complete",
        icon: <UserPlus className="w-4 h-4 shrink-0" />,
        label: "Complete Profile",
        className: "border border-white/10 bg-white/5 text-white/70",
        onClick: () => navigate("/profile"),
      });
    }
    if (!hasEventAdmissionForNext) {
      actions.push({
        key: "browse",
        icon: <Search className="w-4 h-4 shrink-0" />,
        label: "Browse Events",
        className: "border border-white/10 bg-white/5 text-white/70",
        onClick: () => navigate("/events"),
      });
    }
    if ((homeProfile?.vibeCount ?? 0) === 0) {
      actions.push({
        key: "set-vibes",
        icon: <Sparkles className="w-4 h-4 shrink-0" />,
        label: "Set Your Vibes",
        className: "border border-white/10 bg-white/5 text-white/70",
        onClick: () => navigate("/schedule"),
      });
    }

    const visible = actions.slice(0, 4);
    if (visible.length === 0) return null;

    return (
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 py-1 scrollbar-hide">
        {visible.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={a.onClick}
            className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium whitespace-nowrap transition-all hover:scale-[1.02] active:scale-95 ${a.className}`}
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
    <PullToRefresh onRefresh={handleRefresh} className="min-h-screen bg-background pb-[100px]">
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
                <p className="text-sm text-muted-foreground">{contextualSubline}</p>
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
          {sessionHydrated && activeSession && (
            <motion.div
              key="active-call"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <ActiveCallBanner
                sessionId={activeSession.sessionId}
                mode={activeSession.kind === "ready_gate" ? "ready_gate" : "video"}
                onRejoin={() =>
                  activeSession.kind === "ready_gate"
                    ? navigate(`/event/${activeSession.eventId}/lobby`)
                    : navigate(`/date/${activeSession.sessionId}`)
                }
                onEnd={async () => {
                  if (activeSession.kind === "ready_gate") {
                    await supabase.rpc("ready_gate_transition", {
                      p_session_id: activeSession.sessionId,
                      p_action: "forfeit",
                    });
                    await refetchActiveSession();
                    return;
                  }
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
                  await refetchActiveSession();
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showDashboardPhoneNudge && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <PhoneVerificationNudge
                variant="wizard"
                userId={user?.id ?? null}
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
                onJoinDate={() => {
                  if (
                    activeSession &&
                    activeSession.kind === "video" &&
                    (activeSession.queueStatus === "in_handshake" || activeSession.queueStatus === "in_date")
                  ) {
                    navigate(`/date/${activeSession.sessionId}`);
                    return;
                  }
                  navigate("/schedule");
                }}
                onEnableNotifications={() => setShowNotificationFlow(true)}
                notificationsEnabled={isGranted}
              />
            ))}
          </section>
        )}

        {/* 1. Hero — 4 states (live → starting soon ≤2h → booked → no registration) */}
        {showHeroSkeleton && (
          <div className="glass-card overflow-hidden border border-white/10">
            <EventCardSkeleton />
          </div>
        )}

        {!showHeroSkeleton && isLiveEvent && isConfirmedForNextEvent && nextEvent && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative glass-card overflow-hidden border border-emerald-500/30 shadow-[0_0_32px_-8px_rgba(16,185,129,0.45)]"
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
            <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/50">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0 shadow-[0_0_8px_2px_rgba(52,211,153,0.7)]" />
              <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-[1px]">LIVE NOW</span>
            </div>
            <div className="relative z-[1] -mt-16 space-y-3 p-6">
              <h3 className="text-xl font-display font-bold text-foreground drop-shadow-sm">{nextEvent.title}</h3>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 shrink-0" />
                {(() => {
                  const n = (nextEvent as { currentAttendees?: number }).currentAttendees ?? 0;
                  return n > 0 ? `${n} people vibing` : "Jump in — the lobby is open";
                })()}
              </p>
              <Button variant="gradient" className="w-full" onClick={() => navigate(`/event/${nextEvent.id}/lobby`)}>
                Enter Lobby →
              </Button>
            </div>
          </motion.section>
        )}

        {!showHeroSkeleton &&
          !isLiveEvent &&
          startingSoonWithin2h &&
          nextEvent &&
          hasEventAdmissionForNext && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card overflow-hidden border border-orange-400/25 shadow-[0_0_24px_-6px_rgba(251,146,60,0.35)]"
            >
              <div className="relative h-36">
                <EventCover
                  src={nextEvent.image}
                  title={nextEvent.title}
                  className="!aspect-auto absolute inset-0 h-full w-full"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent pointer-events-none" />
                <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-500/25 border border-orange-400/40">
                  <span className="text-[10px] font-bold text-orange-200 uppercase tracking-[1px]">STARTING SOON</span>
                </div>
              </div>
              <div className="space-y-3 p-5">
                <h3 className="text-lg font-display font-bold text-foreground">{nextEvent.title}</h3>
                <p className="text-sm font-medium text-orange-200/90">{formatStartsInSoon(nextEvent.eventDate)}</p>
                <div className="flex justify-center gap-2">
                  {[
                    { val: countdown.days, label: "DAYS" },
                    { val: countdown.hours, label: "HRS" },
                    { val: countdown.minutes, label: "MIN" },
                    { val: countdown.seconds, label: "SEC" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex h-14 w-14 flex-col items-center justify-center rounded-xl bg-secondary"
                    >
                      <span className="text-lg font-bold gradient-text">{String(item.val).padStart(2, "0")}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-[1px] text-muted-foreground">
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
                <Button
                  className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white border-0"
                  onClick={() => navigate(`/events/${nextEvent.id}`)}
                >
                  Get Ready →
                </Button>
              </div>
            </motion.section>
          )}

        {!showHeroSkeleton &&
          !isLiveEvent &&
          !startingSoonWithin2h &&
          nextEvent &&
          hasEventAdmissionForNext && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="overflow-hidden rounded-2xl border border-white/10 glass-card"
            >
              <button
                type="button"
                className="relative block w-full text-left"
                onClick={() => navigate(`/events/${nextEvent.id}`)}
              >
                <div className="relative h-40">
                  <EventCover
                    src={nextEvent.image}
                    title={nextEvent.title}
                    className="!aspect-auto absolute inset-0 h-full w-full"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background via-background/65 to-black/20 pointer-events-none" />
                  <div className="absolute top-3 right-3 rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                    {isWaitlistedForNextEvent ? "On waitlist" : "You're registered ✓"}
                  </div>
                  <div className="absolute bottom-3 left-3 pr-3">
                    <h3 className="text-lg font-display font-bold text-white drop-shadow-md">{nextEvent.title}</h3>
                    <p className="text-sm text-white/85 drop-shadow">{formatEventDateTime(nextEvent.eventDate)}</p>
                  </div>
                </div>
              </button>
              <div className="space-y-3 px-5 pb-5 pt-4">
                <p className="text-center text-sm font-medium text-muted-foreground">
                  {formatLongCountdownToEvent(nextEvent.eventDate)}
                </p>
                <div className="flex justify-center gap-2">
                  {[
                    { val: countdown.days, label: "DAYS" },
                    { val: countdown.hours, label: "HRS" },
                    { val: countdown.minutes, label: "MIN" },
                    { val: countdown.seconds, label: "SEC" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex h-14 w-14 flex-col items-center justify-center rounded-xl bg-secondary"
                    >
                      <span className="text-lg font-bold gradient-text">{String(item.val).padStart(2, "0")}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-[1px] text-muted-foreground">
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/events/${nextEvent.id}`)}
                  className="w-full text-center text-sm font-semibold text-primary hover:underline"
                >
                  View Details →
                </button>
              </div>
            </motion.section>
          )}

        {!showHeroSkeleton && !hasEventAdmissionForNext && (
          <div className="glass-card space-y-4 border border-white/10 p-8 text-center">
            <Sparkles className="mx-auto h-10 w-10 text-primary" />
            <h3 className="text-xl font-display font-bold text-foreground">Find your next vibe</h3>
            <p className="text-sm text-muted-foreground">Join an event to meet amazing people live</p>
            <Button variant="gradient" className="w-full" onClick={() => navigate("/events")}>
              Explore Events →
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
                  Browse Events →
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
                      {event.status === "ended" && (
                        <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-amber-400/90">
                          Ended
                        </span>
                      )}
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

        {/* 5. Profile readiness nudge */}
        {!homeProfileLoading &&
          user?.id &&
          profileCompletenessPercent < 80 &&
          !profileReadinessDismissed && (
            <div className="glass-card relative overflow-hidden border border-violet-500/20 bg-violet-500/5 p-4">
              <button
                type="button"
                className="absolute right-2 top-2 rounded-full p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                aria-label="Dismiss"
                onClick={() => {
                  localStorage.setItem(PROFILE_READINESS_DISMISS_KEY, String(Date.now()));
                  setProfileReadinessDismissed(true);
                }}
              >
                <X className="h-4 w-4" />
              </button>
              <p className="pr-8 text-sm font-semibold text-foreground">
                Complete your profile to get 3x more matches
              </p>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
                  style={{ width: `${profileCompletenessPercent}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] uppercase tracking-[1px] text-muted-foreground">
                {profileCompletenessPercent}% complete
              </p>
              <button
                type="button"
                onClick={() => navigate("/profile")}
                className="mt-3 text-sm font-semibold text-primary hover:underline"
              >
                Complete Now →
              </button>
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
