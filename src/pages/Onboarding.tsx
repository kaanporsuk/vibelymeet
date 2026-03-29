import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowRight, 
  Sparkles, 
  Upload, 
  X, 
  Video, 
  Play, 
  MapPin, 
  Loader2,
  ChevronLeft,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProgressBar } from "@/components/ProgressBar";
import { VibeTagSelector } from "@/components/VibeTagSelector";
import { HeightSelector } from "@/components/HeightSelector";
import { LifestyleDetails } from "@/components/LifestyleDetails";
import { RelationshipIntent } from "@/components/RelationshipIntent";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { 
  createProfile, 
  autoDetectLocation, 
  type GeoLocation,
  type ProfileData 
} from "@/services/profileService";
import { persistPhotos } from "@/services/storageService";
import { trackEvent } from "@/lib/analytics";

const genderOptions = [
  { label: "Woman", value: "woman" },
  { label: "Man", value: "man" },
  { label: "Non-binary", value: "non-binary" },
  { label: "Other", value: "other" },
];

const interestedInOptions = [
  { label: "Women", value: "women" },
  { label: "Men", value: "men" },
  { label: "Everyone", value: "everyone" },
];

interface OnboardingFormData {
  name: string;
  birthDate: string;
  gender: string;
  interestedIn: string;
  location: string;
  locationData: { lat: number; lng: number } | null;
  heightCm: number;
  job: string;
  aboutMe: string;
  vibes: string[];
  lookingFor: string;
  lifestyle: Record<string, string>;
  photos: string[];
  photoFiles: (File | null)[];
  hasVibeVideo: boolean;
}

const STORAGE_KEY = "vibely_onboarding_progress";

