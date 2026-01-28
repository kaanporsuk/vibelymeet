import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, ChevronRight, Sparkles, Video, CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/BottomNav";
import { EventCard } from "@/components/EventCard";
import { MatchAvatar } from "@/components/MatchAvatar";
import { EventCardSkeleton, MatchAvatarSkeleton } from "@/components/Skeleton";
import { DailyDropSection } from "@/components/daily-drop/DailyDropSection";
import { DateReminderCard, MiniDateCountdown } from "@/components/schedule/DateReminderCard";
import { NotificationPermissionFlow, NotificationPermissionButton } from "@/components/notifications/NotificationPermissionFlow";
import { DashboardGreeting } from "@/components/DashboardGreeting";
import { PullToRefresh } from "@/components/PullToRefresh";
import { useNextRegisteredEvent, useEvents, useRealtimeEvents } from "@/hooks/useEvents";
import { useDashboardMatches } from "@/hooks/useMatches";
import { useSchedule } from "@/hooks/useSchedule";
import { useDateReminders } from "@/hooks/useDateReminders";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useNotifications } from "@/contexts/NotificationContext";
import { differenceInSeconds } from "date-fns";

const Dashboard = () => {
  const navigate = useNavigate();
  
  // Enable realtime updates for events
  useRealtimeEvents();
  
  const { data: nextEventData, isLoading: eventLoading, refetch: refetchNextEvent } = useNextRegisteredEvent();
  const { data: events = [], isLoading: eventsLoading, refetch: refetchEvents } = useEvents();
  const { data: matches = [], isLoading: matchesLoading, refetch: refetchMatches } = useDashboardMatches();
  const { proposals } = useSchedule();
  const { nextReminder, imminentReminders, requestNotificationPermission } = useDateReminders(proposals);
  const { isGranted, requestPermission, scheduleDailyDropNotification, scheduleDateReminder } = usePushNotifications();
  const { unreadCount, markAllAsRead } = useNotifications();
  
  const [countdown, setCountdown] = useState({ hours: 0, minutes: 0, seconds: 0 });
  const [showNotificationFlow, setShowNotificationFlow] = useState(false);

  const nextEvent = nextEventData?.event;
  const isRegisteredForNextEvent = nextEventData?.isRegistered || false;

  // Pull to refresh handler
  const handleRefresh = useCallback(async () => {
    await Promise.all([
      refetchNextEvent(),
      refetchEvents(),
      refetchMatches(),
    ]);
  }, [refetchNextEvent, refetchEvents, refetchMatches]);

  const handleNotificationClick = () => {
    markAllAsRead();
    setShowNotificationFlow(true);
  };

  // Schedule daily drop notification when granted
  useEffect(() => {
    if (isGranted) {
      scheduleDailyDropNotification();
    }
  }, [isGranted, scheduleDailyDropNotification]);

  // Schedule date reminders for accepted proposals
  useEffect(() => {
    if (isGranted && proposals.length > 0) {
      proposals
        .filter(p => p.status === 'accepted')
        .forEach(p => {
          scheduleDateReminder(p.senderName || 'Your match', p.date, 15);
        });
    }
  }, [isGranted, proposals, scheduleDateReminder]);

  // Countdown timer
  useEffect(() => {
    if (!nextEvent?.eventDate) return;

    const updateCountdown = () => {
      const now = new Date();
      const diff = differenceInSeconds(nextEvent.eventDate, now);
      
      if (diff <= 0) {
        setCountdown({ hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      const hours = Math.floor(diff / 3600);
      const minutes = Math.floor((diff % 3600) / 60);
      const seconds = diff % 60;
      
      setCountdown({ hours, minutes, seconds });
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [nextEvent?.eventDate]);

  const loading = eventLoading || eventsLoading || matchesLoading;
  const discoverEvents = events.slice(0, 2);
  const newMatchCount = matches.filter((m) => m.isNew).length;

  return (
    <PullToRefresh onRefresh={handleRefresh} className="min-h-screen bg-background pb-24">
      {/* Notification Permission Flow */}
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
            {/* Mini date countdown if upcoming */}
            {nextReminder && nextReminder.urgency !== 'none' && (
              <MiniDateCountdown
                reminder={nextReminder}
                onClick={() => navigate('/schedule')}
              />
            )}
            <NotificationPermissionButton
              isGranted={isGranted}
              onClick={handleNotificationClick}
              unreadCount={unreadCount}
            />
            <div className="w-10 h-10 rounded-full bg-gradient-primary flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-8">
        {/* Imminent Date Reminder - Top Priority */}
        {imminentReminders.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-display font-semibold text-foreground flex items-center gap-2">
              <Video className="w-5 h-5 text-destructive animate-pulse" />
              Starting Soon
            </h2>
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

        {/* Daily Drop */}
        <DailyDropSection />

        {/* Next Event Hero */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-display font-semibold text-foreground">Next Event</h2>
            <Clock className="w-4 h-4 text-muted-foreground" />
          </div>

          {loading ? (
            <EventCardSkeleton />
          ) : nextEvent ? (
            <div 
              className="glass-card p-6 space-y-4 neon-glow-violet cursor-pointer"
              onClick={() => navigate(`/events/${nextEvent.id}`)}
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center">
                  <span className="text-2xl">{nextEvent.emoji}</span>
                </div>
                <div className="flex-1">
                  <h3 className="font-display font-semibold text-foreground">
                    {nextEvent.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{nextEvent.date}</p>
                </div>
                {isRegisteredForNextEvent && (
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30">
                    ✓ Registered
                  </span>
                )}
              </div>

              <div className="flex justify-center gap-4">
                {[
                  { value: countdown.hours, label: "HRS" },
                  { value: countdown.minutes, label: "MIN" },
                  { value: countdown.seconds, label: "SEC" },
                ].map((item, i) => (
                  <div key={i} className="text-center">
                    <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center">
                      <span className="text-2xl font-display font-bold gradient-text">
                        {String(item.value).padStart(2, "0")}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground mt-1">{item.label}</span>
                  </div>
                ))}
              </div>

              {isRegisteredForNextEvent ? (
                <Button variant="gradient" className="w-full" onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/date/${nextEvent.id}`);
                }}>
                  Join Waiting Room
                </Button>
              ) : (
                <Button variant="outline" className="w-full" onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/events/${nextEvent.id}`);
                }}>
                  <CalendarCheck className="w-4 h-4 mr-2" />
                  View Event & Register
                </Button>
              )}
            </div>
          ) : (
            <div className="glass-card p-6 text-center">
              <p className="text-muted-foreground">No upcoming events</p>
              <Button variant="ghost" className="mt-2" onClick={() => navigate("/events")}>
                Browse Events
              </Button>
            </div>
          )}
        </section>

        {/* Matches Rail */}
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
            <button
              onClick={() => navigate("/matches")}
              className="flex items-center text-sm text-primary"
            >
              See all <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-4 overflow-x-auto scrollbar-hide py-2 -mx-4 px-4">
            {loading
              ? Array(5)
                  .fill(0)
                  .map((_, i) => <MatchAvatarSkeleton key={i} />)
              : matches.length > 0
              ? matches.map((match) => (
                  <MatchAvatar
                    key={match.id}
                    image={match.image}
                    name={match.name}
                    isNew={match.isNew}
                    onClick={() => navigate(`/chat/${match.id}`)}
                  />
                ))
              : (
                <div className="text-center py-4 w-full text-muted-foreground text-sm">
                  No matches yet. Join an event to start connecting!
                </div>
              )}
          </div>
        </section>

        {/* Discover Events */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-display font-semibold text-foreground">Discover</h2>
            <button
              onClick={() => navigate("/events")}
              className="flex items-center text-sm text-primary"
            >
              All events <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            {loading
              ? Array(2)
                  .fill(0)
                  .map((_, i) => <EventCardSkeleton key={i} />)
              : discoverEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    id={event.id}
                    title={event.title}
                    image={event.image}
                    date={event.date}
                    time={event.time}
                    attendees={event.attendees}
                    tags={event.tags}
                  />
                ))}
          </div>
        </section>
      </main>

      <BottomNav />
    </PullToRefresh>
  );
};

export default Dashboard;
