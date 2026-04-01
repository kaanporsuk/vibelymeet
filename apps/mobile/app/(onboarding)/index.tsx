import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { trackEvent } from '@/lib/analytics';
import { useAuth } from '@/context/AuthContext';
import { useNativeLogout } from '@/hooks/useNativeLogout';
import OnboardingLayout from '@/components/onboarding/OnboardingLayout';
import {
  type OnboardingData,
  DEFAULT_ONBOARDING_DATA,
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_LEGACY_STORAGE_KEYS,
  writeLocalDraftCache,
  readLocalDraftCache,
} from '@shared/onboardingTypes';
import {
  loadOnboardingDraft,
  saveOnboardingDraft,
  executeOnboardingCompletion,
} from '@shared/onboardingCompletion';
import ValuePropStep from '@/components/onboarding/steps/ValuePropStep';
import NameStep from '@/components/onboarding/steps/NameStep';
import BirthdayStep from '@/components/onboarding/steps/BirthdayStep';
import GenderStep from '@/components/onboarding/steps/GenderStep';
import InterestedInStep from '@/components/onboarding/steps/InterestedInStep';
import IntentStep from '@/components/onboarding/steps/IntentStep';
import BasicsStep from '@/components/onboarding/steps/BasicsStep';
import PhotosStep from '@/components/onboarding/steps/PhotosStep';
import AboutMeStep from '@/components/onboarding/steps/AboutMeStep';
import LocationStep from '@/components/onboarding/steps/LocationStep';
import NotificationStep from '@/components/onboarding/steps/NotificationStep';
import CommunityStep from '@/components/onboarding/steps/CommunityStep';
import EmailCollectionStep from '@/components/onboarding/steps/EmailCollectionStep';
import VibeVideoStep from '@/components/onboarding/steps/VibeVideoStep';
import CelebrationStep from '@/components/onboarding/steps/CelebrationStep';
import { useVibelyDialog } from '@/components/VibelyDialog';
import {
  ONBOARDING_STEP_NAMES,
  TOTAL_STEPS_NO_EMAIL,
  TOTAL_STEPS_WITH_EMAIL,
} from '@shared/onboardingTypes';

