import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
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
import { ONBOARDING_STEP_NAMES } from '@/components/onboarding/constants';

const STORAGE_KEY = 'vibely_onboarding_v2';
const TOTAL_STEPS_WITH_EMAIL = 15;
const TOTAL_STEPS_NO_EMAIL = 14;

function calculateAge(dateIso: string): number {
  const d = new Date(dateIso);
  const t = new Date();
  let age = t.getFullYear() - d.getFullYear();
  const m = t.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age -= 1;
  return age;
}

function getStageForStep(step: number): string | null {
  if (step <= 0) return 'auth_complete';
  if (step <= 4) return 'identity';
  if (step <= 9) return 'details';
  if (step <= 12) return 'media';
  return null;
}

export default function OnboardingV2Screen() {
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
    const stage = getStageForStep(step);
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

  const goBack = useCallback(() => {
    if (currentStep > 0 && !submitting) {
      trackEvent('onboarding_step_skipped', { step: currentStep, step_name: stepNames[currentStep], platform: 'native' });
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep, submitting, stepNames]);

  // Age gate
  useEffect(() => {
    if (!data.birthDate) return;
    const age = calculateAge(data.birthDate);
    if (Number.isFinite(age) && age < 18) {
      void signOut();
      router.replace('/(auth)/sign-in');
    }
  }, [data.birthDate, signOut]);

  const completeOnboarding = useCallback(async () => {
    if (!session?.user?.id || submitOnceRef.current) return;
    submitOnceRef.current = true;
    setSubmitting(true);
    try {
      const userId = session.user.id;
      const age = calculateAge(data.birthDate);
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
      });
      if (upsertError) throw upsertError;

      const { data: rpcResult, error: rpcError } = await supabase.rpc('complete_onboarding', { p_user_id: userId });
      if (rpcError) throw rpcError;
      if (!rpcResult?.success) {
        submitOnceRef.current = false;
        setCurrentStep(0);
        return;
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
    } catch {
      submitOnceRef.current = false;
      setCompletionError("Couldn't save your profile. Check your connection and try again.");
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
      if (!completed) {
        trackEvent('onboarding_abandoned', {
          platform: 'native',
          last_step: currentStep,
          last_step_name: stepNames[currentStep] ?? stepNames[0],
          total_time_seconds: Math.round((Date.now() - startedAtRef.current) / 1000),
        });
      }
    };
  }, [completed, currentStep, stepNames]);

  const content = useMemo(() => {
    switch (currentStep) {
      case 0:
        return <ValuePropStep onNext={goNext} />;
      case 1:
        return <NameStep value={data.name} onChange={(v) => updateField('name', v)} onNext={goNext} />;
      case 2:
        return <BirthdayStep value={data.birthDate} onChange={(v) => updateField('birthDate', v)} onNext={goNext} />;
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
        return <VibeVideoStep onMarkedRecorded={(videoUid) => { updateField('vibeVideoRecorded', true); updateField('bunnyVideoUid', videoUid); }} onNext={goNext} />;
      case 13:
        if (needsEmailCollection) {
          return <VibeVideoStep onMarkedRecorded={(videoUid) => { updateField('vibeVideoRecorded', true); updateField('bunnyVideoUid', videoUid); }} onNext={goNext} />;
        }
        return <CelebrationStep submitting={submitting} completed={completed} errorMessage={completionError} onRetry={() => { submitOnceRef.current = false; void completeOnboarding(); }} vibeScore={vibeScore} vibeScoreLabel={vibeScoreLabel} onExploreEvents={() => router.replace('/(tabs)/events')} onDashboard={() => router.replace('/(tabs)')} />;
      case 14:
      default:
        return <CelebrationStep submitting={submitting} completed={completed} errorMessage={completionError} onRetry={() => { submitOnceRef.current = false; void completeOnboarding(); }} vibeScore={vibeScore} vibeScoreLabel={vibeScoreLabel} onExploreEvents={() => router.replace('/(tabs)/events')} onDashboard={() => router.replace('/(tabs)')} />;
    }
  }, [
    currentStep,
    data,
    goNext,
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
