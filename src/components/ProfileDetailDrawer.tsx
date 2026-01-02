import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageCircle,
  Video,
  Play,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Briefcase,
  Ruler,
  Sparkles,
  X,
  Heart,
  Expand,
} from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VibePlayer } from "@/components/vibe-video/VibePlayer";
import { PhotoPreviewModal } from "@/components/PhotoPreviewModal";

// Mock video URL
const MOCK_VIBE_VIDEO = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";

// Mock extended profile data
const mockProfileData = {
  photos: [
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800",
    "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800",
    "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800",
  ],
  hasVideoIntro: true,
  vibeVideoUrl: MOCK_VIBE_VIDEO,
  vibeCaption: "Marathon Training 🏃‍♂️",
  job: "Product Designer",
  location: "Brooklyn, NY",
  height: 168,
  bio: "Creative soul who believes in the magic of spontaneous adventures and deep conversations over good coffee. Looking for someone to share those quiet Sunday mornings and wild Friday nights.",
  prompts: [
    {
      question: "A fact about me that surprises people",
      answer: "I once lived in a tiny village in Portugal for 3 months and learned to make traditional pastéis de nata from a 90-year-old grandmother.",
    },
    {
      question: "The way to win me over",
      answer: "Send me a perfectly timed meme, remember my coffee order, or suggest we skip the bar and go stargazing instead.",
    },
    {
      question: "I'm looking for",
      answer: "Someone who's equally comfortable in a museum or at a music festival. Bonus points if you can beat me at Mario Kart.",
    },
  ],
  interests: ["Photography", "Hiking", "Vinyl Records", "Cooking", "Yoga"],
};

interface ProfileDetailDrawerProps {
  match: {
    id: string;
    name: string;
    age: number;
    image: string;
    vibes: string[];
    compatibility?: number;
    photos?: string[];
    job?: string;
    location?: string;
    height?: number;
    bio?: string;
  };
  trigger: React.ReactNode;
  onMessage: () => void;
  onVideoCall: () => void;
}

