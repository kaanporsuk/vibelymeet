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
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VibeTag } from "@/components/VibeTag";
import { VerificationBadge } from "@/components/VerificationBadge";
import { PhotoVerifiedMark } from "@/components/PhotoVerifiedMark";
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background"
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="w-10 h-10 rounded-full glass-card"
        >
          <X className="w-5 h-5" />
        </Button>
        <div className="px-3 py-1.5 rounded-full glass-card">
          <span className="text-sm font-medium">Preview Mode</span>
        </div>
        <div className="w-10" /> {/* Spacer */}
      </div>

      {/* Photo gallery */}
      <div className="relative h-[60vh]">
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

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />

        {/* Photo indicators */}
        <div className="absolute top-16 left-0 right-0 flex justify-center gap-1 px-4">
          {profile.photos.map((_, index) => (
            <div
              key={index}
              className={cn(
                "h-1 rounded-full flex-1 max-w-12 transition-all",
                index === currentPhotoIndex
                  ? "bg-white"
                  : "bg-white/30"
              )}
            />
          ))}
        </div>

        {/* Navigation areas */}
        <button
          onClick={prevPhoto}
          className="absolute left-0 top-20 bottom-0 w-1/3"
          aria-label="Previous photo"
        />
        <button
          onClick={nextPhoto}
          className="absolute right-0 top-20 bottom-0 w-1/3"
          aria-label="Next photo"
        />

        {/* Profile info overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-4 space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-display font-bold text-white">
                  {profile.name}, {profile.age}
                </h1>
                <VerificationBadge verified={profile.verified} size="lg" />
              </div>

              <div className="flex items-center gap-3 mt-1 text-white/80">
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

      {/* Content section */}
      <div className="p-4 space-y-4 overflow-y-auto max-h-[40vh] pb-24">
        {/* Intent */}
        {profile.relationshipIntent && (
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 border border-primary/20">
            <span className="text-sm">{intentLabels[profile.relationshipIntent]}</span>
          </div>
        )}

        {/* Bio */}
        {profile.bio && (
          <p className="text-foreground leading-relaxed">{profile.bio}</p>
        )}

        {/* Vibes */}
        {profile.vibes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {profile.vibes.map((vibe) => (
              <VibeTag key={vibe} label={vibe} />
            ))}
          </div>
        )}

        {/* Prompts */}
        {profile.prompts.filter(p => p.answer).map((prompt, index) => (
          <div key={index} className="glass-card p-4 space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{prompt.prompt}</p>
            <p className="text-foreground">{prompt.answer}</p>
          </div>
        ))}

        {/* Details */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {profile.heightCm > 0 && (
            <span className="flex items-center gap-1">
              <Ruler className="w-4 h-4" />
              {profile.heightCm} cm
            </span>
          )}
        </div>
      </div>

      {/* Action buttons preview */}
      <div className="absolute bottom-0 left-0 right-0 p-4 pb-8 bg-gradient-to-t from-background via-background to-transparent">
        <div className="flex items-center justify-center gap-4">
          <div className="w-14 h-14 rounded-full bg-secondary/80 flex items-center justify-center">
            <X className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="w-16 h-16 rounded-full bg-gradient-primary flex items-center justify-center neon-glow-pink">
            <Heart className="w-7 h-7 text-white" fill="white" />
          </div>
          <div className="w-14 h-14 rounded-full bg-secondary/80 flex items-center justify-center">
            <MessageCircle className="w-6 h-6 text-muted-foreground" />
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-3">
          This is how others see your profile
        </p>
      </div>
    </motion.div>
  );
};
