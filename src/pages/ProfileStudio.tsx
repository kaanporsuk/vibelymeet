import { useState, useEffect, useRef, useMemo, useCallback, useId } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Settings,
  LogOut,
  Camera,
  Briefcase,
  Ruler,
  MapPin,
  Sparkles,
  Eye,
  ChevronRight,
  Quote,
  Target,
  Video,
  Pencil,
  CalendarDays,
  Cake,
  Loader2,
  Mail,
  Phone,
  Play,
  Plus,
  CheckCircle2,
  MessageCircle,
  Heart,
  Calendar,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { persistPhotos } from "@/services/storageService";
import { BottomNav } from "@/components/BottomNav";
import { PhotoPreviewModal } from "@/components/PhotoPreviewModal";
import PhotoManageDrawer from "@/components/photos/PhotoManageDrawer";
import { PhotoManager } from "@/components/PhotoManager";
import { VibeTagSelector } from "@/components/VibeTagSelector";
import { ProfilePrompt, PromptSelector } from "@/components/ProfilePrompt";
import { RelationshipIntent } from "@/components/RelationshipIntent";
import { LifestyleDetails } from "@/components/LifestyleDetails";
import { VerificationSteps } from "@/components/VerificationBadge";
import { HeightSelector } from "@/components/HeightSelector";
import VibeStudioModal from "@/components/vibe-video/VibeStudioModal";
import { VibeVideoFullscreenPlayer } from "@/components/vibe-video/VibeVideoFullscreenPlayer";
import { resolveWebVibeVideoState } from "@/lib/vibeVideo/webVibeVideoState";
import { VibeScoreDrawer } from "@/components/profile/VibeScoreDrawer";
import type { VibeScoreActionId, VibeScoreProfileSnapshot } from "@/lib/vibeScoreIncompleteActions";
import { SimplePhotoVerification } from "@/components/verification/SimplePhotoVerification";
import { PhoneVerification } from "@/components/PhoneVerification";
import { EmailVerificationFlow } from "@/components/verification/EmailVerificationFlow";
import { useLogout } from "@/hooks/useLogout";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useSchedule, type TimeBlock } from "@/hooks/useSchedule";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { resolvePhotoVerificationState, type PhotoVerificationState } from "@/lib/photoVerificationState";
import { fetchMyPhoneVerificationProfile } from "@/lib/phoneVerificationState";
import { isCurrentEmailVerified } from "@shared/verificationSemantics";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  fetchMyProfile,
  updateMyProfile,
  autoDetectLocation,
  getZodiacSign,
  getZodiacEmoji,
  calculateAge,
  type ProfileData,
  type GeoLocation,
} from "@/services/profileService";
import { Crown, Star } from "lucide-react";
import { format, startOfDay, addDays } from "date-fns";

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

interface ProfilePromptData {
  question: string;
  answer: string;
}

interface UserProfile {
  id: string;
  name: string;
  birthDate: Date | null;
  age: number | null;
  zodiac: string | null;
  tagline: string | null;
  job: string | null;
  company: string | null;
  heightCm: number | null;
  location: string | null;
  locationData: { lat: number; lng: number } | null;
  aboutMe: string | null;
  photos: string[];
  vibes: string[];
  prompts: ProfilePromptData[];
  lookingFor: string | null;
  lifestyle: Record<string, string>;
  verified: boolean;
  photoVerified: boolean;
  bunnyVideoUid: string | null;
  bunnyVideoStatus: string;
  vibeCaption: string;
  stats: {
    events: number;
    matches: number;
    conversations: number;
  };
  /** Server-computed; read from profiles.vibe_score */
  vibeScore: number;
  vibeScoreLabel: string;
}

const initialProfile: UserProfile = {
  id: "",
  name: "",
  birthDate: null,
  age: null,
  zodiac: null,
  tagline: null,
  job: null,
  company: null,
  heightCm: null,
  location: null,
  locationData: null,
  aboutMe: null,
  photos: [],
  vibes: [],
  prompts: [],
  lookingFor: null,
  lifestyle: {},
  verified: false,
  photoVerified: false,
  bunnyVideoUid: null,
  bunnyVideoStatus: "none",
  vibeCaption: "",
  stats: { events: 0, matches: 0, conversations: 0 },
  vibeScore: 0,
  vibeScoreLabel: "New",
};

type DrawerType =
  | "photos"
  | "vibes"
  | "basics"
  | "bio"
  | "prompt"
  | "intent"
  | "lifestyle"
  | "verification"
  | "vibe-video"
  | "tagline"
  | null;

const MAX_ABOUT_ME_LENGTH = 140;
const MAX_PHOTOS = 6;

// ────────────────────────────────────────────────────────────────────
// Quick Actions config
// ────────────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { key: "video", icon: Video, label: "Video", color: "#06B6D4", scrollTo: "video" },
  { key: "photos", icon: Camera, label: "Photos", color: "#E84393", scrollTo: "photos" },
  { key: "prompts", icon: MessageCircle, label: "Prompts", color: "#8B5CF6", scrollTo: "prompts" },
  { key: "intent", icon: Heart, label: "Intent", color: "#F472B6", scrollTo: "lookingFor" },
  { key: "schedule", icon: Calendar, label: "Schedule", color: "#8B5CF6", scrollTo: "schedule" },
] as const;

const PROMPT_EMOJIS: Record<string, string> = {
  "A shower thought I had recently": "🚿",
  "My simple pleasures": "✨",
  "The way to win me over": "💫",
  "I geek out on": "🤓",
  "Together, we could": "🌙",
  "My most controversial opinion": "🔥",
  "I'm looking for": "🔮",
  "A life goal of mine": "🎯",
  "My love language is": "💕",
  "Two truths and a lie": "🎭",
};

const TIME_BLOCKS: TimeBlock[] = ["morning", "afternoon", "evening", "night"];

/** Native-sized score ring (~48px) with violet→pink progress stroke */
function VibeScoreHeroCircle({ score }: { score: number }) {
  const uid = useId().replace(/:/g, "");
  const size = 48;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, score));
  const offset = circumference * (1 - clamped / 100);
  const gradId = `vibeScoreHeroGrad-${uid}`;

  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center" aria-hidden>
      <svg width={size} height={size} className="absolute inset-0">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#E84393" />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={r} fill="#1a1a2e" stroke="rgba(255,255,255,0.1)" strokeWidth={stroke} />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={stroke}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      <span className="relative text-lg font-bold text-white">{Math.round(clamped)}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────

