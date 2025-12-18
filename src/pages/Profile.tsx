import { useState } from "react";
import { 
  Settings, 
  Edit2, 
  LogOut, 
  ChevronRight, 
  Camera,
  Briefcase,
  Ruler,
  MapPin,
  Sparkles,
  Heart,
  Zap
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BottomNav } from "@/components/BottomNav";
import { VibeScore } from "@/components/VibeScore";
import { PhotoGallery } from "@/components/PhotoGallery";
import { VibeTagSelector } from "@/components/VibeTagSelector";
import { useNavigate } from "react-router-dom";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

interface UserProfile {
  name: string;
  age: number;
  job: string;
  height: string;
  location: string;
  bio: string;
  photos: string[];
  vibes: string[];
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
  height: "5'11\"",
  location: "Brooklyn, NY",
  bio: "Designing by day, DJing by night. Looking for someone who appreciates a good vinyl collection and late-night tacos.",
  photos: [
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
    "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400",
    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
    "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400",
  ],
  vibes: ["Music Lover", "Foodie", "Night Owl", "Creative"],
  stats: {
    events: 8,
    matches: 12,
    conversations: 5,
  },
};

const calculateVibeScore = (profile: UserProfile): number => {
  let score = 0;
  if (profile.name) score += 10;
  if (profile.age) score += 10;
  if (profile.job) score += 10;
  if (profile.height) score += 5;
  if (profile.location) score += 5;
  if (profile.bio && profile.bio.length > 20) score += 15;
  score += Math.min(profile.photos.length * 10, 30);
  score += Math.min(profile.vibes.length * 3, 15);
  return Math.min(score, 100);
};

type DrawerType = "photos" | "vibes" | "basics" | "bio" | null;

