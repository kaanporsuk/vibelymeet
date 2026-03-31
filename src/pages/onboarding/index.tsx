import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { toast } from "sonner";
import { ONBOARDING_STEP_NAMES } from "@/pages/onboarding.constants";

import { OnboardingLayout } from "./OnboardingLayout";
import { ValuePropStep } from "./steps/ValuePropStep";
import { NameStep } from "./steps/NameStep";
import { BirthdayStep } from "./steps/BirthdayStep";
import { GenderStep } from "./steps/GenderStep";
import { InterestedInStep } from "./steps/InterestedInStep";
import { IntentStep } from "./steps/IntentStep";
import { BasicsStep } from "./steps/BasicsStep";
import { PhotosStep } from "./steps/PhotosStep";
import { AboutMeStep } from "./steps/AboutMeStep";
import { LocationStep } from "./steps/LocationStep";
import { NotificationStep } from "./steps/NotificationStep";
import { CommunityStep } from "./steps/CommunityStep";
import { EmailCollectionStep } from "./steps/EmailCollectionStep";
import { VibeVideoStep } from "./steps/VibeVideoStep";
import { CelebrationStep } from "./steps/CelebrationStep";

interface OnboardingData {
  name: string;
  birthDate: string;
  gender: string;
  genderCustom: string;
  interestedIn: string;
  relationshipIntent: string;
  heightCm: number | null;
  job: string;
  photos: string[];
  aboutMe: string;
  location: string;
  locationData: { lat: number; lng: number } | null;
  city: string;
  country: string;
  vibeVideoRecorded: boolean;
  bunnyVideoUid: string | null;
  communityAgreed: boolean;
}

const DEFAULT_DATA: OnboardingData = {
  name: "",
  birthDate: "",
  gender: "",
  genderCustom: "",
  interestedIn: "",
  relationshipIntent: "",
  heightCm: null,
  job: "",
  photos: [],
  aboutMe: "",
  location: "",
  locationData: null,
  city: "",
  country: "",
  vibeVideoRecorded: false,
  bunnyVideoUid: null,
  communityAgreed: false,
};

const STORAGE_KEY = "vibely_onboarding_v2";
const LEGACY_STORAGE_KEY = "vibely_onboarding_progress";

const STEPS_WITHOUT_EMAIL = 14;
const STEPS_WITH_EMAIL = 15;

