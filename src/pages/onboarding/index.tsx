import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, useUserProfile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { toast } from "sonner";
import {
  ONBOARDING_STEP_NAMES,
  TOTAL_STEPS_NO_EMAIL,
  TOTAL_STEPS_WITH_EMAIL,
} from "@/pages/onboarding.constants";
import {
  type OnboardingData,
  DEFAULT_ONBOARDING_DATA,
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_LEGACY_STORAGE_KEYS,
  writeLocalDraftCache,
  readLocalDraftCache,
} from "@shared/onboardingTypes";
import {
  loadOnboardingDraft,
  saveOnboardingDraft,
  executeOnboardingCompletion,
} from "@shared/onboardingCompletion";

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

const Onboarding = () => {
  const navigate = useNavigate();
  const { refreshProfile } = useUserProfile();
  const { refreshEntryState } = useAuth();

  const [session, setSession] = useState<any>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<OnboardingData>({ ...DEFAULT_ONBOARDING_DATA });
  const [draftLoaded, setDraftLoaded] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [vibeScore, setVibeScore] = useState(0);
  const [vibeScoreLabel, setVibeScoreLabel] = useState("New");

  const submitOnceRef = useRef(false);
  const startedAtRef = useRef(Date.now());
  const currentStepRef = useRef(currentStep);
  const completedRef = useRef(completed);

  const needsEmailCollection = !session?.user?.email;
  const totalSteps = needsEmailCollection ? TOTAL_STEPS_WITH_EMAIL : TOTAL_STEPS_NO_EMAIL;
  const stepNames = needsEmailCollection
    ? ONBOARDING_STEP_NAMES
    : ONBOARDING_STEP_NAMES.filter((n) => n !== "email_collection");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load draft: server is source of truth, local cache is fast fallback
  useEffect(() => {
    if (!session?.user?.id || draftLoaded) return;
    const userId = session.user.id;

    ONBOARDING_LEGACY_STORAGE_KEYS.forEach((k) => {
      try { localStorage.removeItem(k); } catch { /* noop */ }
    });

    const applyDraft = (step: number, d: OnboardingData) => {
      setCurrentStep(step);
      setData(d);
    };

    // Show local cache immediately for perceived speed
    const localRaw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    const localDraft = readLocalDraftCache(localRaw, userId);
    if (localDraft) {
      applyDraft(localDraft.step, localDraft.data);
    }

    // Then load authoritative server draft
    loadOnboardingDraft(supabase as any, userId).then((result) => {
      if (result.draft) {
        const sd = result.draft;
        const serverData: OnboardingData = {
          ...DEFAULT_ONBOARDING_DATA,
          ...(typeof sd.onboarding_data === "object" && sd.onboarding_data
            ? sd.onboarding_data
            : {}),
        };
        applyDraft(sd.current_step, serverData);
      }
      setDraftLoaded(true);
    });

    // Load existing photos from partial profile
    const loadExistingPhotos = async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("photos")
        .eq("id", userId)
        .maybeSingle();
      const existing = (profile?.photos as string[] | null) ?? [];
      if (existing.length > 0) {
        setData((prev) => (prev.photos.length > 0 ? prev : { ...prev, photos: existing }));
      }
    };
    loadExistingPhotos();
  }, [session?.user?.id, draftLoaded]);

  // Write local cache on every change (non-authoritative, for fast resume on same device)
  useEffect(() => {
    if (!session?.user?.id || completed) return;
    writeLocalDraftCache(localStorage, session.user.id, currentStep, data);
  }, [session?.user?.id, currentStep, data, completed]);

  // Save to server on data/step changes (debounced 500ms, always reschedules)
  useEffect(() => {
    if (!session?.user?.id || !draftLoaded || completed) return;

    const timer = setTimeout(() => {
      saveOnboardingDraft(supabase as any, session.user.id, currentStep, data, "web")
        .catch(() => {
          console.warn("[onboarding] server draft save failed (non-fatal)");
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [session?.user?.id, currentStep, data, draftLoaded, completed]);

  useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);
  useEffect(() => { completedRef.current = completed; }, [completed]);

  useEffect(() => {
    const name = stepNames[currentStep] ?? stepNames[0];
    trackEvent("onboarding_step_viewed", {
      step: currentStep,
      step_name: name,
      platform: "web",
    });
  }, [currentStep, stepNames]);

  useEffect(() => {
    return () => {
      if (!completedRef.current) {
        trackEvent("onboarding_abandoned", {
          platform: "web",
          last_step: currentStepRef.current,
          last_step_name: stepNames[currentStepRef.current] ?? stepNames[0],
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

  const goNext = useCallback(() => {
    if (currentStep >= totalSteps - 1) return;
    const next = currentStep + 1;
    setCurrentStep(next);
    trackEvent("onboarding_step_completed", {
      step: currentStep,
      step_name: stepNames[currentStep],
      platform: "web",
    });
  }, [currentStep, totalSteps, stepNames]);

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

  const completeOnboarding = useCallback(async () => {
    if (!session?.user?.id || submitOnceRef.current) return;
    submitOnceRef.current = true;
    setSubmitting(true);
    setCompletionError(null);

    try {
      const result = await executeOnboardingCompletion({
        supabase: supabase as any,
        userId: session.user.id,
        data,
        clearLocalDraft: async () => {
          localStorage.removeItem(ONBOARDING_STORAGE_KEY);
        },
        trackEvent,
        platform: "web",
        authMethod: session.user.phone
          ? "phone"
          : session.user.app_metadata?.provider ?? "email",
        startedAt: startedAtRef.current,
      });

      if (!result.success) {
        submitOnceRef.current = false;
        setCompletionError(result.errors.join(", ") || "Profile validation failed.");
        return;
      }

      setVibeScore(result.vibeScore);
      setVibeScoreLabel(result.vibeScoreLabel);
      setCompleted(true);
      await Promise.all([
        refreshProfile(),
        refreshEntryState(),
      ]);
    } catch (e: any) {
      submitOnceRef.current = false;
      setCompletionError(
        e?.message || "Couldn't save your profile. Check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }, [session, data, refreshEntryState, refreshProfile]);

  useEffect(() => {
    if (currentStep === totalSteps - 1) {
      void completeOnboarding();
    }
  }, [currentStep, completeOnboarding, totalSteps]);

  const renderContent = () => {
    const logicalStep = currentStep;

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

    if (needsEmailCollection) {
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
          onGoNow={() => navigate("/home")}
          onExploreEvents={() => navigate("/events")}
        />
      );
    }

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
        onGoNow={() => navigate("/home")}
        onExploreEvents={() => navigate("/events")}
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
