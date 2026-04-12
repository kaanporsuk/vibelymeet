import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  ScrollView,
  Image,
  RefreshControl,
  StyleSheet,
  Pressable,
  View as RNView,
  Modal,
  Platform,
  Linking,
  TextInput,
  ActivityIndicator,
  type NativeMethods,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import Colors from '@/constants/Colors';
import { spacing, radius, fonts, shadows, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { useNativeLogout } from '@/hooks/useNativeLogout';
import { presentNativeLogoutConfirm } from '@/lib/presentNativeLogoutConfirm';
import { LoadingState, ErrorState, Card, Chip, SettingsRow, DestructiveRow } from '@/components/ui';
import { OnBreakBanner } from '@/components/OnBreakBanner';
import {
  fetchMyProfile,
  fetchProfileLiveCounts,
  updateMyProfile,
  formatBirthdayUsWithZodiac,
} from '@/lib/profileApi';
import { avatarUrl, getImageUrl, deckCardUrl } from '@/lib/imageUrl';
import { supabase } from '@/lib/supabase';
import { isDocumentPickerAvailable } from '@/lib/safeDocumentPicker';
import { type PhotoBatchLaunchAction } from '@/lib/photoBatchController';
import { resolveVibeVideoState } from '@/lib/vibeVideoState';
import { vibeVideoDiagVerbose } from '@/lib/vibeVideoDiagnostics';

import { PromptEditSheet } from '@/components/profile/PromptEditSheet';
import { TaglineEditorSheet } from '@/components/profile/TaglineEditorSheet';
import PhotoManageDrawer from '@/components/photos/PhotoManageDrawer';
import {
  AddPhotoSourcePopover,
  type AddPhotoAnchor,
} from '@/components/photos/AddPhotoSourcePopover';
import { PROMPT_EMOJIS } from '@/components/profile/PROMPT_CONSTANTS';
import { RelationshipIntentSelector, getLookingForDisplay } from '@/components/profile/RelationshipIntentSelector';
import { LifestyleDetailsSection } from '@/components/profile/LifestyleDetailsSection';
import { PhoneVerificationFlow } from '@/components/verification/PhoneVerificationFlow';
import { EmailVerificationFlow } from '@/components/verification/EmailVerificationFlow';
import { PhotoVerificationFlow } from '@/components/verification/PhotoVerificationFlow';
import { useSchedule } from '@/lib/useSchedule';
import { KeyboardAwareBottomSheetModal } from '@/components/keyboard/KeyboardAwareBottomSheetModal';
import { VibePickerSheet } from '@/components/profile/VibePickerSheet';
import { getEmojiForVibeLabel } from '@/lib/vibeTagTaxonomy';
import type { VibeScoreActionId } from '@/lib/vibeScoreIncompleteActions';
import VibeScoreCircle from '@/components/profile/VibeScoreCircle';
import VibeScoreDrawer from '@/components/profile/VibeScoreDrawer';
import { useVibelyDialog } from '@/components/VibelyDialog';
import { fetchMyPhotoVerificationState, type PhotoVerificationState } from '@/lib/photoVerificationState';
import { isCurrentEmailVerified, resolveCanonicalAuthEmail } from '@shared/verificationSemantics';

const MAX_PHOTOS = 6;
const MAX_ABOUT_ME_LENGTH = 140;

// ────────────────────────────────────────────────────────────────────
// Quick Actions config
// ────────────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { key: 'video', icon: 'videocam' as const, label: 'Video', color: '#06B6D4', scrollTo: 'video' },
  { key: 'photos', icon: 'camera' as const, label: 'Photos', color: '#E84393', scrollTo: 'photos' },
  { key: 'prompts', icon: 'chatbubbles' as const, label: 'Prompts', color: '#8B5CF6', scrollTo: 'prompts' },
  { key: 'intent', icon: 'heart' as const, label: 'Intent', color: '#F472B6', scrollTo: 'lookingFor' },
  { key: 'schedule', icon: 'calendar' as const, label: 'Schedule', color: '#8B5CF6', scrollTo: 'schedule' },
] as const;

// ────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────

