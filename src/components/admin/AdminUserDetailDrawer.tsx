import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  X,
  User,
  Mail,
  MapPin,
  Calendar,
  Heart,
  MessageSquare,
  Ruler,
  Briefcase,
  Image,
  Video,
  Check,
  Clock,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  Shield,
  Ban,
  Eye,
  MessagesSquare,
  Loader2,
  ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import UserModerationActions, { type AdminModerationReadModel } from "./UserModerationActions";
import AdminProfilePreview from "./AdminProfilePreview";
import AdminMatchMessagesDrawer from "./AdminMatchMessagesDrawer";
import AdminPhotoLightbox from "./AdminPhotoLightbox";
import { getImageUrl, fullScreenUrl, avatarUrl as avatarPreset } from "@/utils/imageUrl";
import AdminGrantCreditsModal from "./AdminGrantCreditsModal";
import { resolvePrimaryProfilePhotoPath } from "../../../shared/profilePhoto/resolvePrimaryProfilePhotoPath";
import AdminPremiumModal from "./AdminPremiumModal";
import { Crown } from "lucide-react";
import { getRelationshipIntentDisplaySafe } from "@shared/profileContracts";
import { resolveWebVibeVideoState } from "@/lib/vibeVideo/webVibeVideoState";
import { VibePlayer } from "@/components/vibe-video/VibePlayer";
import { callAdminRpc, type AdminRpcPayload } from "@/lib/adminRpc";
import { formatAdminUtcDate, formatAdminUtcDateTime } from "@/lib/adminTime";

interface AdminUserDetailDrawerProps {
  userId: string;
  onClose: () => void;
}

type UserVibeRow = {
  label: string | null;
  emoji: string | null;
  category?: string | null;
};

type AdminEmbeddedProfileRow = {
  id: string | null;
  name: string | null;
  avatar_url: string | null;
  photos: string[] | null;
};

type AdminDailyDropRow = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  status: string;
  drop_date: string;
  created_at: string;
  partner_profile?: AdminEmbeddedProfileRow | null;
};

type AdminMatchRow = {
  id: string;
  matched_at: string;
  profile_id_1: string;
  profile_id_2: string;
  other_profile?: AdminEmbeddedProfileRow | null;
};

type AdminUserProfileRow = {
  id: string;
  name: string | null;
  age: number | null;
  gender: string | null;
  birth_date: string | null;
  interested_in: string[] | null;
  tagline: string | null;
  height_cm: number | null;
  location: string | null;
  job: string | null;
  company: string | null;
  about_me: string | null;
  looking_for: string | null;
  relationship_intent: string | null;
  lifestyle?: unknown;
  prompts?: unknown;
  photos: string[] | null;
  avatar_url: string | null;
  bunny_video_uid: string | null;
  bunny_video_status: string | null;
  vibe_caption: string | null;
  photo_verified: boolean | null;
  email_verified: boolean | null;
  verified_email: string | null;
  is_premium: boolean | null;
  subscription_tier: string | null;
  premium_until: string | null;
  is_suspended: boolean | null;
  total_matches: number | null;
  total_conversations: number | null;
  created_at: string;
  updated_at: string;
  onboarding_complete: boolean | null;
  onboarding_stage: string | null;
  last_seen_at: string | null;
  is_bootstrap_fresh: boolean;
  has_activity: boolean;
  lifecycle_status: string | null;
  age_is_placeholder: boolean;
  event_registrations: number | null;
  event_registrations_unavailable: boolean;
};

type PremiumHistoryEntry = {
  id: string;
  action: string;
  premium_until: string | null;
  reason: string | null;
  created_at: string;
  admin_id: string | null;
  adminName: string;
};

type AdminCreditsReadModel = {
  extra_time_credits: number;
  extended_vibe_credits: number;
  updated_at: string | null;
};

type UserDetailReadModelPayload = AdminRpcPayload & {
  profile?: AdminUserProfileRow | null;
  vibes?: UserVibeRow[];
  matches?: AdminMatchRow[];
  daily_drops?: AdminDailyDropRow[];
  moderation?: AdminModerationReadModel | null;
  premium_history?: PremiumHistoryEntry[];
  credits?: AdminCreditsReadModel | null;
};

const EMPTY_VIBES: UserVibeRow[] = [];
const EMPTY_MATCHES: AdminMatchRow[] = [];
const EMPTY_DAILY_DROPS: AdminDailyDropRow[] = [];
const EMPTY_PREMIUM_HISTORY: PremiumHistoryEntry[] = [];
const DEFAULT_CREDITS: AdminCreditsReadModel = {
  extra_time_credits: 0,
  extended_vibe_credits: 0,
  updated_at: null,
};

