import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, ChevronLeft, Check, Sparkles, Rocket, Camera, MessageCircle, Heart, Loader2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import WizardProgressRing from "./WizardProgressRing";
import PhotoUploadGrid from "./PhotoUploadGrid";
import PromptCards from "./PromptCards";
import VibeTagCloud from "./VibeTagCloud";
import { useUserProfile } from "@/contexts/AuthContext";
import { uploadImageToBunny } from "@/services/imageUploadService";
import { supabase } from "@/integrations/supabase/client";

interface ProfileWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  onOpenVibeStudio?: () => void;
}

interface Prompt {
  id: string;
  question: string;
  emoji: string;
  placeholder: string;
  answer: string;
}

const steps = [
  { id: 1, key: "photos", title: "Visual Vibe", subtitle: "Show your best self", icon: Camera },
  { id: 2, key: "prompts", title: "Conversation Starters", subtitle: "Give matches something to respond to", icon: MessageCircle },
  { id: 3, key: "vibes", title: "Your Vibes", subtitle: "Define your identity", icon: Heart },
  { id: 4, key: "video", title: "Vibe Video", subtitle: "Record a 15s intro", icon: Video },
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

// Completion thresholds
const PHOTO_THRESHOLD = 3; // At least 3 photos
const PROMPT_THRESHOLD = 2; // At least 2 prompts answered
const VIBE_THRESHOLD = 5; // At least 5 vibes selected

const ProfileWizard = ({ isOpen, onClose, onComplete, onOpenVibeStudio }: ProfileWizardProps) => {
  const { user } = useUserProfile();
  const [currentStep, setCurrentStep] = useState(0);
  const [photos, setPhotos] = useState<string[]>(Array(6).fill(""));
  const [photoFiles, setPhotoFiles] = useState<(File | null)[]>(Array(6).fill(null));
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [vibes, setVibes] = useState<string[]>([]);
  const [hasVideo, setHasVideo] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [vibeSkipped, setVibeSkipped] = useState(false);
  
  // Track which sections are incomplete (only show these)
  const [incompleteSteps, setIncompleteSteps] = useState<typeof steps>([]);

  // Progress ring uses server-computed vibe score (profiles.vibe_score)
  const [progress, setProgress] = useState(0);

  const refreshProgressFromServer = useCallback(async () => {
    try {
      const { fetchMyProfile } = await import("@/services/profileService");
      const profileData = await fetchMyProfile();
      setProgress(profileData?.vibeScore ?? 0);
    } catch {
      setProgress(0);
    }
  }, []);

  // Helper to get emoji for a prompt question
  const getEmojiForQuestion = (question: string): string => {
    const emojiMap: Record<string, string> = {
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
    return emojiMap[question] || "💭";
  };

  // Check if section is complete
  const isSectionComplete = (key: string, profilePhotos: string[], profilePrompts: Prompt[], profileVibes: string[], profileHasVideo: boolean) => {
    switch (key) {
      case "photos":
        return profilePhotos.filter(p => p !== "").length >= PHOTO_THRESHOLD;
      case "prompts":
        return profilePrompts.filter(p => p.answer && p.answer.trim().length > 0).length >= PROMPT_THRESHOLD;
      case "vibes":
        return profileVibes.length >= VIBE_THRESHOLD;
      case "video":
        return profileHasVideo;
      default:
        return false;
    }
  };

  // Load existing profile data when wizard opens
  useEffect(() => {
    if (!isOpen || !user) {
      setIsLoading(false);
      return;
    }

    const loadExistingProfile = async () => {
      setIsLoading(true);
      try {
        // Fetch full profile data using profileService
        const { fetchMyProfile } = await import("@/services/profileService");
        const profile = await fetchMyProfile();
        
        let loadedPhotos: string[] = Array(6).fill("");
        let loadedPrompts: Prompt[] = [];
        let loadedVibes: string[] = [];
        let loadedHasVideo = false;
        
        if (profile) {
          // Load photos - pad to 6 slots
          const existingPhotos = profile.photos || [];
          loadedPhotos = [...existingPhotos, ...Array(6 - existingPhotos.length).fill("")].slice(0, 6);
          setPhotos(loadedPhotos);
          setPhotoFiles(Array(6).fill(null));

          // Load prompts from database (not bio parsing)
          if (profile.prompts && profile.prompts.length > 0) {
            loadedPrompts = profile.prompts.map((p, idx) => ({
              id: String(idx + 1),
              question: p.question,
              emoji: getEmojiForQuestion(p.question),
              placeholder: "",
              answer: p.answer || ""
            }));
            setPrompts(loadedPrompts);
          }
          
          // Load vibes
          loadedVibes = profile.vibes || [];
          setVibes(loadedVibes);
          
          // Check video
          loadedHasVideo = profile.bunnyVideoStatus === "ready";
          setHasVideo(loadedHasVideo);
        }

        // Determine which steps are incomplete
        const incomplete = steps.filter(step => 
          !isSectionComplete(step.key, loadedPhotos, loadedPrompts, loadedVibes, loadedHasVideo)
        );
        
        setIncompleteSteps(incomplete);
        setCurrentStep(0);
        
        // If everything is complete, show level up immediately
        if (incomplete.length === 0) {
          setIsComplete(true);
          setShowLevelUp(true);
        }

        setProgress(profile?.vibeScore ?? 0);

      } catch (error) {
        console.error('Failed to load existing profile:', error);
        // Default to showing all steps if load fails
        setIncompleteSteps(steps);
      } finally {
        setIsLoading(false);
      }
    };

    loadExistingProfile();
  }, [isOpen, user]);

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

  // Check completion - only trigger when all incomplete steps have been addressed
  useEffect(() => {
    if (progress >= 100 && !isComplete && incompleteSteps.length > 0) {
      // Recheck if all sections are now complete
      const stillIncomplete = incompleteSteps.filter(step => 
        !isSectionComplete(step.key, photos, prompts, vibes, hasVideo)
      );
      
      if (stillIncomplete.length === 0) {
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
    }
  }, [progress, isComplete, photos, prompts, vibes, incompleteSteps]);

  const getCoachText = () => {
    if (incompleteSteps.length === 0) {
      return coachTexts.complete[Math.floor(Math.random() * coachTexts.complete.length)];
    }
    const category = progress < 33 ? "low" : progress < 66 ? "medium" : progress < 100 ? "high" : "complete";
    const texts = coachTexts[category];
    return texts[Math.floor(Math.random() * texts.length)];
  };

  // Get the current step based on incompleteSteps
  const activeSteps = incompleteSteps.length > 0 ? incompleteSteps : steps;
  const currentActiveStep = activeSteps[currentStep];

  const nextStep = () => {
    if (currentStep < activeSteps.length - 1) {
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
      // Import the profile update function
      const { updateMyProfile } = await import("@/services/profileService");
      
      // Upload photos that are file objects (local uploads)
      const uploadedPhotoUrls: string[] = [];
      
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const file = photoFiles[i];
        
        if (photo && file) {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) throw new Error("Not authenticated");
          const url = await uploadImageToBunny(file, session.access_token);
          uploadedPhotoUrls.push(url);
        } else if (photo && photo.startsWith('http')) {
          // Already a URL (maybe from previous session)
          uploadedPhotoUrls.push(photo);
        }
      }

      // Convert prompts to the database format
      const dbPrompts = prompts
        .filter(p => p.answer && p.answer.trim())
        .map(p => ({
          question: p.question,
          answer: p.answer.trim()
        }));

      // Save all changes to the database
      await updateMyProfile({
        photos: uploadedPhotoUrls.length > 0 ? uploadedPhotoUrls : undefined,
        avatarUrl: uploadedPhotoUrls[0] || undefined,
        prompts: dbPrompts.length > 0 ? dbPrompts : undefined,
        vibes: vibes.length > 0 ? vibes : undefined,
      });

      await refreshProgressFromServer();

      toast.success("Profile updated! 🎉");
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
                className="w-32 h-32 rounded-full bg-gradient-primary flex items-center justify-center mb-6 shadow-[0_0_60px_hsl(var(--accent)/0.5)]"
              >
                <Rocket className="w-16 h-16 text-primary-foreground" />
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
                className="space-y-4"
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

            {/* Step indicators - only show incomplete steps */}
            <div className="flex items-center justify-center gap-4 mt-6">
              {activeSteps.map((step, index) => {
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

          {/* Content - render based on currentActiveStep.key */}
          <div className="p-6 overflow-y-auto max-h-[50vh]">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground text-sm">Loading your profile...</p>
              </div>
            ) : activeSteps.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Check className="w-12 h-12 text-primary mb-4" />
                <p className="text-foreground font-medium text-center">Your profile is complete!</p>
                <p className="text-muted-foreground text-sm text-center mt-1">You're all set to start matching.</p>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                {currentActiveStep?.key === "photos" && (
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

                {currentActiveStep?.key === "prompts" && (
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

                {currentActiveStep?.key === "vibes" && (
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

                {currentActiveStep?.key === "video" && (
                  <motion.div
                    key="video"
                    initial={{ opacity: 0, x: 50 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -50 }}
                    transition={{ type: "spring", damping: 25 }}
                    className="flex flex-col items-center justify-center py-8 space-y-6"
                  >
                    {vibeSkipped ? (
                      <div className="text-center space-y-3 py-4">
                        <p className="text-sm text-muted-foreground">
                          📹 Profiles with a Vibe Video get 5x more matches
                        </p>
                        <button
                          onClick={() => setVibeSkipped(false)}
                          className="text-xs text-primary hover:underline"
                        >
                          Record a Vibe Video
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="w-20 h-20 rounded-full bg-gradient-primary flex items-center justify-center">
                          <Video className="w-10 h-10 text-primary-foreground" />
                        </div>
                        <div className="text-center space-y-2">
                          <h3 className="text-lg font-semibold text-foreground">Record Your Vibe Video</h3>
                          <p className="text-sm text-muted-foreground max-w-xs">
                            A 15-second video introduction helps you stand out and get 3x more matches!
                          </p>
                        </div>
                        <Button 
                          variant="gradient" 
                          onClick={async () => {
                            if (user) {
                              try {
                                const { updateMyProfile } = await import("@/services/profileService");
                                const uploadedPhotoUrls: string[] = [];
                                for (let i = 0; i < photos.length; i++) {
                                  const photo = photos[i];
                                  const file = photoFiles[i];
                                    if (photo && file) {
                                      const { data: { session: sess } } = await supabase.auth.getSession();
                                      if (!sess) throw new Error("Not authenticated");
                                      const url = await uploadImageToBunny(file, sess.access_token);
                                      uploadedPhotoUrls.push(url);
                                  } else if (photo && photo.startsWith('http')) {
                                    uploadedPhotoUrls.push(photo);
                                  }
                                }
                                const dbPrompts = prompts
                                  .filter(p => p.answer && p.answer.trim())
                                  .map(p => ({ question: p.question, answer: p.answer.trim() }));
                                await updateMyProfile({
                                  photos: uploadedPhotoUrls.length > 0 ? uploadedPhotoUrls : undefined,
                                  avatarUrl: uploadedPhotoUrls[0] || undefined,
                                  prompts: dbPrompts.length > 0 ? dbPrompts : undefined,
                                  vibes: vibes.length > 0 ? vibes : undefined,
                                });
                                await refreshProgressFromServer();
                                toast.success("Progress saved!");
                              } catch (error) {
                                console.error("Failed to save progress:", error);
                              }
                            }
                            onClose();
                            if (onOpenVibeStudio) {
                              onOpenVibeStudio();
                            }
                          }}
                          className="gap-2"
                        >
                          <Video className="w-4 h-4" />
                          Go to Vibe Studio
                        </Button>
                        <button
                          onClick={() => setVibeSkipped(true)}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Skip for now
                        </button>
                      </>
                    )}
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

              {currentStep < activeSteps.length - 1 ? (
                <Button variant="gradient" onClick={nextStep} className="gap-2">
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  variant="gradient"
                  onClick={handleComplete}
                  disabled={isSaving}
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
                      Save & Continue
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
