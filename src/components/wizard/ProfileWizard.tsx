import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, ChevronLeft, Check, Sparkles, Rocket, Camera, MessageCircle, Heart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import WizardProgressRing from "./WizardProgressRing";
import PhotoUploadGrid from "./PhotoUploadGrid";
import PromptCards from "./PromptCards";
import VibeTagCloud from "./VibeTagCloud";
import { useAuth } from "@/contexts/AuthContext";
import { profileService, videoService } from "@/services/vibelyService";

interface ProfileWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

interface Prompt {
  id: string;
  question: string;
  emoji: string;
  placeholder: string;
  answer: string;
}

const steps = [
  { id: 1, title: "Visual Vibe", subtitle: "Show your best self", icon: Camera },
  { id: 2, title: "Icebreakers", subtitle: "Spark conversations", icon: MessageCircle },
  { id: 3, title: "Your Vibes", subtitle: "Define your identity", icon: Heart },
];

const coachTexts = {
  low: [
    "Let's get started! Add your first photo 📸",
    "Profiles with 3+ photos get 40% more matches!",
    "Your journey to meaningful connections starts here ✨",
  ],
  medium: [
    "You're doing great! Keep going 🔥",
    "Add 2 more items to unlock premium matches!",
    "Almost there! Your profile is looking good 💪",
  ],
  high: [
    "Wow! Your profile is almost complete! 🌟",
    "One more step to become a Vibely superstar!",
    "You're in the top 20% of profiles! 🚀",
  ],
  complete: [
    "Perfect! Your profile is ready to shine! ✨",
    "You're all set for amazing connections! 💝",
    "Profile boost activated! Time to vibe! 🎉",
  ],
};

