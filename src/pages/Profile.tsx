import ProfileStudio from "./ProfileStudio";

const USE_PROFILE_STUDIO = true; // flip to false to rollback

// Bunny Stream CDN playback — no Supabase signed URLs for vibe videos
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Settings,
  LogOut,
  Camera,
  Briefcase,
  Ruler,
  MapPin,
  Sparkles,
  Heart,
  Zap,
  Eye,
  Shield,
  ChevronRight,
  Quote,
  Target,
  Wand2,
  Video,
  Pencil,
  CalendarDays,
  Cake,
  Loader2,
  Mail,
  ShieldCheck,
  Phone,
  Play,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { persistPhotos } from "@/services/storageService";
import { BottomNav } from "@/components/BottomNav";
import { VibeScore } from "@/components/VibeScore";
import { PhotoGallery } from "@/components/PhotoGallery";
import { PhotoPreviewModal } from "@/components/PhotoPreviewModal";
import { PhotoManager } from "@/components/PhotoManager";
import { VibeTagSelector } from "@/components/VibeTagSelector";
import { VibeTag } from "@/components/VibeTag";
import { ProfilePrompt, PromptSelector } from "@/components/ProfilePrompt";
import { RelationshipIntent } from "@/components/RelationshipIntent";
import { LifestyleDetails } from "@/components/LifestyleDetails";
import { VerificationBadge, VerificationSteps } from "@/components/VerificationBadge";
import { HeightSelector } from "@/components/HeightSelector";
import { ProfilePreview } from "@/components/ProfilePreview";
import ProfileWizard from "@/components/wizard/ProfileWizard";
import SafetyHub from "@/components/safety/SafetyHub";
import VibeStudioModal from "@/components/vibe-video/VibeStudioModal";
import { VibePlayer } from "@/components/vibe-video/VibePlayer";
import { VibeVideoFullscreenPlayer } from "@/components/vibe-video/VibeVideoFullscreenPlayer";
import { EmailVerificationFlow } from "@/components/verification/EmailVerificationFlow";
import { SimplePhotoVerification } from "@/components/verification/SimplePhotoVerification";
import { PhoneVerification } from "@/components/PhoneVerification";
import { useNavigate } from "react-router-dom";
import { useLogout } from "@/hooks/useLogout";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { resolvePhotoVerificationState, type PhotoVerificationState } from "@/lib/photoVerificationState";
import { fetchMyPhoneVerificationProfile } from "@/lib/phoneVerificationState";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";

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
  vibeScore: number;
  vibeScoreLabel: string;
}

// Empty initial state for new users - no mock data
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
  stats: {
    events: 0,
    matches: 0,
    conversations: 0,
  },
  vibeScore: 0,
  vibeScoreLabel: "Getting started",
};

import { useEntitlements } from "@/hooks/useEntitlements";
import { Crown, Star } from "lucide-react";

type DrawerType = "photos" | "vibes" | "basics" | "bio" | "prompt" | "intent" | "lifestyle" | "verification" | "vibe-video" | "tagline" | null;