const Profile = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile>(initialProfile);
  const [activeDrawer, setActiveDrawer] = useState<DrawerType>(null);
  const [editForm, setEditForm] = useState(initialProfile);

  const vibeScore = calculateVibeScore(profile);

  const handleSave = (type: DrawerType) => {
    setProfile(editForm);
    setActiveDrawer(null);
  };

  const openDrawer = (type: DrawerType) => {
    setEditForm(profile);
    setActiveDrawer(type);
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Hero Header */}
      <div className="relative">
        {/* Gradient Background */}
        <div className="h-32 bg-gradient-primary opacity-80" />
        
        {/* Settings Button */}
        <button 
          className="absolute top-4 right-4 w-10 h-10 rounded-full glass-card flex items-center justify-center"
          onClick={() => {}}
        >
          <Settings className="w-5 h-5 text-foreground" />
        </button>

        {/* Profile Photo with Vibe Score */}
        <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 flex flex-col items-center">
          <div className="relative">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="relative"
            >
              <img
                src={profile.photos[0]}
                alt={profile.name}
                className="w-28 h-28 rounded-3xl object-cover border-4 border-background shadow-2xl"
              />
              <button 
                onClick={() => openDrawer("photos")}
                className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-gradient-primary flex items-center justify-center shadow-lg neon-glow-violet"
              >
                <Camera className="w-4 h-4 text-white" />
              </button>
            </motion.div>
          </div>
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 pt-24 space-y-6">
        {/* Name & Location */}
        <motion.div 
          className="text-center space-y-1"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <h1 className="text-2xl font-display font-bold text-foreground">
            {profile.name}, {profile.age}
          </h1>
          <div className="flex items-center justify-center gap-1 text-muted-foreground">
            <MapPin className="w-3 h-3" />
            <span className="text-sm">{profile.location}</span>
          </div>
        </motion.div>

        {/* Vibe Score Card */}
        <motion.div 
          className="glass-card p-6 flex items-center gap-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <VibeScore score={vibeScore} size={100} />
          <div className="flex-1 space-y-2">
            <h3 className="font-display font-semibold text-foreground">Your Vibe Score</h3>
            <p className="text-sm text-muted-foreground">
              {vibeScore < 100 
                ? "Complete your profile to unlock maximum matches. Every detail counts." 
                : "You're at peak vibe. Time to make some connections."}
            </p>
            {vibeScore < 100 && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-primary p-0 h-auto"
                onClick={() => openDrawer("photos")}
              >
                <Zap className="w-3 h-3 mr-1" />
                Boost your score →
              </Button>
            )}
          </div>
        </motion.div>

        {/* Stats Row */}
        <motion.div 
          className="grid grid-cols-3 gap-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          {[
            { label: "Events", value: profile.stats.events, icon: Sparkles },
            { label: "Matches", value: profile.stats.matches, icon: Heart },
            { label: "Convos", value: profile.stats.conversations, icon: Zap },
          ].map((stat) => (
            <div key={stat.label} className="glass-card p-4 text-center">
              <stat.icon className="w-4 h-4 mx-auto mb-1 text-primary" />
              <p className="text-xl font-display font-bold gradient-text">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </motion.div>

        {/* Bio Section */}
        <motion.div 
          className="glass-card p-4 space-y-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-foreground">The Pitch</h3>
            <button 
              onClick={() => openDrawer("bio")}
              className="text-primary text-sm font-medium"
            >
              Edit
            </button>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {profile.bio || "Write something that makes them swipe right..."}
          </p>
        </motion.div>

        {/* Vibes Section */}
        <motion.div 
          className="glass-card p-4 space-y-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-foreground">Your Vibes</h3>
            <button 
              onClick={() => openDrawer("vibes")}
              className="text-primary text-sm font-medium"
            >
              Edit
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {profile.vibes.map((vibe) => (
              <span
                key={vibe}
                className="px-3 py-1.5 text-sm rounded-full bg-primary/20 text-primary border border-primary/30"
              >
                {vibe}
              </span>
            ))}
            {profile.vibes.length === 0 && (
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
          transition={{ delay: 0.7 }}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-foreground">Your Gallery</h3>
            <button 
              onClick={() => openDrawer("photos")}
              className="text-primary text-sm font-medium"
            >
              Manage
            </button>
          </div>
          <PhotoGallery photos={profile.photos} onPhotosChange={() => {}} />
        </motion.div>

        {/* Basics Section */}
        <motion.div 
          className="glass-card p-4 space-y-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-foreground">The Basics</h3>
            <button 
              onClick={() => openDrawer("basics")}
              className="text-primary text-sm font-medium"
            >
              Edit
            </button>
          </div>
          <div className="space-y-3">
            {[
              { icon: Briefcase, label: "Work", value: profile.job },
              { icon: Ruler, label: "Height", value: profile.height },
              { icon: MapPin, label: "Location", value: profile.location },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
                  <item.icon className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-medium text-foreground">{item.value || "Not set"}</p>
                </div>
              </div>
            ))}
          </div>
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
          <div className="px-4 pb-4 space-y-4">
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
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Height</label>
              <Input 
                value={editForm.height}
                onChange={(e) => setEditForm({ ...editForm, height: e.target.value })}
                placeholder="Yes, people will ask"
                className="glass-card border-border"
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
            <DrawerTitle className="font-display">Your Pitch</DrawerTitle>
            <DrawerDescription>
              You have 3 seconds to make them care. Make it count.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4">
            <textarea 
              value={editForm.bio}
              onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })}
              placeholder="Write something that makes them want to know more..."
              className="w-full h-32 px-4 py-3 rounded-xl glass-card border border-border resize-none focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground"
              maxLength={300}
            />
            <p className="text-xs text-muted-foreground text-right mt-2">
              {editForm.bio.length}/300
            </p>
          </div>
          <DrawerFooter>
            <Button variant="gradient" onClick={() => handleSave("bio")}>
              Save Pitch
            </Button>
            <DrawerClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <BottomNav />
    </div>
  );
};

export default Profile;