export const ProfileDetailDrawer = ({
  match,
  trigger,
  onMessage,
  onVideoCall,
}: ProfileDetailDrawerProps) => {
  const [open, setOpen] = useState(false);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [showVideoOverlay, setShowVideoOverlay] = useState(false);
  const [showFullscreenPhoto, setShowFullscreenPhoto] = useState(false);

  // Use photos from match prop if available, otherwise fall back to mock data
  const photos = match.photos && match.photos.length > 0 
    ? match.photos 
    : mockProfileData.photos;
  
  const profileData = {
    job: match.job || mockProfileData.job,
    location: match.location || mockProfileData.location,
    height: match.height || mockProfileData.height,
    bio: match.bio || mockProfileData.bio,
  };
  
  const compatibility = match.compatibility ?? Math.floor(Math.random() * 15) + 85;

  const nextPhoto = () => {
    setCurrentPhotoIndex((prev) => (prev + 1) % photos.length);
  };

  const prevPhoto = () => {
    setCurrentPhotoIndex((prev) => (prev - 1 + photos.length) % photos.length);
  };

  const vibeEmojis: Record<string, string> = {
    Foodie: "🍜",
    "Night Owl": "🦉",
    Gamer: "🎮",
    "Gym Rat": "💪",
    Bookworm: "📚",
    Traveler: "✈️",
    "Music Lover": "🎵",
    Cinephile: "🎬",
    "Coffee Addict": "☕",
    Fitness: "🏋️",
    Nature: "🌿",
    Techie: "💻",
    Creative: "🎨",
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent className="h-[95vh] bg-background border-t border-border/50 rounded-t-3xl flex flex-col overflow-hidden">
        {/* Fixed Close Button Header */}
        <div className="shrink-0 absolute top-4 right-4 z-30">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(false)}
            className="w-10 h-10 rounded-full bg-background/50 backdrop-blur-sm hover:bg-background/70"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {/* Hero Section - Vibe Video or Photo Gallery */}
          <div className="relative aspect-[3/4] max-h-[55vh] bg-secondary">
            {mockProfileData.hasVideoIntro ? (
              /* Vibe Video Hero */
              <VibePlayer
                videoUrl={mockProfileData.vibeVideoUrl}
                thumbnailUrl={photos[0]}
                vibeCaption={mockProfileData.vibeCaption}
                autoPlay={true}
                showControls={true}
                className="w-full h-full"
              />
            ) : (
              /* Photo Gallery */
              <>
                <AnimatePresence mode="wait">
                  <motion.img
                    key={currentPhotoIndex}
                    src={photos[currentPhotoIndex]}
                    alt={`${match.name}'s photo`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="w-full h-full object-cover"
                  />
                </AnimatePresence>

                {/* Photo indicators */}
                <div className="absolute top-4 left-4 right-16 flex gap-1">
                  {photos.map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex-1 h-1 rounded-full transition-all",
                        i === currentPhotoIndex
                          ? "bg-primary-foreground"
                          : "bg-primary-foreground/30"
                      )}
                    />
                  ))}
                </div>

                {/* Photo navigation tap areas */}
                <button
                  onClick={prevPhoto}
                  className="absolute left-0 top-16 bottom-0 w-1/3"
                  aria-label="Previous photo"
                />
                <button
                  onClick={nextPhoto}
                  className="absolute right-0 top-16 bottom-0 w-1/3"
                  aria-label="Next photo"
                />

                {/* Expand button */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowFullscreenPhoto(true)}
                  className="absolute bottom-4 right-4 z-10 w-10 h-10 rounded-full bg-background/50 backdrop-blur-sm hover:bg-background/70"
                >
                  <Expand className="w-5 h-5" />
                </Button>

                {/* Navigation arrows (desktop) */}
                {photos.length > 1 && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={prevPhoto}
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-background/30 backdrop-blur-sm hover:bg-background/50 opacity-0 hover:opacity-100 transition-opacity hidden sm:flex"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={nextPhoto}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-background/30 backdrop-blur-sm hover:bg-background/50 opacity-0 hover:opacity-100 transition-opacity hidden sm:flex"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </Button>
                  </>
                )}

                {/* Play Intro Video Button (when has video but showing photos) */}
                {mockProfileData.hasVideoIntro && (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setShowVideoOverlay(true)}
                    className="absolute bottom-4 left-4 flex items-center gap-2 px-4 py-2.5 rounded-full bg-background/80 backdrop-blur-md border border-border/50 text-foreground font-medium shadow-lg"
                  >
                    <div className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center">
                      <Play className="w-4 h-4 text-primary-foreground fill-primary-foreground ml-0.5" />
                    </div>
                    <span className="text-sm">Watch Intro</span>
                  </motion.button>
                )}
              </>
            )}

            {/* Gradient overlay at bottom */}
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent pointer-events-none" />
          </div>

          {/* Profile Content */}
          <div className="relative -mt-8 px-4 space-y-4 pb-32">
            {/* Name and basics card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card p-5 rounded-2xl"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-display font-bold text-foreground">
                    {match.name}, {match.age}
                  </h2>
                  <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
                    {profileData.job && (
                      <span className="flex items-center gap-1">
                        <Briefcase className="w-4 h-4" />
                        {profileData.job}
                      </span>
                    )}
                    {profileData.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-4 h-4" />
                        {profileData.location}
                      </span>
                    )}
                    {profileData.height && (
                      <span className="flex items-center gap-1">
                        <Ruler className="w-4 h-4" />
                        {profileData.height} cm
                      </span>
                    )}
                  </div>
                </div>

                {/* Compatibility badge */}
                <div className="flex flex-col items-center shrink-0">
                  <div className="relative w-14 h-14">
                    <svg className="w-full h-full -rotate-90">
                      <circle
                        cx="28"
                        cy="28"
                        r="24"
                        stroke="hsl(var(--muted))"
                        strokeWidth="4"
                        fill="none"
                      />
                      <circle
                        cx="28"
                        cy="28"
                        r="24"
                        stroke="url(#gradient)"
                        strokeWidth="4"
                        fill="none"
                        strokeDasharray={`${compatibility * 1.51} 151`}
                        strokeLinecap="round"
                      />
                      <defs>
                        <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="hsl(var(--neon-violet))" />
                          <stop offset="100%" stopColor="hsl(var(--neon-pink))" />
                        </linearGradient>
                      </defs>
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-sm font-bold text-foreground">{compatibility}%</span>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground mt-1">Match</span>
                </div>
              </div>
            </motion.div>

            {/* Vibe Tags */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-card p-5 rounded-2xl"
            >
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-5 h-5 text-primary" />
                <h3 className="font-display font-semibold text-foreground">
                  Their Vibes
                </h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {match.vibes.map((vibe) => (
                  <motion.span
                    key={vibe}
                    whileHover={{ scale: 1.05 }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary/15 text-primary border border-primary/30 text-sm font-medium"
                  >
                    <span>{vibeEmojis[vibe] || "✨"}</span>
                    {vibe}
                  </motion.span>
                ))}
                {mockProfileData.interests.slice(0, 3).map((interest) => (
                  <motion.span
                    key={interest}
                    whileHover={{ scale: 1.05 }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-secondary text-foreground border border-border text-sm font-medium"
                  >
                    {interest}
                  </motion.span>
                ))}
              </div>
            </motion.div>

            {/* Photo Gallery Thumbnails */}
            {photos.length > 1 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="glass-card p-5 rounded-2xl"
              >
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-lg">📸</span>
                  <h3 className="font-display font-semibold text-foreground">Photos</h3>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((photo, index) => (
                    <motion.button
                      key={index}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      className={cn(
                        "relative aspect-square rounded-xl overflow-hidden",
                        index === currentPhotoIndex && "ring-2 ring-primary"
                      )}
                      onClick={() => {
                        setCurrentPhotoIndex(index);
                        setShowFullscreenPhoto(true);
                      }}
                    >
                      <img
                        src={photo}
                        alt={`${match.name}'s photo ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Bio */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="glass-card p-5 rounded-2xl"
            >
              <div className="flex items-center gap-2 mb-3">
                <Heart className="w-5 h-5 text-accent" />
                <h3 className="font-display font-semibold text-foreground">About Me</h3>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                {profileData.bio}
              </p>
            </motion.div>

            {/* Prompts */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="space-y-4"
            >
              {mockProfileData.prompts.map((prompt, index) => (
                <motion.div
                  key={prompt.question}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 + index * 0.05 }}
                  className="glass-card p-5 rounded-2xl"
                >
                  <p className="text-sm text-primary font-medium mb-2">
                    {prompt.question}
                  </p>
                  <p className="text-foreground leading-relaxed">{prompt.answer}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>

        {/* Sticky Action Bar */}
        <div className="shrink-0 p-4 bg-background/80 backdrop-blur-xl border-t border-border/50 safe-area-bottom">
          <div className="flex gap-3 max-w-lg mx-auto">
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                onVideoCall();
              }}
              className="flex-1 h-14 rounded-2xl border-border/50 bg-secondary/50 hover:bg-secondary font-semibold text-base gap-2"
            >
              <Video className="w-5 h-5" />
              Video Call
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                onMessage();
              }}
              className="flex-1 h-14 rounded-2xl bg-gradient-primary hover:opacity-90 font-semibold text-base gap-2 text-primary-foreground"
            >
              <MessageCircle className="w-5 h-5" />
              Message
            </Button>
          </div>
        </div>

        {/* Video Intro Modal */}
        <AnimatePresence>
          {showVideoOverlay && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-background/95 backdrop-blur-lg z-50 flex items-center justify-center"
            >
              <div className="text-center p-8">
                <div className="w-24 h-24 rounded-full bg-gradient-primary mx-auto mb-6 flex items-center justify-center">
                  <Play className="w-10 h-10 text-primary-foreground fill-primary-foreground ml-1" />
                </div>
                <h3 className="text-xl font-display font-semibold text-foreground mb-2">
                  Video Intro
                </h3>
                <p className="text-muted-foreground mb-6">
                  {match.name}'s introduction video would play here
                </p>
                <Button
                  variant="outline"
                  onClick={() => setShowVideoOverlay(false)}
                  className="rounded-full"
                >
                  Close
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Fullscreen Photo Modal */}
        <PhotoPreviewModal
          photos={photos}
          initialIndex={currentPhotoIndex}
          isOpen={showFullscreenPhoto}
          onClose={() => setShowFullscreenPhoto(false)}
        />
      </DrawerContent>
    </Drawer>
  );
};