const Onboarding = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  
  // Clear any stored onboarding data for new users
  useEffect(() => {
    const clearDataForNewUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      // Check if this user has stored data from a different user ID
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // If there's a stored userId and it doesn't match current user, clear it
          if (parsed.userId && parsed.userId !== user.id) {
            localStorage.removeItem(STORAGE_KEY);
            console.log('[Onboarding] Cleared stale data from different user');
          }
        } catch {
          // Invalid saved data, clear it
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    };
    
    clearDataForNewUser();
  }, []);
  
  const [formData, setFormData] = useState<OnboardingFormData>(() => {
    return {
      name: "",
      birthDate: "",
      gender: "",
      interestedIn: "",
      location: "",
      locationData: null,
      heightCm: 170,
      job: "",
      aboutMe: "",
      vibes: [],
      lookingFor: "",
      lifestyle: {},
      photos: [],
      photoFiles: [],
      hasVibeVideo: false,
    };
  });

  const totalSteps = 8;

  // Save progress to localStorage with user ID
  useEffect(() => {
    const saveWithUserId = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const dataToSave = { ...formData, photoFiles: [], userId: user.id };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    };
    
    saveWithUserId();
  }, [formData]);


  // Calculate age from birth date
  const calculateAge = (birthDateStr: string): number => {
    const birthDate = new Date(birthDateStr);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const [ageBlocked, setAgeBlocked] = useState(false);

  const nextStep = () => {
    // After identity step, check age gate
    if (step === 1 && formData.birthDate) {
      const age = calculateAge(formData.birthDate);
      if (age < 18) {
        setAgeBlocked(true);
        // Log the block attempt
        logAgeGateBlock(formData.birthDate);
        return;
      }
    }
    if (step < totalSteps - 1) {
      setStep(step + 1);
    } else {
      handleComplete();
    }
  };

  const logAgeGateBlock = async (birthDate: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // The age_gate_blocks table is service-role only, 
      // so we log via an edge function or just note it client-side
      console.log(`[AgeGate] User ${user.id} blocked: DOB ${birthDate}`);
    } catch (err) {
      console.error("[AgeGate] Failed to log block:", err);
    }
  };

  const handleAgeBlockExit = async () => {
    await supabase.auth.signOut();
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = "/";
  };

  const prevStep = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Please log in to complete your profile");
        navigate("/auth");
        return;
      }

      // Upload photos to Supabase storage
      let uploadedPhotos = formData.photos;
      if (formData.photoFiles.length > 0) {
        try {
          uploadedPhotos = await persistPhotos(
            formData.photos,
            formData.photoFiles,
            user.id
          );
        } catch (uploadError) {
          console.error("Photo upload error:", uploadError);
          toast.error("Some photos failed to upload, but we'll continue...");
        }
      }

      const profileData: Partial<ProfileData> = {
        name: formData.name,
        birthDate: formData.birthDate ? new Date(formData.birthDate) : null,
        gender: formData.gender,
        interestedIn: formData.interestedIn ? [formData.interestedIn] : [],
        location: formData.location,
        locationData: formData.locationData,
        heightCm: formData.heightCm,
        job: formData.job,
        aboutMe: formData.aboutMe,
        vibes: formData.vibes,
        lookingFor: formData.lookingFor,
        lifestyle: formData.lifestyle,
        photos: uploadedPhotos,
        avatarUrl: uploadedPhotos[0] || null,
      };

      await createProfile(profileData);

      // Initialize user_credits row for new user
      await supabase.from("user_credits").upsert({
        user_id: user.id,
        extra_time_credits: 0,
        extended_vibe_credits: 0,
      }, { onConflict: 'user_id' });
      
      // Clear saved progress
      localStorage.removeItem(STORAGE_KEY);
      
      trackEvent('onboarding_completed', {
        has_photo: uploadedPhotos.length > 0,
        has_bio: !!formData.aboutMe,
        has_vibes: formData.vibes.length > 0,
        vibe_count: formData.vibes.length,
      });
      
      toast.success("Welcome to Vibely! 🎉");
      navigate("/dashboard");
    } catch (error) {
      console.error("Profile creation error:", error);
      toast.error("Failed to create profile. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLocationDetect = async () => {
    setIsDetectingLocation(true);
    try {
      const location: GeoLocation = await autoDetectLocation();
      setFormData(prev => ({
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

  const handlePhotoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (formData.photos.length < 6) {
      const url = URL.createObjectURL(file);
      setFormData(prev => ({
        ...prev,
        photos: [...prev.photos, url],
        photoFiles: [...prev.photoFiles, file],
      }));
      toast.success("Photo added!");
    }
  };

  const removePhoto = (index: number) => {
    setFormData(prev => ({
      ...prev,
      photos: prev.photos.filter((_, i) => i !== index),
      photoFiles: prev.photoFiles.filter((_, i) => i !== index),
    }));
  };

  const handleRecordVibe = () => {
    sessionStorage.setItem("onboardingData", JSON.stringify({ ...formData, returnStep: step }));
    navigate("/vibe-studio");
  };

  const canProceed = (): boolean => {
    switch (step) {
      case 0: // Welcome
        return true;
      case 1: // Identity
        if (!formData.name || !formData.birthDate || !formData.gender || !formData.interestedIn) {
          return false;
        }
        // Validate age >= 18
        const age = calculateAge(formData.birthDate);
        return age >= 18;
      case 2: // Location
        return !!formData.location;
      case 3: // Details (height, job)
        return formData.heightCm >= 140 && formData.heightCm <= 220;
      case 4: // About Me
        return formData.aboutMe.length >= 10 && formData.aboutMe.length <= 140;
      case 5: // Vibes & Lifestyle
        return formData.vibes.length >= 3;
      case 6: // Looking For
        return !!formData.lookingFor;
      case 7: // Photos & Video
        return formData.photos.length >= 2;
      default:
        return false;
    }
  };

  const getButtonText = (): string => {
    if (step === 0) return "Let's Go";
    if (step === totalSteps - 1) return isSubmitting ? "Creating Profile..." : "Complete Profile";
    return "Continue";
  };

  // Date validation helper
  const getMaxDate = (): string => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 18);
    return date.toISOString().split("T")[0];
  };

  const getMinDate = (): string => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 100);
    return date.toISOString().split("T")[0];
  };

  // Age blocked full-screen gate
  if (ageBlocked) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 -left-32 w-64 h-64 bg-destructive/10 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 -right-32 w-64 h-64 bg-destructive/10 rounded-full blur-3xl" />
        </div>
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring" }}
          className="w-24 h-24 mx-auto bg-destructive/20 rounded-3xl flex items-center justify-center mb-8"
        >
          <Shield className="w-12 h-12 text-destructive" />
        </motion.div>
        <h1 className="text-3xl font-display font-bold text-foreground mb-4">
          You must be 18 or older
        </h1>
        <p className="text-muted-foreground text-lg mb-8 max-w-sm">
          Vibely is an 18+ platform. You are not eligible to create an account.
        </p>
        <Button
          variant="destructive"
          size="lg"
          onClick={handleAgeBlockExit}
          className="w-full max-w-xs"
        >
          Close App
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Ambient Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-64 h-64 bg-neon-violet/20 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-1/4 -right-32 w-64 h-64 bg-neon-pink/20 rounded-full blur-3xl animate-float" style={{ animationDelay: "1s" }} />
      </div>

      {/* Progress */}
      <div className="fixed top-0 left-0 right-0 z-50 p-4 bg-background/80 backdrop-blur-lg">
        <div className="flex items-center gap-4 max-w-md mx-auto">
          {step > 0 && (
            <button onClick={prevStep} className="p-2 rounded-full hover:bg-secondary transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex-1">
            <ProgressBar currentStep={step + 1} totalSteps={totalSteps} />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-6 pt-20 pb-28 overflow-y-auto">
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
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-display font-bold text-foreground">
                    Let's get to know you
                  </h2>
                  <p className="text-muted-foreground">
                    The basics first, then the fun stuff
                  </p>
                </div>

                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">First Name</label>
                    <Input
                      placeholder="Your first name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="h-14 rounded-2xl glass-card border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Date of Birth</label>
                    <Input
                      type="date"
                      value={formData.birthDate}
                      onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
                      max={getMaxDate()}
                      min={getMinDate()}
                      className="h-14 rounded-2xl glass-card border-border text-foreground"
                    />
                    {formData.birthDate && calculateAge(formData.birthDate) < 18 && (
                      <p className="text-xs text-destructive">You must be 18 or older to use Vibely</p>
                    )}
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-medium text-foreground">I identify as</label>
                    <div className="grid grid-cols-2 gap-3">
                      {genderOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setFormData({ ...formData, gender: option.value })}
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

                  <div className="space-y-3">
                    <label className="text-sm font-medium text-foreground">I'm interested in</label>
                    <div className="grid grid-cols-3 gap-3">
                      {interestedInOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setFormData({ ...formData, interestedIn: option.value })}
                          className={`p-4 rounded-2xl text-sm font-medium transition-all duration-300 ${
                            formData.interestedIn === option.value
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

            {/* Step 2: Location */}
            {step === 2 && (
              <motion.div
                key="location"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-display font-bold text-foreground">
                    Where are you based?
                  </h2>
                  <p className="text-muted-foreground">
                    Find people and events near you
                  </p>
                </div>

                <div className="space-y-4">
                  <Button
                    variant="outline"
                    onClick={handleLocationDetect}
                    disabled={isDetectingLocation}
                    className="w-full h-14 rounded-2xl glass-card border-primary/50 text-foreground"
                  >
                    {isDetectingLocation ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Detecting location...
                      </>
                    ) : (
                      <>
                        <MapPin className="w-5 h-5 mr-2 text-primary" />
                        Auto-Detect My Location
                      </>
                    )}
                  </Button>

                  <div className="flex items-center gap-4">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground">or enter manually</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">City, Country</label>
                    <Input
                      placeholder="e.g., Brooklyn, NY"
                      value={formData.location}
                      onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                      className="h-14 rounded-2xl glass-card border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>

                  {formData.locationData && (
                    <p className="text-xs text-muted-foreground text-center">
                      📍 Location saved ({formData.locationData.lat.toFixed(2)}, {formData.locationData.lng.toFixed(2)})
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            {/* Step 3: Details */}
            {step === 3 && (
              <motion.div
                key="details"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-display font-bold text-foreground">
                    A few more details
                  </h2>
                  <p className="text-muted-foreground">
                    Help others get to know you better
                  </p>
                </div>

                <div className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-foreground">Height</label>
                    <HeightSelector
                      value={formData.heightCm}
                      onChange={(cm) => setFormData({ ...formData, heightCm: cm })}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Job Title</label>
                    <Input
                      placeholder="What do you do?"
                      value={formData.job}
                      onChange={(e) => setFormData({ ...formData, job: e.target.value })}
                      className="h-14 rounded-2xl glass-card border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {/* Step 4: About Me */}
            {step === 4 && (
              <motion.div
                key="about"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-display font-bold text-foreground">
                    About Me
                  </h2>
                  <p className="text-muted-foreground">
                    Write something that makes them swipe right
                  </p>
                </div>

                <div className="space-y-2">
                  <Textarea
                    placeholder="Share something about yourself..."
                    value={formData.aboutMe}
                    onChange={(e) => setFormData({ ...formData, aboutMe: e.target.value.slice(0, 140) })}
                    className="min-h-32 rounded-2xl glass-card border-border text-foreground placeholder:text-muted-foreground resize-none"
                    maxLength={140}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Min 10 characters</span>
                    <span className={formData.aboutMe.length >= 140 ? "text-neon-pink" : ""}>
                      {formData.aboutMe.length}/140
                    </span>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Step 5: Vibes & Lifestyle */}
            {step === 5 && (
              <motion.div
                key="vibes"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-display font-bold text-foreground">
                    Your Vibes ✨
                  </h2>
                  <p className="text-muted-foreground">
                    Pick 3-5 that describe you best
                  </p>
                </div>

                <VibeTagSelector
                  selectedVibes={formData.vibes}
                  onVibesChange={(vibes) => setFormData({ ...formData, vibes })}
                  maxSelections={5}
                />

                <div className="pt-4 border-t border-border">
                  <h3 className="text-lg font-display font-semibold text-foreground mb-4">Lifestyle</h3>
                  <LifestyleDetails
                    values={formData.lifestyle}
                    onChange={(key, value) => setFormData({
                      ...formData,
                      lifestyle: { ...formData.lifestyle, [key]: value }
                    })}
                    editable
                  />
                </div>
              </motion.div>
            )}

            {/* Step 6: Looking For */}
            {step === 6 && (
              <motion.div
                key="looking-for"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-display font-bold text-foreground">
                    What are you looking for?
                  </h2>
                  <p className="text-muted-foreground">
                    Be upfront. It saves everyone time.
                  </p>
                </div>

                <RelationshipIntent
                  selected={formData.lookingFor}
                  onSelect={(intent) => setFormData({ ...formData, lookingFor: intent })}
                  editable
                />
              </motion.div>
            )}

            {/* Step 7: Photos & Vibe Video */}
            {step === 7 && (
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
                    Add at least 2 photos to continue
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {[0, 1, 2, 3, 4, 5].map((index) => (
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
                          {index === 0 && (
                            <div className="absolute bottom-2 left-2 px-2 py-1 rounded-full bg-primary text-primary-foreground text-xs font-medium">
                              Main
                            </div>
                          )}
                        </>
                      ) : (
                        <label className="w-full h-full glass-card border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-2 hover:border-primary/50 transition-colors cursor-pointer">
                          <Upload className="w-6 h-6 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Add</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handlePhotoUpload}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>
                  ))}
                </div>

                <p className="text-xs text-center text-muted-foreground">
                  Tip: Photos with your face visible get 3x more matches
                </p>

                {/* Vibe Video Section */}
                <div className="pt-4 border-t border-border space-y-4">
                  <div className="text-center">
                    <h3 className="text-lg font-display font-semibold text-foreground">
                      Record Your Vibe (Optional)
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      A 15-second video intro gets you 5x more matches
                    </p>
                  </div>

                  {formData.hasVibeVideo ? (
                    <div className="glass-card p-4 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                          <Play className="w-6 h-6 text-green-500" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">Vibe Recorded!</p>
                          <p className="text-xs text-muted-foreground">Looking great</p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" onClick={handleRecordVibe}>
                        Re-record
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        className="flex-1 h-12 rounded-2xl"
                        onClick={handleRecordVibe}
                      >
                        <Video className="w-5 h-5 mr-2 text-primary" />
                        Record Vibe
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-12 rounded-2xl text-muted-foreground"
                        onClick={() => setFormData({ ...formData, hasVibeVideo: false })}
                      >
                        Skip for now
                      </Button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur-lg border-t border-border">
        <div className="max-w-md mx-auto">
          <Button
            variant="gradient"
            size="lg"
            className="w-full h-14 rounded-2xl text-lg font-display"
            onClick={nextStep}
            disabled={!canProceed() || isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            ) : null}
            {getButtonText()}
            {!isSubmitting && step < totalSteps - 1 && <ArrowRight className="w-5 h-5 ml-2" />}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
