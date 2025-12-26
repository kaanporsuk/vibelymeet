import { useState } from "react";
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
  CalendarDays
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
import { HeightSelector, HeightDisplay } from "@/components/HeightSelector";
import { ProfilePreview } from "@/components/ProfilePreview";
import ProfileWizard from "@/components/wizard/ProfileWizard";
import SafetyHub from "@/components/safety/SafetyHub";
import VibeStudioModal from "@/components/vibe-video/VibeStudioModal";
import { VibePlayer } from "@/components/vibe-video/VibePlayer";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

interface ProfilePromptData {
  prompt: string;
  answer: string;
}

interface UserProfile {
  name: string;
  age: number;
  job: string;
  heightCm: number;
  location: string;
  bio: string;
  photos: string[];
  vibes: string[];
  prompts: ProfilePromptData[];
  relationshipIntent: string;
  lifestyle: Record<string, string>;
  verified: boolean;
  vibeVideoUrl: string | null;
  vibeCaption: string;
  stats: {
    events: number;
    matches: number;
    conversations: number;
  };
}

const initialProfile: UserProfile = {
  name: "Alex",
  age: 27,
  job: "Product Designer",
  heightCm: 180,
  location: "Brooklyn, NY",
  bio: "Designing by day, DJing by night. Looking for someone who appreciates a good vinyl collection and late-night tacos.",
  photos: [
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
    "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400",
    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
    "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400",
  ],
  vibes: ["Music Lover", "Foodie", "Night Owl", "Creative"],
  prompts: [
    { prompt: "A shower thought I had recently", answer: "If aliens exist, they probably have their own dating apps too." },
    { prompt: "The way to win me over", answer: "Surprise me with a spontaneous adventure. Bonus points for good snacks." },
    { prompt: "I geek out on", answer: "" },
  ],
  relationshipIntent: "relationship",
  lifestyle: {
    drinking: "sometimes",
    smoking: "never",
    exercise: "often",
  },
  verified: true,
  vibeVideoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  vibeCaption: "DJing & Vinyl Hunting 🎵",
  stats: {
    events: 8,
    matches: 12,
    conversations: 5,
  },
};

const calculateVibeScore = (profile: UserProfile): number => {
  let score = 0;
  if (profile.name) score += 8;
  if (profile.age) score += 5;
  if (profile.job) score += 8;
  if (profile.heightCm) score += 5;
  if (profile.location) score += 5;
  if (profile.bio && profile.bio.length > 20) score += 12;
  score += Math.min(profile.photos.length * 8, 24);
  score += Math.min(profile.vibes.length * 3, 12);
  score += profile.prompts.filter(p => p.answer).length * 7;
  if (profile.relationshipIntent) score += 5;
  if (Object.keys(profile.lifestyle).length > 0) score += 5;
  if (profile.verified) score += 4;
  return Math.min(score, 100);
};

type DrawerType = "photos" | "vibes" | "basics" | "bio" | "prompt" | "intent" | "lifestyle" | "verification" | "vibe-video" | null;

