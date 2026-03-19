import { useState, useEffect } from 'react';
import {
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  View as RNView,
  Image,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { createProfile } from '@/lib/profileApi';
import { trackEvent } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import { uploadProfilePhoto } from '@/lib/uploadImage';
import { getImageUrl } from '@/lib/imageUrl';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { VibelyButton } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';

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

const TOTAL_STEPS = 7;
const MAX_ONBOARDING_PHOTOS = 6;

const INTENT_OPTIONS = [
  { value: 'long_term', label: 'Long-term relationship', emoji: '💕' },
  { value: 'short_term', label: 'Short-term / casual', emoji: '🌶️' },
  { value: 'friends', label: 'New friends', emoji: '🤝' },
  { value: 'not_sure', label: 'Not sure yet', emoji: '🤷' },
];

export default function OnboardingScreen() {
  const theme = Colors[useColorScheme()];
  const { refreshOnboarding } = useAuth();
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
<<<<<<< feat/notification-deep-links
=======
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [vibeTags, setVibeTags] = useState<{ id: string; label: string; emoji?: string | null }[]>([]);
  const [selectedVibeIds, setSelectedVibeIds] = useState<string[]>([]);
  const [relationshipIntent, setRelationshipIntent] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
>>>>>>> main
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('vibe_tags').select('id, label, emoji').order('label');
      if (data) setVibeTags(data as { id: string; label: string; emoji?: string | null }[]);
    })();
  }, []);

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
            ? selectedVibeIds.length >= 3
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
  const canSubmit =
    step === 6 &&
    detailsComplete &&
    photos.length >= 2 &&
    !loading &&
    !uploadingPhoto;

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
    } else if (step === 3 && selectedVibeIds.length >= 3) {
      setStep(4);
    } else if (step === 4 && relationshipIntent) {
      setStep(5);
    } else if (step === 5 && canNext) {
      setStep(6);
    }
  };

  const pickAndUploadPhoto = async () => {
    if (photos.length >= MAX_ONBOARDING_PHOTOS || uploadingPhoto) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access to add profile photos.');
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
      setPhotos((prev) => (prev.length >= MAX_ONBOARDING_PHOTOS ? prev : [...prev, path]));
    } catch {
      Alert.alert('Upload failed', 'Please try again.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
<<<<<<< feat/notification-deep-links
      let parsedHeight: number | undefined;
      if (heightCm) {
        const h = Number(heightCm);
        if (isNaN(h) || h < 100 || h > 250) {
          setLoading(false);
          Alert.alert('Invalid height', 'Please enter a height between 100 cm and 250 cm, or leave blank.');
          return;
        }
        parsedHeight = h;
      }
=======
      const birth_date = `${dobYear}-${dobMonth.padStart(2, '0')}-${dobDay.padStart(2, '0')}`;
>>>>>>> main
      await createProfile({
        name: name.trim(),
        gender,
        birth_date,
        city: city.trim() || undefined,
        country: country.trim() || undefined,
        tagline: tagline.trim() || null,
        job: job.trim() || null,
<<<<<<< feat/notification-deep-links
        about_me: aboutMe.trim() || null,
        height_cm: parsedHeight,
=======
        about_me: aboutMeTrim || undefined,
        height_cm: heightCm ? Number(heightCm) : undefined,
        relationship_intent: relationshipIntent || undefined,
        photos: photos.length > 0 ? photos : undefined,
      });
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user && selectedVibeIds.length > 0) {
        const vibeRows = selectedVibeIds.map((tagId) => ({
          profile_id: user.id,
          vibe_tag_id: tagId,
        }));
        const { error: vibesError } = await supabase
          .from('profile_vibes')
          .upsert(vibeRows, { onConflict: 'profile_id,vibe_tag_id' });
        if (vibesError) throw vibesError;
      }
      trackEvent('onboarding_completed', {
        has_photo: photos.length > 0,
        has_bio: !!aboutMeTrim,
        has_vibes: selectedVibeIds.length > 0,
        vibe_count: selectedVibeIds.length,
>>>>>>> main
      });
      await refreshOnboarding();
      router.replace('/(tabs)');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  if (ageBlocked) {
    return (
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
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.kav, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {step > 0 && step <= 6 && (
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

        {/* Step 3: Vibes — web Step 5 parity */}
        {step === 3 && (
          <>
            <Text style={[styles.title, { color: theme.text }]}>Pick your vibes</Text>
            <Text style={[styles.stepSub, { color: theme.textSecondary }]}>
              Choose at least 3 vibes that describe you. This helps us find your people.
            </Text>
            <RNView style={styles.vibeChipWrap}>
              {vibeTags.map((tag) => {
                const selected = selectedVibeIds.includes(tag.id);
                return (
                  <Pressable
                    key={tag.id}
                    onPress={() => {
                      setSelectedVibeIds((prev) =>
                        selected ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]
                      );
                    }}
                    style={[
                      styles.vibeChip,
                      {
                        borderColor: selected ? theme.tint : theme.border,
                        backgroundColor: selected ? theme.tintSoft : 'transparent',
                      },
                    ]}
                  >
                    <Text style={{ fontSize: 14, color: selected ? theme.tint : theme.text }}>
                      {tag.emoji ? `${tag.emoji} ` : ''}
                      {tag.label}
                    </Text>
                  </Pressable>
                );
              })}
            </RNView>
            <Text
              style={[
                styles.vibeMinHint,
                {
                  color: selectedVibeIds.length >= 3 ? theme.success : theme.mutedForeground,
                },
              ]}
            >
              {selectedVibeIds.length}/3 minimum selected
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
            <Text style={[styles.inputLabel, { color: theme.text }]}>Height</Text>
            <TextInput
              placeholder="Height in cm (e.g., 175)"
              value={heightCm}
              onChangeText={(t) => setHeightCm(t.replace(/\D/g, '').slice(0, 3))}
              keyboardType="number-pad"
              maxLength={3}
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
            <VibelyButton
              label="Continue"
              onPress={handleNext}
              disabled={!canNext}
              variant="primary"
              style={styles.button}
            />
<<<<<<< feat/notification-deep-links
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
=======
            <Pressable style={styles.backBtn} onPress={() => setStep(4)} disabled={loading}>
              <Text style={[styles.link, { color: theme.tint }]}>Back</Text>
            </Pressable>
          </>
        )}

        {/* Step 6: Photos — web Step 7 parity */}
        {step === 6 && (
          <>
            <Text style={[styles.title, { color: theme.text }]}>Add your photos</Text>
            <Text style={[styles.stepSub, { color: theme.textSecondary }]}>
              Add at least 2 photos so people can see the real you.
            </Text>
            <RNView style={styles.photoGrid}>
              {[0, 1, 2, 3, 4, 5].map((i) => {
                const photoPath = photos[i];
                const isNextSlot = i === photos.length;
                const showSpinner = uploadingPhoto && isNextSlot;
                const canAddHere =
                  isNextSlot && photos.length < MAX_ONBOARDING_PHOTOS && !uploadingPhoto;
                return (
                  <Pressable
                    key={i}
                    onPress={() => {
                      if (canAddHere) pickAndUploadPhoto();
                    }}
                    disabled={!photoPath && !canAddHere}
                    style={[
                      styles.photoSlot,
                      {
                        borderStyle: photoPath ? 'solid' : 'dashed',
                        borderColor: photoPath ? theme.border : theme.mutedForeground,
                        backgroundColor: photoPath ? 'transparent' : theme.surfaceSubtle,
                      },
                    ]}
                  >
                    {photoPath ? (
                      <Image
                        source={{ uri: getImageUrl(photoPath, undefined, 'profile_photo') }}
                        style={StyleSheet.absoluteFill}
                        resizeMode="cover"
                      />
                    ) : showSpinner ? (
                      <ActivityIndicator color={theme.tint} />
                    ) : (
                      <Ionicons name="add" size={28} color={theme.mutedForeground} />
                    )}
                  </Pressable>
                );
              })}
            </RNView>
            <Text
              style={[
                styles.photoMinHint,
                {
                  color: photos.length >= 2 ? theme.success : theme.mutedForeground,
                },
              ]}
            >
              {photos.length}/2 minimum added
            </Text>
            <Text style={[{ fontSize: 12, color: theme.mutedForeground, marginTop: 8 }]}>
              Optional: add up to {MAX_ONBOARDING_PHOTOS} photos. Vibe video is available on web.
            </Text>
>>>>>>> main
            <VibelyButton
              label={loading ? 'Creating Profile...' : 'Complete Profile'}
              onPress={handleSubmit}
              disabled={!canSubmit}
              loading={loading}
              variant="primary"
              style={styles.button}
            />
            <Pressable style={styles.backBtn} onPress={() => setStep(5)} disabled={loading || uploadingPhoto}>
              <Text style={[styles.link, { color: theme.tint }]}>Back</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
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
  webFallbackCard: { marginTop: 20, marginBottom: 12, padding: spacing.lg },
  webFallbackTitle: { fontSize: 15, fontWeight: '600', marginBottom: 6 },
  webFallbackSub: { fontSize: 13, lineHeight: 18, marginBottom: spacing.md },
  webFallbackBtn: { alignSelf: 'flex-start' },
});
