import { useCallback, useEffect, useRef, useState } from "react";
import { useBeforeUnload, useBlocker, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { useAuth, useUserProfile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { pickOnboardingNamePrefill } from "@/lib/onboardingNameHydration";
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
  hasConfirmedOnboardingLocation,
  writeLocalDraftCache,
  readLocalDraftCache,
} from "@shared/onboardingTypes";
import {
  type SupabaseClient,
  loadOnboardingDraft,
  saveOnboardingDraft,
  executeOnboardingCompletion,
} from "@shared/onboardingCompletion";
import { getAuthProvider } from "@shared/entryState";

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

const LOCATION_STEP_INDEX = 9;
const PHOTOS_STEP_INDEX = 7;
const PHOTO_STEP_BUSY_MESSAGE =
  "Finish photo uploads first. Retry or remove failed photos before leaving this step so your staged changes are not lost.";

const Onboarding = () => {
  const navigate = useNavigate();
  const { refreshProfile } = useUserProfile();
  const { refreshEntryState } = useAuth();

  const [session, setSession] = useState<Session | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<OnboardingData>({ ...DEFAULT_ONBOARDING_DATA });
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [hasUsableStoredName, setHasUsableStoredName] = useState(false);
  const [photoStepBusy, setPhotoStepBusy] = useState(false);

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
  const onboardingSupabase = supabase as unknown as SupabaseClient;
  const authProvider = getAuthProvider(session?.user);
  const totalSteps = needsEmailCollection ? TOTAL_STEPS_WITH_EMAIL : TOTAL_STEPS_NO_EMAIL;
  const stepNames = needsEmailCollection
    ? ONBOARDING_STEP_NAMES
    : ONBOARDING_STEP_NAMES.filter((n) => n !== "email_collection");
  const nameHelperText =
    draftLoaded && authProvider === "apple" && !hasUsableStoredName
      ? "Apple doesn't share your name in the web sign-in flow. Enter your first name to continue."
      : null;

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
    const authUserMetadata = session.user.user_metadata;
    let authoritativeDraftName: string | null = null;

    setHasUsableStoredName(false);

    ONBOARDING_LEGACY_STORAGE_KEYS.forEach((k) => {
      try { localStorage.removeItem(k); } catch { /* noop */ }
    });

    const applyDraft = (step: number, d: OnboardingData) => {
      const nextStep =
        step > LOCATION_STEP_INDEX && !hasConfirmedOnboardingLocation(d)
          ? LOCATION_STEP_INDEX
          : step;
      setCurrentStep(nextStep);
      setData(d);
    };

    // Show local cache immediately for perceived speed
    const localRaw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    const localDraft = readLocalDraftCache(localRaw, userId);
    if (localDraft) {
      authoritativeDraftName = localDraft.data.name;
      applyDraft(localDraft.step, localDraft.data);
    }

    // Server draft then profile hydration — sequential so an empty draft cannot race
    // ahead and wipe values already merged from `profiles`.
    void (async () => {
      const result = await loadOnboardingDraft(onboardingSupabase, userId);
      if (result.draft) {
        const sd = result.draft;
        const serverData: OnboardingData = {
          ...DEFAULT_ONBOARDING_DATA,
          ...(typeof sd.onboarding_data === "object" && sd.onboarding_data
            ? sd.onboarding_data
            : {}),
        };
        authoritativeDraftName = serverData.name;
        applyDraft(sd.current_step, serverData);
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("name, photos")
        .eq("id", userId)
        .maybeSingle();
      const existingProfileName = typeof profile?.name === "string" ? profile.name : null;
      const existingPhotos = (profile?.photos as string[] | null) ?? [];
      const storedNamePrefill = pickOnboardingNamePrefill({
        currentName: authoritativeDraftName,
        profileName: existingProfileName,
        userMetadata: authUserMetadata,
      });
      setHasUsableStoredName(!!storedNamePrefill);
      setData((prev) => {
        const nextName = pickOnboardingNamePrefill({
          currentName: prev.name,
          profileName: existingProfileName,
          userMetadata: authUserMetadata,
        });
        const shouldHydrateName = typeof nextName === "string" && nextName !== prev.name;
        const shouldHydratePhotos = existingPhotos.length > 0 && prev.photos.length === 0;

        if (!shouldHydrateName && !shouldHydratePhotos) {
          return prev;
        }

        return {
          ...prev,
          name: shouldHydrateName ? nextName : prev.name,
          photos: shouldHydratePhotos ? existingPhotos : prev.photos,
        };
      });
      setDraftLoaded(true);
    })();
  }, [session?.user?.id, session?.user?.user_metadata, draftLoaded, onboardingSupabase]);

  // Write local cache on every change (non-authoritative, for fast resume on same device)
  useEffect(() => {
    if (!session?.user?.id || completed) return;
    writeLocalDraftCache(localStorage, session.user.id, currentStep, data);
  }, [session?.user?.id, currentStep, data, completed]);

  // Save to server on data/step changes (debounced 500ms, always reschedules)
  useEffect(() => {
    if (!session?.user?.id || !draftLoaded || completed) return;

    const timer = setTimeout(() => {
      saveOnboardingDraft(onboardingSupabase, session.user.id, currentStep, data, "web")
        .catch(() => {
          console.warn("[onboarding] server draft save failed (non-fatal)");
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [session?.user?.id, currentStep, data, draftLoaded, completed, onboardingSupabase]);

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
    const startedAt = startedAtRef.current;
    return () => {
      if (!completedRef.current) {
        trackEvent("onboarding_abandoned", {
          platform: "web",
          last_step: currentStepRef.current,
          last_step_name: stepNames[currentStepRef.current] ?? stepNames[0],
          total_time_seconds: Math.round((Date.now() - startedAt) / 1000),
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

  const updateLocation = useCallback((
    payload: Pick<OnboardingData, "location" | "locationData" | "country">
  ) => {
    setData((prev) => ({ ...prev, ...payload }));
  }, []);

  const isBlockingPhotoStepExit = currentStep === PHOTOS_STEP_INDEX && photoStepBusy;

  const showPhotoStepBusyMessage = useCallback(() => {
    toast.error(PHOTO_STEP_BUSY_MESSAGE, {
      id: "onboarding-photo-step-busy",
    });
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
    if (isBlockingPhotoStepExit) {
      showPhotoStepBusyMessage();
      return;
    }

    if (currentStep > 0 && !submitting) {
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep, isBlockingPhotoStepExit, showPhotoStepBusyMessage, submitting]);

  const blocker = useBlocker(isBlockingPhotoStepExit);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    showPhotoStepBusyMessage();
    blocker.reset();
  }, [blocker, showPhotoStepBusyMessage]);

  useBeforeUnload(
    useCallback((event) => {
      if (!isBlockingPhotoStepExit) return;
      event.preventDefault();
      event.returnValue = "";
    }, [isBlockingPhotoStepExit]),
  );

  const handleAgeBlocked = useCallback(async () => {
    toast.error("Vibely is for adults 18 and over.");
    await supabase.auth.signOut();
    navigate("/auth");
  }, [navigate]);

  const completeOnboarding = useCallback(async () => {
    if (!session?.user?.id || submitOnceRef.current) return;
    if (!hasConfirmedOnboardingLocation(data)) {
      toast.error("Confirm your city before finishing onboarding.");
      setCurrentStep(LOCATION_STEP_INDEX);
      return;
    }
    submitOnceRef.current = true;
    setSubmitting(true);
    setCompletionError(null);

    try {
      const result = await executeOnboardingCompletion({
        supabase: onboardingSupabase,
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
    } catch (e: unknown) {
      submitOnceRef.current = false;
      setCompletionError(
        e instanceof Error ? e.message : "Couldn't save your profile. Check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }, [session, data, onboardingSupabase, refreshEntryState, refreshProfile]);

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
              helperText={nameHelperText}
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
              onBusyStateChange={setPhotoStepBusy}
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
              locationData={data.locationData}
              country={data.country}
              onLocationChange={updateLocation}
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