function calculateAge(iso: string): number {
  const birth = new Date(iso);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function getStageForStep(step: number): string | null {
  if (step <= 0) return "auth_complete";
  if (step <= 4) return "identity";
  if (step <= 8) return "details";
  if (step <= 12) return "media";
  return null;
}

const Onboarding = () => {
  const navigate = useNavigate();

  const [session, setSession] = useState<any>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<OnboardingData>(DEFAULT_DATA);

  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [vibeScore, setVibeScore] = useState(0);
  const [vibeScoreLabel, setVibeScoreLabel] = useState("New");

  const submitOnceRef = useRef(false);
  const startedAtRef = useRef(Date.now());

  const needsEmailCollection = !session?.user?.email;
  const totalSteps = needsEmailCollection ? STEPS_WITH_EMAIL : STEPS_WITHOUT_EMAIL;
  const stepNames = needsEmailCollection
    ? ONBOARDING_STEP_NAMES
    : ONBOARDING_STEP_NAMES.filter((n) => n !== "email_collection");

  // Load session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load persisted data + clear legacy key
  useEffect(() => {
    if (!session?.user?.id) return;
    localStorage.removeItem(LEGACY_STORAGE_KEY);

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (
          parsed.userId === session.user.id &&
          Date.now() - parsed.updatedAt < 7 * 24 * 60 * 60 * 1000
        ) {
          setCurrentStep(parsed.step);
          setData(parsed.data);
        }
      } catch {
        // ignore corrupted data
      }
    }

    // Pre-populate photos from partial profile
    const loadExistingPhotos = async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("photos")
        .eq("id", session.user.id)
        .maybeSingle();
      const existing = (profile?.photos as string[] | null) ?? [];
      if (existing.length > 0) {
        setData((prev) => (prev.photos.length > 0 ? prev : { ...prev, photos: existing }));
      }
    };
    loadExistingPhotos();
  }, [session?.user?.id]);

  // Persist to localStorage
  useEffect(() => {
    if (!session?.user?.id || completed) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        userId: session.user.id,
        step: currentStep,
        data,
        updatedAt: Date.now(),
      })
    );
  }, [session?.user?.id, currentStep, data, completed]);

  // Track step views
  useEffect(() => {
    const name = stepNames[currentStep] ?? stepNames[0];
    trackEvent("onboarding_step_viewed", {
      step: currentStep,
      step_name: name,
      platform: "web",
    });
  }, [currentStep, stepNames]);

  // Track abandonment on unmount
  useEffect(() => {
    return () => {
      if (!completed) {
        trackEvent("onboarding_abandoned", {
          platform: "web",
          last_step: currentStep,
          last_step_name: stepNames[currentStep] ?? stepNames[0],
          total_time_seconds: Math.round((Date.now() - startedAtRef.current) / 1000),
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateField = useCallback(<K extends keyof OnboardingData>(
    key: K,
    value: OnboardingData[K]
  ) => {
    setData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updateStageIfNeeded = useCallback(
    async (step: number) => {
      const stage = getStageForStep(step);
      if (stage && session?.user?.id) {
        try {
          await supabase.rpc("update_onboarding_stage", {
            p_user_id: session.user.id,
            p_stage: stage,
          });
        } catch {
          // fire and forget
        }
      }
    },
    [session?.user?.id]
  );

  const goNext = useCallback(() => {
    if (currentStep >= totalSteps - 1) return;
    const next = currentStep + 1;
    setCurrentStep(next);
    trackEvent("onboarding_step_completed", {
      step: currentStep,
      step_name: stepNames[currentStep],
      platform: "web",
    });
    void updateStageIfNeeded(next);
  }, [currentStep, totalSteps, stepNames, updateStageIfNeeded]);

  const goBack = useCallback(() => {
    if (currentStep > 0 && !submitting) {
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep, submitting]);

  const handleAgeBlocked = useCallback(async () => {
    toast.error("Vibely is for adults 18 and over.");
    await supabase.auth.signOut();
    navigate("/auth");
  }, [navigate]);

  // --- Completion ---
  const completeOnboarding = useCallback(async () => {
    if (!session?.user?.id || submitOnceRef.current) return;
    submitOnceRef.current = true;
    setSubmitting(true);
    setCompletionError(null);

    try {
      const userId = session.user.id;
      const age = calculateAge(data.birthDate);
      const normalizedIntent =
        data.relationshipIntent === "open" ? "figuring-out" : data.relationshipIntent;
      const gender =
        data.gender === "other" && data.genderCustom.trim()
          ? data.genderCustom.trim()
          : data.gender;

      const { error: upsertError } = await supabase.from("profiles").upsert({
        id: userId,
        name: data.name.trim(),
        birth_date: data.birthDate,
        age,
        gender,
        interested_in: [data.interestedIn],
        relationship_intent: normalizedIntent,
        looking_for: normalizedIntent,
        height_cm: data.heightCm ?? null,
        job: data.job.trim() || null,
        photos: data.photos,
        avatar_url: data.photos[0] || null,
        about_me: data.aboutMe.trim() || null,
        location: data.location || null,
        location_data: data.locationData || null,
        city: data.city || null,
        country: data.country || null,
        bunny_video_uid: data.bunnyVideoUid || null,
      });
      if (upsertError) throw upsertError;

      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        "complete_onboarding",
        { p_user_id: userId }
      );
      if (rpcError) throw rpcError;

      if (!rpcResult?.success) {
        submitOnceRef.current = false;
        throw new Error(
          rpcResult?.errors?.join(", ") || "Profile validation failed."
        );
      }

      // Baseline credits
      await supabase
        .from("user_credits")
        .upsert(
          { user_id: userId, extra_time_credits: 0, extended_vibe_credits: 0 },
          { onConflict: "user_id" }
        );

      // Welcome email
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user?.email) {
        await supabase.functions.invoke("send-email", {
          body: {
            to: userData.user.email,
            template: "welcome",
            data: { name: data.name.trim() },
          },
        });
      }

      localStorage.removeItem(STORAGE_KEY);

      trackEvent("onboarding_completed", {
        platform: "web",
        auth_method: session.user.phone
          ? "phone"
          : session.user.app_metadata?.provider ?? "email",
        has_vibe_video: data.vibeVideoRecorded,
        photo_count: data.photos.length,
        has_about_me: !!data.aboutMe.trim(),
        has_height: !!data.heightCm,
        has_job: !!data.job.trim(),
        relationship_intent: normalizedIntent,
        total_time_seconds: Math.round(
          (Date.now() - startedAtRef.current) / 1000
        ),
        vibe_score: Number(rpcResult?.vibe_score ?? 0),
      });

      setVibeScore(Number(rpcResult?.vibe_score ?? 0));
      setVibeScoreLabel(String(rpcResult?.vibe_score_label ?? "New"));
      setCompleted(true);
    } catch (e: any) {
      submitOnceRef.current = false;
      setCompletionError(
        e?.message || "Couldn't save your profile. Check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }, [session, data]);

  // Trigger completion when reaching the last step
  useEffect(() => {
    if (currentStep === totalSteps - 1) {
      void completeOnboarding();
    }
  }, [currentStep, completeOnboarding, totalSteps]);

  // --- Step rendering ---
  // Build a logical step array. For phone-auth users (no email), inject email collection
  // between community (step 11) and vibe video (step 12).
  const renderContent = () => {
    // Map currentStep to the right component, accounting for conditional email step
    let logicalStep = currentStep;

    // Steps 0-11 are always the same
    if (logicalStep <= 11) {
      switch (logicalStep) {
        case 0:
          return <ValuePropStep onNext={goNext} />;
        case 1:
          return (
            <NameStep
              value={data.name}
              onChange={(v) => updateField("name", v)}
              onNext={goNext}
            />
          );
        case 2:
          return (
            <BirthdayStep
              value={data.birthDate}
              onChange={(v) => updateField("birthDate", v)}
              onNext={goNext}
              onAgeBlocked={handleAgeBlocked}
            />
          );
        case 3:
          return (
            <GenderStep
              value={data.gender}
              customValue={data.genderCustom}
              onChange={(v) => updateField("gender", v)}
              onChangeCustom={(v) => updateField("genderCustom", v)}
              onNext={goNext}
            />
          );
        case 4:
          return (
            <InterestedInStep
              value={data.interestedIn}
              onChange={(v) => updateField("interestedIn", v)}
              onNext={goNext}
            />
          );
        case 5:
          return (
            <IntentStep
              value={data.relationshipIntent}
              onChange={(v) => updateField("relationshipIntent", v)}
              onNext={goNext}
            />
          );
        case 6:
          return (
            <BasicsStep
              heightCm={data.heightCm}
              job={data.job}
              onHeightChange={(v) => updateField("heightCm", v)}
              onJobChange={(v) => updateField("job", v)}
              onNext={goNext}
            />
          );
        case 7:
          return (
            <PhotosStep
              photos={data.photos}
              onPhotosChange={(v) => updateField("photos", v)}
              onNext={goNext}
              userId={session?.user?.id ?? ""}
            />
          );
        case 8:
          return (
            <AboutMeStep
              value={data.aboutMe}
              onChange={(v) => updateField("aboutMe", v)}
              onNext={goNext}
            />
          );
        case 9:
          return (
            <LocationStep
              location={data.location}
              onLocationChange={(payload) => {
                updateField("location", payload.location);
                updateField("locationData", payload.locationData);
                updateField("city", payload.city);
                updateField("country", payload.country);
              }}
              onNext={goNext}
            />
          );
        case 10:
          return (
            <NotificationStep
              userId={session?.user?.id ?? ""}
              onNext={goNext}
            />
          );
        case 11:
          return (
            <CommunityStep
              onAgree={() => {
                updateField("communityAgreed", true);
                goNext();
              }}
            />
          );
        default:
          return null;
      }
    }

    // Steps 12+ depend on whether email collection is shown
    if (needsEmailCollection) {
      // 12 = email, 13 = vibe video, 14 = celebration
      if (logicalStep === 12) {
        return (
          <EmailCollectionStep
            onNext={goNext}
            onSkip={() => {
              trackEvent("onboarding_step_skipped", {
                step: currentStep,
                step_name: "email_collection",
                platform: "web",
              });
              goNext();
            }}
          />
        );
      }
      if (logicalStep === 13) {
        return (
          <VibeVideoStep
            onNext={goNext}
            onSkip={goNext}
            onVideoUploaded={(uid) => {
              updateField("vibeVideoRecorded", true);
              updateField("bunnyVideoUid", uid);
            }}
            userId={session?.user?.id ?? ""}
          />
        );
      }
      // 14 = celebration
      return (
        <CelebrationStep
          submitting={submitting}
          completed={completed}
          errorMessage={completionError}
          onRetry={() => {
            submitOnceRef.current = false;
            void completeOnboarding();
          }}
          vibeScore={vibeScore}
          vibeScoreLabel={vibeScoreLabel}
          onExploreEvents={() => navigate("/events")}
          onDashboard={() => navigate("/dashboard")}
        />
      );
    }

    // No email step: 12 = vibe video, 13 = celebration
    if (logicalStep === 12) {
      return (
        <VibeVideoStep
          onNext={goNext}
          onSkip={goNext}
          onVideoUploaded={(uid) => {
            updateField("vibeVideoRecorded", true);
            updateField("bunnyVideoUid", uid);
          }}
          userId={session?.user?.id ?? ""}
        />
      );
    }

    // 13 (or final) = celebration
    return (
      <CelebrationStep
        submitting={submitting}
        completed={completed}
        errorMessage={completionError}
        onRetry={() => {
          submitOnceRef.current = false;
          void completeOnboarding();
        }}
        vibeScore={vibeScore}
        vibeScoreLabel={vibeScoreLabel}
        onExploreEvents={() => navigate("/events")}
        onDashboard={() => navigate("/dashboard")}
      />
    );
  };

  const isCelebration = currentStep === totalSteps - 1;

  return (
    <OnboardingLayout
      currentStep={currentStep}
      totalSteps={totalSteps}
      onBack={currentStep > 0 && !isCelebration ? goBack : undefined}
      showProgress={!isCelebration}
    >
      {renderContent()}
    </OnboardingLayout>
  );
};

export default Onboarding;
