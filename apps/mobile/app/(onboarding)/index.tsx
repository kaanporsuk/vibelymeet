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
} from 'react-native';
import { router } from 'expo-router';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { createProfile } from '@/lib/profileApi';

const GENDERS = [
  { label: 'Woman', value: 'woman' },
  { label: 'Man', value: 'man' },
  { label: 'Non-binary', value: 'non-binary' },
  { label: 'Other', value: 'other' },
];

export default function OnboardingScreen() {
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
      style={styles.kav}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>
          {step === 0 ? "What's your name?" : 'Tell us a bit about you'}
        </Text>

        {step === 0 && (
          <>
            <TextInput
              style={styles.input}
              placeholder="Your name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              editable={!loading}
            />
            <Pressable style={[styles.button, !canNext && styles.buttonDisabled]} onPress={handleNext} disabled={!canNext}>
              <Text style={styles.buttonText}>Next</Text>
            </Pressable>
          </>
        )}

        {step === 1 && (
          <>
            <Text style={styles.label}>Gender (required)</Text>
            <View style={styles.genderRow} lightColor="#f0f0f0" darkColor="#333">
              {GENDERS.map((g) => (
                <Pressable
                  key={g.value}
                  style={[styles.genderBtn, gender === g.value && styles.genderBtnActive]}
                  onPress={() => setGender(g.value)}
                >
                  <Text style={[styles.genderBtnText, gender === g.value && styles.genderBtnTextActive]}>{g.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Tagline (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Short tagline"
              value={tagline}
              onChangeText={setTagline}
              editable={!loading}
            />
            <Text style={styles.label}>Job (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Job or title"
              value={job}
              onChangeText={setJob}
              editable={!loading}
            />
            <Text style={styles.label}>About you (optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="A bit about you"
              value={aboutMe}
              onChangeText={setAboutMe}
              multiline
              numberOfLines={3}
              editable={!loading}
            />
            <Text style={styles.deferral}>
              Profile photos can be added later on web or in a future app update.
            </Text>
            <Pressable
              style={[styles.button, (!gender || loading) && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={!gender || loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Complete</Text>
              )}
            </Pressable>
          </>
        )}

        {step === 1 && (
          <Pressable style={styles.backBtn} onPress={() => setStep(0)} disabled={loading}>
            <Text style={styles.link}>Back</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1 },
  scroll: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 16 },
  input: { borderWidth: 1, padding: 12, borderRadius: 8, marginBottom: 12 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  genderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  genderBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: '#ccc' },
  genderBtnActive: { backgroundColor: '#2f95dc', borderColor: '#2f95dc' },
  genderBtnText: {},
  genderBtnTextActive: { color: '#fff', fontWeight: '600' },
  button: { backgroundColor: '#2f95dc', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 24 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600' },
  backBtn: { marginTop: 16, alignSelf: 'center' },
  link: { color: '#2f95dc' },
  deferral: { fontSize: 12, opacity: 0.8, marginTop: 16 },
});
