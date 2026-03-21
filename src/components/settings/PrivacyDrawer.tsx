import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Eye,
  Activity,
  Calendar,
  MapPin,
  Crosshair,
  Ban,
  ChevronRight,
  Shield,
  ArrowLeft,
} from "lucide-react";
import { formatDistanceStrict } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Switch } from "@/components/ui/switch";
import { useUserProfile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useBlockUser } from "@/hooks/useBlockUser";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

type DiscoveryMode = "visible" | "snoozed" | "hidden";
type ActivityVis = "matches" | "event_connections" | "nobody";
type EventAttVis = "attendees" | "matches_only" | "hidden";

type PrivacyProfile = {
  discovery_mode: DiscoveryMode | null;
  discovery_snooze_until: string | null;
  activity_status_visibility: ActivityVis | null;
  event_attendance_visibility: EventAttVis | null;
  distance_visibility: "approximate" | "hidden" | null;
  show_distance: boolean | null;
};

const DEFAULTS: PrivacyProfile = {
  discovery_mode: "visible",
  discovery_snooze_until: null,
  activity_status_visibility: "matches",
  event_attendance_visibility: "attendees",
  distance_visibility: "approximate",
  show_distance: true,
};

function discoveryChip(mode: DiscoveryMode | null): string {
  if (mode === "snoozed") return "Snoozed";
  if (mode === "hidden") return "Hidden";
  return "Visible";
}

function activityChip(v: ActivityVis | null): string {
  if (v === "event_connections") return "Event connections";
  if (v === "nobody") return "No one";
  return "Matches";
}

function eventAttChip(v: EventAttVis | null): string {
  if (v === "matches_only") return "Matches";
  if (v === "hidden") return "Hidden";
  return "Everyone";
}

interface PrivacyDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PrivacyDrawer({ open, onOpenChange }: PrivacyDrawerProps) {
  const { user } = useUserProfile();
  const navigate = useNavigate();
  const { blockedUsers, unblockUser } = useBlockUser();
  const [profile, setProfile] = useState<PrivacyProfile>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [geoState, setGeoState] = useState<PermissionState | "unsupported">("prompt");

  const [view, setView] = useState<"main" | "discovery" | "activity" | "event_att" | "blocked">("main");
  const [blockedProfiles, setBlockedProfiles] = useState<Record<string, { name: string }>>({});

