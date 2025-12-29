import { useState, useEffect } from "react";
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
  Mail
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BottomNav } from "@/components/BottomNav";
import { VibeScore } from "@/components/VibeScore";
import { PhotoGallery } from "@/components/PhotoGallery";
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
import { EmailVerificationFlow } from "@/components/verification/EmailVerificationFlow";
import { useNavigate } from "react-router-dom";
import { useLogout } from "@/hooks/useLogout";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
  videoIntroUrl: string | null;
  vibeCaption: string;
  stats: {
    events: number;
    matches: number;
    conversations: number;
  };
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
  videoIntroUrl: null,
  vibeCaption: "",
  stats: {
    events: 0,
    matches: 0,
    conversations: 0,
  },
};

const calculateVibeScore = (profile: UserProfile): number => {
  let score = 0;
  if (profile.name) score += 8;
  if (profile.birthDate) score += 5;
  if (profile.job) score += 8;
  if (profile.heightCm) score += 5;
  if (profile.location) score += 5;
  if (profile.aboutMe && profile.aboutMe.length > 20) score += 12;
  score += Math.min(profile.photos.length * 8, 24);
  score += Math.min(profile.vibes.length * 3, 12);
  score += profile.prompts.filter(p => p.answer).length * 7;
  if (profile.lookingFor) score += 5;
  if (Object.keys(profile.lifestyle).length > 0) score += 5;
  if (profile.verified) score += 4;
  if (profile.tagline) score += 2;
  return Math.min(score, 100);
};

type DrawerType = "photos" | "vibes" | "basics" | "bio" | "prompt" | "intent" | "lifestyle" | "verification" | "vibe-video" | "tagline" | null;