const ProfileWizard = ({ isOpen, onClose, onComplete }: ProfileWizardProps) => {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [photos, setPhotos] = useState<string[]>(Array(6).fill(""));
  const [photoFiles, setPhotoFiles] = useState<(File | null)[]>(Array(6).fill(null));
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [vibes, setVibes] = useState<string[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load existing profile data when wizard opens
  useEffect(() => {
    if (!isOpen || !user) {
      setIsLoading(false);
      return;
    }

    const loadExistingProfile = async () => {
      setIsLoading(true);
      try {
        // Fetch profile data
        const profile = await profileService.getCurrentProfile();
        if (profile) {
          // Load photos - pad to 6 slots
          const existingPhotos = profile.photos || [];
          const paddedPhotos = [...existingPhotos, ...Array(6 - existingPhotos.length).fill("")].slice(0, 6);
          setPhotos(paddedPhotos);
          // Mark existing photos as URLs (no file objects)
          setPhotoFiles(Array(6).fill(null));

          // Parse prompts from bio if available
          if (profile.bio) {
            const parsedPrompts = parsePromptsFromBio(profile.bio);
            if (parsedPrompts.length > 0) {
              setPrompts(parsedPrompts);
            }
          }
        }

        // Fetch vibes
        const existingVibes = await profileService.getProfileVibes(user.id);
        if (existingVibes.length > 0) {
          setVibes(existingVibes);
        }
      } catch (error) {
        console.error('Failed to load existing profile:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadExistingProfile();
  }, [isOpen, user]);

  // Helper to parse prompts from bio text
  const parsePromptsFromBio = (bio: string): Prompt[] => {
    const promptPatterns = [
      { emoji: "💬", question: "A perfect first date looks like..." },
      { emoji: "🎵", question: "My go-to karaoke song is..." },
      { emoji: "✈️", question: "My dream travel destination is..." },
      { emoji: "🍳", question: "My signature dish is..." },
      { emoji: "📚", question: "I'm currently reading..." },
      { emoji: "🎬", question: "A movie I can watch forever..." },
    ];

    const parsedPrompts: Prompt[] = [];
    
    promptPatterns.forEach(pattern => {
      const searchText = `${pattern.emoji} ${pattern.question}`;
      const idx = bio.indexOf(searchText);
      if (idx !== -1) {
        // Extract answer between this question and next emoji or end of text
        const afterQuestion = bio.slice(idx + searchText.length);
        const nextEmojiMatch = afterQuestion.match(/\n\n[💬🎵✈️🍳📚🎬]/);
        const answer = nextEmojiMatch 
          ? afterQuestion.slice(0, nextEmojiMatch.index).trim()
          : afterQuestion.trim();
        
        if (answer) {
          parsedPrompts.push({
            id: `prompt-${parsedPrompts.length}`,
            question: pattern.question,
            emoji: pattern.emoji,
            placeholder: "",
            answer: answer.replace(/^\n+/, '') // Remove leading newlines
          });
        }
      }
    });

    return parsedPrompts;
  };

  // Calculate progress
  const calculateProgress = () => {
    const photoCount = photos.filter((p) => p !== "").length;
    const promptCount = prompts.filter((p) => p.answer.trim().length > 0).length;
    const vibeCount = vibes.length;

    // Weights: Photos 40%, Prompts 30%, Vibes 30%
    const photoProgress = Math.min(photoCount / 3, 1) * 40;
    const promptProgress = Math.min(promptCount / 2, 1) * 30;
    const vibeProgress = Math.min(vibeCount / 5, 1) * 30;

    return Math.round(photoProgress + promptProgress + vibeProgress);
  };

  const progress = calculateProgress();

  // Auto-save indicator
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (photos.some((p) => p !== "") || prompts.length > 0 || vibes.length > 0) {
        setShowSaved(true);
        setTimeout(() => setShowSaved(false), 2000);
      }
    }, 1500);

    return () => clearTimeout(timeout);
  }, [photos, prompts, vibes]);

  // Check completion
  useEffect(() => {
    if (progress >= 100 && !isComplete) {
      setIsComplete(true);
      setTimeout(() => {
        setShowLevelUp(true);
        confetti({
          particleCount: 150,
          spread: 100,
          origin: { y: 0.5 },
          colors: ["#a855f7", "#ec4899", "#06b6d4", "#facc15"],
        });
      }, 500);
    }
  }, [progress, isComplete]);

  const getCoachText = () => {
    const category = progress < 33 ? "low" : progress < 66 ? "medium" : progress < 100 ? "high" : "complete";
    const texts = coachTexts[category];
    return texts[Math.floor(Math.random() * texts.length)];
  };

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((s) => s + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
    }
  };

  // Handle photo changes - store both preview URLs and file references
  const handlePhotosChange = (newPhotos: string[], files?: (File | null)[]) => {
    setPhotos(newPhotos);
    if (files) {
      setPhotoFiles(files);
    }
  };

  const handleComplete = async () => {
    if (!user) {
      toast.error("Please sign in to save your profile");
      return;
    }

    setIsSaving(true);

    try {
      // Upload photos that are file objects (local uploads)
      const uploadedPhotoUrls: string[] = [];
      
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const file = photoFiles[i];
        
        if (photo && file) {
          // Local file, upload it
          const url = await videoService.uploadPhoto(user.id, file, i);
          uploadedPhotoUrls.push(url);
        } else if (photo && photo.startsWith('http')) {
          // Already a URL (maybe from previous session)
          uploadedPhotoUrls.push(photo);
        }
      }

      // Build bio from prompts
      const bio = prompts
        .filter(p => p.answer.trim())
        .map(p => `${p.emoji} ${p.question}\n${p.answer}`)
        .join('\n\n');

      // Save everything to the database
      await profileService.saveCompleteProfile(user.id, {
        photos: uploadedPhotoUrls,
        bio: bio || undefined,
        vibeLabels: vibes
      });

      toast.success("Profile complete! You're ready to vibe! 🎉");
      onComplete();
      onClose();
    } catch (error) {
      console.error('Failed to save profile:', error);
      toast.error("Failed to save profile. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-md p-4"
      >
        {/* Level Up Overlay */}
        <AnimatePresence>
          {showLevelUp && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-60 flex flex-col items-center justify-center bg-background/95 backdrop-blur-xl"
            >
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
                className="w-32 h-32 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center mb-6 shadow-[0_0_60px_rgba(250,204,21,0.5)]"
              >
                <Rocket className="w-16 h-16 text-white" />
              </motion.div>

              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-3xl font-bold text-foreground mb-2 text-center"
              >
                You're Ready to Vibe! 🚀
              </motion.h2>

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="text-muted-foreground text-center mb-8"
              >
                Profile Boost Activated • Premium matches await
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
              >
                <Button
                  variant="gradient"
                  size="xl"
                  onClick={handleComplete}
                  disabled={isSaving}
                  className="relative overflow-hidden"
                >
                  {isSaving ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Saving...
                    </span>
                  ) : (
                    <motion.span
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="flex items-center gap-2"
                    >
                      <Sparkles className="w-5 h-5" />
                      Start Matching
                    </motion.span>
                  )}
                </Button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Wizard */}
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.9, y: 20 }}
          className="w-full max-w-md max-h-[90vh] overflow-hidden rounded-3xl glass-card border border-border"
        >
          {/* Header */}
          <div className="relative p-6 border-b border-border bg-gradient-to-b from-card to-transparent">
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80 transition-colors"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>

            {/* Auto-save indicator */}
            <AnimatePresence>
              {showSaved && (
                <motion.div
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="absolute top-4 left-4 flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/20 text-primary text-xs"
                >
                  <Check className="w-3 h-3" />
                  Saved
                </motion.div>
              )}
            </AnimatePresence>

            {/* Progress Ring & Coach */}
            <div className="flex flex-col items-center gap-4">
              <WizardProgressRing progress={progress} isComplete={isComplete} />
              
              <motion.p
                key={progress}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm text-muted-foreground text-center max-w-[250px]"
              >
                {getCoachText()}
              </motion.p>
            </div>

            {/* Step indicators */}
            <div className="flex items-center justify-center gap-4 mt-6">
              {steps.map((step, index) => {
                const Icon = step.icon;
                const isActive = index === currentStep;
                const isPast = index < currentStep;

                return (
                  <button
                    key={step.id}
                    onClick={() => setCurrentStep(index)}
                    className={`
                      flex flex-col items-center gap-1 transition-all
                      ${isActive ? "scale-110" : "opacity-60 hover:opacity-80"}
                    `}
                  >
                    <div className={`
                      w-10 h-10 rounded-full flex items-center justify-center transition-all
                      ${isActive 
                        ? "bg-gradient-to-br from-primary to-accent shadow-lg" 
                        : isPast 
                          ? "bg-primary/30" 
                          : "bg-secondary"
                      }
                    `}>
                      {isPast ? (
                        <Check className="w-5 h-5 text-primary" />
                      ) : (
                        <Icon className={`w-5 h-5 ${isActive ? "text-primary-foreground" : "text-muted-foreground"}`} />
                      )}
                    </div>
                    <span className={`text-xs font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                      {step.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[50vh]">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground text-sm">Loading your profile...</p>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                {currentStep === 0 && (
                  <motion.div
                    key="photos"
                    initial={{ opacity: 0, x: 50 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -50 }}
                    transition={{ type: "spring", damping: 25 }}
                  >
                    <PhotoUploadGrid 
                      photos={photos} 
                      onPhotosChange={(newPhotos) => handlePhotosChange(newPhotos, photoFiles)} 
                      onFilesChange={setPhotoFiles}
                    />
                  </motion.div>
                )}

                {currentStep === 1 && (
                  <motion.div
                    key="prompts"
                    initial={{ opacity: 0, x: 50 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -50 }}
                    transition={{ type: "spring", damping: 25 }}
                  >
                    <PromptCards prompts={prompts} onPromptsChange={setPrompts} />
                  </motion.div>
                )}

                {currentStep === 2 && (
                  <motion.div
                    key="vibes"
                    initial={{ opacity: 0, x: 50 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -50 }}
                    transition={{ type: "spring", damping: 25 }}
                  >
                    <VibeTagCloud selectedTags={vibes} onTagsChange={setVibes} />
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-border bg-gradient-to-t from-card to-transparent">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                onClick={prevStep}
                disabled={currentStep === 0}
                className="gap-2"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </Button>

              {currentStep < steps.length - 1 ? (
                <Button variant="gradient" onClick={nextStep} className="gap-2">
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  variant="gradient"
                  onClick={handleComplete}
                  disabled={progress < 100 || isSaving}
                  className="gap-2"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      {progress >= 100 ? "Complete Profile" : `${progress}% Complete`}
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ProfileWizard;
