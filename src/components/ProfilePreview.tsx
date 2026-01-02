import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  X, 
  ChevronLeft, 
  ChevronRight, 
  MapPin, 
  Briefcase, 
  Ruler,
  Heart,
  MessageCircle,
  Sparkles,
  Expand
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VibeTag } from "@/components/VibeTag";
import { VerificationBadge } from "@/components/VerificationBadge";
import { PhotoVerifiedMark } from "@/components/PhotoVerifiedMark";
import { PhotoPreviewModal } from "@/components/PhotoPreviewModal";
import { cn } from "@/lib/utils";

interface ProfilePreviewProps {
  profile: {
    name: string;
    age: number;
    photos: string[];
    bio: string;
    job: string;
    location: string;
    heightCm: number;
    vibes: string[];
    verified: boolean;
    photoVerified?: boolean;
    prompts: { prompt: string; answer: string }[];
    relationshipIntent: string;
  };
  onClose: () => void;
}

const intentLabels: Record<string, string> = {
  "long-term": "💍 Long-term partner",
  "relationship": "💕 Relationship",
  "something-casual": "✨ Something casual",
  "new-friends": "👋 New friends",
  "figuring-out": "🤷 Figuring it out",
};

export const ProfilePreview = ({ profile, onClose }: ProfilePreviewProps) => {
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [showFullscreenPhoto, setShowFullscreenPhoto] = useState(false);

  const nextPhoto = () => {
    setCurrentPhotoIndex((prev) => 
      prev < profile.photos.length - 1 ? prev + 1 : prev
    );
  };

  const prevPhoto = () => {
    setCurrentPhotoIndex((prev) => 
      prev > 0 ? prev - 1 : prev
    );
  };

  const hasPhotos = profile.photos.length > 0;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-background flex flex-col"
      >
        {/* Fixed Header */}
        <div className="shrink-0 flex items-center justify-between p-4 border-b border-border/50 bg-background/95 backdrop-blur-sm z-20">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="w-10 h-10 rounded-full"
          >
            <X className="w-5 h-5" />
          </Button>
          <div className="px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20">
            <span className="text-sm font-medium text-primary">Preview Mode</span>
          </div>
          <div className="w-10" />
        </div>

        {/* Scrollable Content - Single scroll container */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {/* Photo Gallery Hero */}
          {hasPhotos && (
            <div className="relative aspect-[3/4] max-h-[65vh] bg-secondary">
              <AnimatePresence mode="wait">
                <motion.img
                  key={currentPhotoIndex}
                  src={profile.photos[currentPhotoIndex]}
                  alt={`${profile.name}'s photo`}
                  className="w-full h-full object-cover"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                />
              </AnimatePresence>

              {/* Photo indicators */}
              <div className="absolute top-4 left-4 right-4 flex gap-1">
                {profile.photos.map((_, index) => (
                  <div
                    key={index}
                    className={cn(
                      "h-1 rounded-full flex-1 max-w-12 transition-all",
                      index === currentPhotoIndex
                        ? "bg-primary-foreground"
                        : "bg-primary-foreground/30"
                    )}
                  />
                ))}
              </div>

              {/* Navigation tap areas */}
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
                className="absolute bottom-4 right-4 w-10 h-10 rounded-full bg-background/50 backdrop-blur-sm hover:bg-background/70"
              >
                <Expand className="w-5 h-5" />
              </Button>

              {/* Gradient overlay */}
              <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent pointer-events-none" />

              {/* Profile info overlay */}
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-3xl font-display font-bold text-foreground">
                        {profile.name}, {profile.age}
                      </h1>
                      <VerificationBadge verified={profile.verified} size="lg" />
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-muted-foreground">
                      {profile.job && (
                        <span className="flex items-center gap-1 text-sm">
                          <Briefcase className="w-3.5 h-3.5" />
                          {profile.job}
                        </span>
                      )}
                      {profile.location && (
                        <span className="flex items-center gap-1 text-sm">
                          <MapPin className="w-3.5 h-3.5" />
                          {profile.location}
                        </span>
                      )}
                    </div>
                  </div>

                  <PhotoVerifiedMark verified={!!profile.photoVerified} size="md" />
                </div>
              </div>
            </div>
          )}

          {/* Content Cards */}
          <div className="p-4 space-y-4 pb-36">
            {/* Name and basics for no-photo state */}
            {!hasPhotos && (
              <div className="glass-card p-5 rounded-2xl">
                <div className="flex items-center gap-2 mb-2">
                  <h1 className="text-3xl font-display font-bold text-foreground">
                    {profile.name}, {profile.age}
                  </h1>
                  <VerificationBadge verified={profile.verified} size="lg" />
                </div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  {profile.job && (
                    <span className="flex items-center gap-1 text-sm">
                      <Briefcase className="w-3.5 h-3.5" />
                      {profile.job}
                    </span>
                  )}
                  {profile.location && (
                    <span className="flex items-center gap-1 text-sm">
                      <MapPin className="w-3.5 h-3.5" />
                      {profile.location}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Key details bar */}
            <div className="flex flex-wrap gap-3">
              {profile.heightCm > 0 && (
                <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-secondary border border-border">
                  <Ruler className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{profile.heightCm} cm</span>
                </div>
              )}
              {profile.relationshipIntent && intentLabels[profile.relationshipIntent] && (
                <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 border border-primary/20">
                  <span className="text-sm">{intentLabels[profile.relationshipIntent]}</span>
                </div>
              )}
            </div>

            {/* Bio */}
            {profile.bio && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="glass-card p-5 rounded-2xl"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Heart className="w-5 h-5 text-accent" />
                  <h3 className="font-display font-semibold text-foreground">About Me</h3>
                </div>
                <p className="text-muted-foreground leading-relaxed">{profile.bio}</p>
              </motion.div>
            )}

            {/* Vibes */}
            {profile.vibes.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="glass-card p-5 rounded-2xl"
              >
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <h3 className="font-display font-semibold text-foreground">Vibes</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {profile.vibes.map((vibe) => (
                    <VibeTag key={vibe} label={vibe} />
                  ))}
                </div>
              </motion.div>
            )}

            {/* Photo Thumbnails */}
            {hasPhotos && profile.photos.length > 1 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="glass-card p-5 rounded-2xl"
              >
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-lg">📸</span>
                  <h3 className="font-display font-semibold text-foreground">Photos</h3>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {profile.photos.map((photo, index) => (
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
                        alt={`Photo ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Prompts */}
            {profile.prompts.filter(p => p.answer && p.prompt).map((prompt, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + index * 0.05 }}
                className="glass-card p-5 rounded-2xl"
              >
                <p className="text-sm font-medium text-primary mb-2">{prompt.prompt}</p>
                <p className="text-foreground leading-relaxed">{prompt.answer}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Fixed Bottom Action Bar */}
        <div className="shrink-0 p-4 pb-8 bg-gradient-to-t from-background via-background to-transparent border-t border-border/30">
          <div className="flex items-center justify-center gap-4 max-w-md mx-auto">
            <div className="w-14 h-14 rounded-full bg-secondary/80 flex items-center justify-center border border-border">
              <X className="w-6 h-6 text-muted-foreground" />
            </div>
            <div className="w-16 h-16 rounded-full bg-gradient-primary flex items-center justify-center neon-glow-pink">
              <Heart className="w-7 h-7 text-primary-foreground" fill="currentColor" />
            </div>
            <div className="w-14 h-14 rounded-full bg-secondary/80 flex items-center justify-center border border-border">
              <MessageCircle className="w-6 h-6 text-muted-foreground" />
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-3">
            This is how others see your profile
          </p>
        </div>
      </motion.div>

      {/* Fullscreen Photo Modal */}
      <PhotoPreviewModal
        photos={profile.photos}
        initialIndex={currentPhotoIndex}
        isOpen={showFullscreenPhoto}
        onClose={() => setShowFullscreenPhoto(false)}
      />
    </>
  );
};