const Profile = () => {
  const navigate = useNavigate();
  const { handleLogout } = useLogout();
  const [profile, setProfile] = useState<UserProfile>(initialProfile);
  const [activeDrawer, setActiveDrawer] = useState<DrawerType>(null);
  const [editForm, setEditForm] = useState<UserProfile>(initialProfile);
  const [editingPromptIndex, setEditingPromptIndex] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showVibeStudio, setShowVibeStudio] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);

  // Fetch profile and user email on mount
  useEffect(() => {
    const loadProfile = async () => {
      try {
        // Get user email
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email) {
          setUserEmail(user.email);
        }

        const data = await fetchMyProfile();
        if (data) {
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
            prompts: data.prompts || [],
            lookingFor: data.lookingFor,
            lifestyle: data.lifestyle,
            verified: false,
            videoIntroUrl: data.videoIntroUrl,
            vibeCaption: "",
            stats: data.stats,
          });
        }
      } catch (error) {
        console.error("Error loading profile:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, []);

  const vibeScore = calculateVibeScore(profile);

  const handleSave = async (type: DrawerType) => {
    setIsSaving(true);
    try {
      const updates: Partial<ProfileData> = {};

      switch (type) {
        case "basics":
          updates.name = editForm.name;
          updates.birthDate = editForm.birthDate;
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
        case "photos":
          updates.photos = editForm.photos;
          updates.avatarUrl = editForm.photos[0] || null;
          break;
        case "prompt":
          updates.prompts = editForm.prompts;
          break;
        case "tagline":
          updates.tagline = editForm.tagline;
          break;
      }

      await updateMyProfile(updates);
      
      // Update local state with recalculated values
      const updatedProfile = { ...editForm };
      if (updatedProfile.birthDate) {
        updatedProfile.age = calculateAge(updatedProfile.birthDate);
        updatedProfile.zodiac = getZodiacSign(updatedProfile.birthDate);
      }
      
      setProfile(updatedProfile);
      setActiveDrawer(null);
      setEditingPromptIndex(null);
      toast.success("Profile updated!");
    } catch (error) {
      console.error("Error saving profile:", error);
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const openDrawer = (type: DrawerType) => {
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

  const verificationSteps = [
    { id: "email", label: "Email verification", description: emailVerified ? "Verified" : "Verify your email", icon: Mail, completed: emailVerified },
    { id: "photo", label: "Photo verification", description: "Take a quick selfie", icon: Camera, completed: profile.verified },
    { id: "phone", label: "Phone number", description: "Verify your number", icon: Shield, completed: false },
  ];

  const handleVerificationStep = (stepId: string) => {
    if (stepId === "email" && !emailVerified) {
      setShowEmailVerification(true);
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
    <div className="min-h-screen bg-background pb-24">
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
            <img
              src={profile.photos[0] || "https://via.placeholder.com/128"}
              alt={profile.name}
              className="w-32 h-32 rounded-3xl object-cover border-4 border-background shadow-2xl"
            />
            
            {/* Camera Button for photos */}
            <button 
              onClick={() => openDrawer("photos")}
              className="absolute -bottom-1 -right-1 w-10 h-10 rounded-full bg-gradient-primary flex items-center justify-center shadow-lg neon-glow-violet"
            >
              <Camera className="w-5 h-5 text-primary-foreground" />
            </button>
            
            {/* Vibe Video indicator */}
            {profile.videoIntroUrl && (
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
          <PhotoGallery photos={profile.photos} onPhotosChange={() => {}} />
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
          <div className="px-4 pb-4 overflow-y-auto">
            <PhotoGallery 
              photos={editForm.photos} 
              onPhotosChange={(photos) => setEditForm({ ...editForm, photos })}
              editable 
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
            <DrawerTitle className="font-display">Edit Your Vibes</DrawerTitle>
            <DrawerDescription>
              What makes you, you? Pick wisely.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 overflow-y-auto">
            <VibeTagSelector 
              selectedVibes={editForm.vibes} 
              onVibesChange={(vibes) => setEditForm({ ...editForm, vibes })}
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
                onChange={(e) => setEditForm({ ...editForm, birthDate: e.target.value ? new Date(e.target.value) : null })}
                className="glass-card border-border"
              />
              {editForm.birthDate && (
                <p className="text-xs text-muted-foreground">
                  Age: {calculateAge(editForm.birthDate)} • Zodiac: {getZodiacSign(editForm.birthDate)} {getZodiacEmoji(getZodiacSign(editForm.birthDate))}
                </p>
              )}
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
            bio: profile.aboutMe || "",
            photos: profile.photos,
            vibes: profile.vibes,
            prompts: profile.prompts.map(p => ({ prompt: p.question, answer: p.answer })),
            relationshipIntent: profile.lookingFor || "",
            verified: profile.verified,
          }} onClose={() => setShowPreview(false)} />
        )}
      </AnimatePresence>

      {/* Profile Wizard */}
      <ProfileWizard
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        onComplete={() => setShowWizard(false)}
      />

      {/* Vibe Video Drawer */}
      <Drawer open={activeDrawer === "vibe-video"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display flex items-center gap-2">
              <Video className="w-5 h-5 text-neon-cyan" />
              My Vibe Video
            </DrawerTitle>
            <DrawerDescription>
              Your 15-second video intro. Show your personality!
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 overflow-y-auto">
            {profile.videoIntroUrl ? (
              <div className="space-y-4">
                <div className="relative rounded-2xl overflow-hidden aspect-[9/16] max-h-[40vh] mx-auto">
                  <VibePlayer
                    videoUrl={profile.videoIntroUrl}
                    vibeCaption={profile.vibeCaption}
                    isOwner
                    onUpdateClick={() => {
                      setActiveDrawer(null);
                      setShowVibeStudio(true);
                    }}
                    className="w-full h-full"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={async () => {
                      await updateMyProfile({ videoIntroUrl: null });
                      setProfile({ ...profile, videoIntroUrl: null });
                      setActiveDrawer(null);
                      toast.success("Video deleted");
                    }}
                  >
                    Delete Video
                  </Button>
                  <Button
                    variant="gradient"
                    className="flex-1"
                    onClick={() => {
                      setActiveDrawer(null);
                      setShowVibeStudio(true);
                    }}
                  >
                    Update Video
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 space-y-4">
                <div className="w-20 h-20 mx-auto rounded-full bg-neon-cyan/20 flex items-center justify-center">
                  <Video className="w-10 h-10 text-neon-cyan" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-1">No Vibe Video Yet</h3>
                  <p className="text-sm text-muted-foreground">
                    Record a 15-second intro to stand out from the crowd
                  </p>
                </div>
                <Button
                  variant="gradient"
                  onClick={() => {
                    setActiveDrawer(null);
                    setShowVibeStudio(true);
                  }}
                >
                  Record My Vibe
                </Button>
              </div>
            )}
          </div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="ghost">Close</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Vibe Studio Modal */}
      <VibeStudioModal
        open={showVibeStudio}
        onOpenChange={setShowVibeStudio}
        onSave={async (url) => {
          await updateMyProfile({ videoIntroUrl: url });
          setProfile({ ...profile, videoIntroUrl: url });
          toast.success("Vibe video saved!");
        }}
        existingVideoUrl={profile.videoIntroUrl || undefined}
      />

      {/* Email Verification Flow */}
      <EmailVerificationFlow
        open={showEmailVerification}
        onOpenChange={setShowEmailVerification}
        onVerified={() => {
          setEmailVerified(true);
          toast.success("Email verified successfully!");
        }}
        userEmail={userEmail}
      />

      <BottomNav />
    </div>
  );
};

export default Profile;