const LegacyProfilePage = () => {
  const navigate = useNavigate();
  const { handleLogout } = useLogout();
  const { hasBadge, badgeType } = useEntitlements();
  const [profile, setProfile] = useState<UserProfile>(initialProfile);
  const [activeDrawer, setActiveDrawer] = useState<DrawerType>(null);
  const [editForm, setEditForm] = useState<UserProfile>(initialProfile);
  const [editPhotoFiles, setEditPhotoFiles] = useState<(File | null)[]>([]);
  const [editingPromptIndex, setEditingPromptIndex] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showVibeStudio, setShowVibeStudio] = useState(false);
  const [showVibePlayer, setShowVibePlayer] = useState(false);
  const [vibeVideoPlaybackUrl, setVibeVideoPlaybackUrl] = useState<string | null>(null);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [showPhotoViewer, setShowPhotoViewer] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [showPhotoVerification, setShowPhotoVerification] = useState(false);
  const [showPhoneVerification, setShowPhoneVerification] = useState(false);
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailForVerification, setEmailForVerification] = useState("");
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [photoVerificationStatus, setPhotoVerificationStatus] = useState<PhotoVerificationState>("none");
  const [photoVerificationExpiresAt, setPhotoVerificationExpiresAt] = useState<string | null>(null);
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);

  // Fetch profile and user email on mount
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();

        // Fetch phone_verified status directly
        if (user) {
          const { data: phoneData } = await supabase
            .from("profiles")
            .select("phone_verified, phone_number, email_verified, photo_verified, photo_verification_expires_at")
            .eq("id", user.id)
            .maybeSingle();
          if (phoneData?.phone_verified) {
            setPhoneVerified(true);
          }
          setEmailVerified(!!phoneData?.email_verified);
          setEmailForVerification(user.email ?? "");
          setPhoneNumber((phoneData?.phone_number as string | null | undefined) ?? null);

          // Determine photo verification status from canonical backend truth.
          const profilePhotoVerified = phoneData?.photo_verified;
          const photoVerificationExpiresAt = phoneData?.photo_verification_expires_at;

          if (profilePhotoVerified) {
            setPhotoVerificationExpiresAt(photoVerificationExpiresAt ?? null);
            setPhotoVerificationStatus(
              resolvePhotoVerificationState({
                photoVerified: profilePhotoVerified,
                photoVerificationExpiresAt,
                latestPhotoVerificationStatus: null,
              }),
            );
          } else {
            // Check for pending verification
            const { data: pendingVerification } = await supabase
              .from("photo_verifications")
              .select("status")
              .eq("user_id", user.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            setPhotoVerificationExpiresAt(null);
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
          const prompts = (data.prompts && data.prompts.length > 0)
            ? data.prompts
            : [
                { question: "", answer: "" },
                { question: "", answer: "" },
                { question: "", answer: "" },
              ];

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
            vibeScoreLabel: data.vibeScoreLabel ?? "Getting started",
          });
        }
      } catch (error) {
        console.error("Error loading profile:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [profileRefreshKey]);

  // Resolve playable URL for vibe video — prefer Bunny Stream CDN
  useEffect(() => {
    if (profile.bunnyVideoUid && profile.bunnyVideoStatus === "ready") {
      setVibeVideoPlaybackUrl(
        `https://${import.meta.env.VITE_BUNNY_STREAM_CDN_HOSTNAME}/${profile.bunnyVideoUid}/playlist.m3u8`
      );
    } else {
      setVibeVideoPlaybackUrl(null);
    }
  }, [profile.bunnyVideoUid, profile.bunnyVideoStatus]);

  // Clear stale failed status when studio opens so old errors don't show
  useEffect(() => {
    if (!showVibeStudio) return;
    if (profile.bunnyVideoStatus === "failed") {
      setProfile(prev => ({ ...prev, bunnyVideoStatus: "none" }));
    }
  }, [showVibeStudio]);

  const vibeScore = profile.vibeScore ?? 0;

  const handleSave = async (type: DrawerType) => {
    setIsSaving(true);
    try {
      const updates: Partial<ProfileData> = {};

      switch (type) {
        case "basics":
          updates.name = editForm.name;
          // birthDate is read-only after initial setup — not included in updates
          updates.job = editForm.job;
          updates.company = editForm.company;
          updates.heightCm = editForm.heightCm;
          updates.location = editForm.location;
          updates.locationData = editForm.locationData;
          break;
        case "bio":
          updates.aboutMe = editForm.aboutMe;
          break;
        case "vibes":
          updates.vibes = editForm.vibes;
          break;
        case "intent":
          updates.lookingFor = editForm.lookingFor;
          break;
        case "lifestyle":
          updates.lifestyle = editForm.lifestyle;
          break;
        case "photos": {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error("Not authenticated");

          // Upload any newly-added local photos (blob URLs) and keep existing storage URLs.
          const persisted = await persistPhotos(editForm.photos, editPhotoFiles, user.id);
          updates.photos = persisted;
          updates.avatarUrl = persisted[0] || null;
          break;
        }
        case "prompt":
          updates.prompts = editForm.prompts;
          break;
        case "tagline":
          updates.tagline = editForm.tagline;
          break;
      }

      await updateMyProfile(updates);
      setProfileRefreshKey((k) => k + 1);
      setActiveDrawer(null);
      setEditingPromptIndex(null);
      setEditPhotoFiles([]);
      toast.success("Profile updated!");
    } catch (error) {
      console.error("[Profile] Failed to save:", error);
      toast.error(`Failed to save: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const openDrawer = (type: DrawerType) => {
    if (type === "prompt") {
      const next = { ...profile };
      if (!next.prompts || next.prompts.length === 0) {
        next.prompts = [
          { question: "", answer: "" },
          { question: "", answer: "" },
          { question: "", answer: "" },
        ];
      }
      setEditForm(next);
      setEditingPromptIndex(0);
      setActiveDrawer(type);
      return;
    }

    if (type === "photos") {
      setEditPhotoFiles(profile.photos.map(() => null));
    }

    setEditForm({ ...profile });
    setActiveDrawer(type);
  };

  const openPromptEditor = (index: number) => {
    setEditingPromptIndex(index);
    setEditForm({ ...profile });
    setActiveDrawer("prompt");
  };


  const handleLocationDetect = async () => {
    setIsDetectingLocation(true);
    try {
      const location: GeoLocation = await autoDetectLocation();
      setEditForm(prev => ({
        ...prev,
        location: location.formatted,
        locationData: { lat: location.lat, lng: location.lng },
      }));
      toast.success("Location detected!");
    } catch (error) {
      console.error("Location detection error:", error);
      toast.error("Could not detect location. Please enter manually.");
    } finally {
      setIsDetectingLocation(false);
    }
  };

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
      description: emailVerified ? "Verified" : "Verify your email",
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
      setShowEmailVerification(true);
      return;
    }
    if (stepId === "photo") {
      if (photoVerificationStatus === "approved") {
        toast.success("Photo already verified ✓");
        return;
      }
      if (photoVerificationStatus === "pending") {
        toast.info("Your verification is under review. Please wait.");
        return;
      }
      if (profile.photos.length === 0) {
        toast.error("Please add a profile photo first");
        return;
      }
      setShowPhotoVerification(true);
    }
    if (stepId === "phone" && !phoneVerified) {
      setShowPhoneVerification(true);
    }
  };

  // Format date for input
  const formatDateForInput = (date: Date | null): string => {
    if (!date) return "";
    return date.toISOString().split("T")[0];
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-[100px]">
      {/* Hero Header */}
      <div className="relative">
        {/* Animated Gradient Background */}
        <div className="h-36 bg-gradient-primary opacity-80 relative overflow-hidden">
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
            animate={{ x: ["-100%", "100%"] }}
            transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
          />
        </div>
        
        {/* Top buttons */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
          <button 
            className="w-10 h-10 rounded-full glass-card flex items-center justify-center"
            onClick={() => setShowPreview(true)}
          >
            <Eye className="w-5 h-5 text-foreground" />
          </button>
          <button 
            className="w-10 h-10 rounded-full glass-card flex items-center justify-center"
            onClick={() => navigate("/settings")}
          >
            <Settings className="w-5 h-5 text-foreground" />
          </button>
        </div>

        {/* Profile Photo with Update Button */}
        <div className="absolute -bottom-16 left-1/2 -translate-x-1/2">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative"
          >
            <ProfilePhoto
              photos={profile.photos}
              name={profile.name}
              size="xl"
              rounded="2xl"
              loading="eager"
              className="border-4 border-background shadow-2xl"
            />
            
            {/* Camera Button for photos */}
            <button 
              onClick={() => openDrawer("photos")}
              className="absolute -bottom-1 -right-1 w-10 h-10 rounded-full bg-gradient-primary flex items-center justify-center shadow-lg neon-glow-violet"
            >
              <Camera className="w-5 h-5 text-primary-foreground" />
            </button>
            
            {/* Vibe Video indicator */}
            {profile.bunnyVideoUid && profile.bunnyVideoStatus === "ready" && (
              <button
                onClick={() => openDrawer("vibe-video")}
                className="absolute -bottom-1 -left-1 w-8 h-8 rounded-full bg-neon-cyan/90 flex items-center justify-center shadow-lg"
              >
                <Video className="w-4 h-4 text-background" />
              </button>
            )}
            
            {profile.verified && (
              <div className="absolute -top-1 -right-1">
                <VerificationBadge verified size="lg" />
              </div>
            )}
          </motion.div>
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 pt-20 space-y-5">
        {/* Name, Age, Zodiac & Location */}
        <motion.div 
          className="text-center space-y-2"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center justify-center gap-2">
            <h1 className="text-2xl font-display font-bold text-foreground">
              {profile.name}, {profile.age}
            </h1>
            {hasBadge && (
              <span
                className={
                  badgeType === "vip"
                    ? "inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-yellow-500 text-amber-950 text-[10px] font-semibold"
                    : "inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground text-[10px] font-semibold"
                }
              >
                {badgeType === "vip" ? (
                  <Star className="w-3 h-3 fill-current" />
                ) : (
                  <Crown className="w-3 h-3" />
                )}{" "}
                {badgeType === "vip" ? "VIP" : "Premium"}
              </span>
            )}
            {profile.zodiac && (
              <span className="text-lg" title={profile.zodiac}>
                {getZodiacEmoji(profile.zodiac)}
              </span>
            )}
          </div>
          
          {/* Tagline */}
          <div className="flex items-center justify-center gap-1">
            {profile.tagline ? (
              <button 
                onClick={() => openDrawer("tagline")}
                className="text-sm text-primary italic hover:underline flex items-center gap-1"
              >
                "{profile.tagline}"
                <Pencil className="w-3 h-3" />
              </button>
            ) : (
              <button 
                onClick={() => openDrawer("tagline")}
                className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1"
              >
                <Pencil className="w-3 h-3" />
                Add tagline
              </button>
            )}
          </div>
          
          <div className="flex items-center justify-center gap-1 text-muted-foreground">
            <MapPin className="w-3 h-3" />
            <span className="text-sm">{profile.location || "Location not set"}</span>
          </div>
        </motion.div>

        {/* Vibe Score & Preview */}
        <motion.div 
          className="glass-card p-5 flex items-center gap-5"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <VibeScore score={vibeScore} size={90} />
          <div className="flex-1 space-y-2">
            <h3 className="font-display font-semibold text-foreground">Your Vibe Score</h3>
            <p className="text-sm text-muted-foreground">
              {vibeScore < 100 
                ? "Complete your profile to stand out from the crowd." 
                : "You're at peak vibe. Time to make some connections."}
            </p>
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-primary p-0 h-auto text-sm"
                onClick={() => setShowPreview(true)}
              >
                <Eye className="w-3 h-3 mr-1" />
                Preview
              </Button>
              {vibeScore < 100 && (
                <Button 
                  variant="gradient" 
                  size="sm" 
                  className="gap-1"
                  onClick={() => setShowWizard(true)}
                >
                  <Wand2 className="w-3 h-3" />
                  Complete Profile
                </Button>
              )}
            </div>
          </div>
        </motion.div>

        {/* My Vibe Schedule */}
        <motion.div 
          className="glass-card p-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <button 
            onClick={() => navigate("/schedule")}
            className="w-full flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-neon-cyan/20 flex items-center justify-center">
                <CalendarDays className="w-5 h-5 text-neon-cyan" />
              </div>
              <div className="text-left">
                <h3 className="font-display font-semibold text-foreground">My Vibe Schedule</h3>
                <p className="text-xs text-muted-foreground">Set when you're open for dates</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        </motion.div>

        {/* Stats Row */}
        <motion.div 
          className="grid grid-cols-3 gap-2"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          {[
            { label: "Events", value: profile.stats.events, icon: Sparkles },
            { label: "Matches", value: profile.stats.matches, icon: Heart },
            { label: "Convos", value: profile.stats.conversations, icon: Zap },
          ].map((stat) => (
            <div key={stat.label} className="glass-card p-3 text-center">
              <stat.icon className="w-4 h-4 mx-auto mb-1 text-primary" />
              <p className="text-lg font-display font-bold gradient-text">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </motion.div>

        {/* Relationship Intent */}
        <motion.div 
          className="glass-card p-4 space-y-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              <h3 className="font-display font-semibold text-foreground">Looking For</h3>
            </div>
            <button 
              onClick={() => openDrawer("intent")}
              className="text-primary text-sm font-medium flex items-center gap-1"
            >
              Edit <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <RelationshipIntent selected={profile.lookingFor || ""} />
        </motion.div>

        {/* Bio Section */}
        <motion.div 
          className="glass-card p-4 space-y-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-foreground">About Me</h3>
            <button 
              onClick={() => openDrawer("bio")}
              className="text-primary text-sm font-medium flex items-center gap-1"
            >
              Edit <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {profile.aboutMe || "Write something that makes them swipe right..."}
          </p>
        </motion.div>

        {/* Profile Prompts */}
        <motion.div 
          className="space-y-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          <div className="flex items-center gap-2 px-1">
            <Quote className="w-4 h-4 text-primary" />
            <h3 className="font-display font-semibold text-foreground">Conversation Starters</h3>
          </div>
          {profile.prompts.length > 0 ? (
            profile.prompts.map((prompt, index) => (
              <ProfilePrompt
                key={index}
                prompt={prompt.question}
                answer={prompt.answer}
                onEdit={() => openPromptEditor(index)}
                editable
                index={index}
              />
            ))
          ) : (
            <button 
              onClick={() => openDrawer("prompt")}
              className="w-full glass-card p-6 border-2 border-dashed border-border/50 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Quote className="w-5 h-5 text-primary" />
              </div>
              <span className="font-medium">Add your first Conversation Starter</span>
              <span className="text-sm text-muted-foreground">Give matches something fun to respond to</span>
            </button>
          )}
        </motion.div>

        {/* Vibes Section */}
        <motion.div 
          className="glass-card p-4 space-y-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <h3 className="font-display font-semibold text-foreground">My Vibes</h3>
            </div>
            <button 
              onClick={() => openDrawer("vibes")}
              className="text-primary text-sm font-medium flex items-center gap-1"
            >
              Edit <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {profile.vibes.length > 0 ? (
              profile.vibes.map((vibe) => (
                <VibeTag key={vibe} label={vibe} variant="display" />
              ))
            ) : (
              <span className="text-sm text-muted-foreground">
                No vibes yet. Add some personality!
              </span>
            )}
          </div>
        </motion.div>

        {/* Vibe Video Section */}
        <motion.div 
          className="space-y-0"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.42 }}
        >
          {/* Section Header */}
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <Video className="w-4 h-4 text-primary" />
              <span className="font-display font-semibold text-sm text-foreground">Vibe Video</span>
            </div>
            {profile.bunnyVideoUid && profile.bunnyVideoStatus === "processing" && (
              <span className="text-xs text-muted-foreground">Processing...</span>
            )}
          </div>

          {/* Cinematic Card */}
          {(() => {
            const hasVibeVideo = profile.bunnyVideoUid && profile.bunnyVideoStatus === "ready";
            const isProcessing = profile.bunnyVideoStatus === "processing" || profile.bunnyVideoStatus === "uploading";
            const thumbnailUrl = profile.bunnyVideoUid
              ? `https://${import.meta.env.VITE_BUNNY_STREAM_CDN_HOSTNAME}/${profile.bunnyVideoUid}/thumbnail.jpg`
              : null;

            return (
              <div
                className={cn(
                  "relative w-full rounded-2xl overflow-hidden bg-secondary",
                  hasVibeVideo && "cursor-pointer active:scale-[0.98] transition-transform"
                )}
                style={{ aspectRatio: "16/9" }}
                onClick={() => {}}
              >
                {/* Thumbnail */}
                {hasVibeVideo && thumbnailUrl && (
                  <img
                    src={thumbnailUrl}
                    alt="Vibe Video"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                )}

                {/* Empty state background */}
                {!hasVibeVideo && !isProcessing && (
                  <div className="w-full h-full flex items-center justify-center bg-secondary">
                    <Video className="w-12 h-12 text-muted-foreground/30" />
                  </div>
                )}

                {/* Bottom gradient overlay */}
                {hasVibeVideo && (
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                )}

                {/* Centered play button */}
                {hasVibeVideo && (
                  <button
                    className="absolute inset-0 flex items-center justify-center"
                    onClick={(e) => { e.stopPropagation(); setShowVibePlayer(true); }}
                  >
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center"
                      style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.3)' }}
                    >
                      <Play className="w-7 h-7 text-white ml-1" />
                    </div>
                  </button>
                )}

                {/* Caption overlay at bottom */}
                {hasVibeVideo && profile.vibeCaption && (
                  <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none"
                    style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)' }}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <div
                        className="w-1 h-1 rounded-full"
                        style={{ background: 'linear-gradient(135deg, #8B5CF6, #E84393)' }}
                      />
                      <span
                        className="text-[10px] font-semibold uppercase tracking-widest"
                        style={{
                          background: 'linear-gradient(90deg, #8B5CF6, #E84393)',
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                        }}
                      >
                        Vibing on
                      </span>
                    </div>
                    <p className="text-white text-sm font-bold leading-tight"
                      style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}
                    >
                      {profile.vibeCaption}
                    </p>
                  </div>
                )}
                {hasVibeVideo && !profile.vibeCaption && (
                  <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none">
                    <p className="text-white/60 text-xs">Tap to play</p>
                  </div>
                )}

                {/* Empty state CTA */}
                {!hasVibeVideo && !isProcessing && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
                    <p className="text-muted-foreground text-sm text-center">
                      Record a 15-second video intro to stand out
                    </p>
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-violet-600 to-pink-500 text-white"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowVibeStudio(true);
                      }}
                    >
                      Record My Vibe
                    </Button>
                  </div>
                )}

                {/* Processing state */}
                {isProcessing && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-secondary/90">
                    <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    <p className="text-sm text-muted-foreground text-center px-6">
                      Processing your Vibe Video...
                    </p>
                  </div>
                )}

                {/* Manage button top-right */}
                {hasVibeVideo && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openDrawer("vibe-video");
                    }}
                    className="absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-medium text-white"
                    style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}
                  >
                    Manage
                  </button>
                )}
              </div>
            );
          })()}
        </motion.div>

        {/* Photos Gallery */}
        <motion.div 
          className="glass-card p-4 space-y-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-primary" />
              <h3 className="font-display font-semibold text-foreground">Photos</h3>
            </div>
            <button 
              onClick={() => openDrawer("photos")}
              className="text-primary text-sm font-medium flex items-center gap-1"
            >
              Manage <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <PhotoGallery 
            photos={profile.photos} 
            onPhotosChange={() => {}} 
            onPhotoClick={(index) => {
              setSelectedPhotoIndex(index);
              setShowPhotoViewer(true);
            }}
          />
        </motion.div>

        {/* Basics Section */}
        <motion.div 
          className="glass-card p-4 space-y-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-foreground">The Basics</h3>
            <button 
              onClick={() => openDrawer("basics")}
              className="text-primary text-sm font-medium flex items-center gap-1"
            >
              Edit <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: Cake, label: "Birthday", value: profile.birthDate ? `${profile.birthDate.toLocaleDateString()} (${profile.zodiac})` : "Not set" },
              { icon: Briefcase, label: "Work", value: profile.job || "Not set" },
              { icon: Ruler, label: "Height", value: profile.heightCm ? `${profile.heightCm} cm` : "Not set" },
              { icon: MapPin, label: "Location", value: profile.location || "Not set" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3 p-3 rounded-xl bg-secondary/40">
                <item.icon className="w-4 h-4 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-medium text-foreground truncate">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Lifestyle Section */}
        <motion.div 
          className="glass-card p-4 space-y-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-foreground">Lifestyle</h3>
            <button 
              onClick={() => openDrawer("lifestyle")}
              className="text-primary text-sm font-medium flex items-center gap-1"
            >
              Edit <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <LifestyleDetails values={profile.lifestyle} />
        </motion.div>

        {/* Verification */}
        <motion.div 
          className="glass-card p-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <VerificationSteps 
            steps={verificationSteps}
            onStartStep={handleVerificationStep}
          />
        </motion.div>

        {/* Invite Friends */}
        <motion.div
          className="glass-card p-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65 }}
        >
          <button
            onClick={async () => {
              const link = `https://vibelymeet.com/auth?ref=${profile.id}`;
              try {
                await navigator.share({
                  title: "Join me on Vibely!",
                  text: "I'm using Vibely for video dates — come find your vibe! 💜",
                  url: link,
                });
              } catch {
                await navigator.clipboard.writeText(link);
                toast.success("Invite link copied!");
              }
            }}
            className="w-full flex items-center gap-3 text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-lg">
              💌
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Invite Friends</p>
              <p className="text-xs text-muted-foreground">Share Vibely with your friends</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        </motion.div>

        {/* Logout */}
        <Button
          variant="ghost"
          className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={handleLogout}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Log Out
        </Button>
      </main>

      {/* Photo Editor Drawer */}
      <Drawer open={activeDrawer === "photos"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display">Manage Your Gallery</DrawerTitle>
            <DrawerDescription>
              First impressions matter. Make them count.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 overflow-y-auto space-y-4">
            {/* Show selected photo preview with swipe */}
            {editForm.photos.length > 0 && (
              <motion.div 
                className="relative aspect-[4/5] rounded-2xl overflow-hidden bg-secondary touch-pan-y"
                drag={editForm.photos.length > 1 ? "x" : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.2}
                onDragEnd={(_, info) => {
                  const swipeThreshold = 50;
                  if (info.offset.x < -swipeThreshold && selectedPhotoIndex < editForm.photos.length - 1) {
                    setSelectedPhotoIndex(prev => prev + 1);
                  } else if (info.offset.x > swipeThreshold && selectedPhotoIndex > 0) {
                    setSelectedPhotoIndex(prev => prev - 1);
                  }
                }}
              >
                <AnimatePresence mode="wait">
                  <motion.img 
                    key={selectedPhotoIndex}
                    src={resolvePhotoUrl(editForm.photos[selectedPhotoIndex] || editForm.photos[0])} 
                    alt="Selected photo"
                    className="w-full h-full object-cover select-none"
                    initial={{ opacity: 0, x: 50 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -50 }}
                    transition={{ duration: 0.2 }}
                    draggable={false}
                  />
                </AnimatePresence>
                {editForm.photos.length > 1 && (
                  <>
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                      {editForm.photos.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedPhotoIndex(idx)}
                          className={cn(
                            "w-2 h-2 rounded-full transition-all",
                            idx === selectedPhotoIndex 
                              ? "bg-primary w-4" 
                              : "bg-background/60"
                          )}
                        />
                      ))}
                    </div>
                    <div className="absolute top-1/2 -translate-y-1/2 left-2 right-2 flex justify-between pointer-events-none">
                      <button 
                        onClick={() => selectedPhotoIndex > 0 && setSelectedPhotoIndex(prev => prev - 1)}
                        className={cn(
                          "w-8 h-8 rounded-full bg-background/50 backdrop-blur-sm flex items-center justify-center pointer-events-auto",
                          selectedPhotoIndex === 0 && "opacity-30"
                        )}
                        disabled={selectedPhotoIndex === 0}
                      >
                        <ChevronRight className="w-4 h-4 rotate-180" />
                      </button>
                      <button 
                        onClick={() => selectedPhotoIndex < editForm.photos.length - 1 && setSelectedPhotoIndex(prev => prev + 1)}
                        className={cn(
                          "w-8 h-8 rounded-full bg-background/50 backdrop-blur-sm flex items-center justify-center pointer-events-auto",
                          selectedPhotoIndex === editForm.photos.length - 1 && "opacity-30"
                        )}
                        disabled={selectedPhotoIndex === editForm.photos.length - 1}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
              </motion.div>
            )}
            <PhotoManager
              photos={editForm.photos}
              onPhotosChange={(photos) => setEditForm({ ...editForm, photos })}
              photoFiles={editPhotoFiles}
              onPhotoFilesChange={setEditPhotoFiles}
            />
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("photos")} disabled={isSaving}>
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
            <DrawerClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Vibes Editor Drawer */}
      <Drawer open={activeDrawer === "vibes"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display">Choose Your Vibes</DrawerTitle>
            <DrawerDescription>
              Pick 5 that best describe how you connect.
            </DrawerDescription>
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
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Vibes
            </Button>
            <DrawerClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Basics Editor Drawer */}
      <Drawer open={activeDrawer === "basics"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display">The Basics</DrawerTitle>
            <DrawerDescription>
              Keep it real. Authenticity is attractive.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 space-y-5 overflow-y-auto">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Name</label>
              <Input 
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="What should we call you?"
                className="glass-card border-border"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Date of Birth</label>
              <Input 
                type="date"
                value={formatDateForInput(editForm.birthDate)}
                disabled
                className="glass-card border-border opacity-60 cursor-not-allowed"
              />
              {editForm.birthDate && (
                <p className="text-xs text-muted-foreground">
                  Age: {calculateAge(editForm.birthDate)} • Zodiac: {getZodiacSign(editForm.birthDate)} {getZodiacEmoji(getZodiacSign(editForm.birthDate))}
                </p>
              )}
              <p className="text-xs text-muted-foreground italic">Date of birth cannot be changed after registration</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Job</label>
              <Input 
                value={editForm.job || ""}
                onChange={(e) => setEditForm({ ...editForm, job: e.target.value })}
                placeholder="What pays the bills?"
                className="glass-card border-border"
              />
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground">Height</label>
              <HeightSelector 
                value={editForm.heightCm || 170}
                onChange={(cm) => setEditForm({ ...editForm, heightCm: cm })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Location</label>
              <div className="flex gap-2">
                <Input 
                  value={editForm.location || ""}
                  onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                  placeholder="Where's home base?"
                  className="glass-card border-border flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleLocationDetect}
                  disabled={isDetectingLocation}
                  title="Auto-detect location"
                >
                  {isDetectingLocation ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <MapPin className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("basics")} disabled={isSaving}>
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
            <DrawerClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Bio Editor Drawer */}
      <Drawer open={activeDrawer === "bio"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display">About Me</DrawerTitle>
            <DrawerDescription>
              You have 3 seconds to make them care. Make it count.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4">
            <Textarea 
              value={editForm.aboutMe || ""}
              onChange={(e) => setEditForm({ ...editForm, aboutMe: e.target.value.slice(0, 140) })}
              placeholder="Write something that makes them want to know more..."
              className="min-h-32 glass-card border-border resize-none"
              maxLength={140}
            />
            <p className="text-xs text-muted-foreground text-right mt-2">
              {(editForm.aboutMe || "").length}/140
            </p>
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("bio")} disabled={isSaving}>
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
            <DrawerClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Prompt Editor Drawer */}
      <Drawer open={activeDrawer === "prompt"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display">Edit Prompt</DrawerTitle>
            <DrawerDescription>
              Spark conversations with your answer.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 space-y-4 overflow-y-auto">
            {editingPromptIndex !== null && (
              <>
                <PromptSelector
                  selectedPrompt={editForm.prompts[editingPromptIndex]?.question || ""}
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
                  <p className="text-xs text-muted-foreground text-right">
                    {editForm.prompts[editingPromptIndex]?.answer?.length || 0}/200
                  </p>
                </div>
              </>
            )}
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("prompt")} disabled={isSaving}>
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Prompt
            </Button>
            <DrawerClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Intent Editor Drawer */}
      <Drawer open={activeDrawer === "intent"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display">What are you looking for?</DrawerTitle>
            <DrawerDescription>
              Be upfront. It saves everyone time.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 overflow-y-auto">
            <RelationshipIntent 
              selected={editForm.lookingFor || ""}
              onSelect={(intent) => setEditForm({ ...editForm, lookingFor: intent })}
              editable
            />
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("intent")} disabled={isSaving}>
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
            <DrawerClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Lifestyle Editor Drawer */}
      <Drawer open={activeDrawer === "lifestyle"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display">Lifestyle</DrawerTitle>
            <DrawerDescription>
              Help find someone compatible with your lifestyle.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 overflow-y-auto">
            <LifestyleDetails 
              values={editForm.lifestyle}
              onChange={(key, value) => setEditForm({ 
                ...editForm, 
                lifestyle: { ...editForm.lifestyle, [key]: value } 
              })}
              editable
            />
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("lifestyle")} disabled={isSaving}>
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
            <DrawerClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Tagline Editor Drawer */}
      <Drawer open={activeDrawer === "tagline"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display">Your Tagline</DrawerTitle>
            <DrawerDescription>
              A short slogan that captures who you are or what you're about.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4">
            <Input 
              value={editForm.tagline || ""}
              onChange={(e) => setEditForm({ ...editForm, tagline: e.target.value.slice(0, 30) })}
              placeholder="e.g., Living my best life ✨"
              className="glass-card border-border"
              maxLength={30}
            />
            <p className="text-xs text-muted-foreground text-right mt-2">
              {(editForm.tagline || "").length}/30
            </p>
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("tagline")} disabled={isSaving}>
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Tagline
            </Button>
            <DrawerClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Profile Preview */}
      <AnimatePresence>
        {showPreview && (
          <ProfilePreview profile={{
            name: profile.name,
            age: profile.age || 0,
            job: profile.job || "",
            heightCm: profile.heightCm || 0,
            location: profile.location || "",
            aboutMe: profile.aboutMe || "",
            photos: profile.photos,
            vibes: profile.vibes,
            prompts: profile.prompts.map(p => ({ question: p.question, answer: p.answer })),
            relationshipIntent: profile.lookingFor || "",
            verified: profile.verified,
            photoVerified: profile.photoVerified,
            lifestyle: profile.lifestyle,
            
            bunnyVideoUid: profile.bunnyVideoUid || undefined,
            bunnyVideoStatus: profile.bunnyVideoStatus || undefined,
          }} onClose={() => setShowPreview(false)} />
        )}
      </AnimatePresence>

      {/* Profile Wizard */}
      <ProfileWizard
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        onComplete={() => setShowWizard(false)}
        onOpenVibeStudio={() => setShowVibeStudio(true)}
      />

      {/* Vibe Video Drawer */}
      <Drawer open={activeDrawer === "vibe-video"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <div className="flex flex-col gap-3 p-4">
            <h3 className="text-lg font-semibold text-center mb-2">Vibe Video</h3>
            
            <Button
              className="w-full"
              variant="default"
              onClick={() => { setActiveDrawer(null); setShowVibePlayer(true); }}
            >
              ▶ Play Video
            </Button>
            
            <Button
              className="w-full"
              variant="outline"
              onClick={() => { setActiveDrawer(null); setShowVibeStudio(true); }}
            >
              Update Video
            </Button>
            
            <Button
              className="w-full"
              variant="destructive"
              onClick={async () => {
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  if (!session) return;
                  const res = await fetch(
                    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-vibe-video`,
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${session.access_token}`,
                      },
                    }
                  );
                  const result = await res.json();
                  if (result.success) {
                    setProfile(prev => ({
                      ...prev,
                      bunnyVideoUid: null,
                      bunnyVideoStatus: "none",
                      vibeCaption: "",
                    }));
                    setActiveDrawer(null);
                    toast.success("Video deleted");
                  } else {
                    toast.error("Failed to delete video. Please try again.");
                  }
                } catch (err) {
                  console.error("[Profile] delete-vibe-video error:", err);
                  toast.error("Failed to delete video. Please try again.");
                }
              }}
            >
              Delete Video
            </Button>
            
            <Button
              className="w-full"
              variant="ghost"
              onClick={() => setActiveDrawer(null)}
            >
              Cancel
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Vibe Studio Modal */}
      <VibeStudioModal
        open={showVibeStudio}
        onOpenChange={setShowVibeStudio}
        onSave={async (_pathOrUrl, caption) => {
          // Bunny upload handles bunny_video_uid/status via edge function + webhook
          // Just update the caption locally; polling in VibeStudioModal sets bunny fields
          await updateMyProfile({ vibeCaption: caption || "" });
          // Re-fetch profile to get updated bunny fields
          const refreshed = await fetchMyProfile();
          if (refreshed) {
            setProfile(prev => ({
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

      {/* Phone Verification */}
      <PhoneVerification
        open={showPhoneVerification}
        onOpenChange={setShowPhoneVerification}
        initialPhoneE164={phoneNumber}
        onVerified={() => {
          setShowPhoneVerification(false);
          if (!profile?.id) {
            setPhoneVerified(true);
            return;
          }
          void (async () => {
            try {
              const next = await fetchMyPhoneVerificationProfile(profile.id);
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

      {/* Photo Verification Modal */}
      <SimplePhotoVerification
        open={showPhotoVerification}
        onOpenChange={setShowPhotoVerification}
        userId={profile.id}
        profilePhotoUrl={profile.photos[0]}
        onSubmissionComplete={() => {
          setPhotoVerificationStatus("pending");
          setProfileRefreshKey((k) => k + 1);
        }}
      />

      {/* Fullscreen Photo Viewer */}
      <PhotoPreviewModal
        photos={profile.photos}
        initialIndex={selectedPhotoIndex}
        isOpen={showPhotoViewer}
        onClose={() => setShowPhotoViewer(false)}
      />

      {/* Fullscreen Vibe Video Player */}
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

const Profile = () => {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("__vibely_diag") !== "1") return;
    console.info("[diag] Profile route entry", {
      path: window.location.pathname,
      useProfileStudio: USE_PROFILE_STUDIO,
    });
  }, []);

  return USE_PROFILE_STUDIO ? <ProfileStudio /> : <LegacyProfilePage />;
};

export default Profile;