  useEffect(() => {
    if (!open) setView("main");
  }, [open]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "discovery_mode, discovery_snooze_until, activity_status_visibility, event_attendance_visibility, distance_visibility, show_distance",
      )
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    if (data) {
      setProfile({
        discovery_mode: (data.discovery_mode as DiscoveryMode) ?? "visible",
        discovery_snooze_until: data.discovery_snooze_until ?? null,
        activity_status_visibility: (data.activity_status_visibility as ActivityVis) ?? "matches",
        event_attendance_visibility: (data.event_attendance_visibility as EventAttVis) ?? "attendees",
        distance_visibility: (data.distance_visibility as "approximate" | "hidden") ?? "approximate",
        show_distance: data.show_distance ?? true,
      });
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!navigator.permissions?.query) {
      setGeoState("unsupported");
      return;
    }
    void navigator.permissions.query({ name: "geolocation" }).then((r) => {
      setGeoState(r.state);
      r.onchange = () => setGeoState(r.state);
    });
  }, [open]);

  useEffect(() => {
    if (!blockedUsers.length) {
      setBlockedProfiles({});
      return;
    }
    const ids = blockedUsers.map((b) => b.blocked_id);
    void supabase
      .from("profiles")
      .select("id, name")
      .in("id", ids)
      .then(({ data }) => {
        const m: Record<string, { name: string }> = {};
        (data || []).forEach((row: { id: string; name: string | null }) => {
          m[row.id] = { name: row.name || "User" };
        });
        setBlockedProfiles(m);
      });
  }, [blockedUsers]);

  const save = async (patch: Partial<PrivacyProfile> & { show_online_status?: boolean }) => {
    if (!user?.id) return;
    const { show_online_status, ...rest } = patch;
    const next = { ...profile, ...rest };
    setProfile(next);
    const body: Record<string, unknown> = {
      discovery_mode: next.discovery_mode,
      discovery_snooze_until: next.discovery_snooze_until,
      activity_status_visibility: next.activity_status_visibility,
      event_attendance_visibility: next.event_attendance_visibility,
      distance_visibility: next.distance_visibility,
      show_distance: next.show_distance,
    };
    if (show_online_status !== undefined) body.show_online_status = show_online_status;
    const { error } = await supabase.from("profiles").update(body).eq("id", user.id);
    if (error) toast.error(error.message);
    else toast.success("Saved");
  };

  const snoozePresets = useMemo(
    () =>
      [
        { ms: 60 * 60 * 1000, label: "1 hour" },
        { ms: 4 * 60 * 60 * 1000, label: "4 hours" },
        { ms: 8 * 60 * 60 * 1000, label: "8 hours" },
        { ms: 24 * 60 * 60 * 1000, label: "24 hours" },
        { ms: 7 * 24 * 60 * 60 * 1000, label: "1 week" },
      ] as const,
    [],
  );

  const snoozeRemaining = useMemo(() => {
    if (profile.discovery_mode !== "snoozed" || !profile.discovery_snooze_until) return null;
    const end = new Date(profile.discovery_snooze_until);
    if (end.getTime() <= Date.now()) return null;
    return formatDistanceStrict(new Date(), end);
  }, [profile.discovery_mode, profile.discovery_snooze_until]);

  const Chip = ({ children }: { children: React.ReactNode }) => (
    <span className="rounded-full border border-primary/30 bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
      {children}
    </span>
  );

  const Row = ({
    icon: Icon,
    title,
    subtitle,
    right,
    onClick,
  }: {
    icon: typeof Eye;
    title: string;
    subtitle: string;
    right: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-xl bg-secondary/40 p-3 text-left transition-colors hover:bg-secondary/60"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">{right}</div>
    </button>
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader>
          {view !== "main" ? (
            <button
              type="button"
              className="mb-2 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setView("main")}
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          ) : null}
          <DrawerTitle className="font-display flex items-center gap-2">
            <Shield className="h-5 w-5 text-neon-cyan" />
            {view === "main" && "Privacy & Visibility"}
            {view === "discovery" && "Discovery mode"}
            {view === "activity" && "Activity status"}
            {view === "event_att" && "Event attendance"}
            {view === "blocked" && "Blocked users"}
          </DrawerTitle>
          <DrawerDescription>
            {view === "main" && "Control who can see you and how"}
            {view === "discovery" && "Choose how discoverable you are"}
            {view === "activity" && "Who can see when you are online"}
            {view === "event_att" && "Who can see events you join"}
            {view === "blocked" && "They cannot message you or see your profile"}
          </DrawerDescription>
        </DrawerHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-4 pb-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : view === "main" ? (
            <>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Discovery
                </p>
                <div className="space-y-2">
                  <Row
                    icon={Eye}
                    title="Discovery Mode"
                    subtitle="Who can see your profile"
                    onClick={() => setView("discovery")}
                    right={
                      <>
                        <Chip>{discoveryChip(profile.discovery_mode)}</Chip>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </>
                    }
                  />
                  {profile.discovery_mode === "snoozed" && snoozeRemaining ? (
                    <p className="text-xs text-amber-500">Snoozed · {snoozeRemaining} remaining</p>
                  ) : null}
                  <Row
                    icon={Activity}
                    title="Activity Status"
                    subtitle="Who sees when you are online"
                    onClick={() => setView("activity")}
                    right={
                      <>
                        <Chip>{activityChip(profile.activity_status_visibility)}</Chip>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </>
                    }
                  />
                  <Row
                    icon={Calendar}
                    title="Event Attendance"
                    subtitle="Who sees events you are attending"
                    onClick={() => setView("event_att")}
                    right={
                      <>
                        <Chip>{eventAttChip(profile.event_attendance_visibility)}</Chip>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </>
                    }
                  />
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Location
                </p>
                <div className="space-y-2">
                  <Row
                    icon={MapPin}
                    title="Location Services"
                    subtitle={
                      geoState === "granted"
                        ? "Allowed in this browser"
                        : geoState === "denied"
                          ? "Blocked — update in browser settings"
                          : "Prompt when the app needs your area"
                    }
                    onClick={() => {
                      toast.message("Browser settings", {
                        description: "Use your browser site settings to allow location for this site.",
                      });
                    }}
                    right={<ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  />
                  <div className="flex items-center justify-between rounded-xl bg-secondary/40 p-3">
                    <div className="flex items-start gap-3">
                      <Crosshair className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium text-foreground">Location precision</p>
                        <p className="text-xs text-muted-foreground">
                          On: approximate distance only. Off: distance hidden. Web never uses precise GPS for others.
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={profile.distance_visibility === "approximate" && !!profile.show_distance}
                      onCheckedChange={(on) => {
                        void save({
                          distance_visibility: on ? "approximate" : "hidden",
                          show_distance: on,
                        });
                      }}
                    />
                  </div>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Safety
                </p>
                <Row
                  icon={Ban}
                  title="Blocked Users"
                  subtitle={blockedUsers.length ? `${blockedUsers.length} blocked` : "Manage blocked people"}
                  onClick={() => setView("blocked")}
                  right={
                    <>
                      {blockedUsers.length > 0 ? <Chip>{blockedUsers.length}</Chip> : null}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </>
                  }
                />
              </div>
            </>
          ) : view === "discovery" ? (
            <div className="space-y-3">
              <Button
                variant="outline"
                className="h-auto w-full justify-start py-3"
                onClick={() => {
                  void save({ discovery_mode: "visible", discovery_snooze_until: null });
                  setView("main");
                }}
              >
                <div className="text-left">
                  <p className="font-medium">Visible</p>
                  <p className="text-xs text-muted-foreground">Everyone can find you</p>
                </div>
              </Button>
              <p className="text-xs font-semibold uppercase text-muted-foreground">Snooze</p>
              <p className="text-xs text-muted-foreground">Hide temporarily</p>
              <div className="flex flex-wrap gap-2">
                {snoozePresets.map(({ ms, label }) => (
                  <Button
                    key={label}
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const until = new Date(Date.now() + ms).toISOString();
                      void save({ discovery_mode: "snoozed", discovery_snooze_until: until });
                      setView("main");
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <Button
                variant="outline"
                className="h-auto w-full justify-start border-destructive/40 py-3"
                onClick={() => {
                  void save({ discovery_mode: "hidden", discovery_snooze_until: null });
                  setView("main");
                }}
              >
                <div className="text-left">
                  <p className="font-medium">Hidden</p>
                  <p className="text-xs text-muted-foreground">Only matches can see you</p>
                </div>
              </Button>
            </div>
          ) : view === "activity" ? (
            <div className="space-y-2">
              {(
                [
                  ["matches", "Matches", "Only your matches see when you are active"],
                  ["event_connections", "Event connections", "People at the same events"],
                  ["nobody", "No one", "Activity status hidden"],
                ] as const
              ).map(([value, title, desc]) => (
                <Button
                  key={value}
                  variant={profile.activity_status_visibility === value ? "default" : "outline"}
                  className="h-auto w-full justify-start py-3"
                  onClick={() => {
                    void save({
                      activity_status_visibility: value,
                      show_online_status: value !== "nobody",
                    });
                    setView("main");
                  }}
                >
                  <div className="text-left">
                    <p className="font-medium">{title}</p>
                    <p className="text-xs opacity-80">{desc}</p>
                  </div>
                </Button>
              ))}
            </div>
          ) : view === "event_att" ? (
            <div className="space-y-2">
              {(
                [
                  ["attendees", "Everyone", "Anyone at the event"],
                  ["matches_only", "Matches", "Only existing matches"],
                  ["hidden", "Hidden", "Attend privately"],
                ] as const
              ).map(([value, title, desc]) => (
                <Button
                  key={value}
                  variant={profile.event_attendance_visibility === value ? "default" : "outline"}
                  className="h-auto w-full justify-start py-3"
                  onClick={() => {
                    void save({ event_attendance_visibility: value });
                    setView("main");
                  }}
                >
                  <div className="text-left">
                    <p className="font-medium">{title}</p>
                    <p className="text-xs opacity-80">{desc}</p>
                  </div>
                </Button>
              ))}
            </div>
          ) : view === "blocked" ? (
            <div className="space-y-2">
              {blockedUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No blocked users</p>
              ) : (
                blockedUsers.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/30 p-3"
                  >
                    <span className="text-sm font-medium">{blockedProfiles[b.blocked_id]?.name ?? "…"}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        unblockUser(b.blocked_id, blockedProfiles[b.blocked_id]?.name ?? "User")
                      }
                    >
                      Unblock
                    </Button>
                  </div>
                ))
              )}
              <Button variant="ghost" className="w-full" onClick={() => navigate("/matches")}>
                Manage from chats or matches
              </Button>
            </div>
          ) : null}
        </div>

        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="gradient">Done</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
