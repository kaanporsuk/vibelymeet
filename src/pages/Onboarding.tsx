import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Sparkles, Upload, X, Video, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ProgressBar";
import { VibeTag } from "@/components/VibeTag";
import { toast } from "sonner";

const vibeOptions = [
  { label: "Foodie", emoji: "🍜" },
  { label: "Gamer", emoji: "🎮" },
  { label: "Night Owl", emoji: "🦉" },
  { label: "Fitness", emoji: "💪" },
  { label: "Creative", emoji: "🎨" },
  { label: "Traveler", emoji: "✈️" },
  { label: "Music Lover", emoji: "🎵" },
  { label: "Bookworm", emoji: "📚" },
  { label: "Tech Nerd", emoji: "💻" },
  { label: "Nature", emoji: "🌿" },
  { label: "Film Buff", emoji: "🎬" },
  { label: "Coffee Addict", emoji: "☕" },
];

const genderOptions = [
  { label: "Woman", value: "woman" },
  { label: "Man", value: "man" },
  { label: "Non-binary", value: "non-binary" },
  { label: "Other", value: "other" },
  { label: "Prefer not to say", value: "prefer-not" },
];

const Onboarding = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState({
    name: "",
    age: "",
    gender: "",
    vibes: [] as string[],
    photos: [] as string[],
    hasVibeVideo: false,
  });

  const totalSteps = 5;

  const nextStep = () => {
    if (step < totalSteps - 1) {
      setStep(step + 1);
    } else {
      toast.success("Welcome to Vibely! 🎉");
      navigate("/dashboard");
    }
  };

  const handleVibeSelect = (vibe: string) => {
    setFormData((prev) => {
      const newVibes = prev.vibes.includes(vibe)
        ? prev.vibes.filter((v) => v !== vibe)
        : prev.vibes.length < 5
        ? [...prev.vibes, vibe]
        : prev.vibes;
      return { ...prev, vibes: newVibes };
    });
  };

  const handlePhotoUpload = () => {
    const placeholders = [
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
      "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400",
    ];
    if (formData.photos.length < 3) {
      setFormData((prev) => ({
        ...prev,
        photos: [...prev.photos, placeholders[prev.photos.length]],
      }));
      toast.success("Photo added!");
    }
  };

  const removePhoto = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      photos: prev.photos.filter((_, i) => i !== index),
    }));
  };

  const handleRecordVibe = () => {
    // Store form data in sessionStorage to preserve state
    sessionStorage.setItem("onboardingData", JSON.stringify({ ...formData, returnStep: step }));
    navigate("/vibe-studio");
  };

  const canProceed = () => {
    switch (step) {
      case 0:
        return true;
      case 1:
        return formData.name && formData.age && formData.gender;
      case 2:
        return formData.vibes.length >= 3;
      case 3:
        return formData.photos.length >= 1;
      case 4:
        return true; // Vibe video is optional but encouraged
      default:
        return false;
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Ambient Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-64 h-64 bg-neon-violet/20 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-1/4 -right-32 w-64 h-64 bg-neon-pink/20 rounded-full blur-3xl animate-float" style={{ animationDelay: "1s" }} />
      </div>

      {/* Progress */}
      <div className="fixed top-0 left-0 right-0 z-50 p-4 bg-background/80 backdrop-blur-lg">
        <ProgressBar currentStep={step + 1} totalSteps={totalSteps} />
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-6 pt-16 pb-24">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait">
            {/* Step 0: Welcome */}
            {step === 0 && (
              <motion.div
                key="welcome"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="text-center space-y-8"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: "spring" }}
                  className="w-24 h-24 mx-auto bg-gradient-primary rounded-3xl flex items-center justify-center neon-glow-violet"
                >
                  <Sparkles className="w-12 h-12 text-white" />
                </motion.div>

                <div className="space-y-4">
                  <h1 className="text-4xl font-display font-bold gradient-text">
                    Welcome to Vibely
                  </h1>
                  <p className="text-muted-foreground text-lg">
                    Find your vibe. Make real connections through live video events.
                  </p>
                </div>

                <div className="glass-card p-6 space-y-3 text-left">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-neon-violet/20 flex items-center justify-center">
                      <span className="text-lg">🎯</span>
                    </div>
                    <span className="text-foreground">Match by vibe, not just looks</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-neon-pink/20 flex items-center justify-center">
                      <span className="text-lg">📹</span>
                    </div>
                    <span className="text-foreground">Live video speed dating</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-neon-cyan/20 flex items-center justify-center">
                      <span className="text-lg">✨</span>
                    </div>
                    <span className="text-foreground">Curated events for your interests</span>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Step 1: Identity */}
            {step === 1 && (
              <motion.div
                key="identity"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-display font-bold text-foreground">
                    Let's get to know you
                  </h2>
                  <p className="text-muted-foreground">
                    The basics first, then the fun stuff
                  </p>
                </div>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      What's your name?
                    </label>
                    <Input
                      placeholder="Your first name"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      className="h-14 rounded-2xl glass-card border-white/10 text-foreground placeholder:text-muted-foreground"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      How old are you?
                    </label>
                    <Input
                      type="number"
                      placeholder="Age"
                      min={18}
                      max={99}
                      value={formData.age}
                      onChange={(e) =>
                        setFormData({ ...formData, age: e.target.value })
                      }
                      className="h-14 rounded-2xl glass-card border-white/10 text-foreground placeholder:text-muted-foreground"
                    />
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-medium text-foreground">
                      I identify as
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {genderOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() =>
                            setFormData({ ...formData, gender: option.value })
                          }
                          className={`p-4 rounded-2xl text-sm font-medium transition-all duration-300 ${
                            formData.gender === option.value
                              ? "bg-primary/20 border-2 border-primary neon-glow-violet text-foreground"
                              : "glass-card border-2 border-transparent text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Step 2: Vibe Check */}
            {step === 2 && (
              <motion.div
                key="vibes"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-display font-bold text-foreground">
                    What's your vibe? ✨
                  </h2>
                  <p className="text-muted-foreground">
                    Pick 3-5 that describe you best
                  </p>
                  <p className="text-sm text-neon-pink">
                    {formData.vibes.length}/5 selected
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {vibeOptions.map((vibe) => (
                    <VibeTag
                      key={vibe.label}
                      label={vibe.label}
                      emoji={vibe.emoji}
                      selected={formData.vibes.includes(vibe.label)}
                      onClick={() => handleVibeSelect(vibe.label)}
                    />
                  ))}
                </div>
              </motion.div>
            )}

            {/* Step 3: Photos */}
            {step === 3 && (
              <motion.div
                key="photos"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-display font-bold text-foreground">
                    Show your best self
                  </h2>
                  <p className="text-muted-foreground">
                    Add at least 1 photo to continue
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {[0, 1, 2].map((index) => (
                    <div
                      key={index}
                      className="aspect-[3/4] rounded-2xl overflow-hidden relative"
                    >
                      {formData.photos[index] ? (
                        <>
                          <img
                            src={formData.photos[index]}
                            alt={`Photo ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <button
                            onClick={() => removePhoto(index)}
                            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-destructive flex items-center justify-center"
                          >
                            <X className="w-4 h-4 text-white" />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={handlePhotoUpload}
                          className="w-full h-full glass-card border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-2 hover:border-primary/50 transition-colors"
                        >
                          <Upload className="w-6 h-6 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            Add
                          </span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <p className="text-xs text-center text-muted-foreground">
                  Tip: Photos with your face visible get 3x more matches
                </p>
              </motion.div>
            )}

            {/* Step 4: Record Your First Vibe */}
            {step === 4 && (
              <motion.div
                key="vibe-video"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-display font-bold text-foreground">
                    Record Your First Vibe
                  </h2>
                  <p className="text-muted-foreground">
                    A 15-second video intro gets you 5x more matches
                  </p>
                </div>

                {/* Video Preview Card */}
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="relative aspect-[9/16] max-h-[50vh] mx-auto rounded-3xl overflow-hidden"
                >
                  {formData.hasVibeVideo ? (
                    <div className="w-full h-full bg-secondary flex items-center justify-center">
                      <div className="text-center space-y-2">
                        <div className="w-16 h-16 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
                          <Play className="w-8 h-8 text-green-500" />
                        </div>
                        <p className="text-green-400 font-medium">Vibe Recorded!</p>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={handleRecordVibe}
                      className="w-full h-full glass-card border-2 border-dashed border-primary/50 flex flex-col items-center justify-center gap-4 hover:border-primary hover:bg-primary/5 transition-all group"
                    >
                      <motion.div
                        animate={{
                          scale: [1, 1.1, 1],
                          boxShadow: [
                            "0 0 0 0 hsl(var(--neon-violet) / 0.4)",
                            "0 0 0 20px hsl(var(--neon-violet) / 0)",
                          ],
                        }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="w-20 h-20 rounded-full bg-gradient-primary flex items-center justify-center"
                      >
                        <Video className="w-10 h-10 text-white" />
                      </motion.div>
                      <div className="space-y-1 text-center">
                        <p className="text-lg font-display font-bold gradient-text">
                          Tap to Record
                        </p>
                        <p className="text-sm text-muted-foreground">
                          15 seconds to show your vibe
                        </p>
                      </div>
                    </button>
                  )}
                </motion.div>

                {/* Benefits List */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <div className="w-6 h-6 rounded-full bg-neon-cyan/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs">✓</span>
                    </div>
                    <span>Others see your personality before matching</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <div className="w-6 h-6 rounded-full bg-neon-pink/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs">✓</span>
                    </div>
                    <span>Stand out in the guest list</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <div className="w-6 h-6 rounded-full bg-neon-violet/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs">✓</span>
                    </div>
                    <span>Better conversation starters</span>
                  </div>
                </div>

                {!formData.hasVibeVideo && (
                  <p className="text-xs text-center text-muted-foreground">
                    You can skip for now and record later from your profile
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Continue Button */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-background via-background to-transparent">
        <div className="flex flex-col gap-3 max-w-md mx-auto">
          {step === 4 && !formData.hasVibeVideo && (
            <Button
              onClick={handleRecordVibe}
              variant="gradient"
              size="xl"
              className="w-full"
            >
              <Video className="w-5 h-5 mr-2" />
              Record Your Vibe
            </Button>
          )}
          <Button
            onClick={nextStep}
            disabled={!canProceed()}
            variant={step === 4 && !formData.hasVibeVideo ? "outline" : "gradient"}
            size="xl"
            className="w-full"
          >
            {step === totalSteps - 1 
              ? formData.hasVibeVideo 
                ? "Start Vibing" 
                : "Skip for Now"
              : "Continue"}
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
