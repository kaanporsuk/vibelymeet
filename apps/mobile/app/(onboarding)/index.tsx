import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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

const ENTRY_RECOVERY_HREF = '/entry-recovery' as Href;
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
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import {
  ONBOARDING_STEP_NAMES,
  TOTAL_STEPS_NO_EMAIL,
  TOTAL_STEPS_WITH_EMAIL,
} from '@shared/onboardingTypes';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';

export default function OnboardingV2Screen() {
  const params = useLocalSearchParams<{
    onboardingVideoUid?: string | string[];
    onboardingVideoRecorded?: string | string[];
    onboardingVideoToken?: string | string[];
  }>();
  const { session, loading, entryState, entryStateLoading, refreshEntryState } = useAuth();
  const logout = useNativeLogout();
  const { show, dialog } = useVibelyDialog();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<OnboardingData>({ ...DEFAULT_ONBOARDING_DATA });
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [vibeScore, setVibeScore] = useState(0);
  const [vibeScoreLabel, setVibeScoreLabel] = useState('Rising');
  /** Non-blocking: server draft save failed; local cache still updated. */
  const [draftCloudSaveHint, setDraftCloudSaveHint] = useState<string | null>(null);
  const submitOnceRef = useRef(false);
  const startedAtRef = useRef<number>(Date.now());
  const currentStepRef = useRef(currentStep);
  const completedRef = useRef(completed);
  const handledVideoTokenRef = useRef<string | null>(null);

  const updateField = useCallback(<K extends keyof OnboardingData>(field: K, value: OnboardingData[K]) => {
    setData((prev) => ({ ...prev, [field]: value }));
  }, []);

  useEffect(() => {
    if (loading || entryStateLoading) return;
    if (!session?.user?.id) {
      router.replace('/(auth)/sign-in');
      return;
    }
    if (entryState?.state === 'complete') {
      router.replace('/(tabs)');
      return;
    }
    if (
      !entryState
      || entryState.state === 'missing_profile'
      || entryState.state === 'suspected_fragmented_identity'
      || entryState.state === 'account_suspended'
      || entryState.state === 'hard_error'
    ) {
      router.replace(ENTRY_RECOVERY_HREF);
    }
  }, [entryState, entryStateLoading, loading, session?.user?.id]);

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
      if (result.error) {
        setDraftCloudSaveHint(
          'Could not load saved progress from the server. You can continue; we will keep saving locally and retry syncing.',
        );
      }
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
      void saveOnboardingDraft(supabase as any, session.user.id, currentStep, data, 'native').then((r) => {
        if (r.success) setDraftCloudSaveHint(null);
        else {
          console.warn('[onboarding] server draft save failed (non-fatal)');
          setDraftCloudSaveHint(
            'Could not sync progress to your account (tap to retry). Your answers stay on this device.',
          );
        }
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
    // Hint for draft / analytics only; finalize reads profiles.bunny_video_uid when present.
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

  const retryCloudDraftSync = useCallback(async () => {
    if (!session?.user?.id || !draftLoaded || completed) return;
    const r = await saveOnboardingDraft(supabase as any, session.user.id, currentStep, data, 'native');
    if (r.success) setDraftCloudSaveHint(null);
    else {
      setDraftCloudSaveHint(
        'Still could not sync. Check your connection and tap to try again.',
      );
    }
  }, [session?.user?.id, draftLoaded, completed, currentStep, data]);

  const handleFinalizeErrorBack = useCallback(() => {
    setCompletionError(null);
    submitOnceRef.current = false;
    setCurrentStep((s) => Math.max(0, s - 1));
  }, []);

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
    rcBreadcrumb(RC_CATEGORY.onboardingFinalize, 'finalize_attempt', { step: currentStep });

    try {
      setCompletionError(null);
      // finalize_onboarding copies `bunnyVideoUid` from the payload onto profiles.bunny_video_uid.
      // The authoritative uid is already on the profile after create-video-upload; drafts can lag or
      // go empty and would otherwise clear the column. Align the payload with the profile snapshot.
      let dataForFinalize = data;
      if (data.vibeVideoRecorded) {
        const { data: profileRow } = await supabase
          .from('profiles')
          .select('bunny_video_uid')
          .eq('id', session.user.id)
          .maybeSingle();
        const canonical =
          typeof profileRow?.bunny_video_uid === 'string'
            ? profileRow.bunny_video_uid.trim()
            : '';
        if (canonical) {
          dataForFinalize = { ...data, bunnyVideoUid: canonical };
        }
      }

      const result = await executeOnboardingCompletion({
        supabase: supabase as any,
        userId: session.user.id,
        data: dataForFinalize,
        clearLocalDraft: async () => {
          await AsyncStorage.removeItem(ONBOARDING_STORAGE_KEY);
        },
        trackEvent,
        platform: 'native',
        authMethod: session.user.phone ? 'phone' : (session.user.app_metadata?.provider ?? 'email'),
        startedAt: startedAtRef.current,
      });

      if (!result.success) {
        rcBreadcrumb(RC_CATEGORY.onboardingFinalize, 'finalize_failed', {
          error_code: result.errorCode ?? null,
          error_count: result.errors.length,
        });
        submitOnceRef.current = false;
        setCompletionError(result.errors.join(', ') || "Couldn't save your profile. Check your connection and try again.");
        return;
      }

      rcBreadcrumb(RC_CATEGORY.onboardingFinalize, 'finalize_success', {
        already_completed: result.alreadyCompleted,
      });
      setVibeScore(result.vibeScore);
      setVibeScoreLabel(result.vibeScoreLabel);
      setCompleted(true);
      setCompletionError(null);
      await refreshEntryState();
    } catch (error: any) {
      rcBreadcrumb(RC_CATEGORY.onboardingFinalize, 'finalize_exception', {
        message_snippet: String(error?.message ?? 'unknown').slice(0, 120),
      });
      submitOnceRef.current = false;
      setCompletionError(
        String(error?.message || "Couldn't save your profile. Check your connection and try again.")
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    session?.user?.id,
    session?.user?.phone,
    session?.user?.app_metadata?.provider,
    data,
    refreshEntryState,
    currentStep,
  ]);

  const retryFinalizeOnboarding = useCallback(() => {
    rcBreadcrumb(RC_CATEGORY.onboardingFinalize, 'finalize_retry_tap', {});
    submitOnceRef.current = false;
    void completeOnboarding();
  }, [completeOnboarding]);

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
        return <GenderStep value={data.gender} customValue={data.genderCustom} onChange={(v) => updateField('gender', v)} onChangeCustom={(v) => updateField('genderCustom', v)} onNext={goNext} />;
      case 4:
        return <InterestedInStep value={data.interestedIn} onChange={(v) => updateField('interestedIn', v)} onNext={goNext} />;
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
        return (
          <CelebrationStep
            submitting={submitting}
            completed={completed}
            errorMessage={completionError}
            onRetry={retryFinalizeOnboarding}
            onGoBackToEdit={handleFinalizeErrorBack}
            vibeScore={vibeScore}
            vibeScoreLabel={vibeScoreLabel}
            onGoNow={() => router.replace('/(tabs)')}
            onExploreEvents={() => router.replace('/(tabs)/events')}
          />
        );
      case 14:
      default:
        return (
          <CelebrationStep
            submitting={submitting}
            completed={completed}
            errorMessage={completionError}
            onRetry={retryFinalizeOnboarding}
            onGoBackToEdit={handleFinalizeErrorBack}
            vibeScore={vibeScore}
            vibeScoreLabel={vibeScoreLabel}
            onGoNow={() => router.replace('/(tabs)')}
            onExploreEvents={() => router.replace('/(tabs)/events')}
          />
        );
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
    session?.user?.id,
    submitting,
    completed,
    vibeScore,
    vibeScoreLabel,
    updateField,
    retryFinalizeOnboarding,
    handleFinalizeErrorBack,
  ]);

  const layoutOnBack =
    currentStep === 0
      ? confirmLeaveOnboarding
      : currentStep === totalSteps - 1 && completionError && !completed && !submitting
        ? handleFinalizeErrorBack
        : currentStep > 0 && currentStep < totalSteps - 1
          ? goBack
          : undefined;

  const topNotice =
    draftCloudSaveHint && !completed ? (
      <Pressable
        onPress={() => void retryCloudDraftSync()}
        style={[styles.syncBanner, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
        accessibilityRole="button"
        accessibilityLabel="Retry saving onboarding progress to your account"
      >
        <Text style={[styles.syncBannerText, { color: theme.textSecondary }]}>{draftCloudSaveHint}</Text>
        <Text style={[styles.syncBannerAction, { color: theme.tint }]}>Retry</Text>
      </Pressable>
    ) : null;

  if (loading || entryStateLoading || !session?.user?.id || entryState?.state !== 'incomplete') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <OnboardingLayout
        currentStep={currentStep}
        totalSteps={totalSteps}
        onBack={layoutOnBack}
        showProgress={currentStep !== totalSteps - 1}
        topNotice={topNotice}
      >
        {content}
      </OnboardingLayout>
      {dialog}
    </>
  );
}

const styles = StyleSheet.create({
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  syncBannerText: { flex: 1, fontSize: 12, lineHeight: 17 },
  syncBannerAction: { fontSize: 12, fontWeight: '700' },
});
