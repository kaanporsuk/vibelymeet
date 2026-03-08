import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Sparkles, CalendarCheck, Users, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/BottomNav";
import { EventCover, ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { EventCardSkeleton, MatchAvatarSkeleton } from "@/components/Skeleton";

import { DateReminderCard, MiniDateCountdown } from "@/components/schedule/DateReminderCard";
import { NotificationPermissionFlow, NotificationPermissionButton } from "@/components/notifications/NotificationPermissionFlow";
import { DashboardGreeting } from "@/components/DashboardGreeting";
import { PullToRefresh } from "@/components/PullToRefresh";
import { ActiveCallBanner } from "@/components/events/ActiveCallBanner";
import { useNextRegisteredEvent, useEvents, useRealtimeEvents } from "@/hooks/useEvents";
import { useDashboardMatches } from "@/hooks/useMatches";
import { useSchedule } from "@/hooks/useSchedule";
import { useDateReminders } from "@/hooks/useDateReminders";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useNotifications } from "@/contexts/NotificationContext";
import { useAuth } from "@/contexts/AuthContext";
import { useOtherCityEvents } from "@/hooks/useVisibleEvents";
import { supabase } from "@/integrations/supabase/client";
import { differenceInSeconds } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { PhoneVerificationNudge } from "@/components/PhoneVerificationNudge";
import { DeletionRecoveryBanner } from "@/components/settings/DeletionRecoveryBanner";
import { useDeletionRecovery } from "@/hooks/useDeletionRecovery";

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  useRealtimeEvents();
  const { pendingDeletion, cancelDeletion, isCancelling } = useDeletionRecovery();

  // Active session detection for rejoin banner
  const [activeSession, setActiveSession] = useState<{ sessionId: string; eventId: string } | null>(null);

  // Phone verification nudge on dashboard
  const [showDashboardPhoneNudge, setShowDashboardPhoneNudge] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    const dismissed = localStorage.getItem("vibely_phone_nudge_dashboard_dismissed");
    if (dismissed) return;

    const check = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("phone_verified")
        .eq("id", user.id)
        .maybeSingle();
      if (data && !data.phone_verified) {
        setShowDashboardPhoneNudge(true);
      }
    };
    check();
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
    checkActive();
  }, [user?.id]);

  const { data: nextEventData, isLoading: eventLoading, refetch: refetchNextEvent } = useNextRegisteredEvent();
  const { data: events = [], isLoading: eventsLoading, refetch: refetchEvents } = useEvents();
  const { data: matches = [], isLoading: matchesLoading, refetch: refetchMatches } = useDashboardMatches();
  const { proposals } = useSchedule();
  const { nextReminder, imminentReminders, requestNotificationPermission } = useDateReminders(proposals);
  const { isGranted, requestPermission, scheduleDailyDropNotification, scheduleDateReminder } = usePushNotifications();
  const { unreadCount, markAllAsRead } = useNotifications();
  const { data: otherCities = [] } = useOtherCityEvents();

  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [showNotificationFlow, setShowNotificationFlow] = useState(false);

  const nextEvent = nextEventData?.event;
  const isRegisteredForNextEvent = nextEventData?.isRegistered || false;
  const isLiveEvent = (nextEvent as any)?.isLive === true;

  const handleRefresh = useCallback(async () => {
    await Promise.all([refetchNextEvent(), refetchEvents(), refetchMatches()]);
  }, [refetchNextEvent, refetchEvents, refetchMatches]);

  const handleNotificationClick = () => {
    markAllAsRead();
    setShowNotificationFlow(true);
  };

  useEffect(() => {
    if (isGranted) scheduleDailyDropNotification();
  }, [isGranted, scheduleDailyDropNotification]);

  useEffect(() => {
    if (isGranted && proposals.length > 0) {
      proposals
        .filter(p => p.status === 'accepted')
        .forEach(p => scheduleDateReminder(p.senderName || 'Your match', p.date, 15));
    }
  }, [isGranted, proposals, scheduleDateReminder]);

  // Countdown timer
  useEffect(() => {
    if (!nextEvent?.eventDate || isLiveEvent) return;
    const updateCountdown = () => {
      const diff = differenceInSeconds(nextEvent.eventDate, new Date());
      if (diff <= 0) { setCountdown({ days: 0, hours: 0, minutes: 0, seconds: 0 }); return; }
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
  const discoverEvents = events.filter(e => e.status !== 'live').slice(0, 4);
  const newMatchCount = matches.filter((m) => m.isNew).length;

  return (
    <PullToRefresh onRefresh={handleRefresh} className="min-h-screen bg-background pb-24">
      {/* Active Call Rejoin Banner */}
      <AnimatePresence>
        {activeSession && (
          <ActiveCallBanner
            sessionId={activeSession.sessionId}
            onRejoin={() => navigate(`/date/${activeSession.sessionId}`)}
            onEnd={async () => {
              await supabase.from("video_sessions").update({ ended_at: new Date().toISOString() }).eq("id", activeSession.sessionId);
              if (user?.id) {
                await supabase.from("event_registrations").update({ queue_status: "browsing", current_room_id: null, current_partner_id: null }).eq("profile_id", user.id).eq("event_id", activeSession.eventId);
              }
              setActiveSession(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* Deletion Recovery Banner */}
      {pendingDeletion && (
        <DeletionRecoveryBanner
          scheduledDate={pendingDeletion.scheduled_deletion_at}
          onCancel={cancelDeletion}
          isCancelling={isCancelling}
        />
      )}

      <NotificationPermissionFlow
        open={showNotificationFlow}
        onOpenChange={setShowNotificationFlow}
        onRequestPermission={requestPermission}
      />

      {/* Header */}
      <header className="sticky top-0 z-40 glass-card border-b border-white/10 px-4 py-4">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <DashboardGreeting />
          <div className="flex items-center gap-2">
            {nextReminder && nextReminder.urgency !== 'none' && (
              <MiniDateCountdown reminder={nextReminder} onClick={() => navigate('/schedule')} />
            )}
            <NotificationPermissionButton
              isGranted={isGranted}
              onClick={handleNotificationClick}
              unreadCount={unreadCount}
            />
            <button onClick={() => navigate('/profile')} className="w-8 h-8 shrink-0">
              <ProfilePhoto
                photos={user?.avatarUrl ? [user.avatarUrl] : undefined}
                name={user?.name}
                size="sm"
                className="w-8 h-8"
              />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-8">
        {/* Phone Verification Nudge */}
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
        {/* Imminent Date Reminders */}
        {imminentReminders.length > 0 && (
          <section className="space-y-3">
            {imminentReminders.map(reminder => (
              <DateReminderCard
                key={reminder.id}
                reminder={reminder}
                onJoinDate={() => navigate('/video-date')}
                onEnableNotifications={() => setShowNotificationFlow(true)}
                notificationsEnabled={isGranted}
              />
            ))}
          </section>
        )}

        {/* SECTION 1: LIVE EVENT — top priority */}
        {isLiveEvent && isRegisteredForNextEvent && nextEvent && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            <div className="relative glass-card overflow-hidden neon-glow-pink">
              {/* Cover background */}
              <div className="absolute inset-0">
                <EventCover src={nextEvent.image} title={nextEvent.title} className="!aspect-auto h-full w-full" />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />
              </div>

              <div className="relative p-6 space-y-4">
                {/* LIVE badge */}
                <div className="flex items-center gap-2">
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-destructive/20 border border-destructive/40"
                  >
                    <Radio className="w-3.5 h-3.5 text-destructive" />
                    <span className="text-xs font-bold text-destructive uppercase tracking-wider">Live Now</span>
                  </motion.div>
                </div>

                <div>
                  <h3 className="text-xl font-display font-bold text-foreground">{nextEvent.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    People vibing right now
                  </p>
                </div>

                <Button
                  variant="gradient"
                  className="w-full text-base py-6"
                  onClick={() => navigate(`/event/${nextEvent.id}/lobby`)}
                >
                  Enter Lobby →
                </Button>
              </div>
            </div>
          </motion.section>
        )}

        {/* SECTION 2: NEXT EVENT (not live) */}
        {!isLiveEvent && nextEvent && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-display font-semibold text-foreground">Next Event</h2>
            </div>

            {loading ? (
              <EventCardSkeleton />
            ) : (
              <div
                className="glass-card overflow-hidden cursor-pointer"
                onClick={() => navigate(`/events/${nextEvent.id}`)}
              >
                <div className="relative h-36 overflow-hidden">
                  <EventCover src={nextEvent.image} title={nextEvent.title} className="!aspect-auto h-full w-full" />
                  <div className="absolute inset-0 bg-gradient-to-t from-background/90 to-transparent" />
                  {isRegisteredForNextEvent && (
                    <span className="absolute top-3 right-3 px-2 py-1 text-xs font-medium rounded-full bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30">
                      ✓ Registered
                    </span>
                  )}
                  <div className="absolute bottom-3 left-3">
                    <h3 className="font-display font-semibold text-lg text-white">
                      {nextEvent.title}
                    </h3>
                    <p className="text-sm text-white/70">{nextEvent.date}</p>
                  </div>
                </div>

                <div className="p-4 space-y-4">
                  {/* Countdown */}
                  <div className="flex justify-center gap-3">
                    {[
                      { value: countdown.days, label: "DAYS" },
                      { value: countdown.hours, label: "HRS" },
                      { value: countdown.minutes, label: "MIN" },
                      { value: countdown.seconds, label: "SEC" },
                    ].map((item, i) => (
                      <div key={i} className="text-center">
                        <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center">
                          <span className="text-xl font-display font-bold gradient-text">
                            {String(item.value).padStart(2, "0")}
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground mt-1">{item.label}</span>
                      </div>
                    ))}
                  </div>

                  {!isRegisteredForNextEvent && (
                    <Button variant="outline" size="sm" className="w-full" onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/events/${nextEvent.id}`);
                    }}>
                      <CalendarCheck className="w-4 h-4 mr-2" />
                      View & Register
                    </Button>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* No events at all */}
        {!nextEvent && !loading && (
          <div className="glass-card p-6 text-center">
            <p className="text-muted-foreground">No upcoming events</p>
            <Button variant="ghost" className="mt-2" onClick={() => navigate("/events")}>
              Browse Events
            </Button>
          </div>
        )}


        {/* Premium Nudge — other cities */}
        {otherCities.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-4 border border-primary/20 bg-gradient-to-r from-primary/5 to-accent/5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xl">💎</span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {otherCities.reduce((sum, c) => sum + Number(c.event_count), 0)} events in {otherCities.length} {otherCities.length === 1 ? 'city' : 'cities'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {otherCities.slice(0, 3).map(c => c.city).join(' · ')}
                    {otherCities.length > 3 ? ` + ${otherCities.length - 3} more` : ''}
                  </p>
                </div>
              </div>
              <Button size="sm" variant="outline" className="shrink-0 text-xs border-primary/30 text-primary"
                onClick={() => navigate("/events")}>
                Go Premium →
              </Button>
            </div>
          </motion.div>
        )}

        {/* SECTION 3: YOUR MATCHES */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-display font-semibold text-foreground">
              Your Matches
              {!loading && newMatchCount > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-neon-pink/20 text-neon-pink">
                  {newMatchCount} new
                </span>
              )}
            </h2>
            <button onClick={() => navigate("/matches")} className="flex items-center text-sm text-primary">
              See all <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-4 overflow-x-auto scrollbar-hide py-2 -mx-4 px-4">
            {loading
              ? Array(5).fill(0).map((_, i) => <MatchAvatarSkeleton key={i} />)
              : matches.length > 0
              ? matches.map((match) => (
                  <button
                    key={match.id}
                    onClick={() => navigate(`/chat/${match.id}`)}
                    className="flex flex-col items-center gap-2 min-w-fit"
                  >
                    <div className={`p-[3px] rounded-full ${match.isNew ? "bg-gradient-primary animate-glow-pulse" : "bg-border"}`}>
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
                    <span className="text-xs text-foreground font-medium truncate max-w-[64px]">
                      {match.name.split(" ")[0]}
                    </span>
                  </button>
                ))
              : (
                <div className="text-center py-4 w-full">
                  <p className="text-sm text-muted-foreground mb-2">No matches yet. Join an event to start connecting!</p>
                  <Button variant="outline" size="sm" onClick={() => navigate("/events")}>
                    Browse Events →
                  </Button>
                </div>
              )}
          </div>
        </section>

        {/* SECTION 4: DISCOVER */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-display font-semibold text-foreground">Upcoming Events</h2>
            <button onClick={() => navigate("/events")} className="flex items-center text-sm text-primary">
              All events <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-2">
            {loading
              ? Array(2).fill(0).map((_, i) => (
                  <div key={i} className="min-w-[260px]"><EventCardSkeleton /></div>
                ))
              : discoverEvents.map((event) => (
                  <div
                    key={event.id}
                    className="min-w-[260px] glass-card overflow-hidden cursor-pointer shrink-0"
                    onClick={() => navigate(`/events/${event.id}`)}
                  >
                    <EventCover src={event.image} title={event.title} />
                    <div className="p-3 space-y-1.5">
                      <h3 className="font-display font-semibold text-sm text-foreground line-clamp-1">{event.title}</h3>
                      <p className="text-xs text-muted-foreground">{event.date} • {event.time}</p>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Users className="w-3 h-3" />
                        {event.attendees} attending
                      </div>
                    </div>
                  </div>
                ))}
          </div>
        </section>
      </main>

      <BottomNav />
    </PullToRefresh>
  );
};

export default Dashboard;