const ProfileStudio = () => {
  const navigate = useNavigate();
  const { handleLogout } = useLogout();
  const { hasBadge, badgeType } = useEntitlements();
  const [profile, setProfile] = useState<UserProfile>(initialProfile);
  const [activeDrawer, setActiveDrawer] = useState<DrawerType>(null);
  const [editForm, setEditForm] = useState<UserProfile>(initialProfile);
  const [editPhotoFiles, setEditPhotoFiles] = useState<(File | null)[]>([]);
  const [editingPromptIndex, setEditingPromptIndex] = useState<number | null>(null);
  const [promptEditorMode, setPromptEditorMode] = useState<"add" | "edit">("edit");
  const [showVibeScoreDrawer, setShowVibeScoreDrawer] = useState(false);
  const [showVibeStudio, setShowVibeStudio] = useState(false);
  const [showVibePlayer, setShowVibePlayer] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [showPhotoViewer, setShowPhotoViewer] = useState(false);
  const [showPhotoDrawer, setShowPhotoDrawer] = useState(false);
  const [thumbnailError, setThumbnailError] = useState(false);
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [showPhotoVerification, setShowPhotoVerification] = useState(false);
  const [showPhoneVerification, setShowPhoneVerification] = useState(false);
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [accountEmailConfirmed, setAccountEmailConfirmed] = useState(false);
  const [emailForVerification, setEmailForVerification] = useState("");
  const [photoVerificationStatus, setPhotoVerificationStatus] = useState<PhotoVerificationState>("none");
  const [meetingPref, setMeetingPref] = useState<"events" | "dates" | "both">("both");

  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { mySchedule, dateRange, isLoading: scheduleLoading } = useSchedule();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("__vibely_diag") !== "1") return;
    console.info("[diag] ProfileStudio mounted", { path: window.location.pathname });
  }, []);

  // ── Data loading (same as legacy) ─────────────────────────────

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setAccountEmailConfirmed(!!user.email_confirmed_at);
          const { data: phoneData } = await supabase
            .from("profiles")
            .select("phone_verified, phone_number, email_verified, verified_email, photo_verified, photo_verification_expires_at")
            .eq("id", user.id)
            .maybeSingle();
          if (phoneData?.phone_verified) setPhoneVerified(true);
          setPhoneNumber((phoneData?.phone_number as string | null | undefined) ?? null);
          setEmailVerified(
            isCurrentEmailVerified({
              emailVerified: !!phoneData?.email_verified,
              verifiedEmail: (phoneData?.verified_email as string | null | undefined) ?? null,
              authEmail: user.email ?? null,
              authEmailConfirmed: !!user.email_confirmed_at,
            }),
          );
          setEmailForVerification(user.email ?? "");
          const profilePhotoVerified = phoneData?.photo_verified;
          const photoVerificationExpiresAt = phoneData?.photo_verification_expires_at;

          if (profilePhotoVerified) {
            setPhotoVerificationStatus(
              resolvePhotoVerificationState({
                photoVerified: profilePhotoVerified,
                photoVerificationExpiresAt,
                latestPhotoVerificationStatus: null,
              }),
            );
          } else {
            const { data: pendingVerification } = await supabase
              .from("photo_verifications")
              .select("status")
              .eq("user_id", user.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            setPhotoVerificationStatus(
              resolvePhotoVerificationState({
                photoVerified: profilePhotoVerified,
                photoVerificationExpiresAt,
                latestPhotoVerificationStatus: pendingVerification?.status,
              }),
            );
          }
        }
        const data = await fetchMyProfile();
        if (data) {
          const prompts = data.prompts?.length ? data.prompts : [{ question: "", answer: "" }, { question: "", answer: "" }, { question: "", answer: "" }];
          setProfile({
            id: data.id,
            name: data.name,
            birthDate: data.birthDate,
            age: data.age,
            zodiac: data.zodiac,
            tagline: data.tagline,
            job: data.job,
            company: data.company,
            heightCm: data.heightCm,
            location: data.location,
            locationData: data.locationData,
            aboutMe: data.aboutMe,
            photos: data.photos,
            vibes: data.vibes,
            prompts,
            lookingFor: data.lookingFor,
            lifestyle: data.lifestyle,
            verified: false,
            photoVerified: data.photoVerified || false,
            bunnyVideoUid: data.bunnyVideoUid || null,
            bunnyVideoStatus: data.bunnyVideoStatus || "none",
            vibeCaption: (data as any).vibeCaption || "",
            stats: data.stats,
            vibeScore: data.vibeScore ?? 0,
            vibeScoreLabel: data.vibeScoreLabel ?? "New",
          });
          const stored = data.lifestyle?.meeting_preference;
          if (stored === "events" || stored === "dates" || stored === "both") setMeetingPref(stored as any);
        }
      } catch (error) {
        console.error("Error loading profile:", error);
      } finally {
        setIsLoading(false);
      }
    };
    loadProfile();
  }, [profileRefreshKey]);

  useEffect(() => {
    if (!showVibeStudio) return;
    if (profile.bunnyVideoStatus === "failed") setProfile((prev) => ({ ...prev, bunnyVideoStatus: "none" }));
  }, [showVibeStudio]);

  const vibeVideoInfo = useMemo(
    () =>
      resolveWebVibeVideoState({
        bunnyVideoUid: profile.bunnyVideoUid,
        bunnyVideoStatus: profile.bunnyVideoStatus,
        vibeCaption: profile.vibeCaption,
      }),
    [profile.bunnyVideoUid, profile.bunnyVideoStatus, profile.vibeCaption],
  );
  const vibeVideoPlaybackUrl = vibeVideoInfo.playbackUrl;
  const hasVibeVideo = vibeVideoInfo.state === "ready" && !!vibeVideoInfo.playbackUrl;
  const isVibeVideoProcessing =
    vibeVideoInfo.state === "processing" || vibeVideoInfo.state === "uploading";
  const isVibeVideoFailed = vibeVideoInfo.state === "failed";
  const isVibeVideoDataError = vibeVideoInfo.state === "error";
  const readyAwaitingPlaybackUrl = vibeVideoInfo.state === "ready" && !vibeVideoInfo.playbackUrl;
  const thumbnailUrl = vibeVideoInfo.thumbnailUrl;

  useEffect(() => {
    setThumbnailError(false);
  }, [thumbnailUrl]);

  // ── Derived data ──────────────────────────────────────────────

  const vibeScore = profile.vibeScore ?? 0;

  const vibeScoreProfileSnapshot = useMemo(
    (): VibeScoreProfileSnapshot => ({
      photos: profile.photos,
      bunnyVideoUid: profile.bunnyVideoUid,
      bunnyVideoStatus: profile.bunnyVideoStatus,
      vibes: profile.vibes,
      prompts: profile.prompts,
      aboutMe: profile.aboutMe,
      tagline: profile.tagline,
      relationshipIntent: (profile as any).relationshipIntent ?? null,
      lookingFor: profile.lookingFor,
      job: profile.job,
      heightCm: profile.heightCm,
      lifestyle: profile.lifestyle,
      phoneVerified,
      emailVerified,
      photoVerified: profile.photoVerified,
      name: profile.name,
    }),
    [profile, phoneVerified, emailVerified],
  );
  const filledPromptCount = profile.prompts.filter((p) => p.question?.trim() && p.answer?.trim()).length;
  const storedMeetingPref = profile.lifestyle?.meeting_preference ?? "both";

  const isSlotOpen = useCallback((date: Date, block: TimeBlock): boolean => {
    const key = `${format(date, "yyyy-MM-dd")}_${block}`;
    return mySchedule[key]?.status === "open";
  }, [mySchedule]);

  const scheduleStatus = useMemo(() => {
    if (scheduleLoading || dateRange.length === 0) return { label: "No schedule set", color: "#6B7280" };
    const hasAnyOpen = Object.values(mySchedule).some((v) => v.status === "open");
    if (!hasAnyOpen) return { label: "No schedule set", color: "#6B7280" };
    const todayStr = format(startOfDay(new Date()), "yyyy-MM-dd");
    for (const date of dateRange) {
      const dateStr = format(date, "yyyy-MM-dd");
      const dayHasOpen = TIME_BLOCKS.some((b) => isSlotOpen(date, b));
      if (dayHasOpen) {
        if (dateStr === todayStr) return { label: "Available today", color: "#22c55e" };
        const dayName = format(date, "EEEE");
        return { label: `Next available: ${dayName}`, color: "#F59E0B" };
      }
    }
    return { label: "No schedule set", color: "#6B7280" };
  }, [dateRange, mySchedule, scheduleLoading, isSlotOpen]);

  // ── Verification steps ────────────────────────────────────────

  const getPhotoVerificationStep = () => {
    switch (photoVerificationStatus) {
      case "approved":
        return { id: "photo", label: "Photo verification", description: "Verified", icon: Camera, completed: true };
      case "pending":
        return { id: "photo", label: "Photo verification", description: "⏳ Under Review", icon: Camera, completed: false };
      case "rejected":
        return { id: "photo", label: "Photo verification", description: "❌ Declined — Try again", icon: Camera, completed: false };
      case "expired":
        return { id: "photo", label: "Photo verification", description: "🔄 Expired — Re-verify", icon: Camera, completed: false };
      default:
        return { id: "photo", label: "Photo verification", description: "Take a quick selfie", icon: Camera, completed: false };
    }
  };

  const verificationSteps = [
    {
      id: "email",
      label: "Email verification",
      description: emailVerified
        ? "Current account email verified"
        : accountEmailConfirmed
          ? "Verify your current email"
          : "Confirm your email in your inbox first",
      icon: Mail,
      completed: emailVerified,
    },
    getPhotoVerificationStep(),
    { id: "phone", label: "Phone number", description: phoneVerified ? "Verified" : "Verify your number", icon: Phone, completed: phoneVerified },
  ];

  const handleVerificationStep = (stepId: string) => {
    if (stepId === "email") {
      if (emailVerified) {
        toast.success("Your email is already verified ✓");
        return;
      }
      if (!accountEmailConfirmed) {
        toast.info("Confirm your current account email from your inbox first.");
        return;
      }
      setShowEmailVerification(true);
      scrollToSection("verification");
      return;
    }
    if (stepId === "photo") {
      if (photoVerificationStatus === "approved") { toast.success("Photo already verified ✓"); return; }
      if (photoVerificationStatus === "pending") { toast.info("Your verification is under review."); return; }
      if (profile.photos.length === 0) { toast.error("Please add a profile photo first"); return; }
      setShowPhotoVerification(true);
    }
    if (stepId === "phone" && !phoneVerified) setShowPhoneVerification(true);
  };

  // ── Save handler (same as legacy) ─────────────────────────────

  const handleSave = async (type: DrawerType) => {
    setIsSaving(true);
    try {
      const updates: Partial<ProfileData> = {};
      switch (type) {
        case "basics":
          updates.name = editForm.name;
          updates.job = editForm.job;
          updates.company = editForm.company;
          updates.heightCm = editForm.heightCm;
          updates.location = editForm.location;
          updates.locationData = editForm.locationData;
          break;
        case "bio":
          updates.aboutMe = (editForm.aboutMe ?? "").trim().slice(0, MAX_ABOUT_ME_LENGTH) || null;
          break;
        case "vibes":
          updates.vibes = editForm.vibes;
          break;
        case "intent":
          updates.lookingFor = editForm.lookingFor;
          updates.lifestyle = { ...editForm.lifestyle, meeting_preference: meetingPref };
          break;
        case "lifestyle":
          updates.lifestyle = editForm.lifestyle;
          break;
        case "photos": {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error("Not authenticated");
          const persisted = await persistPhotos(editForm.photos, editPhotoFiles, user.id);
          const { data: pubResult, error: pubError } = await supabase.rpc("publish_photo_set", {
            p_user_id: user.id,
            p_photos: persisted,
            p_context: "profile_studio",
          });
          if (pubError) throw pubError;
          const pr = pubResult as Record<string, unknown> | null;
          if (pr && pr.success !== true) throw new Error(String(pr.error ?? "Photo save failed"));
          break;
        }
        case "prompt":
          updates.prompts = editForm.prompts;
          break;
        case "tagline":
          updates.tagline = editForm.tagline;
          break;
      }
      if (type !== "photos") {
        await updateMyProfile(updates);
      }
      setProfileRefreshKey((k) => k + 1);
      setActiveDrawer(null);
      setEditingPromptIndex(null);
      setEditPhotoFiles([]);
      toast.success("Profile updated!");
    } catch (error) {
      toast.error(`Failed to save: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const openDrawer = (type: DrawerType) => {
    if (type === "tagline") {
      setEditForm({ ...profile });
      setActiveDrawer("tagline");
      return;
    }
    if (type === "prompt") {
      const next = { ...profile };
      if (!next.prompts || next.prompts.length === 0) {
        next.prompts = [{ question: "", answer: "" }, { question: "", answer: "" }, { question: "", answer: "" }];
      }
      setEditForm(next);
      setEditingPromptIndex(0);
      const slot0 = next.prompts[0] ?? { question: "", answer: "" };
      const filled0 = !!(slot0.question?.trim() && slot0.answer?.trim());
      setPromptEditorMode(filled0 ? "edit" : "add");
      setActiveDrawer(type);
      return;
    }
    if (type === "photos") setEditPhotoFiles(profile.photos.map(() => null));
    setEditForm({ ...profile });
    setActiveDrawer(type);
  };

  const openPromptEditor = (index: number) => {
    setEditingPromptIndex(index);
    setEditForm({ ...profile });
    const slots = [...(profile.prompts || [])];
    while (slots.length < 3) slots.push({ question: "", answer: "" });
    const slot = slots[index] ?? { question: "", answer: "" };
    const filled = !!(slot.question?.trim() && slot.answer?.trim());
    setPromptEditorMode(filled ? "edit" : "add");
    setActiveDrawer("prompt");
  };

  const promptUnavailableElsewhere = useMemo(() => {
    if (editingPromptIndex === null) return [];
    return profile.prompts
      .map((p, i) => (i !== editingPromptIndex && p.question?.trim() ? p.question.trim() : null))
      .filter((q): q is string => !!q);
  }, [profile.prompts, editingPromptIndex]);

  const canSavePrompt = useMemo(() => {
    if (editingPromptIndex === null) return false;
    const pe = editForm.prompts[editingPromptIndex];
    return !!(pe?.question?.trim() && pe?.answer?.trim());
  }, [editForm.prompts, editingPromptIndex]);

  const handleRemovePrompt = async () => {
    if (editingPromptIndex === null) return;
    if (!window.confirm("Remove this conversation starter?")) return;
    setIsSaving(true);
    try {
      const next = profile.prompts.filter((_, i) => i !== editingPromptIndex);
      await updateMyProfile({ prompts: next });
      setProfileRefreshKey((k) => k + 1);
      setActiveDrawer(null);
      setEditingPromptIndex(null);
      toast.success("Prompt removed");
    } catch (error) {
      toast.error(`Failed to remove: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLocationDetect = async () => {
    setIsDetectingLocation(true);
    try {
      const location: GeoLocation = await autoDetectLocation();
      setEditForm((prev) => ({ ...prev, location: location.formatted, locationData: { lat: location.lat, lng: location.lng } }));
      toast.success("Location detected!");
    } catch {
      toast.error("Could not detect location. Please enter manually.");
    } finally {
      setIsDetectingLocation(false);
    }
  };

  const scrollToSection = (key: string) => {
    const el = sectionRefs.current[key];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleVibeScoreAction = (action: VibeScoreActionId) => {
    switch (action) {
      case "photos":
        setShowPhotoDrawer(true);
        break;
      case "vibe_video":
        if (profile.bunnyVideoUid?.trim()) setActiveDrawer("vibe-video");
        else setShowVibeStudio(true);
        break;
      case "vibes":
        setEditForm({ ...profile });
        setActiveDrawer("vibes");
        scrollToSection("prompts");
        break;
      case "prompts":
        scrollToSection("prompts");
        break;
      case "about_me":
        setEditForm({ ...profile });
        setActiveDrawer("bio");
        scrollToSection("about");
        break;
      case "tagline":
        setEditForm({ ...profile });
        setActiveDrawer("tagline");
        scrollToSection("hero");
        break;
      case "relationship_intent":
        scrollToSection("lookingFor");
        break;
      case "job":
      case "height":
        setEditForm({ ...profile });
        setActiveDrawer("basics");
        scrollToSection("details");
        break;
      case "lifestyle":
        setEditForm({ ...profile });
        setActiveDrawer("lifestyle");
        scrollToSection("details");
        break;
      case "phone":
        setShowPhoneVerification(true);
        scrollToSection("verification");
        break;
      case "email":
        if (emailVerified) {
          toast.success("Your email is already verified ✓");
        } else if (!accountEmailConfirmed) {
          toast.info("Confirm your current account email from your inbox first.");
        } else {
          setShowEmailVerification(true);
        }
        scrollToSection("verification");
        break;
      case "photo_verify":
        scrollToSection("verification");
        if (profile.photos.length === 0) {
          toast.error("Please add a profile photo first");
          return;
        }
        setShowPhotoVerification(true);
        break;
      case "name":
        setEditForm({ ...profile });
        setActiveDrawer("basics");
        scrollToSection("hero");
        break;
      default:
        break;
    }
  };

  const openHeroVideoFab = () => {
    if (profile.bunnyVideoUid?.trim()) setActiveDrawer("vibe-video");
    else setShowVibeStudio(true);
  };

  const handleInviteFriends = async () => {
    const link = `https://vibelymeet.com/invite?ref=${profile.id}`;
    try {
      await navigator.share({ title: "Join me on Vibely!", text: "I'm using Vibely for video dates — come find your vibe! 💜", url: link });
    } catch {
      await navigator.clipboard.writeText(link);
      toast.success("Invite link copied!");
    }
  };

  const formatDateForInput = (date: Date | null): string => {
    if (!date) return "";
    return date.toISOString().split("T")[0];
  };

  // ── Loading ───────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const mainPhoto = profile.photos[0] ?? null;
  const MAX_PROMPTS = 3;
  const promptSlots = [...profile.prompts];
  while (promptSlots.length < MAX_PROMPTS) promptSlots.push({ question: "", answer: "" });
  const displayPrompts = promptSlots.slice(0, MAX_PROMPTS);

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background pb-[100px]">
      <div className="max-w-lg mx-auto px-4">

        {/* ═══ Section 1: Cinematic hero (compact on mobile, roomier on md+) ═══ */}
        <div className="relative -mx-4 mb-0">
          <div className="h-[120px] md:h-[148px] bg-gradient-to-br from-violet-600 via-fuchsia-600 to-pink-600 rounded-b-[1.25rem] md:rounded-b-3xl px-4 pt-2 md:pt-3 flex flex-row justify-between items-start">
            <button
              type="button"
              onClick={() => navigate("/profile/preview")}
              className="w-[34px] h-[34px] min-w-[34px] min-h-[34px] rounded-full bg-black/30 flex items-center justify-center mt-1"
              aria-label="Preview profile"
            >
              <Eye className="w-[18px] h-[18px] text-white" />
            </button>
            <button
              type="button"
              onClick={() => navigate("/settings")}
              className="w-[34px] h-[34px] min-w-[34px] min-h-[34px] rounded-full bg-black/30 flex items-center justify-center mt-1"
              aria-label="Settings"
            >
              <Settings className="w-[18px] h-[18px] text-white" />
            </button>
          </div>
          <div className="flex justify-center -mt-[50px] md:-mt-14 relative z-10 pointer-events-none">
            <div className="pointer-events-auto relative">
              {mainPhoto ? (
                <img
                  src={resolvePhotoUrl(mainPhoto)}
                  alt={profile.name}
                  className="w-[100px] h-[100px] md:w-[112px] md:h-[112px] rounded-[14px] object-cover border-[3px] border-background shadow-lg"
                />
              ) : (
                <div className="w-[100px] h-[100px] md:w-[112px] md:h-[112px] rounded-[14px] bg-white/5 border-[3px] border-background flex items-center justify-center shadow-lg">
                  <Camera className="w-9 h-9 md:w-10 md:h-10 text-gray-500" />
                </div>
              )}
              <button
                type="button"
                onClick={openHeroVideoFab}
                className="absolute -bottom-1 -left-1 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 shadow-lg ring-2 ring-background backdrop-blur-sm"
                aria-label="Vibe video"
              >
                <Video className="h-[18px] w-[18px] text-white" />
              </button>
              <button
                type="button"
                onClick={() => setShowPhotoDrawer(true)}
                className="absolute -bottom-1 -right-1 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-r from-violet-600 to-pink-500 shadow-lg ring-2 ring-background"
                aria-label="Add or manage photos"
              >
                <Camera className="h-[18px] w-[18px] text-white" />
              </button>
            </div>
          </div>
          <div
            ref={(el) => {
              sectionRefs.current.hero = el;
            }}
            className="text-center px-4 pt-2 md:pt-3 pb-1"
          >
            <div className="flex items-center justify-center gap-1.5 flex-wrap">
              <h1 className="text-[22px] md:text-2xl font-display font-bold text-white">
                {profile.name}
                {profile.age != null ? `, ${profile.age}` : ""}
              </h1>
              {hasBadge && (
                <span
                  className={
                    badgeType === "vip"
                      ? "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-yellow-500 text-amber-950 text-[9px] font-semibold"
                      : "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground text-[9px] font-semibold"
                  }
                >
                  {badgeType === "vip" ? (
                    <Star className="w-2.5 h-2.5 fill-current" />
                  ) : (
                    <Crown className="w-2.5 h-2.5" />
                  )}{" "}
                  {badgeType === "vip" ? "VIP" : "PRO"}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => openDrawer("tagline")}
              className="mt-1 flex w-full items-center justify-center gap-1.5 text-[13px] md:text-sm text-violet-300/90 italic line-clamp-2 hover:opacity-90"
            >
              <span>{profile.tagline?.trim() ? `“${profile.tagline.trim()}”` : "Add a tagline"}</span>
              <Pencil className="h-3.5 w-3.5 shrink-0 text-violet-400" />
            </button>
            <p className="text-xs md:text-[13px] text-gray-400 mt-1 flex items-center justify-center gap-1">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="truncate">{profile.location || "Location not set"}</span>
            </p>
          </div>
        </div>

        {/* Preview | Vibe Score circle | Complete Profile (native row) */}
        <div className="mt-3 md:mt-4 flex flex-row items-center justify-between gap-2 px-0.5">
          <button
            type="button"
            onClick={() => navigate("/profile/preview")}
            className="flex min-h-[44px] min-w-0 flex-1 shrink items-center justify-center gap-1.5 rounded-[10px] border border-violet-500/40 bg-transparent py-2.5 px-2 text-sm font-semibold text-violet-400 hover:bg-violet-500/10"
          >
            <Eye className="h-4 w-4 shrink-0" />
            <span className="truncate">Preview</span>
          </button>
          <button
            type="button"
            onClick={() => setShowVibeScoreDrawer(true)}
            className="shrink-0 rounded-full p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            aria-label="Vibe Score details"
          >
            <VibeScoreHeroCircle score={vibeScore} />
          </button>
          <button
            type="button"
            onClick={() => setShowVibeScoreDrawer(true)}
            className="flex min-h-[44px] min-w-0 flex-1 shrink items-center justify-center gap-1 rounded-[10px] bg-gradient-to-r from-violet-500 to-pink-500 px-2 py-2.5 text-sm font-bold text-white hover:opacity-90"
          >
            {vibeScore >= 90 ? (
              <>
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="truncate">Iconic</span>
              </>
            ) : (
              <span className="truncate px-0.5">Complete Profile</span>
            )}
          </button>
        </div>

        {/* My Vibe Schedule — summary row */}
        <button
          type="button"
          onClick={() => navigate("/schedule")}
          className="w-full mt-2 md:mt-3 flex items-center gap-2.5 py-3 px-3.5 rounded-2xl border border-white/10 bg-white/5 text-left"
        >
          <CalendarDays className="w-4 h-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">My Vibe Schedule</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {scheduleStatus.label === "No schedule set" ? "Set when you're open for dates" : scheduleStatus.label}
            </p>
          </div>
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: scheduleStatus.color }} />
          <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
        </button>

        {/* Counters */}
        <div className="grid grid-cols-3 gap-2 mt-2 md:mt-2.5 mb-3 md:mb-4">
          {(
            [
              { label: "Events", value: profile.stats.events },
              { label: "Matches", value: profile.stats.matches },
              { label: "Convos", value: profile.stats.conversations },
            ] as const
          ).map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-white/10 bg-white/5 py-2.5 md:py-3 flex flex-col items-center"
            >
              <span className="text-xl md:text-[22px] font-display font-bold text-white">{stat.value}</span>
              <span className="text-[11px] text-gray-400 font-medium mt-0.5">{stat.label}</span>
            </div>
          ))}
        </div>

        {/* ═══ Quick Actions — compact pills ═══ */}
        <div className="flex gap-2 px-4 py-2 overflow-x-auto scrollbar-hide -mx-1 md:mx-0 mt-1 md:mt-0 mb-2 md:mb-3">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={() => scrollToSection(action.scrollTo)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/[0.06] border border-white/[0.08] text-sm text-gray-300 hover:bg-white/[0.1] transition whitespace-nowrap shrink-0"
            >
              <action.icon className="w-4 h-4 shrink-0" style={{ color: action.color }} />
              {action.label}
            </button>
          ))}
        </div>

        {/* ═══ Section 4: Vibe Video Module ═══ */}
        <div ref={(el) => { sectionRefs.current["video"] = el; }} className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Video className="h-[18px] w-[18px] text-primary" />
              <h3 className="text-base font-display font-semibold text-white">Vibe Video</h3>
            </div>
            {vibeVideoInfo.uid ? (
              <button
                type="button"
                onClick={() => openDrawer("vibe-video")}
                className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-violet-400 hover:text-violet-300"
              >
                Manage <ChevronRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {isVibeVideoProcessing ? (
            <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 flex flex-col items-center justify-center gap-3 py-10">
              <Loader2 className="w-10 h-10 text-violet-400 animate-spin" />
              <p className="text-base font-display font-semibold text-white">Processing your Vibe Video…</p>
              <p className="text-sm text-gray-400 text-center px-6">Usually 15–30 seconds while we get it ready to play</p>
            </div>
          ) : isVibeVideoFailed ? (
            <div className="rounded-2xl bg-white/5 backdrop-blur border border-red-500/20 flex flex-col items-center justify-center gap-3 py-10">
              <Video className="w-12 h-12 text-red-400/50" />
              <p className="text-base font-display font-semibold text-white">Couldn&apos;t finish processing</p>
              <p className="text-sm text-gray-400 text-center px-6">Try recording again — your clip didn&apos;t make it through</p>
              <button
                onClick={() => setShowVibeStudio(true)}
                className="mt-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-pink-500 text-white font-bold text-sm"
              >
                Record again
              </button>
            </div>
          ) : isVibeVideoDataError ? (
            <div className="rounded-2xl bg-white/5 backdrop-blur border border-amber-500/20 flex flex-col items-center justify-center gap-3 py-10 px-6">
              <Video className="w-12 h-12 text-amber-400/70" />
              <p className="text-base font-display font-semibold text-white text-center">Video status looks inconsistent</p>
              <p className="text-sm text-gray-400 text-center">Open Manage to refresh or re-upload if this persists.</p>
              <button
                type="button"
                onClick={() => openDrawer("vibe-video")}
                className="mt-2 px-6 py-2.5 rounded-xl bg-white/10 text-white font-semibold text-sm"
              >
                Manage
              </button>
            </div>
          ) : readyAwaitingPlaybackUrl ? (
            <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 flex flex-col items-center justify-center gap-3 py-10 px-6">
              <Loader2 className="w-10 h-10 text-violet-400 animate-spin" />
              <p className="text-base font-display font-semibold text-white text-center">Ready on our side</p>
              <p className="text-sm text-gray-400 text-center">Preview link isn&apos;t loading — check connection or try again shortly.</p>
            </div>
          ) : hasVibeVideo ? (
            <div className="relative w-full rounded-2xl overflow-hidden bg-secondary" style={{ aspectRatio: "16/9" }}>
              {thumbnailUrl && !thumbnailError ? (
                <img src={thumbnailUrl} alt="Vibe Video" className="w-full h-full object-cover" onError={() => setThumbnailError(true)} />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-[#1C1A2E] to-[#0D0B1A]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />

              {/* Live badge */}
              <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
                <span className="text-[9px] font-semibold tracking-widest text-green-500">READY</span>
              </div>

              {/* Play button */}
              <button
                onClick={() => setShowVibePlayer(true)}
                className="absolute inset-0 flex items-center justify-center"
              >
                <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.3)" }}>
                  <Play className="w-7 h-7 text-white ml-1" />
                </div>
              </button>

              {/* Caption */}
              {profile.vibeCaption && (
                <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none">
                  <p className="text-[10px] font-semibold uppercase tracking-widest bg-gradient-to-r from-violet-500 to-pink-500 bg-clip-text text-transparent mb-0.5">Vibing on</p>
                  <p className="text-white text-sm font-bold">{profile.vibeCaption}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 flex flex-col items-center justify-center gap-3 py-10">
              <Video className="w-12 h-12 text-gray-500/30" />
              <p className="text-base font-display font-semibold text-white">Record your Vibe Video</p>
              <p className="text-sm text-gray-400 text-center px-6">Profiles with video get 3x more quality conversations</p>
              <button
                onClick={() => setShowVibeStudio(true)}
                className="mt-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-pink-500 text-white font-bold text-sm"
              >
                Record now
              </button>
            </div>
          )}
        </div>

        {/* ═══ Section 5: Photos Module ═══ */}
        <div ref={(el) => { sectionRefs.current["photos"] = el; }} className="mb-6">
          {/* Header row */}
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Camera className="w-[18px] h-[18px] text-primary" />
              <h3 className="text-lg font-display font-bold text-white">Photos</h3>
              <span className="ml-2 px-2.5 py-0.5 rounded-full bg-white/[0.08] text-xs font-semibold text-white/45">
                {profile.photos.length}/6
              </span>
            </div>
            <button onClick={() => setShowPhotoDrawer(true)} className="text-violet-500 text-sm font-medium flex items-center gap-1 hover:text-violet-400 transition-colors">
              Manage <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          {profile.photos.length < 4 && (
            <p className="text-[13px] text-muted-foreground mb-3">
              Your first photo leads every first impression.
            </p>
          )}
          {profile.photos.length >= 4 && <div className="mb-3" />}

          {/* Editorial masonry grid */}
          {(() => {
            const renderSlot = (index: number) => {
              const url = profile.photos[index] ?? null;
              const isMain = index === 0;
              return (
                <button
                  key={`photo-slot-${index}`}
                  onClick={url
                    ? () => { setSelectedPhotoIndex(index); setShowPhotoViewer(true); }
                    : () => setShowPhotoDrawer(true)
                  }
                  className={cn(
                    "relative rounded-2xl overflow-hidden flex items-center justify-center w-full h-full transition-all",
                    url
                      ? "bg-black"
                      : "border-[1.5px] border-dashed border-violet-500/30 bg-white/[0.04] hover:border-violet-500/50 hover:bg-white/[0.06]"
                  )}
                >
                  {url ? (
                    <>
                      <img src={resolvePhotoUrl(url)} alt="" className="w-full h-full object-cover" />
                      {isMain && (
                        <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/60 backdrop-blur-sm text-[11px] font-semibold text-white/90">
                          <span>👑</span> Main
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <Plus className="w-6 h-6 text-white/30" />
                      <span className="text-[11px] text-white/25">Add</span>
                    </div>
                  )}
                </button>
              );
            };

            return (
              <div className="flex flex-col gap-2">
                {/* Row 1: Main (60%) + stacked pair (40%) */}
                <div className="flex gap-2" style={{ height: 280 }}>
                  <div className="flex" style={{ flex: 3 }}>
                    {renderSlot(0)}
                  </div>
                  <div className="flex flex-col gap-2" style={{ flex: 2 }}>
                    {renderSlot(1)}
                    {renderSlot(2)}
                  </div>
                </div>
                {/* Row 2: three equal tiles */}
                <div className="flex gap-2" style={{ height: 140 }}>
                  {renderSlot(3)}
                  {renderSlot(4)}
                  {renderSlot(5)}
                </div>
              </div>
            );
          })()}
        </div>

        {/* ═══ Section 6: Conversation Starters ═══ */}
        <div ref={(el) => { sectionRefs.current["prompts"] = el; }} className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Quote className="w-4 h-4 text-primary" />
            <h3 className="text-base font-display font-semibold text-white">Conversation Starters</h3>
          </div>
          <div className="space-y-3">
            {displayPrompts.map((slot, index) => {
              const hasQuestion = !!slot.question?.trim();
              const answerTrim = slot.answer?.trim() ?? "";
              const filled = hasQuestion && !!answerTrim;

              if (!filled) {
                return (
                  <button
                    key={`empty-${index}`}
                    onClick={() => openPromptEditor(index)}
                    className="w-full rounded-2xl border border-dashed border-white/10 bg-white/5 py-8 flex flex-col items-center justify-center gap-2 hover:border-violet-500/30 transition-colors"
                  >
                    <span className="text-2xl">💬</span>
                    <span className="text-sm text-gray-400">Tap to add your answer...</span>
                  </button>
                );
              }

              const emoji = PROMPT_EMOJIS[slot.question] ?? "💭";
              return (
                <button
                  key={`prompt-${index}-${slot.question}`}
                  onClick={() => openPromptEditor(index)}
                  className="w-full relative rounded-2xl bg-white/5 backdrop-blur border border-white/10 overflow-hidden text-left hover:bg-white/[0.07] transition-colors"
                >
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-violet-500 to-pink-500" />
                  <div className="p-4 pl-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <span className="text-lg mt-0.5">{emoji}</span>
                        <span className="text-sm font-semibold text-gray-400">{slot.question}</span>
                      </div>
                      <Pencil className="w-4 h-4 text-gray-500 shrink-0 mt-1" />
                    </div>
                    <p className="text-base font-semibold text-white mt-2">{answerTrim}</p>
                    <div className="flex items-center gap-1.5 mt-3">
                      <MessageCircle className="w-3.5 h-3.5 text-primary" />
                      <span className="text-xs text-gray-400 font-medium">Conversation starter</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {filledPromptCount < 2 && (
            <p className="text-xs italic text-gray-400 mt-3">
              Great prompts lead to better conversations. Add at least 2!
            </p>
          )}
        </div>

        {/* ═══ Section 7: Looking For ═══ */}
        <div ref={(el) => { sectionRefs.current["lookingFor"] = el; }} className="mb-6">
          <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                <h3 className="text-base font-display font-semibold text-white">Looking For</h3>
              </div>
              <button onClick={() => openDrawer("intent")} className="text-primary text-sm font-medium flex items-center gap-1">
                Edit <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <RelationshipIntent selected={profile.lookingFor || ""} />
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <span className="text-xs text-gray-400 font-medium">Open to:</span>
              {(["events", "dates", "both"] as const).map((opt) => {
                const labels = { events: "Events", dates: "1:1 Dates", both: "Both" };
                const isActive = storedMeetingPref === opt;
                return (
                  <span
                    key={opt}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-semibold border",
                      isActive
                        ? "bg-violet-500/20 border-violet-500/50 text-violet-400"
                        : "bg-white/5 border-white/10 text-gray-500"
                    )}
                  >
                    {labels[opt]}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {/* ═══ Section 8: About Me ═══ */}
        <div ref={(el) => { sectionRefs.current.about = el; }} className="mb-6">
          <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-display font-semibold text-white">About Me</h3>
              <button onClick={() => openDrawer("bio")} className="text-primary text-sm font-medium flex items-center gap-1">
                Edit <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <p className={cn("text-sm leading-relaxed", profile.aboutMe ? "text-gray-400" : "text-gray-600")}>
              {profile.aboutMe || "Tell potential matches about yourself..."}
            </p>
            <p className="text-[11px] text-gray-600 text-right mt-2">{(profile.aboutMe ?? "").length}/{MAX_ABOUT_ME_LENGTH}</p>
            {(profile.aboutMe ?? "").length > 0 && (profile.aboutMe ?? "").length < 50 && (
              <p className="text-xs italic text-gray-400 mt-2">
                Tip: Specific beats generic. Tell people what makes you interesting!
              </p>
            )}
          </div>
        </div>

        {/* ═══ Section 9: My Vibes ═══ */}
        <div className="mb-6">
          <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <h3 className="text-base font-display font-semibold text-white">My Vibes</h3>
              </div>
              <button onClick={() => openDrawer("vibes")} className="text-primary text-sm font-medium flex items-center gap-1">
                Edit <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            {profile.vibes.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {profile.vibes.map((v) => (
                  <span
                    key={v}
                    className="px-3 py-1.5 rounded-full text-sm font-medium text-white bg-violet-500/15 border border-violet-500/35"
                  >
                    {v}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-gray-400">Add vibes to show your personality!</p>
              </div>
            )}
          </div>
        </div>

        {/* ═══ Section 10: Vibe Schedule (14-day grid) ═══ */}
        <div ref={(el) => { sectionRefs.current["schedule"] = el; }} className="mb-6">
          <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-primary" />
                <h3 className="text-base font-display font-semibold text-white">Vibe Schedule</h3>
              </div>
              <button onClick={() => navigate("/schedule")} className="text-primary text-sm font-medium flex items-center gap-1">
                Edit <ChevronRight className="w-3 h-3" />
              </button>
            </div>

            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: scheduleStatus.color }} />
              <span className="text-sm font-semibold text-white">{scheduleStatus.label}</span>
            </div>

            <div className="overflow-x-auto scrollbar-hide">
              <div className="flex gap-1.5" style={{ paddingLeft: 2, paddingRight: 2 }}>
                {dateRange.map((date) => {
                  const dateStr = format(date, "yyyy-MM-dd");
                  const isToday = dateStr === format(startOfDay(new Date()), "yyyy-MM-dd");
                  return (
                    <div key={dateStr} className="flex flex-col items-center" style={{ width: 36 }}>
                      <span className={cn("text-[11px]", isToday ? "text-violet-500 font-bold" : "text-gray-500")}>
                        {format(date, "EEEEE")}
                      </span>
                      <span className={cn("text-[13px] mt-0.5", isToday ? "text-violet-500 font-bold" : "text-white font-medium")}>
                        {format(date, "d")}
                      </span>
                      <div className="flex flex-col gap-[3px] mt-1.5">
                        {TIME_BLOCKS.map((block) => {
                          const open = isSlotOpen(date, block);
                          return (
                            <div
                              key={block}
                              className="w-2 h-2 rounded-full"
                              style={{
                                backgroundColor: open ? "#0D9488" : "rgba(255,255,255,0.1)",
                                border: open ? "none" : "1px solid rgba(255,255,255,0.06)",
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {scheduleStatus.color === "#6B7280" && (
              <p className="text-sm text-gray-400 mt-3">Set when you're open for dates</p>
            )}
          </div>
        </div>

        {/* ═══ Section 11: Details (Basics + Lifestyle) ═══ */}
        <div ref={(el) => { sectionRefs.current.details = el; }} className="mb-6">
          <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-display font-semibold text-white">Details</h3>
              <button onClick={() => openDrawer("basics")} className="text-primary text-sm font-medium flex items-center gap-1">
                Edit <ChevronRight className="w-3 h-3" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {[
                { icon: Cake, label: "Birthday", value: profile.birthDate ? `${profile.birthDate.toLocaleDateString()} (${profile.zodiac})` : "Not set" },
                { icon: Briefcase, label: "Work", value: profile.job || "Not set" },
                { icon: Ruler, label: "Height", value: profile.heightCm ? `${profile.heightCm} cm` : "Not set" },
                { icon: MapPin, label: "Location", value: profile.location || "Not set" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2.5 p-3 rounded-xl bg-white/5 border border-white/10">
                  <item.icon className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-gray-500">{item.label}</p>
                    <p className="text-[13px] font-semibold text-white truncate">{item.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {Object.keys(profile.lifestyle).filter((k) => k !== "meeting_preference").length > 0 && (
              <div className="pt-3 border-t border-white/5">
                <LifestyleDetails values={profile.lifestyle} />
              </div>
            )}
          </div>
        </div>

        {/* ═══ Section 12: Verification ═══ */}
        <div ref={(el) => { sectionRefs.current["verification"] = el; }} className="mb-6">
          <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-4">
            <VerificationSteps steps={verificationSteps} onStartStep={handleVerificationStep} />
          </div>
        </div>

        {/* ═══ Section 13: Invite Friends ═══ */}
        <div className="mb-6">
          <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-4">
            <button onClick={handleInviteFriends} className="w-full flex items-center gap-3 text-left">
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-lg">💌</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">Invite Friends</p>
                <p className="text-xs text-gray-400">Share Vibely with your friends</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Logout */}
        <Button variant="ghost" className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 mb-8" onClick={handleLogout}>
          <LogOut className="w-4 h-4 mr-2" />
          Log Out
        </Button>
      </div>

      {/* ═══ Drawers (reused from legacy) ═══ */}

      {/* Photo Editor */}
      <Drawer open={activeDrawer === "photos"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display">Manage Your Gallery</DrawerTitle>
            <DrawerDescription>First impressions matter. Make them count.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 overflow-y-auto space-y-4">
            <PhotoManager
              photos={editForm.photos}
              onPhotosChange={(photos) => setEditForm({ ...editForm, photos })}
              photoFiles={editPhotoFiles}
              onPhotoFilesChange={setEditPhotoFiles}
            />
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("photos")} disabled={isSaving}>
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
            <DrawerClose asChild><Button variant="ghost">Cancel</Button></DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Vibes Editor */}
      <Drawer open={activeDrawer === "vibes"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display">Choose Your Vibes</DrawerTitle>
            <DrawerDescription>Pick 5 that best describe how you connect.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 overflow-y-auto">
            <VibeTagSelector
              selectedVibes={editForm.vibes}
              onVibesChange={(vibes) => setEditForm({ ...editForm, vibes })}
              categoriesOnly={["energy", "social_style"]}
            />
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("vibes")} disabled={isSaving}>
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Vibes
            </Button>
            <DrawerClose asChild><Button variant="ghost">Cancel</Button></DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Basics Editor */}
      <Drawer open={activeDrawer === "basics"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display">The Basics</DrawerTitle>
            <DrawerDescription>Keep it real. Authenticity is attractive.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 space-y-5 overflow-y-auto">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Name</label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="What should we call you?" className="glass-card border-border" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Date of Birth</label>
              <Input type="date" value={formatDateForInput(editForm.birthDate)} disabled className="glass-card border-border opacity-60 cursor-not-allowed" />
              {editForm.birthDate && (
                <p className="text-xs text-muted-foreground">Age: {calculateAge(editForm.birthDate)} • Zodiac: {getZodiacSign(editForm.birthDate)} {getZodiacEmoji(getZodiacSign(editForm.birthDate))}</p>
              )}
              <p className="text-xs text-muted-foreground italic">Date of birth cannot be changed after registration</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Job</label>
              <Input value={editForm.job || ""} onChange={(e) => setEditForm({ ...editForm, job: e.target.value })} placeholder="What pays the bills?" className="glass-card border-border" />
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground">Height</label>
              <HeightSelector value={editForm.heightCm || 170} onChange={(cm) => setEditForm({ ...editForm, heightCm: cm })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Location</label>
              <div className="flex gap-2">
                <Input value={editForm.location || ""} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} placeholder="Where's home base?" className="glass-card border-border flex-1" />
                <Button variant="outline" size="icon" onClick={handleLocationDetect} disabled={isDetectingLocation}>
                  {isDetectingLocation ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("basics")} disabled={isSaving}>
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
            <DrawerClose asChild><Button variant="ghost">Cancel</Button></DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Bio Editor */}
      <Drawer open={activeDrawer === "bio"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display">About Me</DrawerTitle>
            <DrawerDescription>You have 3 seconds to make them care. Make it count.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4">
            <Textarea
              value={editForm.aboutMe || ""}
              onChange={(e) => setEditForm({ ...editForm, aboutMe: e.target.value.slice(0, MAX_ABOUT_ME_LENGTH) })}
              placeholder="Write something that makes them want to know more..."
              className="min-h-32 glass-card border-border resize-none"
              maxLength={MAX_ABOUT_ME_LENGTH}
            />
            <p className="text-xs text-muted-foreground text-right mt-2">{(editForm.aboutMe || "").length}/{MAX_ABOUT_ME_LENGTH}</p>
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("bio")} disabled={isSaving}>
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
            <DrawerClose asChild><Button variant="ghost">Cancel</Button></DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Prompt Editor */}
      <Drawer open={activeDrawer === "prompt"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display">
              {promptEditorMode === "add" ? "Add Prompt" : "Edit Prompt"}
            </DrawerTitle>
            <DrawerDescription>Spark conversations with your answer.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 space-y-4 overflow-y-auto">
            {editingPromptIndex !== null && (
              <>
                <PromptSelector
                  selectedPrompt={editForm.prompts[editingPromptIndex]?.question || ""}
                  unavailablePrompts={promptUnavailableElsewhere}
                  onSelect={(prompt) => {
                    const newPrompts = [...editForm.prompts];
                    newPrompts[editingPromptIndex] = { ...newPrompts[editingPromptIndex], question: prompt };
                    setEditForm({ ...editForm, prompts: newPrompts });
                  }}
                />
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Your Answer</label>
                  <Textarea
                    value={editForm.prompts[editingPromptIndex]?.answer || ""}
                    onChange={(e) => {
                      const newPrompts = [...editForm.prompts];
                      newPrompts[editingPromptIndex] = { ...newPrompts[editingPromptIndex], answer: e.target.value };
                      setEditForm({ ...editForm, prompts: newPrompts });
                    }}
                    placeholder="Be authentic, be interesting..."
                    className="min-h-24 glass-card border-border resize-none"
                    maxLength={200}
                  />
                  <p className="text-xs text-muted-foreground text-right">{editForm.prompts[editingPromptIndex]?.answer?.length || 0}/200</p>
                </div>
              </>
            )}
          </div>
          <DrawerFooter>
            <Button
              variant="gradient"
              onClick={() => handleSave("prompt")}
              disabled={isSaving || !canSavePrompt}
              className={!canSavePrompt ? "opacity-40" : undefined}
            >
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Prompt
            </Button>
            {promptEditorMode === "edit" && editingPromptIndex !== null ? (
              <button
                type="button"
                onClick={() => void handleRemovePrompt()}
                className="w-full text-center text-sm font-semibold text-red-400 py-2 hover:text-red-300 transition-colors"
              >
                Remove Prompt
              </button>
            ) : null}
            <DrawerClose asChild><Button variant="ghost">Cancel</Button></DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Intent Editor */}
      <Drawer open={activeDrawer === "intent"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display">What are you looking for?</DrawerTitle>
            <DrawerDescription>Be upfront. It saves everyone time.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 overflow-y-auto space-y-6">
            <RelationshipIntent selected={editForm.lookingFor || ""} onSelect={(intent) => setEditForm({ ...editForm, lookingFor: intent })} editable />
            <div>
              <p className="text-sm font-medium text-foreground mb-2">Open to:</p>
              <div className="flex gap-2">
                {(["events", "dates", "both"] as const).map((opt) => {
                  const labels = { events: "Events", dates: "1:1 Dates", both: "Both" };
                  const isActive = meetingPref === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => setMeetingPref(opt)}
                      className={cn(
                        "px-4 py-2 rounded-full text-sm font-semibold border transition-colors",
                        isActive ? "bg-violet-500/20 border-violet-500/50 text-violet-400" : "bg-white/5 border-white/10 text-gray-500 hover:border-white/20"
                      )}
                    >
                      {labels[opt]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("intent")} disabled={isSaving}>
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
            <DrawerClose asChild><Button variant="ghost">Cancel</Button></DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Lifestyle Editor */}
      <Drawer open={activeDrawer === "lifestyle"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display">Lifestyle</DrawerTitle>
            <DrawerDescription>Help find someone compatible with your lifestyle.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 overflow-y-auto">
            <LifestyleDetails values={editForm.lifestyle} onChange={(key, value) => setEditForm({ ...editForm, lifestyle: { ...editForm.lifestyle, [key]: value } })} editable />
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("lifestyle")} disabled={isSaving}>
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
            <DrawerClose asChild><Button variant="ghost">Cancel</Button></DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Vibe Video Drawer */}
      <Drawer open={activeDrawer === "vibe-video"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="pb-2">
            <DrawerTitle className="font-display">Vibe Video</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-4 space-y-4">
            {/* Thumbnail preview */}
            <div className="relative w-full rounded-xl overflow-hidden" style={{ aspectRatio: "16/9" }}>
              {thumbnailUrl && !thumbnailError ? (
                <img src={thumbnailUrl} alt="Vibe Video" className="w-full h-full object-cover" onError={() => setThumbnailError(true)} />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-[#1C1A2E] to-[#0D0B1A]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <button onClick={() => { setActiveDrawer(null); setShowVibePlayer(true); }} className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 rounded-full flex items-center justify-center bg-violet-500/80 backdrop-blur-sm">
                  <Play className="w-5 h-5 text-white ml-0.5" />
                </div>
              </button>
              {profile.vibeCaption && (
                <div className="absolute bottom-0 left-0 right-0 p-3 pointer-events-none">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-violet-400 mb-0.5">Vibing on</p>
                  <p className="text-white text-sm font-bold truncate">{profile.vibeCaption}</p>
                </div>
              )}
            </div>

            {/* Status */}
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 text-xs font-semibold text-green-500">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Live
              </span>
            </div>

            <div className="border-t border-white/5" />

            {/* Action rows */}
            {[
              { icon: Video, label: "Record new video", onClick: () => { setActiveDrawer(null); setShowVibeStudio(true); }, chevron: true },
              { icon: Eye, label: "Preview as others see it", onClick: () => { setActiveDrawer(null); setShowVibePlayer(true); }, chevron: true },
            ].map((row) => (
              <button
                key={row.label}
                onClick={row.onClick}
                className="w-full flex items-center gap-3.5 h-14 hover:bg-white/5 rounded-lg transition-colors -mx-1 px-1"
              >
                <row.icon className="w-5 h-5 text-primary shrink-0" />
                <span className="text-[15px] font-semibold text-white flex-1 text-left">{row.label}</span>
                {row.chevron && <ChevronRight className="w-4 h-4 text-white/20" />}
              </button>
            ))}

            <div className="border-t border-white/5" />

            <button
              onClick={async () => {
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  if (!session) return;
                  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-vibe-video`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
                  });
                  const result = await res.json();
                  if (result.success) {
                    setProfile((prev) => ({ ...prev, bunnyVideoUid: null, bunnyVideoStatus: "none", vibeCaption: "" }));
                    setActiveDrawer(null);
                    toast.success("Video deleted");
                  } else {
                    toast.error("Failed to delete video.");
                  }
                } catch {
                  toast.error("Failed to delete video.");
                }
              }}
              className="w-full flex items-center gap-3.5 h-14 hover:bg-destructive/10 rounded-lg transition-colors -mx-1 px-1"
            >
              <Trash2 className="w-5 h-5 text-destructive shrink-0" />
              <span className="text-[15px] font-semibold text-destructive flex-1 text-left">Delete video</span>
            </button>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Tagline */}
      <Drawer open={activeDrawer === "tagline"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display">Your Tagline</DrawerTitle>
            <DrawerDescription>A short slogan that captures who you are or what you&apos;re about.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4">
            <Input
              value={editForm.tagline || ""}
              onChange={(e) => setEditForm({ ...editForm, tagline: e.target.value.slice(0, 30) })}
              placeholder="e.g., Living my best life ✨"
              className="glass-card border-border"
              maxLength={30}
            />
            <p className="text-xs text-muted-foreground text-right mt-2">{(editForm.tagline || "").length}/30</p>
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("tagline")} disabled={isSaving}>
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Tagline
            </Button>
            <DrawerClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <VibeScoreDrawer
        open={showVibeScoreDrawer}
        onOpenChange={setShowVibeScoreDrawer}
        profile={vibeScoreProfileSnapshot}
        score={vibeScore}
        vibeScoreLabel={profile.vibeScoreLabel}
        onAction={handleVibeScoreAction}
      />

      <VibeStudioModal
        open={showVibeStudio}
        onOpenChange={setShowVibeStudio}
        onSave={async (_pathOrUrl, caption) => {
          await updateMyProfile({ vibeCaption: caption || "" });
          const refreshed = await fetchMyProfile();
          if (refreshed) {
            setProfile((prev) => ({
              ...prev,
              bunnyVideoUid: refreshed.bunnyVideoUid || null,
              bunnyVideoStatus: refreshed.bunnyVideoStatus || "none",
              vibeCaption: caption || "",
              vibeScore: refreshed.vibeScore ?? prev.vibeScore,
              vibeScoreLabel: refreshed.vibeScoreLabel ?? prev.vibeScoreLabel,
            }));
          }
        }}
        existingVideoUrl={vibeVideoPlaybackUrl || undefined}
        existingCaption={profile.vibeCaption}
      />

      <PhoneVerification
        open={showPhoneVerification}
        onOpenChange={setShowPhoneVerification}
        initialPhoneE164={phoneNumber}
        onVerified={() => {
          setShowPhoneVerification(false);
          void (async () => {
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user?.id) {
                setPhoneVerified(true);
                return;
              }
              const next = await fetchMyPhoneVerificationProfile(user.id);
              setPhoneVerified(next.phoneVerified);
              setPhoneNumber(next.phoneNumber);
            } catch (e) {
              console.error(e);
              setPhoneVerified(true);
            } finally {
              setProfileRefreshKey((k) => k + 1);
            }
          })();
        }}
      />
      <EmailVerificationFlow
        open={showEmailVerification}
        onOpenChange={setShowEmailVerification}
        userEmail={emailForVerification}
        onVerified={() => {
          setEmailVerified(true);
          setProfileRefreshKey((k) => k + 1);
        }}
      />

      <SimplePhotoVerification
        open={showPhotoVerification}
        onOpenChange={setShowPhotoVerification}
        userId={profile.id}
        profilePhotoUrl={profile.photos[0]}
        onSubmissionComplete={() => {
          // Persisted backend state after submission is "pending" (admin approval is server-side).
          setPhotoVerificationStatus("pending");
          setProfileRefreshKey((k) => k + 1);
        }}
      />

      <PhotoPreviewModal photos={profile.photos} initialIndex={selectedPhotoIndex} isOpen={showPhotoViewer} onClose={() => setShowPhotoViewer(false)} />

      <PhotoManageDrawer
        isOpen={showPhotoDrawer}
        onClose={() => setShowPhotoDrawer(false)}
        photos={profile.photos}
        onPhotosChanged={() => setProfileRefreshKey((k) => k + 1)}
      />

      <VibeVideoFullscreenPlayer
        show={showVibePlayer}
        bunnyVideoUid={profile.bunnyVideoUid}
        bunnyVideoStatus={profile.bunnyVideoStatus}
        vibeCaption={profile.vibeCaption}
        onClose={() => setShowVibePlayer(false)}
      />

      <BottomNav />
    </div>
  );
};

export default ProfileStudio;