export default function OnboardingV2Screen() {
  const params = useLocalSearchParams<{
    onboardingVideoUid?: string | string[];
    onboardingVideoRecorded?: string | string[];
    onboardingVideoToken?: string | string[];
  }>();
  const { session, refreshOnboarding } = useAuth();
  const logout = useNativeLogout();
  const { show, dialog } = useVibelyDialog();
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<OnboardingData>({ ...DEFAULT_ONBOARDING_DATA });
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [genderVisible, setGenderVisible] = useState(true);
  const [interestedVisible, setInterestedVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [vibeScore, setVibeScore] = useState(0);
  const [vibeScoreLabel, setVibeScoreLabel] = useState('Rising');
  const submitOnceRef = useRef(false);
  const startedAtRef = useRef<number>(Date.now());
  const currentStepRef = useRef(currentStep);
  const completedRef = useRef(completed);
  const handledVideoTokenRef = useRef<string | null>(null);

  const updateField = useCallback(<K extends keyof OnboardingData>(field: K, value: OnboardingData[K]) => {
    setData((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Load draft: server is source of truth, local cache is fast fallback
  useEffect(() => {
    if (!session?.user?.id || draftLoaded) return;
    const userId = session.user.id;

    const load = async () => {
      // Clean up legacy keys
      for (const key of ONBOARDING_LEGACY_STORAGE_KEYS) {
        try { await AsyncStorage.removeItem(key); } catch { /* noop */ }
      }

      const applyDraft = (step: number, d: OnboardingData) => {
        setCurrentStep(step);
        setData(d);
      };

      // Show local cache immediately for perceived speed
      try {
        const localRaw = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
        const localDraft = readLocalDraftCache(localRaw, userId);
        if (localDraft) {
          applyDraft(localDraft.step, localDraft.data);
        }
      } catch { /* noop */ }

      // Then load authoritative server draft
      const result = await loadOnboardingDraft(supabase as any, userId);
      if (result.draft) {
        const sd = result.draft;
        const serverData: OnboardingData = {
          ...DEFAULT_ONBOARDING_DATA,
          ...(typeof sd.onboarding_data === 'object' && sd.onboarding_data
            ? sd.onboarding_data
            : {}),
        };
        applyDraft(sd.current_step, serverData);
      }
      setDraftLoaded(true);
    };
    void load();
  }, [session?.user?.id, draftLoaded]);

  // Load existing photos from partial profile
  useEffect(() => {
    if (!session?.user?.id) return;
    const loadExistingPhotos = async () => {
      if (data.photos.length > 0) return;
      const { data: profile } = await supabase.from('profiles').select('photos').eq('id', session.user.id).maybeSingle();
      const existingPhotos = (profile?.photos as string[] | null) ?? [];
      if (existingPhotos.length > 0) {
        updateField('photos', existingPhotos);
      }
    };
    void loadExistingPhotos();
  }, [session?.user?.id, data.photos.length, updateField]);

  // Write local cache on every change (non-authoritative)
  useEffect(() => {
    if (!session?.user?.id || completed) return;
    writeLocalDraftCache(AsyncStorage, session.user.id, currentStep, data);
  }, [session?.user?.id, currentStep, data, completed]);

  // Save to server on data/step changes (debounced 500ms, always reschedules)
  useEffect(() => {
    if (!session?.user?.id || !draftLoaded || completed) return;

    const timer = setTimeout(() => {
      saveOnboardingDraft(supabase as any, session.user.id, currentStep, data, 'native')
        .catch(() => {
          console.warn('[onboarding] server draft save failed (non-fatal)');
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [session?.user?.id, currentStep, data, draftLoaded, completed]);

  const needsEmailCollection = !session?.user?.email;
  const totalSteps = needsEmailCollection ? TOTAL_STEPS_WITH_EMAIL : TOTAL_STEPS_NO_EMAIL;
  const stepNames = needsEmailCollection
    ? ONBOARDING_STEP_NAMES
    : ONBOARDING_STEP_NAMES.filter((n) => n !== 'email_collection');

  useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);
  useEffect(() => { completedRef.current = completed; }, [completed]);

  useEffect(() => {
    const stepName = stepNames[currentStep] ?? stepNames[0];
    trackEvent('onboarding_step_viewed', { step: currentStep, step_name: stepName, platform: 'native' });
  }, [currentStep, stepNames]);

  const goNext = useCallback(() => {
    if (currentStep >= totalSteps - 1) return;
    const next = currentStep + 1;
    setCurrentStep(next);
    trackEvent('onboarding_step_completed', { step: currentStep, step_name: stepNames[currentStep], platform: 'native' });
  }, [currentStep, totalSteps, stepNames]);

  useEffect(() => {
    const rawUid = Array.isArray(params.onboardingVideoUid) ? params.onboardingVideoUid[0] : params.onboardingVideoUid;
    const rawRecorded = Array.isArray(params.onboardingVideoRecorded) ? params.onboardingVideoRecorded[0] : params.onboardingVideoRecorded;
    const rawToken = Array.isArray(params.onboardingVideoToken) ? params.onboardingVideoToken[0] : params.onboardingVideoToken;

    const videoUid = typeof rawUid === 'string' ? rawUid.trim() : '';
    const videoRecorded = rawRecorded === '1';
    const token = typeof rawToken === 'string' ? rawToken : null;

    if (!videoRecorded || !videoUid || !token) return;
    if (handledVideoTokenRef.current === token) return;
    handledVideoTokenRef.current = token;

    updateField('vibeVideoRecorded', true);
    updateField('bunnyVideoUid', videoUid);

    const vibeStepIndex = needsEmailCollection ? 13 : 12;
    if (currentStep === vibeStepIndex) {
      goNext();
    }
  }, [params.onboardingVideoUid, params.onboardingVideoRecorded, params.onboardingVideoToken, updateField, needsEmailCollection, currentStep, goNext]);

  const goBack = useCallback(() => {
    if (currentStep > 0 && !submitting) {
      trackEvent('onboarding_step_skipped', { step: currentStep, step_name: stepNames[currentStep], platform: 'native' });
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep, submitting, stepNames]);

  const confirmLeaveOnboarding = useCallback(() => {
    show({
      title: 'Leave onboarding?',
      message: 'You can come back later, but you’ll need to sign in again to continue.',
      variant: 'warning',
      primaryAction: {
        label: 'Return to sign in',
        onPress: () => {
          trackEvent('onboarding_exit_to_auth', { platform: 'native' });
          void logout().catch((err) => {
            if (__DEV__) console.warn('[onboarding] exit-to-auth logout failed:', err);
          });
        },
      },
      secondaryAction: { label: 'Stay', onPress: () => {} },
    });
  }, [show, logout]);

  const handleAgeBlocked = useCallback(() => {
    void logout().catch((err) => {
      if (__DEV__) console.warn('[onboarding] age-block logout failed:', err);
    });
  }, [logout]);

  const completeOnboarding = useCallback(async () => {
    if (!session?.user?.id || submitOnceRef.current) return;
    submitOnceRef.current = true;
    setSubmitting(true);

    try {
      const result = await executeOnboardingCompletion({
        supabase: supabase as any,
        userId: session.user.id,
        data,
        clearLocalDraft: async () => {
          await AsyncStorage.removeItem(ONBOARDING_STORAGE_KEY);
        },
        trackEvent,
        platform: 'native',
        authMethod: session.user.phone ? 'phone' : (session.user.app_metadata?.provider ?? 'email'),
        startedAt: startedAtRef.current,
      });

      if (!result.success) {
        submitOnceRef.current = false;
        setCompletionError(result.errors.join(', ') || "Couldn't save your profile. Check your connection and try again.");
        return;
      }

      setVibeScore(result.vibeScore);
      setVibeScoreLabel(result.vibeScoreLabel);
      setCompleted(true);
      setCompletionError(null);
      await refreshOnboarding();
    } catch (error: any) {
      submitOnceRef.current = false;
      setCompletionError(
        String(error?.message || "Couldn't save your profile. Check your connection and try again.")
      );
    } finally {
      setSubmitting(false);
    }
  }, [session?.user?.id, session?.user?.phone, session?.user?.app_metadata?.provider, data, refreshOnboarding]);

  useEffect(() => {
    if (currentStep === totalSteps - 1) {
      void completeOnboarding();
    }
  }, [currentStep, completeOnboarding, totalSteps]);

  useEffect(() => {
    return () => {
      if (!completedRef.current) {
        trackEvent('onboarding_abandoned', {
          platform: 'native',
          last_step: currentStepRef.current,
          last_step_name: stepNames[currentStepRef.current] ?? stepNames[0],
          total_time_seconds: Math.round((Date.now() - startedAtRef.current) / 1000),
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const content = useMemo(() => {
    switch (currentStep) {
      case 0:
        return <ValuePropStep onNext={goNext} />;
      case 1:
        return <NameStep value={data.name} onChange={(v) => updateField('name', v)} onNext={goNext} />;
      case 2:
        return <BirthdayStep value={data.birthDate} onChange={(v) => updateField('birthDate', v)} onNext={goNext} onAgeBlocked={handleAgeBlocked} />;
      case 3:
        return <GenderStep value={data.gender} customValue={data.genderCustom} onChange={(v) => updateField('gender', v)} onChangeCustom={(v) => updateField('genderCustom', v)} showOnProfile={genderVisible} onToggleShow={setGenderVisible} onNext={goNext} />;
      case 4:
        return <InterestedInStep value={data.interestedIn} onChange={(v) => updateField('interestedIn', v)} showOnProfile={interestedVisible} onToggleShow={setInterestedVisible} onNext={goNext} />;
      case 5:
        return <IntentStep value={data.relationshipIntent} onChange={(v) => updateField('relationshipIntent', v)} onNext={goNext} />;
      case 6:
        return <BasicsStep heightCm={data.heightCm} job={data.job} onHeightChange={(v) => updateField('heightCm', Number.isFinite(v as number) ? (v as number) : null)} onJobChange={(v) => updateField('job', v)} onNext={goNext} />;
      case 7:
        return <PhotosStep photos={data.photos} onChange={(v) => updateField('photos', v)} onNext={goNext} />;
      case 8:
        return <AboutMeStep value={data.aboutMe} onChange={(v) => updateField('aboutMe', v)} onNext={goNext} />;
      case 9:
        return <LocationStep location={data.location} onLocationChange={(loc) => { updateField('location', loc.location); updateField('locationData', loc.locationData); updateField('country', loc.country); }} onNext={goNext} />;
      case 10:
        return <NotificationStep userId={session?.user?.id ?? ''} onNext={goNext} />;
      case 11:
        return <CommunityStep onAgree={() => { updateField('communityAgreed', true); goNext(); }} />;
      case 12:
        if (needsEmailCollection) {
          return <EmailCollectionStep onNext={goNext} onSkip={() => {
            trackEvent('onboarding_step_skipped', { step: currentStep, step_name: 'email_collection', platform: 'native' });
            goNext();
          }} />;
        }
        return <VibeVideoStep onNext={goNext} />;
      case 13:
        if (needsEmailCollection) {
          return <VibeVideoStep onNext={goNext} />;
        }
        return <CelebrationStep submitting={submitting} completed={completed} errorMessage={completionError} onRetry={() => { submitOnceRef.current = false; void completeOnboarding(); }} vibeScore={vibeScore} vibeScoreLabel={vibeScoreLabel} onGoNow={() => router.replace('/(tabs)')} onExploreEvents={() => router.replace('/(tabs)/events')} />;
      case 14:
      default:
        return <CelebrationStep submitting={submitting} completed={completed} errorMessage={completionError} onRetry={() => { submitOnceRef.current = false; void completeOnboarding(); }} vibeScore={vibeScore} vibeScoreLabel={vibeScoreLabel} onGoNow={() => router.replace('/(tabs)')} onExploreEvents={() => router.replace('/(tabs)/events')} />;
    }
  }, [
    currentStep,
    data,
    goNext,
    handleAgeBlocked,
    completeOnboarding,
    needsEmailCollection,
    completionError,
    totalSteps,
    genderVisible,
    interestedVisible,
    session?.user?.id,
    submitting,
    completed,
    vibeScore,
    vibeScoreLabel,
    updateField,
  ]);

  const layoutOnBack =
    currentStep === 0
      ? confirmLeaveOnboarding
      : currentStep > 0 && currentStep < totalSteps - 1
        ? goBack
        : undefined;

  return (
    <>
      <OnboardingLayout
        currentStep={currentStep}
        totalSteps={totalSteps}
        onBack={layoutOnBack}
        showProgress={currentStep !== totalSteps - 1}
      >
        {content}
      </OnboardingLayout>
      {dialog}
    </>
  );
}
