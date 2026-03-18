import { useState } from 'react';
import {
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
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

const GENDERS = [
  { label: 'Woman', value: 'woman' },
  { label: 'Man', value: 'man' },
  { label: 'Non-binary', value: 'non-binary' },
  { label: 'Other', value: 'other' },
];

const WEB_PROFILE_URL = 'https://vibelymeet.com/profile';

export default function OnboardingScreen() {
  const theme = Colors[useColorScheme()];
  const { refreshOnboarding } = useAuth();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [gender, setGender] = useState('');
  const [tagline, setTagline] = useState('');
  const [job, setJob] = useState('');
  const [aboutMe, setAboutMe] = useState('');
  const [loading, setLoading] = useState(false);

  const canNext = step === 0 ? name.trim().length >= 2 : true;
  const canSubmit = step === 1 && name.trim() && gender && !loading;

  const handleNext = () => {
    if (step === 0 && canNext) setStep(1);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await createProfile({
        name: name.trim(),
        gender,
        tagline: tagline.trim() || null,
        job: job.trim() || null,
        about_me: aboutMe.trim() || null,
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

  return (
    <KeyboardAvoidingView
      style={[styles.kav, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {step === 0 && (
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
            <VibelyButton label="Next" onPress={handleNext} disabled={!canNext} variant="primary" style={styles.button} />
          </>
        )}

        {step === 1 && (
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
              label={loading ? '' : 'Complete'}
              onPress={handleSubmit}
              disabled={!gender || loading}
              loading={loading}
              variant="primary"
              style={styles.button}
            />
            <Pressable style={styles.backBtn} onPress={() => setStep(0)} disabled={loading}>
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
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  stepSub: { fontSize: 15, lineHeight: 22, marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 16 },
  input: { borderWidth: 1, padding: 12, borderRadius: radius.lg, marginBottom: 12 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  genderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12, padding: 4, borderRadius: radius.lg },
  genderBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: radius.lg, borderWidth: 1 },
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
