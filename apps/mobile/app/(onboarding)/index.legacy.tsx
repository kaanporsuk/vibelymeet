// LEGACY FILE — preserved for rollback.
// To rollback: rename this file back to its original name.

import { useState } from 'react';
import {
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  View as RNView,
  Image,
  ActivityIndicator,
  Linking,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { createProfile, syncProfileVibes } from '@/lib/profileApi';
import { VIBE_TAXONOMY } from '@/lib/vibeTagTaxonomy';
import { trackEvent } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import { uploadProfilePhoto } from '@/lib/uploadImage';
import { getImageUrl } from '@/lib/imageUrl';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { VibelyButton, Card } from '@/components/ui';
import { spacing, radius } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { useVibelyDialog } from '@/components/VibelyDialog';

function calculateAge(day: number, month: number, year: number): number {
  const today = new Date();
  const birthDate = new Date(year, month - 1, day);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

function isValidDateOfBirth(day: number, month: number, year: number): boolean {
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return false;
  if (year < 1900 || year > new Date().getFullYear()) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day;
}

const GENDERS = [
  { label: 'Woman', value: 'woman' },
  { label: 'Man', value: 'man' },
  { label: 'Non-binary', value: 'non-binary' },
  { label: 'Other', value: 'other' },
];

/** Six user-facing steps: indices 0–5 (final step includes submit). */
const TOTAL_STEPS = 6;
const MAX_ONBOARDING_PHOTOS = 6;

const WEB_PROFILE_URL = 'https://vibelymeet.com/profile';

const INTENT_OPTIONS = [
  { value: 'long_term', label: 'Long-term relationship', emoji: '💕' },
  { value: 'short_term', label: 'Short-term / casual', emoji: '🌶️' },
  { value: 'friends', label: 'New friends', emoji: '🤝' },
  { value: 'not_sure', label: 'Not sure yet', emoji: '🤷' },
];

export default function OnboardingScreen() {
  const theme = Colors[useColorScheme()];
  const { refreshOnboarding } = useAuth();
  const { show, dialog } = useVibelyDialog();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [dobDay, setDobDay] = useState('');
  const [dobMonth, setDobMonth] = useState('');
  const [dobYear, setDobYear] = useState('');
  const [ageBlocked, setAgeBlocked] = useState(false);
  const [gender, setGender] = useState('');
  const [tagline, setTagline] = useState('');
  const [job, setJob] = useState('');
  const [aboutMe, setAboutMe] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedVibeLabels, setSelectedVibeLabels] = useState<string[]>([]);
  const [relationshipIntent, setRelationshipIntent] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');

  const dobFilled = dobDay.length > 0 && dobMonth.length > 0 && dobYear.length === 4;
  const d = dobFilled ? Number(dobDay) : NaN;
  const m = dobFilled ? Number(dobMonth) : NaN;
  const y = dobFilled ? Number(dobYear) : NaN;
  const dobValid = dobFilled && isValidDateOfBirth(d, m, y);
  const dobAge = dobValid ? calculateAge(d, m, y) : null;
  const step1AgeOk = dobAge !== null && dobAge >= 18;
  const aboutMeTrim = aboutMe.trim();
  const aboutMeValid = aboutMeTrim.length === 0 || aboutMeTrim.length >= 10;

  const canNext =
    step === 0
      ? true
      : step === 1
        ? name.trim().length >= 2 && dobFilled && dobValid && step1AgeOk
        : step === 2
          ? true
          : step === 3
            ? selectedVibeLabels.length >= 3 && selectedVibeLabels.length <= 5
            : step === 4
              ? !!relationshipIntent
              : step === 5
              ? !!(
                  name.trim() &&
                  gender &&
                  dobFilled &&
                  dobValid &&
                  step1AgeOk &&
                  aboutMeValid
                )
              : false;
  const detailsComplete =
    !!(
      name.trim() &&
      gender &&
      dobFilled &&
      dobValid &&
      step1AgeOk &&
      aboutMeValid
    );
  const canSubmit = step === 5 && detailsComplete && !loading && !uploadingPhoto;

  const handleNext = () => {
    if (step === 0) setStep(1);
    else if (step === 1) {
      if (!(dobDay && dobMonth && dobYear)) return;
      const day = Number(dobDay);
      const month = Number(dobMonth);
      const year = Number(dobYear);
      if (!isValidDateOfBirth(day, month, year)) return;
      const age = calculateAge(day, month, year);
      if (age < 18) {
        setAgeBlocked(true);
        return;
      }
      if (name.trim().length >= 2) setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else if (step === 3 && selectedVibeLabels.length >= 3 && selectedVibeLabels.length <= 5) {
      setStep(4);
    } else if (step === 4 && relationshipIntent) {
      setStep(5);
    }
  };

  const pickAndUploadPhoto = async () => {
    if (photos.length >= MAX_ONBOARDING_PHOTOS || uploadingPhoto) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      show({
        title: 'Photos need access',
        message: 'Allow your photo library so you can add profile photos.',
        variant: 'info',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setUploadingPhoto(true);
    try {
      const path = await uploadProfilePhoto({
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'image/jpeg',
        fileName: `onboarding_${Date.now()}.jpg`,
      });
      setPhotos((prev: string[]) => (prev.length >= MAX_ONBOARDING_PHOTOS ? prev : [...prev, path]));
    } catch {
      show({
        title: 'Upload didn’t work',
        message: 'Please try again in a moment.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      let parsedHeight: number | undefined;
      if (heightCm) {
        const h = Number(heightCm);
        if (!Number.isFinite(h) || !Number.isInteger(h) || h < 100 || h > 250) {
          show({
            title: 'Check your height',
            message: 'Enter a height between 100 and 250 cm, or leave it blank.',
            variant: 'warning',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          return;
        }
        parsedHeight = h;
      }
      const birth_date = `${dobYear}-${dobMonth.padStart(2, '0')}-${dobDay.padStart(2, '0')}`;
      await createProfile({
        name: name.trim(),
        gender,
        birth_date,
        city: city.trim() || undefined,
        country: country.trim() || undefined,
        tagline: tagline.trim() || null,
        job: job.trim() || null,
        about_me: aboutMeTrim || undefined,
        height_cm: parsedHeight,
        relationship_intent: relationshipIntent || undefined,
        photos: photos.length > 0 ? photos : undefined,
      });
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user && selectedVibeLabels.length > 0) {
        await syncProfileVibes(user.id, selectedVibeLabels);
      }
      trackEvent('onboarding_completed', {
        has_photo: photos.length > 0,
        has_bio: !!aboutMeTrim,
        has_vibes: selectedVibeLabels.length > 0,
        vibe_count: selectedVibeLabels.length,
      });
      if (user?.email) {
        void supabase.functions
          .invoke('send-email', {
            body: {
              to: user.email,
              template: 'welcome',
              data: { name: name.trim() },
            },
          })
          .catch(() => {});
      }
      await refreshOnboarding();
      router.replace('/(tabs)');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      show({
        title: 'Something went wrong',
        message: msg,
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setLoading(false);
    }
  };

  if (ageBlocked) {
    return (
      <>
      <RNView
        style={[
          styles.ageBlockedRoot,
          { backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center', padding: 32 },
        ]}
      >
        <Ionicons name="alert-circle" size={64} color={theme.danger} />
        <Text style={[styles.welcomeTitle, { color: theme.text, marginTop: 24, textAlign: 'center' }]}>
          You must be 18 or older
        </Text>
        <Text style={[styles.welcomeSub, { color: theme.textSecondary, marginTop: 12, textAlign: 'center' }]}>
          Vibely is only available to users who are 18 years of age or older.
        </Text>
        <VibelyButton
          label="Close"
          variant="destructive"
          onPress={async () => {
            try {
              await supabase.auth.signOut();
            } catch {
              /* ignore */
            }
            try {
              await AsyncStorage.clear();
            } catch {
              /* ignore */
            }
            router.replace('/(auth)/sign-in');
          }}
          style={{ width: '100%', maxWidth: 400, marginTop: 32 }}
        />
      </RNView>
      {dialog}
      </>
    );
  }

  return (
    <>
    <KeyboardAvoidingView
      style={[styles.kav, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {step > 0 && step <= 5 && (
          <RNView style={styles.stepProgressWrap}>
            <RNView style={[styles.progressTrack, { backgroundColor: theme.border }]}>
              <RNView
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(100, ((step + 1) / TOTAL_STEPS) * 100)}%`,
                    backgroundColor: theme.tint,
                  },
                ]}
              />
            </RNView>
            <Text style={[styles.stepProgress, { color: theme.mutedForeground }]}>
              Step {step + 1} of {TOTAL_STEPS}
            </Text>
          </RNView>
        )}
        {step === 0 && (
          <View style={styles.welcomeBlock}>
            <View style={[styles.welcomeIcon, { backgroundColor: theme.tint }]}>
              <Ionicons name="sparkles" size={48} color="#fff" />
            </View>
            <Text style={[styles.welcomeTitle, { color: theme.text }]}>Welcome to Vibely</Text>
            <Text style={[styles.welcomeSub, { color: theme.textSecondary }]}>
              Find your vibe. Make real connections through live video events.
            </Text>
            <View style={[styles.welcomeBullets, { borderColor: theme.border }]}>
              <View style={styles.welcomeBullet}>
                <View style={[styles.bulletIcon, { backgroundColor: theme.accentSoft }]}>
                  <Text style={styles.bulletEmoji}>🎯</Text>
                </View>
                <Text style={[styles.bulletText, { color: theme.text }]}>Match by vibe, not just looks</Text>
              </View>
              <View style={styles.welcomeBullet}>
                <View style={[styles.bulletIcon, { backgroundColor: theme.accentSoft }]}>
                  <Text style={styles.bulletEmoji}>📹</Text>
                </View>
                <Text style={[styles.bulletText, { color: theme.text }]}>Live video speed dating</Text>
              </View>
              <View style={styles.welcomeBullet}>
                <View style={[styles.bulletIcon, { backgroundColor: theme.accentSoft }]}>
                  <Text style={styles.bulletEmoji}>✨</Text>
                </View>
                <Text style={[styles.bulletText, { color: theme.text }]}>Curated events for your interests</Text>
              </View>
            </View>
            <VibelyButton label="Let's Go" onPress={handleNext} variant="primary" style={styles.button} />
          </View>
        )}

        {/* Step 1: Identity — web "Let's get to know you" */}
        {step === 1 && (
          <>
            <Text style={[styles.title, { color: theme.text }]}>Let's get to know you</Text>
            <Text style={[styles.stepSub, { color: theme.textSecondary }]}>
              The basics first, then the fun stuff
            </Text>
            <Text style={[styles.label, { color: theme.text, marginTop: 8 }]}>First Name</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text }]}
              placeholder="Your first name"
              placeholderTextColor={theme.textSecondary}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              editable={!loading}
            />
            <Text style={[styles.inputLabel, { color: theme.text }]}>Date of Birth</Text>
            <RNView style={styles.dobRow}>
              <TextInput
                placeholder="DD"
                value={dobDay}
                onChangeText={(t) => setDobDay(t.replace(/\D/g, '').slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
                style={[styles.dobInput, { borderColor: theme.border, color: theme.text }]}
                placeholderTextColor={theme.mutedForeground}
              />
              <TextInput
                placeholder="MM"
                value={dobMonth}
                onChangeText={(t) => setDobMonth(t.replace(/\D/g, '').slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
                style={[styles.dobInput, { borderColor: theme.border, color: theme.text }]}
                placeholderTextColor={theme.mutedForeground}
              />
              <TextInput
                placeholder="YYYY"
                value={dobYear}
                onChangeText={(t) => setDobYear(t.replace(/\D/g, '').slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
                style={[styles.dobInput, styles.dobInputYear, { borderColor: theme.border, color: theme.text }]}
                placeholderTextColor={theme.mutedForeground}
              />
            </RNView>
            {dobFilled && !dobValid ? (
              <Text style={[styles.dobHint, { color: theme.danger }]}>Enter a valid date.</Text>
            ) : null}
            {dobValid && dobAge !== null && dobAge < 18 ? (
              <Text style={[styles.dobHint, { color: theme.danger }]}>
                You must be 18 or older to use Vibely.
              </Text>
            ) : null}
            <VibelyButton label="Continue" onPress={handleNext} disabled={!canNext} variant="primary" style={styles.button} />
          </>
        )}

        {/* Step 2: Location — optional; web Step 2 parity */}
        {step === 2 && (
          <>
            <Text style={[styles.title, { color: theme.text }]}>Where are you based?</Text>
            <Text style={[styles.stepSub, { color: theme.textSecondary }]}>
              We&apos;ll show you events and people near you.
            </Text>
            <TextInput
              placeholder="City (e.g., London, Istanbul)"
              value={city}
              onChangeText={setCity}
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  color: theme.text,
                  backgroundColor: theme.background,
                },
              ]}
              placeholderTextColor={theme.mutedForeground}
              editable={!loading}
            />
            <TextInput
              placeholder="Country"
              value={country}
              onChangeText={setCountry}
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  color: theme.text,
                  backgroundColor: theme.background,
                },
              ]}
              placeholderTextColor={theme.mutedForeground}
              editable={!loading}
            />
            <Text style={[{ fontSize: 12, color: theme.mutedForeground, marginTop: 8 }]}>
              You can update your location anytime in settings.
            </Text>
            <VibelyButton label="Continue" onPress={handleNext} variant="primary" style={styles.button} />
            <Pressable style={styles.backBtn} onPress={() => setStep(1)} disabled={loading}>
              <Text style={[styles.link, { color: theme.tint }]}>Back</Text>
            </Pressable>
          </>
        )}

        {/* Step 3: Vibes — shared taxonomy (all categories); labels synced via profile_vibes */}
        {step === 3 && (
          <>
            <Text style={[styles.title, { color: theme.text }]}>Pick your vibes</Text>
            <Text style={[styles.stepSub, { color: theme.textSecondary }]}>
              Choose 3–5 vibes that describe you. This helps us find your people.
            </Text>
            {VIBE_TAXONOMY.map((cat) => (
              <RNView key={cat.key} style={{ marginBottom: 20 }}>
                <Text style={[styles.vibeCategoryTitle, { color: theme.text }]}>{cat.title}</Text>
                <Text style={[styles.vibeCategorySub, { color: theme.textSecondary }]}>{cat.subtitle}</Text>
                <RNView style={styles.vibeChipWrap}>
                  {cat.options.map((opt) => {
                    const selected = selectedVibeLabels.includes(opt.label);
                    const atMax = selectedVibeLabels.length >= 5;
                    const disabled = !selected && atMax;
                    return (
                      <Pressable
                        key={opt.label}
                        disabled={disabled}
                        onPress={() => {
                          setSelectedVibeLabels((prev) =>
                            selected
                              ? prev.filter((x) => x !== opt.label)
                              : prev.length >= 5
                                ? prev
                                : [...prev, opt.label]
                          );
                        }}
                        style={[
                          styles.vibeChip,
                          {
                            borderColor: selected ? theme.tint : theme.border,
                            backgroundColor: selected ? theme.tintSoft : 'transparent',
                            opacity: disabled ? 0.4 : 1,
                          },
                        ]}
                      >
                        <Text style={{ fontSize: 14, color: selected ? theme.tint : theme.text }}>
                          {opt.emoji} {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </RNView>
              </RNView>
            ))}
            <Text
              style={[
                styles.vibeMinHint,
                {
                  color:
                    selectedVibeLabels.length >= 3 && selectedVibeLabels.length <= 5
                      ? theme.success
                      : theme.mutedForeground,
                },
              ]}
            >
              {selectedVibeLabels.length}/5 selected (minimum 3)
            </Text>
            <VibelyButton
              label="Continue"
              onPress={handleNext}
              disabled={!canNext}
              variant="primary"
              style={styles.button}
            />
            <Pressable style={styles.backBtn} onPress={() => setStep(2)} disabled={loading}>
              <Text style={[styles.link, { color: theme.tint }]}>Back</Text>
            </Pressable>
          </>
        )}

        {/* Step 4: Relationship intent — web Step 6 parity */}
        {step === 4 && (
          <>
            <Text style={[styles.title, { color: theme.text }]}>What are you looking for?</Text>
            <Text style={[styles.stepSub, { color: theme.textSecondary }]}>
              This helps us match you with people who want the same things.
            </Text>
            <RNView style={styles.intentOptionList}>
              {INTENT_OPTIONS.map((opt) => {
                const selected = relationshipIntent === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setRelationshipIntent(opt.value)}
                    style={[
                      styles.intentOptionRow,
                      {
                        borderColor: selected ? theme.tint : theme.border,
                        backgroundColor: selected ? theme.tintSoft : 'transparent',
                      },
                    ]}
                  >
                    <Text style={{ fontSize: 24 }}>{opt.emoji}</Text>
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: selected ? '600' : '400',
                        color: selected ? theme.tint : theme.text,
                        flex: 1,
                      }}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </RNView>
            <VibelyButton
              label="Continue"
              onPress={handleNext}
              disabled={!canNext}
              variant="primary"
              style={styles.button}
            />
            <Pressable style={styles.backBtn} onPress={() => setStep(3)} disabled={loading}>
              <Text style={[styles.link, { color: theme.tint }]}>Back</Text>
            </Pressable>
          </>
        )}

        {/* Step 5: Details + Complete — web "Tell us a bit more" + Complete Profile */}
        {step === 5 && (
          <>
            <Text style={[styles.title, { color: theme.text }]}>Tell us a bit more</Text>
            <Text style={[styles.stepSub, { color: theme.textSecondary }]}>
              Optional details — you can edit these anytime
            </Text>
            <Text style={[styles.inputLabel, { color: theme.text, marginTop: 0 }]}>About Me</Text>
            <TextInput
              placeholder="Tell people about yourself (10-140 characters)"
              value={aboutMe}
              onChangeText={(t) => setAboutMe(t.slice(0, 140))}
              multiline
              maxLength={140}
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  color: theme.text,
                  backgroundColor: theme.background,
                  minHeight: 80,
                  textAlignVertical: 'top',
                },
              ]}
              placeholderTextColor={theme.mutedForeground}
              editable={!loading}
            />
            <Text style={[{ fontSize: 11, color: theme.mutedForeground, textAlign: 'right', marginTop: 2 }]}>
              {aboutMe.length}/140
            </Text>
            {aboutMe.length > 0 && aboutMe.length < 10 ? (
              <Text style={{ fontSize: 11, color: theme.danger, marginTop: 2 }}>Minimum 10 characters</Text>
            ) : null}
            <Text style={[styles.inputLabel, { color: theme.text }]}>Height (optional)</Text>
            <TextInput
              placeholder="Height in cm (e.g. 175)"
              value={heightCm}
              onChangeText={(t) => setHeightCm(t.replace(/[^0-9]/g, '').slice(0, 3))}
              keyboardType="number-pad"
              maxLength={3}
              style={[
                styles.input,
                { borderColor: theme.border, color: theme.text, backgroundColor: theme.background },
              ]}
              placeholderTextColor={theme.mutedForeground}
              editable={!loading}
            />
            {heightCm.length > 0 &&
              (Number(heightCm) < 100 || Number(heightCm) > 250) && (
                <Text style={{ fontSize: 11, color: theme.danger, marginTop: 2 }}>
                  Enter a value between 100 and 250 cm
                </Text>
              )}
            <Text style={[styles.label, { color: theme.text }]}>Gender (required)</Text>
            <RNView style={[styles.genderRow, { backgroundColor: theme.surfaceSubtle }]}>
              {GENDERS.map((g) => (
                <Pressable
                  key={g.value}
                  style={[
                    styles.genderBtn,
                    { borderColor: theme.border },
                    gender === g.value && { backgroundColor: theme.tint, borderColor: theme.tint },
                  ]}
                  onPress={() => setGender(g.value)}
                >
                  <Text style={[styles.genderBtnText, { color: theme.text }, gender === g.value && styles.genderBtnTextActive]}>
                    {g.label}
                  </Text>
                </Pressable>
              ))}
            </RNView>
            <Text style={[styles.label, { color: theme.text }]}>Tagline (optional)</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text }]}
              placeholder="Short tagline"
              placeholderTextColor={theme.textSecondary}
              value={tagline}
              onChangeText={setTagline}
              editable={!loading}
            />
            <Text style={[styles.label, { color: theme.text }]}>Job (optional)</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text }]}
              placeholder="Job or title"
              placeholderTextColor={theme.textSecondary}
              value={job}
              onChangeText={setJob}
              editable={!loading}
            />
            <Text style={[{ fontSize: 13, color: theme.mutedForeground, marginTop: 8, lineHeight: 20 }]}>
              You can add more photos and record your vibe video later in your profile.
            </Text>
            <Text style={[styles.inputLabel, { color: theme.text }]}>Height (optional)</Text>
            <TextInput
              placeholder="Height in cm (e.g. 175)"
              value={heightCm}
              onChangeText={(t) => setHeightCm(t.replace(/[^0-9]/g, '').slice(0, 3))}
              keyboardType="number-pad"
              maxLength={3}
              style={[
                styles.input,
                { borderColor: theme.border, color: theme.text, backgroundColor: theme.background },
              ]}
              placeholderTextColor={theme.mutedForeground}
              editable={!loading}
            />
            {heightCm.length > 0 &&
              (Number(heightCm) < 100 || Number(heightCm) > 250) && (
                <Text style={{ fontSize: 11, color: theme.danger, marginTop: 2 }}>
                  Enter a value between 100 and 250 cm
                </Text>
              )}
            <Card variant="glass" style={[styles.webFallbackCard, { borderColor: theme.glassBorder }]}>
              <Text style={[styles.webFallbackTitle, { color: theme.text }]}>Add photos & more on web</Text>
              <Text style={[styles.webFallbackSub, { color: theme.textSecondary }]}>
                Profile photos, vibes, and vibe video are available on the full site. Finish there for the best experience.
              </Text>
              <VibelyButton
                label="Complete on web"
                onPress={() => Linking.openURL(WEB_PROFILE_URL)}
                variant="secondary"
                size="sm"
                style={styles.webFallbackBtn}
              />
            </Card>
            <VibelyButton
              label={loading ? 'Creating Profile...' : 'Complete Profile'}
              onPress={handleSubmit}
              disabled={!canSubmit}
              loading={loading}
              variant="primary"
              style={styles.button}
            />
            <Pressable style={styles.backBtn} onPress={() => setStep(4)} disabled={loading || uploadingPhoto}>
              <Text style={[styles.link, { color: theme.tint }]}>Back</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
    {dialog}
    </>
  );
}

const styles = StyleSheet.create({
  ageBlockedRoot: { flex: 1 },
  kav: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: 48 },
  welcomeBlock: { alignItems: 'center', paddingTop: spacing.xl },
  welcomeIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  welcomeTitle: { fontSize: 26, fontWeight: '700', textAlign: 'center', marginBottom: spacing.sm },
  welcomeSub: { fontSize: 16, lineHeight: 24, textAlign: 'center', marginBottom: spacing.xl, paddingHorizontal: spacing.md },
  welcomeBullets: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  welcomeBullet: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bulletIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletEmoji: { fontSize: 18 },
  bulletText: { flex: 1, fontSize: 15, lineHeight: 22 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  stepSub: { fontSize: 15, lineHeight: 22, marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 16 },
  inputLabel: { fontSize: 14, fontWeight: '600', marginBottom: 6, marginTop: 16 },
  input: { borderWidth: 1, padding: 12, borderRadius: 16, marginBottom: 12, minHeight: 56 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  genderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12, padding: 4, borderRadius: 16 },
  genderBtn: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1 },
  genderBtnText: {},
  genderBtnTextActive: { color: '#fff', fontWeight: '600' },
  button: { marginTop: 24 },
  backBtn: { marginTop: 16, alignSelf: 'center' },
  link: { fontSize: 14, fontWeight: '500' },
  stepProgressWrap: { marginBottom: spacing.md, gap: spacing.sm },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden', width: '100%' },
  progressFill: { height: 4, borderRadius: 2 },
  stepProgress: { fontSize: 12, textAlign: 'center' },
  dobRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  dobInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 48,
    textAlign: 'center' as const,
  },
  dobInputYear: { flex: 1.4 },
  dobHint: { fontSize: 13, marginBottom: 8 },
  vibeCategoryTitle: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  vibeCategorySub: { fontSize: 13, marginBottom: 10 },
  vibeChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  vibeChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1 },
  vibeMinHint: { fontSize: 13, marginBottom: 8 },
  intentOptionList: { gap: 10, marginBottom: 8 },
  intentOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  photoSlot: {
    width: '30%',
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoMinHint: { fontSize: 13, marginBottom: 4 },
  webFallbackCard: { marginTop: 20, marginBottom: 12, padding: spacing.lg },
  webFallbackTitle: { fontSize: 15, fontWeight: '600', marginBottom: 6 },
  webFallbackSub: { fontSize: 13, lineHeight: 18, marginBottom: spacing.md },
  webFallbackBtn: { alignSelf: 'flex-start' },
});
