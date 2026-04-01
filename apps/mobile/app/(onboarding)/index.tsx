import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { trackEvent } from '@/lib/analytics';
import { useAuth } from '@/context/AuthContext';
import OnboardingLayout from '@/components/onboarding/OnboardingLayout';
import { DEFAULT_ONBOARDING_DATA, OnboardingData } from '@/components/onboarding/types';
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
import {
  getOnboardingStageForStep,
  ONBOARDING_STEP_NAMES,
  TOTAL_STEPS_NO_EMAIL,
  TOTAL_STEPS_WITH_EMAIL,
} from '@/components/onboarding/constants';
import { calculateAgeFromIsoDate } from '@/components/onboarding/dateUtils';

const STORAGE_KEY = 'vibely_onboarding_v2';

export default function OnboardingV2Screen() {
  const params = useLocalSearchParams<{
    onboardingVideoUid?: string | string[];
    onboardingVideoRecorded?: string | string[];
    onboardingVideoToken?: string | string[];
  }>();
  const { session, signOut, refreshOnboarding } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<OnboardingData>(DEFAULT_ONBOARDING_DATA);
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

  useEffect(() => {
    if (!session?.user?.id) return;
    const load = async () => {
      try {
        await AsyncStorage.removeItem('vibely_onboarding_progress');
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed?.userId !== session.user.id) return;
        if (Date.now() - (parsed?.updatedAt ?? 0) > 7 * 24 * 60 * 60 * 1000) return;
        if (typeof parsed?.step === 'number') setCurrentStep(parsed.step);
        if (parsed?.data) setData({ ...DEFAULT_ONBOARDING_DATA, ...parsed.data });
      } catch {
        // ignore
      }
    };
    void load();
  }, [session?.user?.id]);

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

  useEffect(() => {
    if (!session?.user?.id) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ userId: session.user.id, step: currentStep, data, updatedAt: Date.now() }));
  }, [session?.user?.id, currentStep, data]);

  const updateStageIfNeeded = useCallback(async (step: number) => {
    const stage = getOnboardingStageForStep(step);
    if (!stage || !session?.user?.id) return;
    try {
      await supabase.rpc('update_onboarding_stage', { p_user_id: session.user.id, p_stage: stage });
    } catch {
      // non-blocking
    }
  }, [session?.user?.id]);

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
    void updateStageIfNeeded(next);
  }, [currentStep, updateStageIfNeeded, totalSteps, stepNames]);

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

  const handleAgeBlocked = useCallback(() => {
    void signOut();
    router.replace('/(auth)/sign-in');
  }, [signOut]);

  const completeOnboarding = useCallback(async () => {
    if (!session?.user?.id || submitOnceRef.current) return;
    submitOnceRef.current = true;
    setSubmitting(true);
    try {
      const userId = session.user.id;
      const age = calculateAgeFromIsoDate(data.birthDate) ?? 0;
      const normalizedIntent = data.relationshipIntent === 'open' ? 'figuring-out' : data.relationshipIntent;

      const { error: upsertError } = await supabase.from('profiles').upsert({
        id: userId,
        name: data.name.trim(),
        birth_date: data.birthDate,
        age,
        gender: data.gender === 'other' && data.genderCustom.trim() ? data.genderCustom.trim() : data.gender,
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
        community_agreed_at: data.communityAgreed ? new Date().toISOString() : null,
      });
      if (upsertError) throw upsertError;

      const { data: rpcResult, error: rpcError } = await supabase.rpc('complete_onboarding', { p_user_id: userId });
      if (rpcError) throw rpcError;
      if (!rpcResult?.success) {
        submitOnceRef.current = false;
        throw new Error(
          Array.isArray(rpcResult?.errors)
            ? rpcResult.errors.join(', ')
            : "Couldn't save your profile. Check your connection and try again."
        );
      }

      await supabase.from('user_credits').upsert({ user_id: userId, extra_time_credits: 0, extended_vibe_credits: 0 }, { onConflict: 'user_id' });

      const { data: userData } = await supabase.auth.getUser();
      if (userData.user?.email) {
        await supabase.functions.invoke('send-email', {
          body: {
            to: userData.user.email,
            template: 'welcome',
            data: { name: data.name.trim() },
          },
        });
      }

      await AsyncStorage.removeItem(STORAGE_KEY);
      trackEvent('onboarding_completed', {
        platform: 'native',
        auth_method: session?.user?.phone ? 'phone' : (session?.user?.app_metadata?.provider ?? 'email'),
        has_vibe_video: data.vibeVideoRecorded,
        photo_count: data.photos.length,
        has_about_me: !!data.aboutMe.trim(),
        has_height: !!data.heightCm,
        has_job: !!data.job.trim(),
        relationship_intent: normalizedIntent,
        total_time_seconds: Math.round((Date.now() - startedAtRef.current) / 1000),
        vibe_score: Number(rpcResult?.vibe_score ?? 0),
      });

      setVibeScore(Number(rpcResult?.vibe_score ?? 0));
      setVibeScoreLabel(String(rpcResult?.vibe_score_label ?? 'Rising'));
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
        return <LocationStep location={data.location} onLocationChange={(loc) => { updateField('location', loc.location); updateField('locationData', loc.locationData); updateField('city', loc.city); updateField('country', loc.country); }} onNext={goNext} />;
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

  return (
    <OnboardingLayout
      currentStep={currentStep}
      totalSteps={totalSteps}
      onBack={currentStep > 0 && currentStep < totalSteps - 1 ? goBack : undefined}
      showProgress={currentStep !== totalSteps - 1}
    >
      {content}
    </OnboardingLayout>
  );
}