const Profile = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile>(initialProfile);
  const [activeDrawer, setActiveDrawer] = useState<DrawerType>(null);
  const [editForm, setEditForm] = useState(initialProfile);
  const [editingPromptIndex, setEditingPromptIndex] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showVibeStudio, setShowVibeStudio] = useState(false);

  const vibeScore = calculateVibeScore(profile);

  const handleSave = (type: DrawerType) => {
    setProfile(editForm);
    setActiveDrawer(null);
    setEditingPromptIndex(null);
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

  const verificationSteps = [
    { id: "photo", label: "Photo verification", description: "Take a quick selfie", icon: Camera, completed: profile.verified },
    { id: "phone", label: "Phone number", description: "Verify your number", icon: Shield, completed: true },
  ];

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

        {/* Profile Photo with Update Button - Always show main photo */}
        <div className="absolute -bottom-16 left-1/2 -translate-x-1/2">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative"
          >
            <img
              src={profile.photos[0]}
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
            {profile.vibeVideoUrl && (
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
        {/* Name & Location */}
        <motion.div 
          className="text-center space-y-1"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center justify-center gap-2">
            <h1 className="text-2xl font-display font-bold text-foreground">
              {profile.name}, {profile.age}
            </h1>
          </div>
          <div className="flex items-center justify-center gap-1 text-muted-foreground">
            <MapPin className="w-3 h-3" />
            <span className="text-sm">{profile.location}</span>
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
          <RelationshipIntent selected={profile.relationshipIntent} />
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
            {profile.bio || "Write something that makes them swipe right..."}
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
          {profile.prompts.map((prompt, index) => (
            <ProfilePrompt
              key={index}
              prompt={prompt.prompt}
              answer={prompt.answer}
              onEdit={() => openPromptEditor(index)}
              editable
              index={index}
            />
          ))}
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
              { icon: Briefcase, label: "Work", value: profile.job },
              { icon: Ruler, label: "Height", value: profile.heightCm ? `${profile.heightCm} cm` : "Not set" },
              { icon: MapPin, label: "Location", value: profile.location },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3 p-3 rounded-xl bg-secondary/40">
                <item.icon className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-medium text-foreground truncate">{item.value || "Not set"}</p>
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
            onStartStep={(id) => openDrawer("verification")}
          />
        </motion.div>

        {/* Logout */}
        <Button
          variant="ghost"
          className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={() => navigate("/")}
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
            <Button variant="gradient" onClick={() => handleSave("photos")}>
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
            <Button variant="gradient" onClick={() => handleSave("vibes")}>
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
              <label className="text-sm font-medium text-foreground">Age</label>
              <Input 
                type="number"
                value={editForm.age}
                onChange={(e) => setEditForm({ ...editForm, age: parseInt(e.target.value) || 0 })}
                placeholder="How many trips around the sun?"
                className="glass-card border-border"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Job</label>
              <Input 
                value={editForm.job}
                onChange={(e) => setEditForm({ ...editForm, job: e.target.value })}
                placeholder="What pays the bills?"
                className="glass-card border-border"
              />
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground">Height</label>
              <HeightSelector 
                value={editForm.heightCm}
                onChange={(cm) => setEditForm({ ...editForm, heightCm: cm })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Location</label>
              <Input 
                value={editForm.location}
                onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                placeholder="Where's home base?"
                className="glass-card border-border"
              />
            </div>
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("basics")}>
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
              value={editForm.bio}
              onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })}
              placeholder="Write something that makes them want to know more..."
              className="min-h-32 glass-card border-border resize-none"
              maxLength={300}
            />
            <p className="text-xs text-muted-foreground text-right mt-2">
              {editForm.bio.length}/300
            </p>
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("bio")}>
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
                  selectedPrompt={editForm.prompts[editingPromptIndex]?.prompt || ""}
                  onSelect={(prompt) => {
                    const newPrompts = [...editForm.prompts];
                    newPrompts[editingPromptIndex] = { ...newPrompts[editingPromptIndex], prompt };
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
            <Button variant="gradient" onClick={() => handleSave("prompt")}>
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
              selected={editForm.relationshipIntent}
              onSelect={(intent) => setEditForm({ ...editForm, relationshipIntent: intent })}
              editable
            />
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("intent")}>
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
            <Button variant="gradient" onClick={() => handleSave("lifestyle")}>
              Save
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
          <ProfilePreview profile={profile} onClose={() => setShowPreview(false)} />
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
            {profile.vibeVideoUrl ? (
              <div className="space-y-4">
                <div className="relative rounded-2xl overflow-hidden aspect-[9/16] max-h-[40vh] mx-auto">
                  <VibePlayer
                    videoUrl={profile.vibeVideoUrl}
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
                    onClick={() => {
                      setProfile({ ...profile, vibeVideoUrl: null });
                      setActiveDrawer(null);
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
        onSave={(url) => setProfile({ ...profile, vibeVideoUrl: url })}
        existingVideoUrl={profile.vibeVideoUrl || undefined}
      />

      <BottomNav />
    </div>
  );
};

export default Profile;
