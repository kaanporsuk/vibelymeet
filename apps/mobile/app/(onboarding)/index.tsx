import { useState } from 'react';
import {
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Linking,
  View as RNView,
} from 'react-native';
import { router } from 'expo-router';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { createProfile } from '@/lib/profileApi';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { VibelyButton } from '@/components/ui';
import { Card } from '@/components/ui';
import { spacing, radius } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';

const GENDERS = [
  { label: 'Woman', value: 'woman' },
  { label: 'Man', value: 'man' },
  { label: 'Non-binary', value: 'non-binary' },
  { label: 'Other', value: 'other' },
];

const WEB_PROFILE_URL = 'https://vibelymeet.com/profile';
const TOTAL_STEPS = 3;

export default function OnboardingScreen() {
  const theme = Colors[useColorScheme()];
  const { refreshOnboarding } = useAuth();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [gender, setGender] = useState('');
  const [tagline, setTagline] = useState('');
  const [job, setJob] = useState('');
  const [aboutMe, setAboutMe] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [loading, setLoading] = useState(false);

  const canNext = step === 1 ? name.trim().length >= 2 : true;
  const canSubmit = step === 2 && name.trim() && gender && !loading;

  const handleNext = () => {
    if (step === 0) setStep(1);
    else if (step === 1 && canNext) setStep(2);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
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
      await createProfile({
        name: name.trim(),
        gender,
        tagline: tagline.trim() || null,
        job: job.trim() || null,
        about_me: aboutMe.trim() || null,
        height_cm: parsedHeight,
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

  const progress = ((step + 1) / TOTAL_STEPS) * 100;

  return (
    <KeyboardAvoidingView
      style={[styles.kav, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
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
            <VibelyButton label="Continue" onPress={handleNext} disabled={!canNext} variant="primary" style={styles.button} />
          </>
        )}

        {/* Step 2: Details + Complete — web "Tell us a bit more" + Complete Profile */}
        {step === 2 && (
          <>
            <Text style={[styles.title, { color: theme.text }]}>Tell us a bit more</Text>
            <Text style={[styles.stepSub, { color: theme.textSecondary }]}>
              Optional details — you can edit these anytime
            </Text>
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
            <Text style={[styles.label, { color: theme.text }]}>About you (optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea, { borderColor: theme.border, color: theme.text }]}
              placeholder="A bit about you"
              placeholderTextColor={theme.textSecondary}
              value={aboutMe}
              onChangeText={setAboutMe}
              multiline
              numberOfLines={3}
              editable={!loading}
            />
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
              disabled={!gender || loading}
              loading={loading}
              variant="primary"
              style={styles.button}
            />
            <Pressable style={styles.backBtn} onPress={() => setStep(1)} disabled={loading}>
              <Text style={[styles.link, { color: theme.tint }]}>Back</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