export default function ProfileStudio() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const logout = useNativeLogout();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const qc = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);

  // Section refs for quick-action scroll
  const sectionOffsets = useRef<Record<string, number>>({});
  const sectionLayouts = useRef<Record<string, { y: number; height: number }>>({});
  const sectionWrapperOffsets = useRef<Record<string, number>>({});
  const sectionCardRefs = useRef<Record<string, RNView | null>>({});
  const scrollViewportHeight = useRef(0);
  const scrollContentHeight = useRef(0);
  const currentScrollY = useRef(0);

  const { data: profile, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-profile'],
    queryFn: fetchMyProfile,
    enabled: !!user?.id,
  });

  const { data: liveCounts, refetch: refetchLiveCounts } = useQuery({
    queryKey: ['profile-live-counts', user?.id],
    queryFn: () => fetchProfileLiveCounts(user!.id),
    enabled: !!user?.id,
  });

  // Shared React Query cache with full Schedule screen — refetch on tab focus after edits elsewhere
  const {
    days: scheduleDays,
    schedule: scheduleRecord,
    isLoading: scheduleLoading,
    BUCKETS,
    refetch: refetchSchedule,
  } = useSchedule();

  useFocusEffect(
    React.useCallback(() => {
      if (!user?.id) return;
      void refetch().catch((e) => {
        if (__DEV__) console.warn('[ProfileStudio] refetch failed:', e);
      });
      void refetchLiveCounts().catch((e) => {
        if (__DEV__) console.warn('[ProfileStudio] refetchLiveCounts failed:', e);
      });
      void refetchSchedule().catch((e) => {
        if (__DEV__) console.warn('[ProfileStudio] refetchSchedule failed:', e);
      });
    }, [user?.id, refetch, refetchLiveCounts, refetchSchedule]),
  );

  /** Server `vibe_score` — always derived from `profile` (useQuery ['my-profile']); updates on refetch/invalidate. */
  const vibeScore = profile?.vibe_score ?? 0;

  // Pull-to-refresh (manual only — never tied to background refetch)
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  // Photo upload state
  const [thumbnailError, setThumbnailError] = useState(false);
  const [photoViewerIndex, setPhotoViewerIndex] = useState<number | null>(null);
  const [showPhotoDrawer, setShowPhotoDrawer] = useState(false);
  const [photoDrawerLaunchAction, setPhotoDrawerLaunchAction] = useState<PhotoBatchLaunchAction | null>(null);
  const [showVibeScoreDrawer, setShowVibeScoreDrawer] = useState(false);
  const [photoSourceMenu, setPhotoSourceMenu] = useState<{
    open: boolean;
    anchor: AddPhotoAnchor | null;
  }>({ open: false, anchor: null });
  const photoEmptySlotRefs = useRef<(RNView | null)[]>([]);
  const heroCameraFabRef = useRef<RNView | null>(null);
  const [showVibePicker, setShowVibePicker] = useState(false);

  // Prompt editing state
  const [showPromptSheet, setShowPromptSheet] = useState(false);
  const [promptSheetMode, setPromptSheetMode] = useState<'edit' | 'add'>('edit');
  const [promptEditIndex, setPromptEditIndex] = useState<number | null>(null);

  // Edit drawers
  const [showIntentDrawer, setShowIntentDrawer] = useState(false);
  const [lookingForEdit, setLookingForEdit] = useState('');
  const [meetingPref, setMeetingPref] = useState<'events' | 'dates' | 'both'>('both');
  const [showBioDrawer, setShowBioDrawer] = useState(false);
  const [aboutMeEdit, setAboutMeEdit] = useState('');
  const [showDetailsDrawer, setShowDetailsDrawer] = useState(false);
  const [nameEdit, setNameEdit] = useState('');
  const [jobEdit, setJobEdit] = useState('');
  const [heightEdit, setHeightEdit] = useState('');
  // locationEdit removed — location is system-managed via handleUpdateDeviceLocation.
  const [lifestyleEdit, setLifestyleEdit] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showTaglineSheet, setShowTaglineSheet] = useState(false);

  // Verification
  const [showPhoneVerify, setShowPhoneVerify] = useState(false);
  const [showEmailVerify, setShowEmailVerify] = useState(false);
  const [showPhotoVerify, setShowPhotoVerify] = useState(false);
  const [photoVerificationState, setPhotoVerificationState] = useState<PhotoVerificationState>('none');

  const chooseFileSupported = React.useMemo(() => isDocumentPickerAvailable(), []);

  // Sync edit forms when profile loads
  useEffect(() => {
    if (!profile) return;
    setLookingForEdit(profile.relationship_intent ?? profile.looking_for ?? '');
    setAboutMeEdit(profile.about_me ?? '');
    setNameEdit(profile.name ?? '');
    setJobEdit(profile.job ?? '');
    setHeightEdit(profile.height_cm ? String(profile.height_cm) : '');
    setLifestyleEdit(profile.lifestyle ?? {});
    setThumbnailError(false);
    const stored = (profile.lifestyle as Record<string, string> | null)?.meeting_preference;
    if (stored === 'events' || stored === 'dates' || stored === 'both') {
      setMeetingPref(stored);
    }
  }, [profile]);

  const { show, dialog } = useVibelyDialog();

  const refreshPhotoVerificationState = React.useCallback(async () => {
    if (!user?.id) return;
    const next = await fetchMyPhotoVerificationState(user.id);
    setPhotoVerificationState(next.state);
  }, [user?.id]);

  useEffect(() => {
    void refreshPhotoVerificationState();
  }, [refreshPhotoVerificationState]);

  // ═══════════════════════════════════════════════
  // End of hooks — only plain values / handlers below until loading/error early returns.
  // ═══════════════════════════════════════════════

  // Verification counts
  const verificationStepTotal = 3;
  const hasAccountEmail = !!resolveCanonicalAuthEmail(user);
  const emailVerified = isCurrentEmailVerified({
    emailVerified: profile?.email_verified,
    verifiedEmail: profile?.verified_email ?? null,
    authEmail: resolveCanonicalAuthEmail(user) ?? user?.email ?? null,
  });
  const verificationVerifiedCount =
    (emailVerified ? 1 : 0) +
    (profile?.photo_verified ? 1 : 0) +
    (profile?.phone_verified ? 1 : 0);
  const verificationProgressPct = (verificationVerifiedCount / verificationStepTotal) * 100;
  const vibeScoreProfile = React.useMemo(
    () => (profile ? { ...profile, email_verified: emailVerified } : null),
    [profile, emailVerified],
  );

  const isSlotOpen = (isoDate: string, bucket: string): boolean =>
    scheduleRecord[`${isoDate}_${bucket}`]?.status === 'open';

  const scheduleStatus = (() => {
    if (scheduleLoading || !scheduleDays.length) return { label: 'No schedule set', color: '#6B7280' };
    const hasAnyOpen = Object.values(scheduleRecord).some(v => v.status === 'open');
    if (!hasAnyOpen) return { label: 'No schedule set', color: '#6B7280' };
    const todayStr = new Date().toISOString().split('T')[0];
    for (const day of scheduleDays) {
      const dayHasOpen = BUCKETS.some(b => isSlotOpen(day.isoDate, b));
      if (dayHasOpen) {
        if (day.isoDate === todayStr) return { label: 'Available today', color: '#22c55e' };
        const d = new Date(day.isoDate);
        const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
        return { label: `Next available: ${dayName}`, color: '#F59E0B' };
      }
    }
    return { label: 'No schedule set', color: '#6B7280' };
  })();

  /** Vibe video UI state — must not use hooks; same call order every render (incl. loading/error paths). */
  const videoInfo = resolveVibeVideoState(profile ?? null);

  useEffect(() => {
    if (!profile) return;
    vibeVideoDiagVerbose('profile_studio.video_state', {
      profileId: profile.id,
      bunny_video_uid: profile.bunny_video_uid ?? null,
      bunny_video_status: profile.bunny_video_status ?? null,
      resolvedState: videoInfo.state,
      playbackUrl: videoInfo.playbackUrl,
    });
  }, [profile?.id, profile?.bunny_video_uid, profile?.bunny_video_status, videoInfo.playbackUrl, videoInfo.state, profile]);

  const registerSectionLayout = (key: string, y: number, height: number) => {
    sectionOffsets.current[key] = y;
    sectionLayouts.current[key] = { y, height };
  };

  const registerSectionWrapperOffset = (key: string, y: number) => {
    sectionWrapperOffsets.current[key] = y;
  };

  const registerSectionCardLayout = (key: string, cardY: number, cardHeight: number) => {
    const wrapperY = sectionWrapperOffsets.current[key] ?? 0;
    registerSectionLayout(key, wrapperY + cardY, cardHeight);
  };

  const setSectionCardRef = (key: string) => (node: RNView | null) => {
    sectionCardRefs.current[key] = node;
  };

  const alignSectionCardToVisibleCenter = (key: string, attempt = 0) => {
    const cardRef = sectionCardRefs.current[key];
    if (!cardRef || !scrollRef.current) return;

    cardRef.measureInWindow((_x, cardY, _w, cardH) => {
      (scrollRef.current as unknown as NativeMethods | null)?.measureInWindow(
        (_sx: number, scrollYOnScreen: number, _sw: number, scrollHOnScreen: number) => {
        const bottomObstruction = layout.scrollContentPaddingBottomTab + Math.max(insets.bottom, 8);
        const visibleHeight = Math.max(0, scrollHOnScreen - bottomObstruction);
        const desiredVisibleCenterOnScreen = scrollYOnScreen + visibleHeight / 2;
        const cardCenterOnScreen = cardY + cardH / 2;
        const delta = cardCenterOnScreen - desiredVisibleCenterOnScreen;

        const maxY = Math.max(0, scrollContentHeight.current - scrollViewportHeight.current);
        const targetScrollY = Math.min(Math.max(currentScrollY.current + delta, 0), maxY);

        scrollRef.current?.scrollTo({ y: targetScrollY, animated: true });

        // One corrective pass to account for async layout settling after animated scroll.
        if (attempt < 1 && Math.abs(delta) > 2) {
          requestAnimationFrame(() => {
            alignSectionCardToVisibleCenter(key, attempt + 1);
          });
        }
      },
    );
    });
  };

  const scrollToSection = (key: string) => {
    if (!scrollRef.current) return;
    const sectionLayout = sectionLayouts.current[key];
    const coarseY = sectionLayout?.y ?? sectionOffsets.current[key];
    if (coarseY != null) {
      const maxY = Math.max(0, scrollContentHeight.current - scrollViewportHeight.current);
      const coarseTargetY = Math.min(Math.max(coarseY, 0), maxY);
      scrollRef.current.scrollTo({ y: coarseTargetY, animated: true });
    }
    requestAnimationFrame(() => {
      alignSectionCardToVisibleCenter(key);
    });
  };

  const openVibeStudio = useCallback(() => {
    (router as { push: (p: string) => void }).push('/vibe-studio');
  }, [router]);

  const handleVibeScoreDrawerAction = (action: VibeScoreActionId) => {
    switch (action) {
      case 'vibes':
        setShowVibePicker(true);
        scrollToSection('prompts');
        break;
      case 'photos':
        openPhotoDrawerEditor();
        break;
      case 'vibe_video':
        openVibeStudio();
        break;
      case 'prompts':
        scrollToSection('prompts');
        break;
      case 'about_me':
        setAboutMeEdit((profile?.about_me ?? '').slice(0, MAX_ABOUT_ME_LENGTH));
        setShowBioDrawer(true);
        scrollToSection('about');
        break;
      case 'tagline':
        setShowTaglineSheet(true);
        scrollToSection('hero');
        break;
      case 'relationship_intent':
        scrollToSection('lookingFor');
        break;
      case 'job':
      case 'height':
      case 'lifestyle':
        setShowDetailsDrawer(true);
        scrollToSection('details');
        break;
      case 'phone':
        setShowPhoneVerify(true);
        break;
      case 'email':
        if (emailVerified) {
          show({
            title: 'Already verified',
            message: 'Your current account email is already verified on your profile.',
            variant: 'success',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
        } else if (!hasAccountEmail) {
          show({
            title: 'Add an email first',
            message: 'Add an account email before you verify it on your profile.',
            variant: 'warning',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
        } else {
          setShowEmailVerify(true);
        }
        break;
      case 'photo_verify':
        scrollToSection('verification');
        if (photoVerificationState === 'approved') {
          show({
            title: 'Already verified',
            message: 'Your photo verification badge is active.',
            variant: 'success',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          break;
        }
        if (photoVerificationState === 'pending') {
          show({
            title: 'Under review',
            message: 'Your selfie is currently under review. We’ll update your badge when approved.',
            variant: 'info',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          break;
        }
        if (!profile?.photos?.[0]) {
          show({
            title: 'Add a profile photo first',
            message: 'Please add a profile photo before submitting selfie verification.',
            variant: 'warning',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          break;
        }
        setShowPhotoVerify(true);
        break;
      case 'name':
        scrollToSection('hero');
        break;
      default:
        break;
    }
  };

  const openPhotoDrawerEditor = useCallback(() => {
    setPhotoSourceMenu({ open: false, anchor: null });
    setPhotoDrawerLaunchAction(null);
    setShowPhotoDrawer(true);
  }, []);

  const openPhotoDrawerWithAction = useCallback((kind: PhotoBatchLaunchAction['kind']) => {
    setPhotoSourceMenu({ open: false, anchor: null });
    setPhotoDrawerLaunchAction({ id: Date.now() + Math.random(), kind });
    setShowPhotoDrawer(true);
  }, []);

  // ── Prompt handlers ────────────────────────────────────────────

  const handlePromptCommit = async (payload: { question: string; answer: string }) => {
    const idx = promptEditIndex;
    if (idx === null || idx < 0) return;
    setSaving(true);
    try {
      const current = [...(profile?.prompts ?? [])];
      while (current.length <= idx) current.push({ question: '', answer: '' });
      current[idx] = { question: payload.question, answer: payload.answer };
      while (
        current.length > 0 &&
        (!String(current[current.length - 1]?.question ?? '').trim() ||
          !String(current[current.length - 1]?.answer ?? '').trim())
      ) {
        current.pop();
      }
      await updateMyProfile({ prompts: current });
      await qc.invalidateQueries({ queryKey: ['my-profile'] });
      setShowPromptSheet(false);
      setPromptEditIndex(null);
    } catch (e) {
      show({
        title: 'Couldn’t save prompt',
        message: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePromptRemove = async (index: number) => {
    setSaving(true);
    try {
      const current = profile?.prompts ?? [];
      const next = current.filter((_, i) => i !== index);
      await updateMyProfile({ prompts: next.length ? next : [] });
      await qc.invalidateQueries({ queryKey: ['my-profile'] });
      setShowPromptSheet(false);
      setPromptEditIndex(null);
    } catch (e) {
      show({
        title: 'Couldn’t remove prompt',
        message: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Intent + meeting preference save ──────────────────────────

  const handleSaveIntent = async () => {
    setSaving(true);
    try {
      const currentLifestyle = profile?.lifestyle ?? {};
      await updateMyProfile({
        looking_for: lookingForEdit.trim() || undefined,
        lifestyle: { ...currentLifestyle, meeting_preference: meetingPref },
      });
      qc.invalidateQueries({ queryKey: ['my-profile'] });
      setShowIntentDrawer(false);
    } catch (e) {
      show({
        title: 'Couldn’t save',
        message: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Bio save ──────────────────────────────────────────────────

  const handleSaveBio = async () => {
    const next = aboutMeEdit.trim().slice(0, MAX_ABOUT_ME_LENGTH);
    setSaving(true);
    try {
      await updateMyProfile({ about_me: next || undefined });
      qc.invalidateQueries({ queryKey: ['my-profile'] });
      setShowBioDrawer(false);
    } catch (e) {
      show({
        title: 'Couldn’t save',
        message: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setSaving(false);
    }
  };

  const discardBioDrawer = () => {
    setAboutMeEdit((profile?.about_me ?? '').slice(0, MAX_ABOUT_ME_LENGTH));
    setShowBioDrawer(false);
  };

  const discardDetailsDrawer = () => {
    if (profile) {
      setNameEdit(profile.name ?? '');
      setJobEdit(profile.job ?? '');
      setHeightEdit(profile.height_cm ? String(profile.height_cm) : '');
      setLifestyleEdit({ ...(profile.lifestyle ?? {}) });
    }
    setShowDetailsDrawer(false);
  };

  const discardIntentDrawer = () => {
    if (profile) {
      setLookingForEdit(profile.relationship_intent ?? profile.looking_for ?? '');
      const stored = (profile.lifestyle as Record<string, string> | null)?.meeting_preference;
      if (stored === 'events' || stored === 'dates' || stored === 'both') {
        setMeetingPref(stored);
      } else {
        setMeetingPref('both');
      }
    }
    setShowIntentDrawer(false);
  };

  /** Prompt questions used in other slots — native prompt picker disables these. */
  const usedPromptQuestionsElsewhere =
    promptEditIndex === null
      ? []
      : (profile?.prompts ?? [])
          .map((p, i) => (i !== promptEditIndex && p.question?.trim() ? p.question.trim() : null))
          .filter((q): q is string => !!q);

  // ── Tagline save ─────────────────────────────────────────────

  const handleSaveTagline = async (value: string) => {
    setSaving(true);
    try {
      await updateMyProfile({ tagline: value.trim() || undefined });
      qc.invalidateQueries({ queryKey: ['my-profile'] });
      setShowTaglineSheet(false);
    } catch (e) {
      show({
        title: 'Couldn’t save',
        message: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Details (basics + lifestyle) save ─────────────────────────

  const handleSaveDetails = async () => {
    setSaving(true);
    try {
      const parsedHeight = heightEdit.trim() ? parseInt(heightEdit.trim(), 10) : undefined;
      await updateMyProfile({
        name: nameEdit.trim() || undefined,
        job: jobEdit.trim() || undefined,
        height_cm: parsedHeight !== undefined && !Number.isNaN(parsedHeight) ? parsedHeight : undefined,
        // location is system-managed — updated only via handleUpdateDeviceLocation (GPS → RPC).
        // Do not include location or location_data here.
        lifestyle: Object.keys(lifestyleEdit).length > 0 ? lifestyleEdit : undefined,
      });
      qc.invalidateQueries({ queryKey: ['my-profile'] });
      setShowDetailsDrawer(false);
    } catch (e) {
      show({
        title: "Couldn't save",
        message: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Device location update ────────────────────────────────────
  // Replaces any free-text location edit. Captures GPS, reverse-geocodes,
  // and writes all three fields (location, location_data, country) via RPC.

  const [updatingLocation, setUpdatingLocation] = useState(false);

  const handleUpdateDeviceLocation = async () => {
    if (updatingLocation) return;
    setUpdatingLocation(true);
    try {
      const Location = await import('expo-location');
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        show({
          title: 'Location access needed',
          message: perm.canAskAgain === false
            ? 'Location is off for Vibely. Enable it in Settings to update your location.'
            : 'Allow location access so Vibely can set your city.',
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      // Reverse-geocode to normalized city/country label.
      let displayLabel = '';
      let country = '';
      try {
        const { data: geoData, error: geoErr } = await supabase.functions.invoke('geocode', {
          body: { lat, lng },
        });
        if (!geoErr && geoData) {
          const city = typeof geoData.city === 'string' ? geoData.city.trim() : '';
          country = typeof geoData.country === 'string' ? geoData.country.trim() : '';
          displayLabel = city && country ? `${city}, ${country}` : (geoData.formatted ?? '');
        }
      } catch { /* fall through — geocode failure prevents update */ }

      if (!displayLabel || !country) {
        show({
          title: 'Location not recognized',
          message: "We couldn't match your GPS position to a city. Try again in a moment.",
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      const { data: rpcResult, error: rpcError } = await supabase.rpc('update_profile_location', {
        p_user_id: user?.id,
        p_location: displayLabel,
        p_lat: lat,
        p_lng: lng,
        p_country: country,
      });
      if (rpcError) throw rpcError;
      const result = rpcResult as { success?: boolean; error?: string } | null;
      if (!result?.success) throw new Error(result?.error ?? 'location_update_failed');

      qc.invalidateQueries({ queryKey: ['my-profile'] });
      show({
        title: 'Location updated',
        message: displayLabel,
        variant: 'success',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } catch (e) {
      show({
        title: 'Location update failed',
        message: e instanceof Error ? e.message : 'Check your connection and try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setUpdatingLocation(false);
    }
  };

  // ── Early returns (loading / error / empty profile) — no hooks below top of component ──

  if (isLoading && !profile) {
    return (
      <>
        <View style={[s.centered, { backgroundColor: theme.background }]}>
          <LoadingState title="Loading profile…" message="Just a sec…" />
        </View>
        {dialog}
      </>
    );
  }

  if (isError && !profile) {
    return (
      <>
        <View style={[s.centered, { backgroundColor: theme.background, flex: 1 }]}>
          <ErrorState
            message={error instanceof Error ? error.message : "We couldn't load your profile."}
            onActionPress={() => {
              void refetch().catch((e) => {
                if (__DEV__) console.warn('[ProfileStudio] refetch failed:', e);
              });
              void refetchLiveCounts().catch((e) => {
                if (__DEV__) console.warn('[ProfileStudio] refetchLiveCounts failed:', e);
              });
            }}
          />
        </View>
        {dialog}
      </>
    );
  }

  /** Network/offline or missing row — fetchMyProfile returned null without throwing */
  if (!isLoading && user?.id && !profile) {
    return (
      <>
        <View style={[s.centered, { backgroundColor: theme.background, flex: 1 }]}>
          <ErrorState
            message="We couldn't load your profile. Check your connection and try again."
            onActionPress={() => {
              void refetch().catch((e) => {
                if (__DEV__) console.warn('[ProfileStudio] refetch failed:', e);
              });
              void refetchLiveCounts().catch((e) => {
                if (__DEV__) console.warn('[ProfileStudio] refetchLiveCounts failed:', e);
              });
            }}
          />
        </View>
        {dialog}
      </>
    );
  }

  // ── Derived data (no hooks below early returns) ─────────────────

  const mainPhoto = profile?.photos?.[0] ?? profile?.avatar_url ?? null;
  const displayName = profile?.name ?? 'Your name';
  const age = profile?.age;
  const hasPlayableVibeVideo = videoInfo.state === 'ready' && videoInfo.canPlay;
  const readyAwaitingPlaybackUrl = videoInfo.state === 'ready' && !videoInfo.canPlay;
  const isVibeVideoProcessing = videoInfo.state === 'processing' || videoInfo.state === 'uploading';
  const isVibeVideoFailed = videoInfo.state === 'failed';
  const isVibeVideoError = videoInfo.state === 'error';
  const thumbnailUrl = videoInfo.thumbnailUrl;
  const caption = videoInfo.caption ?? '';
  const profilePhotos = profile?.photos ?? [];
  const lookingForDisplay = getLookingForDisplay(profile?.relationship_intent ?? profile?.looking_for);
  const storedMeetingPref = (profile?.lifestyle as Record<string, string> | null)?.meeting_preference ?? 'both';
  const promptList = profile?.prompts ?? [];
  const filledPromptCount = promptList.filter(p => p.question?.trim() && p.answer?.trim()).length;

  const VERIFICATION_TEAL = '#0D9488';
  const VERIFICATION_GRADIENT = ['#8B5CF6', '#E84393'] as const;
  const VERIFICATION_SHIELD = '#8B5CF6';
  const VERIFICATION_SUCCESS_TEXT = '#2DD4BF';

  return (
    <>
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: theme.background }}
      scrollEventThrottle={16}
      onScroll={(e) => {
        currentScrollY.current = e.nativeEvent.contentOffset.y;
      }}
      onLayout={(e) => {
        scrollViewportHeight.current = e.nativeEvent.layout.height;
      }}
      onContentSizeChange={(_, height) => {
        scrollContentHeight.current = height;
      }}
      contentContainerStyle={{
        // Clears floating VibelyTabBar: layout.scrollContentPaddingBottomTab + dockOuter safe inset (see app/(tabs)/_layout.tsx)
        paddingBottom: layout.scrollContentPaddingBottomTab + Math.max(insets.bottom, 8),
      }}
      refreshControl={
        <RefreshControl
          refreshing={isManualRefreshing}
          onRefresh={async () => {
            setIsManualRefreshing(true);
            try {
              await Promise.all([
                refetch().catch((e) => {
                  if (__DEV__) console.warn('[ProfileStudio] pull refresh refetch failed:', e);
                }),
                refetchLiveCounts().catch((e) => {
                  if (__DEV__) console.warn('[ProfileStudio] pull refresh counts failed:', e);
                }),
                refetchSchedule().catch((e) => {
                  if (__DEV__) console.warn('[ProfileStudio] pull refresh schedule failed:', e);
                }),
              ]);
            } finally {
              setIsManualRefreshing(false);
            }
          }}
          tintColor={theme.tint}
        />
      }
    >
      {/* ═══ Section 1: Cinematic Hero Header ═══ */}
      <LinearGradient
        colors={['#8B5CF6', '#D946EF', '#E84393']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ width: '100%', height: 120, paddingTop: insets.top }}
      >
        <RNView style={s.heroTopRow}>
          <Pressable
            onPress={() => (router as { push: (p: string) => void }).push('/profile-preview')}
            style={s.heroIconBtn}
            accessibilityLabel="Preview profile"
          >
            <Ionicons name="eye-outline" size={18} color="white" />
          </Pressable>
          <Pressable
            onPress={() => router.push('/settings')}
            style={s.heroIconBtn}
            accessibilityLabel="Settings"
          >
            <Ionicons name="settings-outline" size={18} color="white" />
          </Pressable>
        </RNView>
      </LinearGradient>

      {/* Centered avatar overlapping gradient */}
      <RNView style={s.heroAvatarWrap}>
        <RNView style={{ position: 'relative' }}>
          {mainPhoto ? (
            <Image
              source={{ uri: avatarUrl(mainPhoto) }}
              style={[s.heroAvatar, { borderColor: theme.background }]}
            />
          ) : (
            <RNView style={[s.heroAvatar, s.heroAvatarPlaceholder, { borderColor: theme.background, backgroundColor: theme.surfaceSubtle }]}>
              <Ionicons name="person" size={36} color={theme.mutedForeground} />
            </RNView>
          )}
          {/* Video FAB — bottom left */}
          <Pressable
            onPress={openVibeStudio}
            style={[s.heroFab, s.heroFabLeft]}
          >
            <Ionicons name="videocam" size={18} color="white" />
          </Pressable>
          {/* Camera FAB — bottom right */}
          <RNView ref={heroCameraFabRef} collapsable={false} style={[s.heroFab, s.heroFabRight]}>
            <Pressable
              onPress={() => {
                if (profilePhotos.length >= MAX_PHOTOS) {
                  openPhotoDrawerEditor();
                  return;
                }
                heroCameraFabRef.current?.measureInWindow((x, y, width, height) => {
                  setPhotoSourceMenu({ open: true, anchor: { x, y, width, height } });
                });
              }}
              style={StyleSheet.absoluteFill}
              accessibilityLabel="Add profile photo"
            >
              <RNView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="camera" size={18} color="white" />
              </RNView>
            </Pressable>
          </RNView>
        </RNView>
      </RNView>

      {/* Name, tagline, location */}
      <RNView
        onLayout={(e) => {
          const { y } = e.nativeEvent.layout;
          registerSectionWrapperOffset('hero', y);
        }}
      >
        <RNView
          ref={setSectionCardRef('hero')}
          collapsable={false}
          onLayout={(e) => {
            const { y, height } = e.nativeEvent.layout;
            registerSectionCardLayout('hero', y, height);
          }}
          style={s.heroIdentity}
        >
          <RNView style={s.heroNameRow}>
            <Text style={[s.heroName, { color: theme.text }]}>
              {displayName}{age != null ? `, ${age}` : ''}
            </Text>
          </RNView>

          <Pressable
            onPress={() => setShowTaglineSheet(true)}
            style={s.heroTaglineRow}
          >
            <Text style={s.heroTagline}>
              "{profile?.tagline?.trim() || 'Add a tagline'}"
            </Text>
            <Ionicons name="pencil-outline" size={14} color="#8B5CF6" />
          </Pressable>

          <RNView style={s.heroLocationRow}>
            <Ionicons name="location-outline" size={14} color={theme.textSecondary} />
            <Text style={[s.heroLocationText, { color: theme.textSecondary }]}>
              {profile?.location?.trim() || 'Location not set'}
            </Text>
          </RNView>
        </RNView>
      </RNView>

      <RNView style={{ paddingHorizontal: layout.containerPadding, marginBottom: spacing.sm }}>
        <OnBreakBanner variant="compact" />
      </RNView>

      {/* ═══ Preview | Vibe Score circle | Complete Profile ═══ */}
      <RNView style={s.vibeScoreHeaderRow}>
        <Pressable
          onPress={() => (router as { push: (p: string) => void }).push('/profile-preview')}
          style={[s.vibeScorePreviewBtn, { borderColor: 'rgba(139, 92, 246, 0.4)' }]}
        >
          <Ionicons name="eye-outline" size={16} color="#8B5CF6" />
          <Text style={s.vibeScorePreviewText}>Preview</Text>
        </Pressable>

        <Pressable
          onPress={() => setShowVibeScoreDrawer(true)}
          style={s.vibeScoreCenterCircle}
          accessibilityRole="button"
          accessibilityLabel="Vibe Score"
        >
          <VibeScoreCircle score={vibeScore} />
        </Pressable>

        <Pressable onPress={() => setShowVibeScoreDrawer(true)} style={s.vibeScoreCompleteBtn}>
          <LinearGradient
            colors={['#8B5CF6', '#E84393']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.vibeScoreCompleteBtnGrad}
          >
            {vibeScore >= 90 ? (
              <>
                <Ionicons name="checkmark-circle" size={16} color="#fff" style={{ marginRight: 4 }} />
                <Text style={s.vibeScoreCompleteBtnText}>Iconic</Text>
              </>
            ) : (
              <Text style={s.vibeScoreCompleteBtnText}>Complete Profile</Text>
            )}
          </LinearGradient>
        </Pressable>
      </RNView>

      {/* ═══ My Vibe Schedule Row ═══ */}
      <Pressable
        onPress={() => router.push('/schedule')}
        style={[s.scheduleRow, { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder }]}
      >
        <Ionicons name="calendar-outline" size={16} color={theme.tint} />
        <RNView style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[s.scheduleRowTitle, { color: theme.text }]}>My Vibe Schedule</Text>
          <Text style={[s.scheduleRowSubtitle, { color: theme.textSecondary }]}>
            {scheduleStatus.label === 'No schedule set' ? "Set when you're open for dates" : scheduleStatus.label}
          </Text>
        </RNView>
        <RNView style={[s.scheduleRowDot, { backgroundColor: scheduleStatus.color }]} />
        <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
      </Pressable>

      {/* ═══ Counters Row ═══ */}
      <RNView style={s.countersRow}>
        {([
          { label: 'Events', value: liveCounts?.events ?? profile?.events_attended ?? 0 },
          { label: 'Matches', value: liveCounts?.matches ?? profile?.total_matches ?? 0 },
          { label: 'Convos', value: liveCounts?.convos ?? profile?.total_conversations ?? 0 },
        ] as const).map((stat) => (
          <RNView key={stat.label} style={[s.counterBox, { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder }]}>
            <Text style={[s.counterValue, { color: theme.text }]}>{stat.value}</Text>
            <Text style={[s.counterLabel, { color: theme.textSecondary }]}>{stat.label}</Text>
          </RNView>
        ))}
      </RNView>

      {/* ═══ Quick Actions — compact pills ═══ */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        alwaysBounceHorizontal={false}
        bounces={false}
        contentContainerStyle={s.quickActionsContent}
        style={s.quickActionsStrip}
      >
        {QUICK_ACTIONS.map((action) => (
          <Pressable
            key={action.key}
            onPress={() => {
              scrollToSection(action.scrollTo);
            }}
            style={({ pressed }) => [s.quickActionPill, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name={action.icon} size={14} color={action.color} />
            <Text style={s.quickActionPillLabel}>{action.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* ═══ Main content area ═══ */}
      <RNView style={s.main}>

        {/* ═══ Section 4: Vibe Video Module ═══ */}
        <RNView
          onLayout={(e) => {
            const { y } = e.nativeEvent.layout;
            registerSectionWrapperOffset('video', y);
          }}
        >
          <RNView style={s.sectionHeader}>
            <RNView style={s.sectionTitleRow}>
              <Ionicons name="videocam-outline" size={18} color={theme.tint} />
              <Text style={[s.sectionTitle, { color: theme.text }]}>Vibe Video</Text>
            </RNView>
            <Pressable
              onPress={openVibeStudio}
              style={({ pressed }) => [s.sectionLink, pressed && { opacity: 0.8 }]}
            >
              <Text style={[s.sectionLinkText, { color: theme.tint }]}>Open Studio</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.tint} />
            </Pressable>
          </RNView>

          {isVibeVideoProcessing ? (
            <Pressable
              onPress={openVibeStudio}
              ref={setSectionCardRef('video')}
              collapsable={false}
              onLayout={(e) => {
                const { y, height } = e.nativeEvent.layout;
                registerSectionCardLayout('video', y, height);
              }}
              style={({ pressed }) => [
                s.videoCard,
                s.videoProcessingCard,
                { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder },
                pressed && { opacity: 0.92 },
              ]}
            >
              <ActivityIndicator size="large" color="#8B5CF6" />
              <Text style={[s.videoProcessingTitle, { color: theme.text }]}>Processing your video…</Text>
              <Text style={[s.videoProcessingSubtitle, { color: theme.textSecondary }]}>
                This usually takes 15–30 seconds
              </Text>
              <Text style={[s.videoStudioHint, { color: theme.tint }]}>Open Vibe Studio</Text>
            </Pressable>
          ) : readyAwaitingPlaybackUrl ? (
            <Pressable
              onPress={openVibeStudio}
              ref={setSectionCardRef('video')}
              collapsable={false}
              onLayout={(e) => {
                const { y, height } = e.nativeEvent.layout;
                registerSectionCardLayout('video', y, height);
              }}
              style={({ pressed }) => [
                s.videoCard,
                s.videoProcessingCard,
                { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder },
                pressed && { opacity: 0.92 },
              ]}
            >
              <Ionicons name="sync" size={36} color="#FBBF24" />
              <Text style={[s.videoProcessingTitle, { color: theme.text }]}>Preview still syncing</Text>
              <Text style={[s.videoProcessingSubtitle, { color: theme.textSecondary }]}>
                The backend marked this Vibe Video ready, but this device is still waiting on a playable preview URL.
              </Text>
              <Text style={[s.videoStudioHint, { color: theme.tint }]}>Open Vibe Studio</Text>
            </Pressable>
          ) : hasPlayableVibeVideo ? (
            <Pressable
              onPress={openVibeStudio}
              ref={setSectionCardRef('video')}
              collapsable={false}
              onLayout={(e) => {
                const { y, height } = e.nativeEvent.layout;
                registerSectionCardLayout('video', y, height);
              }}
              style={({ pressed }) => [
                s.videoCard,
                { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder },
                pressed && { opacity: 0.96 },
              ]}
            >
              {thumbnailUrl && !thumbnailError ? (
                <Image
                  source={{ uri: thumbnailUrl }}
                  style={s.videoThumbnail}
                  resizeMode="cover"
                  onError={() => setThumbnailError(true)}
                />
              ) : (
                <LinearGradient colors={['#1C1A2E', '#0D0B1A']} style={s.videoThumbnail} />
              )}

              <LinearGradient
                pointerEvents="none"
                colors={['transparent', 'rgba(0,0,0,0.72)']}
                locations={[0.3, 1]}
                style={StyleSheet.absoluteFill}
              />

              <RNView pointerEvents="none" style={s.viewfinderTL} />
              <RNView pointerEvents="none" style={s.viewfinderTR} />
              <RNView pointerEvents="none" style={s.viewfinderBL} />
              <RNView pointerEvents="none" style={s.viewfinderBR} />

              <RNView style={s.videoLiveBadge}>
                <RNView style={s.videoLiveDot} />
                <Text style={s.videoLiveText}>LIVE</Text>
              </RNView>

              <RNView style={s.videoPlayOverlay} pointerEvents="none">
                <RNView style={s.videoPlayBtn}>
                  <Ionicons name="arrow-forward" size={26} color="#fff" />
                </RNView>
              </RNView>

              <RNView style={s.videoCaptionStrip} pointerEvents="none">
                {caption ? (
                  <>
                    <Text style={s.videoCaptionLabel}>VIBING ON</Text>
                    <Text style={s.videoCaptionText} numberOfLines={2}>
                      {caption}
                    </Text>
                  </>
                ) : (
                  <Text style={[s.videoCaptionText, { opacity: 0.7 }]}>
                    Open in Vibe Studio
                  </Text>
                )}
              </RNView>
            </Pressable>
          ) : isVibeVideoFailed ? (
            <Pressable
              onPress={openVibeStudio}
              ref={setSectionCardRef('video')}
              collapsable={false}
              onLayout={(e) => {
                const { y, height } = e.nativeEvent.layout;
                registerSectionCardLayout('video', y, height);
              }}
              style={({ pressed }) => [pressed && { opacity: 0.94 }]}
            >
              <Card variant="glass" style={s.videoEmptyCard}>
                <Ionicons name="alert-circle-outline" size={48} color="#F59E0B" style={{ opacity: 0.85 }} />
                <Text style={[s.videoEmptyTitle, { color: theme.text }]}>Video processing failed</Text>
                <Text style={[s.videoEmptySubtitle, { color: theme.textSecondary }]}>
                  Record a new clip — it only takes a moment.
                </Text>
                <LinearGradient
                  colors={['#8B5CF6', '#E84393']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.videoEmptyCta}
                >
                  <RNView style={s.videoEmptyCtaInner}>
                    <Text style={s.videoEmptyCtaText}>Open Vibe Studio</Text>
                  </RNView>
                </LinearGradient>
              </Card>
            </Pressable>
          ) : isVibeVideoError ? (
            <Pressable
              onPress={openVibeStudio}
              ref={setSectionCardRef('video')}
              collapsable={false}
              onLayout={(e) => {
                const { y, height } = e.nativeEvent.layout;
                registerSectionCardLayout('video', y, height);
              }}
              style={({ pressed }) => [pressed && { opacity: 0.94 }]}
            >
              <Card variant="glass" style={s.videoEmptyCard}>
                <Ionicons name="warning-outline" size={48} color="#F59E0B" style={{ opacity: 0.9 }} />
                <Text style={[s.videoEmptyTitle, { color: theme.text }]}>Video issue</Text>
                <Text style={[s.videoEmptySubtitle, { color: theme.textSecondary }]}>
                  Something went wrong with your video. Try recording a new one.
                </Text>
                <LinearGradient
                  colors={['#8B5CF6', '#E84393']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.videoEmptyCta}
                >
                  <RNView style={s.videoEmptyCtaInner}>
                    <Text style={s.videoEmptyCtaText}>Open Vibe Studio</Text>
                  </RNView>
                </LinearGradient>
              </Card>
            </Pressable>
          ) : (
            <Pressable
              onPress={openVibeStudio}
              ref={setSectionCardRef('video')}
              collapsable={false}
              onLayout={(e) => {
                const { y, height } = e.nativeEvent.layout;
                registerSectionCardLayout('video', y, height);
              }}
              style={({ pressed }) => [pressed && { opacity: 0.94 }]}
            >
              <Card variant="glass" style={s.videoEmptyCard}>
                <Ionicons name="videocam-outline" size={48} color={theme.textSecondary} style={{ opacity: 0.3 }} />
                <Text style={[s.videoEmptyTitle, { color: theme.text }]}>Record your Vibe Video</Text>
                <Text style={[s.videoEmptySubtitle, { color: theme.textSecondary }]}>
                  Profiles with video get 3x more quality conversations
                </Text>
                <LinearGradient
                  colors={['#8B5CF6', '#E84393']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.videoEmptyCta}
                >
                  <RNView style={s.videoEmptyCtaInner}>
                    <Text style={s.videoEmptyCtaText}>Open Vibe Studio</Text>
                  </RNView>
                </LinearGradient>
              </Card>
            </Pressable>
          )}
        </RNView>

        {/* ═══ Section 5: Photos Module ═══ */}
        <RNView
          onLayout={(e) => {
            const { y } = e.nativeEvent.layout;
            registerSectionWrapperOffset('photos', y);
          }}
          style={{ marginTop: spacing.xl }}
        >
          {/* Header row */}
          <RNView style={s.sectionHeader}>
            <RNView style={s.sectionTitleRow}>
              <Ionicons name="camera-outline" size={18} color={theme.tint} />
              <Text style={[s.sectionTitle, { color: theme.text }]}>Photos</Text>
              <RNView style={s.photoCountPill}>
                <Text style={s.photoCountText}>{profilePhotos.length}/{MAX_PHOTOS}</Text>
              </RNView>
            </RNView>
            <Pressable
              onPress={openPhotoDrawerEditor}
              style={({ pressed }) => [s.sectionLink, pressed && { opacity: 0.8 }]}
            >
              <Text style={[s.sectionLinkText, { color: theme.tint }]}>Manage</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.tint} />
            </Pressable>
          </RNView>

          {profilePhotos.length < 4 && (
            <Text style={[s.photoSubtitle, { color: theme.textSecondary }]}>
              Your first photo leads every first impression.
            </Text>
          )}

          {/* Editorial masonry grid */}
          {(() => {
              const renderSlot = (index: number) => {
              const url = profilePhotos[index] ?? null;
              const isMain = index === 0;
              return (
                <RNView
                  key={`photo-${index}`}
                  ref={(r) => {
                    photoEmptySlotRefs.current[index] = r;
                  }}
                  collapsable={false}
                  style={{ flex: 1 }}
                >
                  <Pressable
                    onPress={
                      url
                        ? () => setPhotoViewerIndex(index)
                        : () => {
                            photoEmptySlotRefs.current[index]?.measureInWindow((x, y, width, height) => {
                              setPhotoSourceMenu({
                                open: true,
                                anchor: { x, y, width, height },
                              });
                            });
                          }
                    }
                    style={[
                      s.pgSlot,
                      { flex: 1 },
                      url && { borderWidth: 0, borderColor: 'transparent', borderStyle: 'solid' },
                    ]}
                  >
                    {url ? (
                      <>
                        <Image source={{ uri: deckCardUrl(url) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                        {isMain && (
                          <RNView style={s.photoMainBadge}>
                            <Text style={s.photoMainBadgeCrown}>👑</Text>
                            <Text style={s.photoMainBadgeText}>Main</Text>
                          </RNView>
                        )}
                      </>
                    ) : (
                      <RNView style={s.pgEmptyInner}>
                        <Ionicons name="add" size={24} color="rgba(255,255,255,0.3)" />
                        <Text style={s.pgEmptyLabel}>Add</Text>
                      </RNView>
                    )}
                  </Pressable>
                </RNView>
              );
            };

            return (
              <RNView
                ref={setSectionCardRef('photos')}
                collapsable={false}
                onLayout={(e) => {
                  const { y, height } = e.nativeEvent.layout;
                  registerSectionCardLayout('photos', y, height);
                }}
              >
                {/* Row 1 */}
                <RNView style={{ flexDirection: 'row', gap: 8, height: 240 }}>
                  <RNView style={{ flex: 3 }}>{renderSlot(0)}</RNView>
                  <RNView style={{ flex: 2, gap: 8 }}>
                    {renderSlot(1)}
                    {renderSlot(2)}
                  </RNView>
                </RNView>
                {/* Row 2 */}
                <RNView style={{ flexDirection: 'row', gap: 8, height: 120, marginTop: 8 }}>
                  {renderSlot(3)}
                  {renderSlot(4)}
                  {renderSlot(5)}
                </RNView>
              </RNView>
            );
          })()}
        </RNView>

        {/* ═══ Section 6: Conversation Starters ═══ */}
        <RNView
          onLayout={(e) => {
            const { y } = e.nativeEvent.layout;
            registerSectionWrapperOffset('prompts', y);
          }}
          style={{ marginTop: spacing.xl }}
        >
          <RNView style={s.sectionHeader}>
            <RNView style={s.sectionTitleRow}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.tint} />
              <Text style={[s.sectionTitle, { color: theme.text }]}>Conversation Starters</Text>
            </RNView>
          </RNView>

          {(() => {
            const MAX_PROMPTS = 3;
            const list = profile?.prompts ?? [];

            const slots = [...list];
            while (slots.length < MAX_PROMPTS) slots.push({ question: '', answer: '' });
            const displaySlots = slots.slice(0, MAX_PROMPTS);

            const openSlot = (index: number) => {
              const slot = displaySlots[index] ?? { question: '', answer: '' };
              const filled = !!(slot.question?.trim() && slot.answer?.trim());
              setPromptSheetMode(filled ? 'edit' : 'add');
              setPromptEditIndex(index);
              setShowPromptSheet(true);
            };

            return (
              <RNView
                ref={setSectionCardRef('prompts')}
                collapsable={false}
                style={{ gap: spacing.md }}
                onLayout={(e) => {
                  const { y, height } = e.nativeEvent.layout;
                  registerSectionCardLayout('prompts', y, height);
                }}
              >
                {displaySlots.map((slot, index) => {
                  const answerTrim = slot.answer?.trim() ?? '';
                  const filled = !!(slot.question?.trim() && answerTrim);

                  if (!filled) {
                    return (
                      <Pressable
                        key={`empty-${index}`}
                        onPress={() => openSlot(index)}
                        style={({ pressed }) => [
                          s.promptEmptyCard,
                          {
                            borderStyle: 'dashed',
                            borderColor: 'rgba(255,255,255,0.12)',
                            backgroundColor: 'rgba(255,255,255,0.03)',
                          },
                          pressed && { opacity: 0.92 },
                        ]}
                      >
                        <Text style={{ fontSize: 28 }}>💬</Text>
                        <Text style={[s.promptEmptyText, { color: theme.textSecondary }]}>
                          Tap to add your answer...
                        </Text>
                      </Pressable>
                    );
                  }

                  const emoji = PROMPT_EMOJIS[slot.question] ?? '💭';
                  return (
                    <Pressable
                      key={`prompt-${index}-${slot.question}`}
                      onPress={() => openSlot(index)}
                      style={({ pressed }) => [
                        s.promptCard,
                        { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder },
                        pressed && { opacity: 0.96 },
                      ]}
                    >
                      <RNView style={s.promptGradientAccent}>
                        <LinearGradient
                          colors={['#8B5CF6', '#E84393']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 0, y: 1 }}
                          style={StyleSheet.absoluteFill}
                        />
                      </RNView>
                      <RNView style={s.promptCardInner}>
                        <RNView style={s.promptCardTopRow}>
                          <RNView style={s.promptCardTitleRow}>
                            <Text style={{ fontSize: 18, marginTop: 2 }}>{emoji}</Text>
                            <Text style={[s.promptCardQuestion, { color: theme.textSecondary }]} numberOfLines={3}>
                              {slot.question}
                            </Text>
                          </RNView>
                          <Ionicons name="pencil-outline" size={18} color={theme.textSecondary} />
                        </RNView>
                        <Text style={[s.promptCardAnswer, { color: theme.text }]}>{answerTrim}</Text>
                        <RNView style={s.promptCardFooter}>
                          <Ionicons name="chatbubble-ellipses-outline" size={14} color={theme.tint} />
                          <Text style={[s.promptCardFooterLabel, { color: theme.textSecondary }]}>
                            Conversation starter
                          </Text>
                        </RNView>
                      </RNView>
                    </Pressable>
                  );
                })}
              </RNView>
            );
          })()}

          {filledPromptCount < 2 && (
            <Text style={[s.coachingHint, { color: theme.textSecondary }]}>
              Great prompts lead to better conversations. Add at least 2!
            </Text>
          )}
        </RNView>

        {/* ═══ Section 7: Looking For ═══ */}
        <RNView
          onLayout={(e) => {
            const { y } = e.nativeEvent.layout;
            registerSectionWrapperOffset('lookingFor', y);
          }}
          style={{ marginTop: spacing.xl }}
        >
          <RNView
            ref={setSectionCardRef('lookingFor')}
            collapsable={false}
            onLayout={(e) => {
              const { y, height } = e.nativeEvent.layout;
              registerSectionCardLayout('lookingFor', y, height);
            }}
          >
          <Card variant="glass">
            <RNView style={s.sectionHeader}>
              <RNView style={s.sectionTitleRow}>
                <Ionicons name="flag-outline" size={18} color={theme.tint} />
                <Text style={[s.sectionTitle, { color: theme.text }]}>Looking For</Text>
              </RNView>
              <Pressable onPress={() => setShowIntentDrawer(true)} style={({ pressed }) => [s.sectionLink, pressed && { opacity: 0.8 }]}>
                <Text style={[s.sectionLinkText, { color: theme.tint }]}>Edit</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.tint} />
              </Pressable>
            </RNView>

            {lookingForDisplay ? (
              <RNView style={[s.intentChip, { backgroundColor: theme.tintSoft, borderColor: theme.border }]}>
                <Text style={{ fontSize: 18 }}>{lookingForDisplay.emoji}</Text>
                <Text style={[s.intentChipLabel, { color: theme.text }]}>{lookingForDisplay.label}</Text>
              </RNView>
            ) : (
              <Text style={[s.helperText, { color: theme.textSecondary }]}>
                Be upfront. It saves everyone time.
              </Text>
            )}

            <RNView style={s.meetingPrefRow}>
              <Text style={[s.meetingPrefLabel, { color: theme.textSecondary }]}>Open to:</Text>
              {(['events', 'dates', 'both'] as const).map((opt) => {
                const labels = { events: 'Events', dates: '1:1 Dates', both: 'Both' };
                const isActive = storedMeetingPref === opt;
                return (
                  <RNView
                    key={opt}
                    style={[
                      s.meetingPrefPill,
                      {
                        backgroundColor: isActive ? 'rgba(139,92,246,0.2)' : theme.surfaceSubtle,
                        borderColor: isActive ? 'rgba(139,92,246,0.5)' : theme.border,
                      },
                    ]}
                  >
                    <Text style={[s.meetingPrefPillText, { color: isActive ? '#8B5CF6' : theme.textSecondary }]}>
                      {labels[opt]}
                    </Text>
                  </RNView>
                );
              })}
            </RNView>
          </Card>
          </RNView>
        </RNView>

        {/* ═══ Section 8: About Me ═══ */}
        <RNView
          onLayout={(e) => {
            const { y } = e.nativeEvent.layout;
            registerSectionWrapperOffset('about', y);
          }}
          style={{ marginTop: spacing.xl }}
        >
          <RNView
            ref={setSectionCardRef('about')}
            collapsable={false}
            onLayout={(e) => {
              const { y, height } = e.nativeEvent.layout;
              registerSectionCardLayout('about', y, height);
            }}
          >
            <Card variant="glass">
              <RNView style={s.sectionHeader}>
                <Text style={[s.sectionTitle, { color: theme.text, marginLeft: 0 }]}>About Me</Text>
                <Pressable
                  onPress={() => {
                    setAboutMeEdit((profile?.about_me ?? '').slice(0, MAX_ABOUT_ME_LENGTH));
                    setShowBioDrawer(true);
                  }}
                  style={({ pressed }) => [s.sectionLink, pressed && { opacity: 0.8 }]}
                >
                  <Text style={[s.sectionLinkText, { color: theme.tint }]}>Edit</Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.tint} />
                </Pressable>
              </RNView>
              <Text style={[s.bioText, { color: profile?.about_me ? theme.textSecondary : theme.mutedForeground }]}>
                {profile?.about_me || 'Tell potential matches about yourself...'}
              </Text>
              <Text style={[s.bioCharCount, { color: theme.textSecondary }]}>
                {(profile?.about_me ?? '').length}/140
              </Text>
            </Card>
          </RNView>
        </RNView>

        {/* ═══ Section 9: My Vibes ═══ */}
        <RNView
          style={{ marginTop: spacing.xl }}
          onLayout={(e) => {
            sectionOffsets.current['vibes'] = e.nativeEvent.layout.y;
          }}
        >
          <Card variant="glass">
            <RNView style={s.sectionHeader}>
              <RNView style={s.sectionTitleRow}>
                <Ionicons name="sparkles-outline" size={18} color={theme.tint} />
                <Text style={[s.sectionTitle, { color: theme.text }]}>My Vibes</Text>
              </RNView>
              <Pressable onPress={() => setShowVibePicker(true)} style={({ pressed }) => [s.sectionLink, pressed && { opacity: 0.8 }]}>
                <Text style={[s.sectionLinkText, { color: theme.tint }]}>Edit</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.tint} />
              </Pressable>
            </RNView>
            {profile?.vibes && profile.vibes.length > 0 ? (
              <RNView style={s.vibesWrap}>
                {profile.vibes.map((v) => {
                  const em = getEmojiForVibeLabel(v);
                  return (
                    <RNView
                      key={v}
                      style={[s.vibeChip, { backgroundColor: 'rgba(139,92,246,0.15)', borderColor: 'rgba(139,92,246,0.35)' }]}
                    >
                      <Text style={[s.vibeChipText, { color: theme.text }]}>
                        {em ? `${em} ` : ''}
                        {v}
                      </Text>
                    </RNView>
                  );
                })}
              </RNView>
            ) : (
              <RNView style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg }}>
                <Text style={[s.helperText, { color: theme.textSecondary }]}>
                  Add vibes to show your personality!
                </Text>
              </RNView>
            )}
          </Card>
        </RNView>

        {/* ═══ Section 10: Vibe Schedule ═══ */}
        <RNView
          onLayout={(e) => {
            const { y } = e.nativeEvent.layout;
            registerSectionWrapperOffset('schedule', y);
          }}
          style={{ marginTop: spacing.xl }}
        >
          <RNView
            ref={setSectionCardRef('schedule')}
            collapsable={false}
            onLayout={(e) => {
              const { y, height } = e.nativeEvent.layout;
              registerSectionCardLayout('schedule', y, height);
            }}
          >
          <Card variant="glass">
            <RNView style={s.sectionHeader}>
              <RNView style={s.sectionTitleRow}>
                <Ionicons name="calendar-outline" size={18} color={theme.tint} />
                <Text style={[s.sectionTitle, { color: theme.text }]}>Vibe Schedule</Text>
              </RNView>
              <Pressable onPress={() => router.push('/schedule')} style={({ pressed }) => [s.sectionLink, pressed && { opacity: 0.8 }]}>
                <Text style={[s.sectionLinkText, { color: theme.tint }]}>Edit</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.tint} />
              </Pressable>
            </RNView>

            {/* Status line */}
            <RNView style={s.scheduleStatusRow}>
              <RNView style={[s.scheduleStatusDot, { backgroundColor: scheduleStatus.color }]} />
              <Text style={[s.scheduleStatusText, { color: theme.text }]}>{scheduleStatus.label}</Text>
            </RNView>

            {/* 14-day scrollable mini-grid */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}
            >
              {scheduleDays.map((day) => (
                <RNView key={day.isoDate} style={s.scheduleDayCol}>
                  <Text style={[s.scheduleDayLabel, {
                    color: day.isToday ? '#8B5CF6' : theme.textSecondary,
                    fontFamily: day.isToday ? fonts.bodyBold : fonts.body,
                  }]}>
                    {day.weekdayShort.charAt(0)}
                  </Text>
                  <Text style={[s.scheduleDateNum, {
                    color: day.isToday ? '#8B5CF6' : theme.text,
                    fontFamily: day.isToday ? fonts.bodyBold : fonts.bodyMedium,
                  }]}>
                    {day.dayNumber}
                  </Text>
                  <RNView style={{ gap: 3, marginTop: 6 }}>
                    {BUCKETS.map((bucket) => {
                      const open = isSlotOpen(day.isoDate, bucket);
                      return (
                        <RNView
                          key={bucket}
                          style={[
                            s.scheduleSlotDot,
                            {
                              backgroundColor: open ? '#0D9488' : 'rgba(255,255,255,0.1)',
                              borderWidth: open ? 0 : 1,
                              borderColor: 'rgba(255,255,255,0.06)',
                            },
                          ]}
                        />
                      );
                    })}
                  </RNView>
                </RNView>
              ))}
            </ScrollView>

            {scheduleStatus.color === '#6B7280' && (
              <Text style={[s.helperText, { color: theme.textSecondary, marginTop: spacing.md }]}>
                Set when you're open for dates
              </Text>
            )}
          </Card>
          </RNView>
        </RNView>

        {/* ═══ Section 11: Details (Basics + Lifestyle) ═══ */}
        <RNView
          onLayout={(e) => {
            const { y } = e.nativeEvent.layout;
            registerSectionWrapperOffset('details', y);
          }}
          style={{ marginTop: spacing.xl }}
        >
          <RNView
            ref={setSectionCardRef('details')}
            collapsable={false}
            onLayout={(e) => {
              const { y, height } = e.nativeEvent.layout;
              registerSectionCardLayout('details', y, height);
            }}
          >
            <Card variant="glass">
              <RNView style={s.sectionHeader}>
                <Text style={[s.sectionTitle, { color: theme.text, marginLeft: 0 }]}>Details</Text>
                <Pressable onPress={() => setShowDetailsDrawer(true)} style={({ pressed }) => [s.sectionLink, pressed && { opacity: 0.8 }]}>
                  <Text style={[s.sectionLinkText, { color: theme.tint }]}>Edit</Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.tint} />
                </Pressable>
              </RNView>

              {/* The Basics: 2×2 grid */}
              <RNView style={s.basicsGrid}>
              {([
                { icon: 'calendar-outline' as const, label: 'Birthday', value: formatBirthdayUsWithZodiac(profile?.birth_date) },
                { icon: 'briefcase-outline' as const, label: 'Work', value: profile?.job?.trim() || 'Not set' },
                { icon: 'resize-outline' as const, label: 'Height', value: profile?.height_cm ? `${profile.height_cm} cm` : 'Not set' },
                { icon: 'location-outline' as const, label: 'Location', value: profile?.location?.trim() || 'Not set' },
              ] as const).map((item) => (
                <RNView key={item.label} style={[s.basicCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
                  <RNView style={s.basicCardTopRow}>
                    <Ionicons name={item.icon} size={14} color={theme.textSecondary} />
                    <Text style={[s.basicCardLabel, { color: theme.textSecondary }]}>{item.label}</Text>
                  </RNView>
                  <Text style={[s.basicCardValue, { color: theme.text }]} numberOfLines={2}>{item.value}</Text>
                </RNView>
              ))}
            </RNView>

            {/* Lifestyle chips */}
            {profile?.lifestyle && Object.keys(profile.lifestyle).filter(k => k !== 'meeting_preference').length > 0 && (
              <RNView style={{ marginTop: spacing.lg }}>
                <LifestyleDetailsSection values={profile.lifestyle} editable={false} />
              </RNView>
            )}
            </Card>
          </RNView>
        </RNView>

        {/* ═══ Section 12: Verification ═══ */}
        <RNView
          onLayout={(e) => {
            const { y } = e.nativeEvent.layout;
            registerSectionWrapperOffset('verification', y);
          }}
          style={{ marginTop: spacing.xl }}
        >
          <RNView
            ref={setSectionCardRef('verification')}
            collapsable={false}
            onLayout={(e) => {
              const { y, height } = e.nativeEvent.layout;
              registerSectionCardLayout('verification', y, height);
            }}
          >
          <Card variant="glass">
            <RNView style={s.verificationHeaderRow}>
              <RNView style={s.verificationTitleLeft}>
                <Ionicons name="shield-checkmark-outline" size={20} color={VERIFICATION_SHIELD} />
                <Text style={[s.verificationTitle, { color: theme.text }]}>Verification</Text>
              </RNView>
              <Text style={[s.verificationCountLabel, { color: theme.textSecondary }]}>
                {verificationVerifiedCount}/{verificationStepTotal} complete
              </Text>
            </RNView>

            <RNView style={s.verificationProgressTrack}>
              <RNView style={[s.verificationProgressFill, { width: `${verificationProgressPct}%` }]}>
                <LinearGradient
                  colors={[...VERIFICATION_GRADIENT]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
              </RNView>
            </RNView>

            <RNView style={s.verificationCardsWrap}>
              {/* Email */}
              {emailVerified ? (
                <RNView style={[s.verificationCard, { borderColor: 'rgba(13,148,136,0.3)', backgroundColor: 'rgba(13,148,136,0.1)' }]}>
                  <RNView style={[s.verificationIconSquare, { backgroundColor: 'rgba(13,148,136,0.2)' }]}>
                    <Ionicons name="mail-outline" size={20} color={VERIFICATION_TEAL} />
                  </RNView>
                  <RNView style={s.verificationCardText}>
                    <Text style={[s.verificationCardTitle, { color: theme.text }]}>Email verification</Text>
                    <Text style={[s.verificationCardSubtitle, { color: theme.textSecondary }]}>Current account email verified</Text>
                  </RNView>
                  <RNView style={s.verificationTealCheck}><Ionicons name="checkmark" size={14} color="#fff" /></RNView>
                </RNView>
              ) : (
                <Pressable
                  onPress={() => {
                    if (!hasAccountEmail) {
                      show({
                        title: 'Add an email first',
                        message: 'Add an account email before you verify it on your profile.',
                        variant: 'warning',
                        primaryAction: { label: 'OK', onPress: () => {} },
                      });
                      return;
                    }
                    setShowEmailVerify(true);
                  }}
                  style={({ pressed }) => [s.verificationCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }, pressed && { opacity: 0.85 }]}
                >
                  <RNView style={[s.verificationIconSquare, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                    <Ionicons name="mail-outline" size={20} color={theme.textSecondary} />
                  </RNView>
                  <RNView style={s.verificationCardText}>
                    <Text style={[s.verificationCardTitle, { color: theme.text }]}>Email verification</Text>
                    <Text style={[s.verificationCardSubtitle, { color: hasAccountEmail ? theme.tint : theme.textSecondary }]}>
                      {hasAccountEmail ? 'Verify your current email' : 'Add an email to your account first'}
                    </Text>
                  </RNView>
                  <Ionicons name="chevron-forward" size={20} color={hasAccountEmail ? theme.tint : theme.textSecondary} />
                </Pressable>
              )}

              {/* Photo */}
              {photoVerificationState === 'approved' ? (
                <RNView style={[s.verificationCard, { borderColor: 'rgba(13,148,136,0.3)', backgroundColor: 'rgba(13,148,136,0.1)' }]}>
                  <RNView style={[s.verificationIconSquare, { backgroundColor: 'rgba(13,148,136,0.2)' }]}>
                    <Ionicons name="camera-outline" size={20} color={VERIFICATION_TEAL} />
                  </RNView>
                  <RNView style={s.verificationCardText}>
                    <Text style={[s.verificationCardTitle, { color: theme.text }]}>Photo verification</Text>
                    <Text style={[s.verificationCardSubtitle, { color: theme.textSecondary }]}>Verified</Text>
                  </RNView>
                  <RNView style={s.verificationTealCheck}><Ionicons name="checkmark" size={14} color="#fff" /></RNView>
                </RNView>
              ) : photoVerificationState === 'pending' ? (
                <Pressable
                  onPress={() =>
                    show({
                      title: 'Under review',
                      message: 'Your selfie is currently under review. We’ll update your badge when approved.',
                      variant: 'info',
                      primaryAction: { label: 'OK', onPress: () => {} },
                    })
                  }
                  style={({ pressed }) => [s.verificationCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }, pressed && { opacity: 0.85 }]}
                >
                  <RNView style={[s.verificationIconSquare, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                    <Ionicons name="camera-outline" size={20} color={theme.textSecondary} />
                  </RNView>
                  <RNView style={s.verificationCardText}>
                    <Text style={[s.verificationCardTitle, { color: theme.text }]}>Photo verification</Text>
                    <Text style={[s.verificationCardSubtitle, { color: theme.textSecondary }]}>Under review</Text>
                  </RNView>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => {
                    if (!profile?.photos?.[0]) {
                      show({
                        title: 'Add a profile photo first',
                        message: 'Please add a profile photo before submitting selfie verification.',
                        variant: 'warning',
                        primaryAction: { label: 'OK', onPress: () => {} },
                      });
                      return;
                    }
                    setShowPhotoVerify(true);
                  }}
                  style={({ pressed }) => [s.verificationCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }, pressed && { opacity: 0.85 }]}
                >
                  <RNView style={[s.verificationIconSquare, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                    <Ionicons name="camera-outline" size={20} color={theme.textSecondary} />
                  </RNView>
                  <RNView style={s.verificationCardText}>
                    <Text style={[s.verificationCardTitle, { color: theme.text }]}>Photo verification</Text>
                    <Text style={[s.verificationCardSubtitle, { color: theme.tint }]}>
                      {photoVerificationState === 'rejected'
                        ? 'Declined — try again'
                        : photoVerificationState === 'expired'
                          ? 'Expired — re-verify'
                          : 'Verify'}
                    </Text>
                  </RNView>
                  <Ionicons name="chevron-forward" size={20} color={theme.tint} />
                </Pressable>
              )}

              {/* Phone */}
              {profile?.phone_verified ? (
                <RNView style={[s.verificationCard, { borderColor: 'rgba(13,148,136,0.3)', backgroundColor: 'rgba(13,148,136,0.1)' }]}>
                  <RNView style={[s.verificationIconSquare, { backgroundColor: 'rgba(13,148,136,0.2)' }]}>
                    <Ionicons name="call-outline" size={20} color={VERIFICATION_TEAL} />
                  </RNView>
                  <RNView style={s.verificationCardText}>
                    <Text style={[s.verificationCardTitle, { color: theme.text }]}>Phone number</Text>
                    <Text style={[s.verificationCardSubtitle, { color: theme.textSecondary }]}>Verified</Text>
                  </RNView>
                  <RNView style={s.verificationTealCheck}><Ionicons name="checkmark" size={14} color="#fff" /></RNView>
                </RNView>
              ) : (
                <Pressable onPress={() => setShowPhoneVerify(true)} style={({ pressed }) => [s.verificationCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }, pressed && { opacity: 0.85 }]}>
                  <RNView style={[s.verificationIconSquare, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                    <Ionicons name="call-outline" size={20} color={theme.textSecondary} />
                  </RNView>
                  <RNView style={s.verificationCardText}>
                    <Text style={[s.verificationCardTitle, { color: theme.text }]}>Phone number</Text>
                    <Text style={[s.verificationCardSubtitle, { color: theme.tint }]}>Verify your number</Text>
                  </RNView>
                  <Ionicons name="chevron-forward" size={20} color={theme.tint} />
                </Pressable>
              )}
            </RNView>

            {verificationVerifiedCount === verificationStepTotal && (
              <RNView style={[s.verificationSuccessBanner, { backgroundColor: 'rgba(13,148,136,0.15)', borderColor: 'rgba(13,148,136,0.3)' }]}>
                <RNView style={s.verificationSuccessIconCircle}>
                  <Ionicons name="checkmark" size={18} color="#fff" />
                </RNView>
                <Text style={[s.verificationSuccessText, { color: VERIFICATION_SUCCESS_TEXT }]}>
                  {"You're verified! 3x more likely to match."}
                </Text>
              </RNView>
            )}
          </Card>
          </RNView>
        </RNView>

        {/* ═══ Section 13: Bring Friends ═══ */}
        <RNView style={{ marginTop: spacing.xl }}>
          <Pressable
            onPress={() => router.push('/settings/referrals' as Href)}
            style={({ pressed }) => [s.inviteCard, pressed && { opacity: 0.92 }]}
          >
            <LinearGradient
              colors={['rgba(139,92,246,0.15)', 'rgba(232,67,147,0.15)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.inviteCardGradient}
            >
              <RNView style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <RNView style={s.inviteIconCircle}>
                  <Ionicons name="people" size={22} color="#E84393" />
                </RNView>
                <RNView style={{ flex: 1 }}>
                  <Text style={[s.inviteCardTitle, { color: theme.text }]}>Bring Friends to Vibely</Text>
                  <Text style={[s.inviteCardSub, { color: theme.textSecondary }]}>
                    Invite to events, or help friends discover great people
                  </Text>
                </RNView>
                <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
              </RNView>
            </LinearGradient>
          </Pressable>
        </RNView>

        {/* ═══ Logout ═══ */}
        <RNView style={{ marginTop: spacing.lg }}>
          <DestructiveRow
            icon={<Ionicons name="log-out-outline" size={18} color={theme.danger} />}
            label="Log out"
            onPress={() => presentNativeLogoutConfirm(show, logout)}
          />
        </RNView>
      </RNView>

    </ScrollView>

      {/* ═══ Modals & Sheets (outside main ScrollView) ═══
          Nested RN Modals under a vertical ScrollView break touch targeting on some devices
          (stacked Modal for photo drawer + VibelyDialog confirm). Keep overlays as siblings. */}

      {vibeScoreProfile ? (
        <VibeScoreDrawer
          visible={showVibeScoreDrawer}
          onClose={() => setShowVibeScoreDrawer(false)}
          profile={vibeScoreProfile}
          score={vibeScore}
          onAction={handleVibeScoreDrawerAction}
        />
      ) : null}

      <VibePickerSheet
        visible={showVibePicker}
        onClose={() => setShowVibePicker(false)}
        currentVibes={profile?.vibes ?? []}
        onSave={() => {
          void qc.invalidateQueries({ queryKey: ['my-profile'] }).catch((e) => {
            if (__DEV__) console.warn('[ProfileStudio] invalidate my-profile after vibes failed:', e);
          });
        }}
      />

      {/* Photo management drawer */}
      <PhotoManageDrawer
        visible={showPhotoDrawer}
        onClose={() => {
          setShowPhotoDrawer(false);
          setPhotoDrawerLaunchAction(null);
        }}
        photos={profilePhotos}
        launchAction={photoDrawerLaunchAction}
        onPhotosChanged={() => {
          void qc.invalidateQueries({ queryKey: ['my-profile'] }).catch((e) => {
            if (__DEV__) console.warn('[ProfileStudio] invalidate my-profile after photos failed:', e);
          });
        }}
      />

      {/* Fullscreen photo viewer (shared with PhotoManageDrawer runtime) */}
      <PhotoManageDrawer
        visible={photoViewerIndex !== null}
        onClose={() => setPhotoViewerIndex(null)}
        photos={profilePhotos}
        onPhotosChanged={() => {}}
        fullscreenOnly
        initialFullscreenIndex={photoViewerIndex}
      />

      <PromptEditSheet
        visible={showPromptSheet}
        onClose={() => {
          setShowPromptSheet(false);
          setPromptEditIndex(null);
        }}
        mode={promptSheetMode}
        initialQuestion={
          promptEditIndex !== null ? (profile?.prompts?.[promptEditIndex]?.question ?? '') : ''
        }
        initialAnswer={
          promptEditIndex !== null ? (profile?.prompts?.[promptEditIndex]?.answer ?? '') : ''
        }
        onSave={handlePromptCommit}
        onRemove={
          promptSheetMode === 'edit' && promptEditIndex !== null
            ? () => handlePromptRemove(promptEditIndex)
            : undefined
        }
        usedQuestions={usedPromptQuestionsElsewhere}
        saving={saving}
      />

      {/* Intent editor modal — keyboard-aware for parity with other profile sheets */}
      <KeyboardAwareBottomSheetModal
        visible={showIntentDrawer}
        onRequestClose={discardIntentDrawer}
        scrollable={false}
        backdropColor="rgba(0,0,0,0.55)"
      >
        <Text style={[s.sheetTitle, { color: theme.text }]}>Looking For</Text>
        <RelationshipIntentSelector selected={lookingForEdit} onSelect={setLookingForEdit} editable />
        <RNView style={[s.meetingPrefRow, { marginTop: spacing.xl }]}>
          <Text style={[s.meetingPrefLabel, { color: theme.textSecondary }]}>Open to:</Text>
          {(['events', 'dates', 'both'] as const).map((opt) => {
            const labels = { events: 'Events', dates: '1:1 Dates', both: 'Both' };
            const isActive = meetingPref === opt;
            return (
              <Pressable key={opt} onPress={() => setMeetingPref(opt)}>
                <RNView style={[s.meetingPrefPill, { backgroundColor: isActive ? 'rgba(139,92,246,0.2)' : theme.surfaceSubtle, borderColor: isActive ? 'rgba(139,92,246,0.5)' : theme.border }]}>
                  <Text style={[s.meetingPrefPillText, { color: isActive ? '#8B5CF6' : theme.textSecondary }]}>{labels[opt]}</Text>
                </RNView>
              </Pressable>
            );
          })}
        </RNView>
        <RNView style={s.sheetFooter}>
          <Pressable onPress={handleSaveIntent} style={[s.sheetSaveBtn, { opacity: saving ? 0.6 : 1 }]} disabled={saving}>
            <LinearGradient colors={['#8B5CF6', '#E84393']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[StyleSheet.absoluteFill, { borderRadius: 12 }]} />
            <Text style={s.sheetSaveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
          <Pressable onPress={discardIntentDrawer} style={s.sheetCancel}>
            <Text style={[s.sheetCancelText, { color: theme.textSecondary }]}>Cancel</Text>
          </Pressable>
        </RNView>
      </KeyboardAwareBottomSheetModal>

      {/* Bio editor modal */}
      <KeyboardAwareBottomSheetModal
        visible={showBioDrawer}
        onRequestClose={discardBioDrawer}
        backdropColor="rgba(0,0,0,0.55)"
        footer={
          <RNView style={s.sheetFooter}>
            <Pressable onPress={handleSaveBio} style={[s.sheetSaveBtn, { opacity: saving ? 0.6 : 1 }]} disabled={saving}>
              <LinearGradient colors={['#8B5CF6', '#E84393']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[StyleSheet.absoluteFill, { borderRadius: 12 }]} />
              <Text style={s.sheetSaveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
            <Pressable onPress={discardBioDrawer} style={s.sheetCancel}>
              <Text style={[s.sheetCancelText, { color: theme.textSecondary }]}>Cancel</Text>
            </Pressable>
          </RNView>
        }
      >
        <Text style={[s.sheetTitle, { color: theme.text, marginBottom: spacing.xs }]}>About Me</Text>
        <Text style={[s.aboutMeSheetSubtitle, { color: theme.textSecondary }]}>
          You have 3 seconds to make them care. Make it count.
        </Text>
        <TextInput
          value={aboutMeEdit}
          onChangeText={(t) => setAboutMeEdit(t.slice(0, MAX_ABOUT_ME_LENGTH))}
          placeholder="Write something about yourself..."
          placeholderTextColor="rgba(255,255,255,0.45)"
          multiline
          maxLength={MAX_ABOUT_ME_LENGTH}
          style={s.aboutMeSheetInput}
        />
        <Text style={[s.aboutMeSheetCharCount, { color: theme.textSecondary }]}>
          {aboutMeEdit.length}/140
        </Text>
      </KeyboardAwareBottomSheetModal>

      {/* Details editor modal */}
      <KeyboardAwareBottomSheetModal
        visible={showDetailsDrawer}
        onRequestClose={discardDetailsDrawer}
        scrollable={false}
        maxHeightRatio={0.85}
        backdropColor="rgba(0,0,0,0.55)"
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          onStartShouldSetResponder={() => true}
          contentContainerStyle={{ paddingBottom: spacing.lg }}
        >
          <Text style={[s.sheetTitle, { color: theme.text }]}>Edit Details</Text>
          <Text style={[s.detailLabel, { color: theme.textSecondary }]}>Name</Text>
          <RNView style={[s.bioInput, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle, minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md }]}>
            <Text style={{ color: theme.textSecondary, fontSize: 15, fontFamily: fonts.body }}>{nameEdit}</Text>
          </RNView>
          <Text style={[s.detailLabel, { color: theme.textSecondary, marginTop: spacing.md }]}>Birthday</Text>
          <RNView style={[s.bioInput, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle, minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md }]}>
            <Text style={{ color: theme.textSecondary, fontSize: 15, fontFamily: fonts.body }}>
              {formatBirthdayUsWithZodiac(profile?.birth_date) || 'Not set'}
            </Text>
          </RNView>
          <Text style={[s.detailLabel, { color: theme.textSecondary }]}>Job / Role</Text>
          <TextInput
            value={jobEdit}
            onChangeText={setJobEdit}
            placeholder="e.g. Software Engineer"
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={[s.bioInput, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle, color: theme.text, fontSize: 15, fontFamily: fonts.body, minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: 0 }]}
            returnKeyType="next"
          />
          <Text style={[s.detailLabel, { color: theme.textSecondary, marginTop: spacing.md }]}>Height (cm)</Text>
          <TextInput
            value={heightEdit}
            onChangeText={(t) => setHeightEdit(t.replace(/[^0-9]/g, ''))}
            placeholder="e.g. 175"
            placeholderTextColor="rgba(255,255,255,0.35)"
            keyboardType="number-pad"
            maxLength={3}
            style={[s.bioInput, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle, color: theme.text, fontSize: 15, fontFamily: fonts.body, minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: 0 }]}
            returnKeyType="next"
          />
          <Text style={[s.detailLabel, { color: theme.textSecondary, marginTop: spacing.md }]}>Location</Text>
          <RNView style={[s.locationRow, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
            <Ionicons name="location-outline" size={16} color={theme.textSecondary} />
            <Text style={[s.locationRowText, { color: profile?.location ? theme.text : theme.textSecondary }]} numberOfLines={1}>
              {profile?.location?.trim() || 'Location not set'}
            </Text>
            <Pressable
              onPress={handleUpdateDeviceLocation}
              disabled={updatingLocation}
              style={{ opacity: updatingLocation ? 0.55 : 1 }}
            >
              <Text style={{ color: theme.tint, fontSize: 13, fontWeight: '600' }}>
                {updatingLocation ? 'Updating…' : 'Update'}
              </Text>
            </Pressable>
          </RNView>
          <Text style={[s.detailHint, { color: theme.textSecondary }]}>
            Uses your device location. Exact coordinates are never shown publicly.
          </Text>
          <Text style={[s.detailLabel, { color: theme.textSecondary, marginTop: spacing.lg }]}>Lifestyle</Text>
          <LifestyleDetailsSection values={lifestyleEdit} onChange={(key, value) => setLifestyleEdit(prev => ({ ...prev, [key]: value }))} editable />
          <RNView style={s.sheetFooter}>
            <Pressable onPress={handleSaveDetails} style={[s.sheetSaveBtn, { opacity: saving ? 0.6 : 1 }]} disabled={saving}>
              <LinearGradient colors={['#8B5CF6', '#E84393']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[StyleSheet.absoluteFill, { borderRadius: 12 }]} />
              <Text style={s.sheetSaveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
            <Pressable onPress={discardDetailsDrawer} style={s.sheetCancel}>
              <Text style={[s.sheetCancelText, { color: theme.textSecondary }]}>Cancel</Text>
            </Pressable>
          </RNView>
        </ScrollView>
      </KeyboardAwareBottomSheetModal>

      <TaglineEditorSheet
        visible={showTaglineSheet}
        initialTagline={profile?.tagline ?? ''}
        saving={saving}
        onClose={() => setShowTaglineSheet(false)}
        onSave={handleSaveTagline}
      />

      <PhoneVerificationFlow
        visible={showPhoneVerify}
        onClose={() => setShowPhoneVerify(false)}
        initialPhoneE164={profile?.phone_number}
        onVerified={() => {
          qc.invalidateQueries({ queryKey: ['my-profile'] });
        }}
      />
      <EmailVerificationFlow
        visible={showEmailVerify}
        email={resolveCanonicalAuthEmail(user) ?? user?.email ?? ''}
        onClose={() => setShowEmailVerify(false)}
        onVerified={() => { qc.invalidateQueries({ queryKey: ['my-profile'] }); }}
      />
      <PhotoVerificationFlow
        visible={showPhotoVerify}
        onClose={() => setShowPhotoVerify(false)}
        profilePhotoUrl={profile?.photos?.[0] ?? null}
        onSubmissionComplete={() => {
          setPhotoVerificationState('pending');
          void refreshPhotoVerificationState();
          qc.invalidateQueries({ queryKey: ['my-profile'] });
        }}
      />

    <AddPhotoSourcePopover
      visible={photoSourceMenu.open}
      anchor={photoSourceMenu.anchor}
      safeInsets={insets}
      onDismiss={() => setPhotoSourceMenu({ open: false, anchor: null })}
      onPhotoLibrary={() => openPhotoDrawerWithAction('add-many-library')}
      onTakePhoto={() => openPhotoDrawerWithAction('take-one-photo')}
      onChooseFile={() => openPhotoDrawerWithAction('add-many-document')}
      chooseFileSupported={chooseFileSupported}
      useRootModal
    />
    {dialog}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────

const VIEWFINDER_SIZE = 20;
const VIEWFINDER_BORDER = 2;
const VIEWFINDER_COLOR = 'rgba(255,255,255,0.2)';

const s = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Hero Header ──
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  heroIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatarWrap: {
    alignItems: 'center',
    marginTop: -50,
  },
  heroAvatar: {
    width: 100,
    height: 100,
    borderRadius: 14,
    borderWidth: 3,
  },
  heroAvatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroFab: {
    position: 'absolute',
    bottom: -8,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroFabLeft: {
    left: -8,
    backgroundColor: '#06B6D4',
  },
  heroFabRight: {
    right: -8,
    backgroundColor: '#E84393',
  },
  heroIdentity: {
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 20,
  },
  heroNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroName: {
    fontSize: 22,
    fontFamily: fonts.displayBold,
  },
  heroTaglineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  heroTagline: {
    fontSize: 13,
    color: '#8B5CF6',
    fontStyle: 'italic',
    fontFamily: fonts.body,
  },
  heroLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  heroLocationText: {
    fontSize: 12,
    fontFamily: fonts.body,
  },

  vibeScoreHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
    marginBottom: 12,
    paddingHorizontal: layout.containerPadding,
  },
  vibeScorePreviewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 0,
  },
  vibeScorePreviewText: {
    color: '#8B5CF6',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: fonts.bodySemiBold,
  },
  vibeScoreCenterCircle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  vibeScoreCompleteBtn: {
    flex: 1,
    minWidth: 0,
  },
  vibeScoreCompleteBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  vibeScoreCompleteBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.bodyBold,
  },

  // ── Schedule Row ──
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: layout.containerPadding,
    marginTop: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius['2xl'],
    borderWidth: 1,
  },
  scheduleRowTitle: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  scheduleRowSubtitle: {
    fontSize: 12,
    fontFamily: fonts.body,
    marginTop: 2,
  },
  scheduleRowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },

  // ── Counters Row ──
  countersRow: {
    flexDirection: 'row',
    paddingHorizontal: layout.containerPadding,
    gap: 8,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  counterBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  counterValue: {
    fontSize: 20,
    fontFamily: fonts.displayBold,
  },
  counterLabel: {
    fontSize: 11,
    fontFamily: fonts.bodyMedium,
    marginTop: 2,
  },

  // ── Quick Actions (compact pill row) ──
  quickActionsStrip: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  quickActionsContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  quickActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  quickActionPillLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
    fontFamily: fonts.bodyMedium,
  },

  // ── Main content ──
  main: {
    paddingHorizontal: layout.containerPadding,
  },

  // ── Section headers ──
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: fonts.display,
    marginLeft: spacing.sm,
  },
  sectionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sectionLinkText: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },

  // ── Vibe Video (ready state) ──
  videoCard: {
    borderRadius: radius['2xl'],
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
    marginBottom: spacing.md,
  },
  videoThumbnail: {
    ...StyleSheet.absoluteFillObject,
  },
  videoProcessingCard: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingVertical: spacing.xl,
  },
  videoProcessingTitle: {
    fontSize: 16,
    fontFamily: fonts.display,
    textAlign: 'center',
    marginTop: 4,
  },
  videoProcessingSubtitle: {
    fontSize: 13,
    fontFamily: fonts.body,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  videoStudioHint: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    marginTop: 2,
  },
  videoErrorCard: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoErrorCardInner: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.lg,
    zIndex: 2,
  },
  videoErrorTitle: {
    color: '#fff',
    fontSize: 16,
    fontFamily: fonts.bodyBold,
    textAlign: 'center',
  },
  videoErrorSubtitle: {
    fontSize: 13,
    fontFamily: fonts.body,
    textAlign: 'center',
    maxWidth: 280,
  },
  viewfinderTL: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
    borderTopWidth: VIEWFINDER_BORDER,
    borderLeftWidth: VIEWFINDER_BORDER,
    borderColor: VIEWFINDER_COLOR,
  },
  viewfinderTR: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
    borderTopWidth: VIEWFINDER_BORDER,
    borderRightWidth: VIEWFINDER_BORDER,
    borderColor: VIEWFINDER_COLOR,
  },
  viewfinderBL: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
    borderBottomWidth: VIEWFINDER_BORDER,
    borderLeftWidth: VIEWFINDER_BORDER,
    borderColor: VIEWFINDER_COLOR,
  },
  viewfinderBR: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
    borderBottomWidth: VIEWFINDER_BORDER,
    borderRightWidth: VIEWFINDER_BORDER,
    borderColor: VIEWFINDER_COLOR,
  },
  videoLiveBadge: {
    position: 'absolute',
    top: 12,
    left: 12 + VIEWFINDER_SIZE + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  videoLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
  },
  videoLiveText: {
    fontSize: 9,
    fontFamily: fonts.bodySemiBold,
    letterSpacing: 1.5,
    color: '#22c55e',
  },
  videoPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  videoCaptionStrip: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
  },
  videoCaptionLabel: {
    fontSize: 10,
    fontFamily: fonts.bodySemiBold,
    letterSpacing: 2,
    color: '#06B6D4',
    marginBottom: 4,
  },
  videoCaptionText: {
    fontSize: 14,
    fontFamily: fonts.bodyBold,
    color: '#fff',
  },

  // ── Vibe Video (empty state) ──
  videoEmptyCard: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  videoEmptyTitle: {
    fontSize: 16,
    fontFamily: fonts.display,
  },
  videoEmptySubtitle: {
    fontSize: 13,
    fontFamily: fonts.body,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  videoEmptyCta: {
    borderRadius: 12,
    marginTop: spacing.sm,
  },
  videoEmptyCtaInner: {
    paddingVertical: 12,
    paddingHorizontal: spacing['2xl'],
    alignItems: 'center',
  },
  videoEmptyCtaText: {
    color: '#fff',
    fontFamily: fonts.bodyBold,
    fontSize: 14,
  },

  // ── Photos ──
  photoCountPill: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    marginLeft: 8,
  },
  photoCountText: {
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
    color: 'rgba(255,255,255,0.45)',
  },
  photoSubtitle: {
    fontSize: 13,
    fontFamily: fonts.body,
    marginBottom: spacing.sm,
    marginTop: -2,
  },
  pgSlot: {
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1.5,
    borderColor: 'rgba(139,92,246,0.3)',
    borderStyle: 'dashed',
  },
  pgEmptyInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  pgEmptyLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.25)',
    fontFamily: fonts.body,
  },
  photoMainBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  photoMainBadgeCrown: {
    fontSize: 11,
    lineHeight: 12,
  },
  photoMainBadgeText: {
    fontSize: 10,
    fontFamily: fonts.bodySemiBold,
    color: 'rgba(255,255,255,0.95)',
  },
  photoViewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoViewerImage: {
    width: '100%',
    height: '80%',
  },
  photoViewerClose: {
    position: 'absolute',
    top: 56,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Prompts ──
  promptCard: {
    borderRadius: radius['2xl'],
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  promptGradientAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    zIndex: 0,
  },
  promptCardInner: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    paddingLeft: 19,
    zIndex: 1,
  },
  promptCardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  promptCardTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  promptCardQuestion: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
    flex: 1,
  },
  promptCardAnswer: {
    fontSize: 16,
    lineHeight: 24,
    marginTop: spacing.sm,
    fontFamily: fonts.bodySemiBold,
  },
  promptCardAnswerPlaceholder: {
    fontSize: 15,
    fontStyle: 'italic',
    marginTop: spacing.sm,
    fontFamily: fonts.body,
  },
  promptCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  promptCardFooterLabel: {
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
  },
  promptEmptyCard: {
    borderWidth: 1,
    borderRadius: radius['2xl'],
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  promptEmptyText: {
    fontSize: 15,
    textAlign: 'center',
    fontFamily: fonts.body,
  },
  coachingHint: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: spacing.md,
    fontFamily: fonts.body,
  },

  // ── Looking For ──
  intentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.xl,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  intentChipLabel: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
  },
  helperText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.body,
  },
  meetingPrefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    flexWrap: 'wrap',
  },
  meetingPrefLabel: {
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
    marginRight: 4,
  },
  meetingPrefPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  meetingPrefPillText: {
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
  },

  // ── Bio ──
  bioText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.body,
  },
  bioCharCount: {
    fontSize: 13,
    textAlign: 'right',
    marginTop: spacing.xs,
    fontFamily: fonts.body,
  },
  aboutMeSheetSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.body,
    textAlign: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  aboutMeSheetInput: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 16,
    color: '#FFFFFF',
    fontSize: 15,
    minHeight: 120,
    fontFamily: fonts.body,
    textAlignVertical: 'top',
  },
  aboutMeSheetCharCount: {
    fontSize: 13,
    textAlign: 'right',
    marginTop: spacing.xs,
    fontFamily: fonts.body,
  },
  bioInput: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },

  // ── Vibes ──
  vibesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  vibeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  vibeChipText: {
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
  },

  // ── Schedule ──
  scheduleStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing.md,
  },
  scheduleStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  scheduleStatusText: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  scheduleDayCol: {
    alignItems: 'center',
    width: 36,
  },
  scheduleDayLabel: {
    fontSize: 11,
  },
  scheduleDateNum: {
    fontSize: 13,
    marginTop: 2,
  },
  scheduleSlotDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // ── Basics grid ──
  basicsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  basicCard: {
    width: '48%',
    padding: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  basicCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  basicCardLabel: {
    fontSize: 11,
    fontFamily: fonts.body,
  },
  basicCardValue: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    marginTop: 4,
  },

  // ── Verification ──
  verificationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  verificationTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  verificationTitle: {
    fontSize: 18,
    fontFamily: fonts.displayBold,
  },
  verificationCountLabel: {
    fontSize: 14,
    fontFamily: fonts.body,
  },
  verificationProgressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginTop: 12,
    overflow: 'hidden',
  },
  verificationProgressFill: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  verificationCardsWrap: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  inviteCard: {
    borderRadius: radius['2xl'],
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.25)',
  },
  inviteCardGradient: {
    padding: spacing.lg,
  },
  inviteIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(232,67,147,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteCardTitle: {
    fontSize: 16,
    fontFamily: fonts.displayBold,
  },
  inviteCardSub: {
    fontSize: 13,
    fontFamily: fonts.body,
    marginTop: 4,
    lineHeight: 18,
  },
  verificationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  verificationIconSquare: {
    width: 40,
    height: 40,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verificationCardText: {
    flex: 1,
    minWidth: 0,
  },
  verificationCardTitle: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  verificationCardSubtitle: {
    fontSize: 12,
    marginTop: 2,
    fontFamily: fonts.body,
  },
  verificationTealCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#0D9488',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verificationSuccessBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: spacing.md,
  },
  verificationSuccessIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#0D9488',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verificationSuccessText: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
    flex: 1,
  },

  // ── Detail editor ──
  detailLabel: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  locationRowText: {
    flex: 1,
    fontSize: 15,
    fontFamily: fonts.body,
  },
  detailHint: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 17,
  },

  // ── Sheet shared ──
  sheetFooter: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  sheetSaveBtn: {
    alignSelf: 'stretch',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sheetSaveBtnText: {
    color: '#fff',
    fontFamily: fonts.bodyBold,
    fontSize: 15,
  },

  // ── Video Manage Sheet ──
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheetContent: {
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderWidth: 1,
    paddingTop: spacing.md,
    paddingBottom: spacing['2xl'],
    paddingHorizontal: spacing.lg,
  },
  sheetTitle: {
    fontSize: 18,
    fontFamily: fonts.displayBold,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  sheetRowLabel: {
    fontSize: 16,
    fontFamily: fonts.bodySemiBold,
  },
  sheetCancel: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  sheetCancelText: {
    fontSize: 16,
    fontFamily: fonts.bodySemiBold,
  },
});