const getLifecycleBadgeMeta = (status?: string | null) => {
  if (status === "complete") {
    return { label: "Complete", className: "bg-green-500/20 text-green-400 border-green-500/30" };
  }
  if (status === "bootstrap_fresh") {
    return { label: "Bootstrap fresh", className: "bg-amber-500/20 text-amber-300 border-amber-500/30" };
  }
  if (status === "incomplete_active") {
    return { label: "Incomplete active", className: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" };
  }
  if (status === "suspended") {
    return { label: "Suspended", className: "bg-destructive/20 text-destructive border-destructive/30" };
  }
  return { label: "Incomplete", className: "bg-slate-500/20 text-slate-300 border-slate-500/30" };
};

const getProfileGenderLabel = (profile: AdminUserProfileRow): string => {
  const value = profile.gender?.trim().toLowerCase();
  if (!profile.onboarding_complete && (profile.is_bootstrap_fresh || !value || value === "prefer_not_to_say" || value === "prefer not to say")) {
    return "Pending gender";
  }
  return profile.gender || "N/A";
};

const getProfileSubscriptionTier = (profile?: AdminUserProfileRow | null): "free" | "premium" | "vip" => {
  if (!profile?.is_premium) return "free";
  const tier = profile?.subscription_tier?.trim().toLowerCase();
  if (tier === "vip") return "vip";
  return "premium";
};

const formatNullableDateTime = (value?: string | null): string => (
  formatAdminUtcDateTime(value, "N/A")
);

const AdminUserDetailDrawer = ({ userId, onClose }: AdminUserDetailDrawerProps) => {
  const [showModeration, setShowModeration] = useState(false);
  const [showProfilePreview, setShowProfilePreview] = useState(false);
  const [showMatchMessages, setShowMatchMessages] = useState(false);
  const [showGrantCredits, setShowGrantCredits] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [refreshedPhotos, setRefreshedPhotos] = useState<string[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const nestedDialogTriggerRef = useRef<HTMLElement | null>(null);
  const lightboxTriggerRef = useRef<HTMLElement | null>(null);

  const { data: userDetail, isLoading, isError } = useQuery({
    queryKey: ['admin-user-detail', userId],
    queryFn: async () => {
      return callAdminRpc<UserDetailReadModelPayload>("admin_get_user_detail_read_model", {
        p_user_id: userId,
      });
    },
  });

  const profile = userDetail?.profile ?? null;
  const vibes = userDetail?.vibes ?? EMPTY_VIBES;
  const matches = userDetail?.matches ?? EMPTY_MATCHES;
  const dailyDrops = userDetail?.daily_drops ?? EMPTY_DAILY_DROPS;
  const moderation = userDetail?.moderation ?? null;
  const premiumHistory = userDetail?.premium_history ?? EMPTY_PREMIUM_HISTORY;
  const credits = userDetail?.credits ?? DEFAULT_CREDITS;
  const lifecycleMeta = getLifecycleBadgeMeta(profile?.lifecycle_status);
  const profileAgeLabel = profile?.age_is_placeholder ? "Pending age" : profile?.age ?? "N/A";
  const subscriptionTier = getProfileSubscriptionTier(profile);
  const subscriptionTierLabel = subscriptionTier === "vip" ? "VIP" : "Premium";

  const matchProfiles = useMemo(() => {
    const profileMap: Record<string, AdminEmbeddedProfileRow> = {};
    for (const match of matches) {
      const otherId = match.profile_id_1 === userId ? match.profile_id_2 : match.profile_id_1;
      if (match.other_profile) profileMap[otherId] = match.other_profile;
    }
    return profileMap;
  }, [matches, userId]);

  const dropProfiles = useMemo(() => {
    const profileMap: Record<string, AdminEmbeddedProfileRow> = {};
    for (const drop of dailyDrops) {
      const partnerId = drop.user_a_id === userId ? drop.user_b_id : drop.user_a_id;
      if (drop.partner_profile) profileMap[partnerId] = drop.partner_profile;
    }
    return profileMap;
  }, [dailyDrops, userId]);

  // Resolve photos via CDN helper (no async refresh needed)
  useEffect(() => {
    if (!profile?.photos?.length) {
      setRefreshedPhotos([]);
      return;
    }
    setRefreshedPhotos(profile.photos.map((url: string) => fullScreenUrl(url)));
  }, [profile?.photos]);

  const vibeVideo = useMemo(
    () =>
      profile
        ? resolveWebVibeVideoState({
            bunny_video_uid: profile.bunny_video_uid,
            bunny_video_status: profile.bunny_video_status,
            updated_at: profile.updated_at,
            vibe_caption: profile.vibe_caption,
          })
        : null,
    [profile],
  );

  const displayPhotos = refreshedPhotos.length > 0 ? refreshedPhotos : profile?.photos || [];

  const restoreNestedDialogFocus = () => {
    const trigger = nestedDialogTriggerRef.current;
    nestedDialogTriggerRef.current = null;
    window.requestAnimationFrame(() => trigger?.focus());
  };

  const openNestedDialog = (open: () => void, trigger: HTMLElement | null) => {
    nestedDialogTriggerRef.current = trigger;
    open();
  };

  const closeNestedDialog = (close: () => void) => {
    close();
    restoreNestedDialogFocus();
  };

  const openLightbox = (index: number, trigger: HTMLElement | null) => {
    lightboxTriggerRef.current = trigger;
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
    const trigger = lightboxTriggerRef.current;
    lightboxTriggerRef.current = null;
    window.requestAnimationFrame(() => trigger?.focus());
  };

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
      />

      {/* Drawer */}
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed right-0 top-0 h-full w-full max-w-4xl bg-background border-l border-border z-50 overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold font-display text-foreground">User Profile</h2>
            <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
              <X className="w-5 h-5" />
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={(event) => openNestedDialog(() => setShowProfilePreview(true), event.currentTarget)}
              className="gap-2 shrink-0"
            >
              <Eye className="w-4 h-4" />
              Preview
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(event) => openNestedDialog(() => setShowMatchMessages(true), event.currentTarget)}
              className="gap-2 shrink-0"
            >
              <MessagesSquare className="w-4 h-4" />
              Messages
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(event) => openNestedDialog(() => setShowGrantCredits(true), event.currentTarget)}
              className="gap-2 text-primary border-primary/30 hover:bg-primary/10 shrink-0"
            >
              <Sparkles className="w-4 h-4" />
              Credits
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(event) => openNestedDialog(() => setShowPremiumModal(true), event.currentTarget)}
              className="gap-2 text-accent border-accent/30 hover:bg-accent/10 shrink-0"
            >
              <Crown className="w-4 h-4" />
              Premium
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(event) => openNestedDialog(() => setShowModeration(true), event.currentTarget)}
              className="gap-2 text-yellow-500 border-yellow-500/30 hover:bg-yellow-500/10 shrink-0"
            >
              <Shield className="w-4 h-4" />
              Moderate
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-20 bg-secondary/50 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-6 text-center space-y-2">
              <p className="font-medium text-destructive">User detail unavailable</p>
              <p className="text-sm text-muted-foreground">
                Backend admin read failed; this does not prove the user is missing.
              </p>
            </div>
          ) : profile ? (
            <div className="p-6 space-y-6">
              {/* Profile Header */}
              <div className="flex items-start gap-4">
                <Avatar className="h-24 w-24 border-4 border-border">
                  <AvatarImage
                    src={avatarPreset(
                      resolvePrimaryProfilePhotoPath({
                        photos: profile.photos,
                        avatar_url: profile.avatar_url,
                      }),
                    )}
                  />
                  <AvatarFallback className="bg-primary/20 text-primary text-2xl">
                    {profile.name?.[0]?.toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-2xl font-bold text-foreground">{profile.name || "Unnamed user"}</h3>
                    <span className="text-lg text-muted-foreground">{profileAgeLabel}</span>
                    <Badge className={lifecycleMeta.className}>
                      {lifecycleMeta.label}
                    </Badge>
                    {subscriptionTier !== "free" && (
                      <Badge
                        className={
                          subscriptionTier === "vip"
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                            : "bg-primary/20 text-primary border-primary/30"
                        }
                      >
                        <Crown className="w-3 h-3 mr-1" />
                        {subscriptionTierLabel} {profile.premium_until ? `until ${formatAdminUtcDate(profile.premium_until)}` : '(forever)'}
                      </Badge>
                    )}
                    {subscriptionTier === "free" && (
                      <span className="text-xs text-muted-foreground">Free account</span>
                    )}
                    {profile.photo_verified && (
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                        <Check className="w-3 h-3 mr-1" />
                        Verified
                      </Badge>
                    )}
                    {profile.is_suspended && (
                      <Badge className="bg-destructive/20 text-destructive border-destructive/30">
                        <Ban className="w-3 h-3 mr-1" />
                        Suspended
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{profile.tagline || profile.about_me}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="gap-1">
                      <User className="w-3 h-3" />
                      {getProfileGenderLabel(profile)}
                    </Badge>
                    {profile.location && (
                      <Badge variant="outline" className="gap-1">
                        <MapPin className="w-3 h-3" />
                        {profile.location}
                      </Badge>
                    )}
                    {profile.height_cm && (
                      <Badge variant="outline" className="gap-1">
                        <Ruler className="w-3 h-3" />
                        {profile.height_cm}cm
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="glass-card p-4 rounded-xl text-center">
                  <Heart className="w-5 h-5 text-pink-400 mx-auto mb-1" />
                  <p className="text-2xl font-bold text-foreground">{profile.total_matches || 0}</p>
                  <p className="text-xs text-muted-foreground">Matches</p>
                </div>
                <div className="glass-card p-4 rounded-xl text-center">
                  <MessageSquare className="w-5 h-5 text-cyan-400 mx-auto mb-1" />
                  <p className="text-2xl font-bold text-foreground">{profile.total_conversations || 0}</p>
                  <p className="text-xs text-muted-foreground">Conversations</p>
                </div>
                <div className="glass-card p-4 rounded-xl text-center">
                  <Calendar className="w-5 h-5 text-orange-400 mx-auto mb-1" />
                  <p className="text-2xl font-bold text-foreground">
                    {profile.event_registrations_unavailable ? "—" : profile.event_registrations ?? 0}
                  </p>
                  <p className="text-xs text-muted-foreground">Event registrations</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {profile.event_registrations_unavailable ? "Unavailable" : "Not confirmed attendance"}
                  </p>
                </div>
              </div>

              {/* Tabs */}
              <Tabs defaultValue="info" className="w-full">
                <TabsList className="w-full bg-secondary/50">
                  <TabsTrigger value="info" className="flex-1">Info</TabsTrigger>
                  <TabsTrigger value="photos" className="flex-1">Photos</TabsTrigger>
                  <TabsTrigger value="activity" className="flex-1">Activity</TabsTrigger>
                  <TabsTrigger value="matches" className="flex-1">Matches</TabsTrigger>
                </TabsList>

                <TabsContent value="info" className="space-y-4 mt-4">
                  {/* Personal Info */}
                  <div className="glass-card p-4 rounded-xl space-y-3">
                    <h4 className="font-semibold text-foreground">Personal Information</h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">Email</p>
                        <p className="text-foreground">{profile.verified_email || 'Not verified'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Birthday</p>
                        <p className="text-foreground">
                          {profile.birth_date ? formatAdminUtcDate(profile.birth_date, "N/A") : 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Looking For</p>
                        <p className="text-foreground">
                          {profile.relationship_intent || profile.looking_for
                            ? `${getRelationshipIntentDisplaySafe(profile.relationship_intent || profile.looking_for).emoji} ${getRelationshipIntentDisplaySafe(profile.relationship_intent || profile.looking_for).label}`
                            : 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Job</p>
                        <p className="text-foreground">{profile.job || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Company</p>
                        <p className="text-foreground">{profile.company || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Interested In</p>
                        <p className="text-foreground">{profile.interested_in?.join(', ') || 'N/A'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Vibes */}
                  <div className="glass-card p-4 rounded-xl space-y-3">
                    <h4 className="font-semibold text-foreground flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      Vibes
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {vibes?.map((vibe, i: number) => (
                        <Badge key={i} variant="secondary" className="gap-1">
                          {vibe?.emoji} {vibe?.label}
                        </Badge>
                      ))}
                      {(!vibes || vibes.length === 0) && (
                        <p className="text-sm text-muted-foreground">No vibes selected</p>
                      )}
                    </div>
                  </div>

                  {/* Account Info */}
                  <div className="glass-card p-4 rounded-xl space-y-3">
                    <h4 className="font-semibold text-foreground">Account Details</h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">Created</p>
                        <p className="text-foreground">
                          {formatAdminUtcDateTime(profile.created_at)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Last Updated</p>
                        <p className="text-foreground">
                          {formatNullableDateTime(profile.updated_at)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Onboarding</p>
                        <p className="text-foreground">
                          {profile.onboarding_stage || lifecycleMeta.label}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Last Seen</p>
                        <p className="text-foreground">
                          {formatNullableDateTime(profile.last_seen_at)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Credits</p>
                        <p className="text-foreground">
                          {credits.extra_time_credits} extra / {credits.extended_vibe_credits} vibe
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Email Verified</p>
                        <p className={profile.email_verified ? 'text-green-400' : 'text-muted-foreground'}>
                          {profile.email_verified ? 'Yes' : 'No'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Photo Verified</p>
                        <p className={profile.photo_verified ? 'text-green-400' : 'text-muted-foreground'}>
                          {profile.photo_verified ? 'Yes' : 'No'}
                        </p>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="photos" className="mt-4">
                  <div className="grid grid-cols-3 gap-2">
                    {displayPhotos.map((photo: string, i: number) => (
                      <motion.button
                        key={i}
                        type="button"
                        className="aspect-square rounded-xl overflow-hidden bg-secondary/50 cursor-pointer relative group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={(event) => openLightbox(i, event.currentTarget)}
                        aria-label={`Open photo ${i + 1} for ${profile.name || "user"}`}
                      >
                        <img
                          src={photo}
                          alt={`Photo ${i + 1}`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.src = '/placeholder.svg';
                          }}
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                          <ZoomIn className="w-6 h-6 text-white" />
                        </div>
                      </motion.button>
                    ))}
                    {displayPhotos.length === 0 && (
                      <div className="col-span-3 text-center py-8 text-muted-foreground">
                        No photos uploaded
                      </div>
                    )}
                  </div>
                  {vibeVideo && vibeVideo.state !== "none" && (
                    <div className="mt-4">
                      <h4 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                        <Video className="w-4 h-4" />
                        Vibe Video
                        {vibeVideo.uid ? (
                          <span className="text-xs font-normal text-muted-foreground">({vibeVideo.state})</span>
                        ) : null}
                      </h4>
                      {vibeVideo.state === "processing" || vibeVideo.state === "stale_processing" ? (
                        <div className="aspect-video rounded-xl bg-secondary/50 flex flex-col items-center justify-center gap-2 p-4 text-center">
                          <Loader2
                            className={`w-6 h-6 animate-spin ${
                              vibeVideo.state === "stale_processing" ? "text-amber-400" : "text-muted-foreground"
                            }`}
                          />
                          <p className="text-sm text-muted-foreground">
                            {vibeVideo.state === "stale_processing"
                              ? "Still processing — inspect Bunny webhook delivery and profile timestamps"
                              : "Processing — video is in the pipeline"}
                          </p>
                        </div>
                      ) : vibeVideo.state === "failed" ? (
                        <div className="aspect-video rounded-xl bg-secondary/50 flex items-center justify-center p-4 text-center">
                          <p className="text-sm text-destructive">Encoding failed (UID on file)</p>
                        </div>
                      ) : vibeVideo.state === "error" ? (
                        <div className="aspect-video rounded-xl bg-secondary/50 flex items-center justify-center p-4 text-center">
                          <p className="text-sm text-muted-foreground">Inconsistent row: status without UID</p>
                        </div>
                      ) : vibeVideo.state === "ready" && vibeVideo.playbackUrl ? (
                        <div className="aspect-video rounded-xl overflow-hidden bg-secondary">
                          <VibePlayer
                            videoUrl={vibeVideo.playbackUrl}
                            thumbnailUrl={vibeVideo.thumbnailUrl ?? undefined}
                            vibeCaption={vibeVideo.caption ?? undefined}
                            autoPlay={false}
                            showControls
                            className="w-full h-full"
                            backendReportsReady
                          />
                        </div>
                      ) : vibeVideo.state === "ready" && !vibeVideo.playbackUrl ? (
                        <div className="aspect-video rounded-xl bg-secondary/50 flex items-center justify-center p-4 text-center">
                          <p className="text-sm text-muted-foreground">
                            Ready in DB — playback URL missing (CDN host / env)
                          </p>
                        </div>
                      ) : null}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="activity" className="mt-4 space-y-4">
                  <h4 className="font-semibold text-foreground">Daily Drop Activity</h4>
                  <div className="space-y-2">
                    {dailyDrops?.map((drop) => {
                      const partnerId = drop.user_a_id === userId ? drop.user_b_id : drop.user_a_id;
                      const partner = dropProfiles?.[partnerId];
                      return (
                        <div key={drop.id} className="glass-card p-3 rounded-xl flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage
                              src={avatarPreset(
                                resolvePrimaryProfilePhotoPath({
                                  photos: partner?.photos,
                                  avatar_url: partner?.avatar_url,
                                }),
                              )}
                            />
                            <AvatarFallback>{partner?.name?.[0] || '?'}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-foreground">
                              {partner?.name || 'Unknown'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatAdminUtcDate(drop.created_at)}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              drop.status === 'matched'
                                ? 'bg-green-500/10 text-green-400 border-green-500/30'
                                : drop.status === 'passed'
                                ? 'bg-red-500/10 text-red-400 border-red-500/30'
                                : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
                            }
                          >
                            {drop.status === 'matched' && <ThumbsUp className="w-3 h-3 mr-1" />}
                            {drop.status === 'passed' && <ThumbsDown className="w-3 h-3 mr-1" />}
                            {drop.status.startsWith('active') && <Clock className="w-3 h-3 mr-1" />}
                            {drop.status}
                          </Badge>
                        </div>
                      );
                    })}
                    {(!dailyDrops || dailyDrops.length === 0) && (
                      <p className="text-center py-8 text-muted-foreground">No activity recorded</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="matches" className="mt-4 space-y-4">
                  <h4 className="font-semibold text-foreground">Matches ({matches?.length || 0})</h4>
                  <div className="space-y-2">
                    {matches?.map((match) => {
                      const otherId = match.profile_id_1 === userId ? match.profile_id_2 : match.profile_id_1;
                      const otherUser = matchProfiles?.[otherId];
                      return (
                        <div key={match.id} className="glass-card p-3 rounded-xl flex items-center gap-3">
                          <Avatar className="h-10 w-10 border-2 border-pink-500/30">
                            <AvatarImage
                              src={avatarPreset(
                                resolvePrimaryProfilePhotoPath({
                                  photos: otherUser?.photos,
                                  avatar_url: otherUser?.avatar_url,
                                }),
                              )}
                            />
                            <AvatarFallback>{otherUser?.name?.[0] || '?'}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-foreground">
                              {otherUser?.name || 'Unknown'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Matched {formatAdminUtcDate(match.matched_at)}
                            </p>
                          </div>
                          <Heart className="w-4 h-4 text-pink-400" />
                        </div>
                      );
                    })}
                    {(!matches || matches.length === 0) && (
                      <p className="text-center py-8 text-muted-foreground">No matches yet</p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <div className="p-6 text-center text-muted-foreground">
              User not found
            </div>
          )}
        </ScrollArea>
      </motion.div>

      {/* Moderation Modal */}
      {profile && (
        <UserModerationActions
          userId={userId}
          userName={profile.name || 'User'}
          moderation={moderation}
          isOpen={showModeration}
          onClose={() => closeNestedDialog(() => setShowModeration(false))}
        />
      )}

      {/* Profile Preview Modal */}
      <AdminProfilePreview
        profile={profile}
        vibes={vibes}
        isOpen={showProfilePreview}
        onClose={() => closeNestedDialog(() => setShowProfilePreview(false))}
      />

      {/* Match Messages Drawer */}
      {profile && (
        <AdminMatchMessagesDrawer
          userId={userId}
          userName={profile.name || 'User'}
          isOpen={showMatchMessages}
          onClose={() => closeNestedDialog(() => setShowMatchMessages(false))}
        />
      )}

      {/* Photo Lightbox */}
      <AdminPhotoLightbox
        photos={displayPhotos}
        initialIndex={lightboxIndex}
        isOpen={lightboxOpen}
        onClose={closeLightbox}
      />

      {/* Grant Credits Modal */}
      {profile && (
        <AdminGrantCreditsModal
          userId={userId}
          userName={profile.name || 'User'}
          currentCredits={credits}
          isOpen={showGrantCredits}
          onClose={() => closeNestedDialog(() => setShowGrantCredits(false))}
        />
      )}

      {/* Premium Modal */}
      {profile && (
        <AdminPremiumModal
          userId={userId}
          userName={profile.name || 'User'}
          currentIsPremium={profile.is_premium || false}
          currentSubscriptionTier={profile.subscription_tier || "free"}
          currentPremiumUntil={profile.premium_until || null}
          history={premiumHistory}
          isOpen={showPremiumModal}
          onClose={() => closeNestedDialog(() => setShowPremiumModal(false))}
          onReopen={() => setShowPremiumModal(true)}
        />
      )}
    </>
  );
};

export default AdminUserDetailDrawer;
