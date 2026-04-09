/**
 * LinkedSignInMethods.tsx (Native / React Native)
 *
 * Shows all Vibely sign-in methods and lets the user link or (where supported) unlink them.
 *
 * METHOD SEMANTICS
 * ────────────────
 * Google / Apple  → OAuth linking via expo-web-browser + supabase.auth.linkIdentity().
 * Email password  → Two explicit flows:
 *   A. Session has email (OAuth user) → "Add password" via updateUser({ password }).
 *      No confirmation email; effective immediately.
 *   B. No session email (phone-only)  → "Add email" via updateUser({ email }).
 *      Sends confirmation link; sign-in active after confirmation.
 * Phone           → OTP-only. updateUser({ phone }) + verifyOtp({ type: 'phone_change' }).
 *                   No phone+password mode exists in Vibely.
 *
 * NATIVE OAUTH LINKING
 * ─────────────────────
 * Apple  → Native token path. expo-apple-authentication.signInAsync() produces an OIDC
 *           identity token that is passed directly to linkIdentity({ provider: 'apple', token }).
 *           No browser required; same token used by the existing Apple sign-in flow.
 * Google → Browser OAuth path via expo-web-browser (deliberate first-release choice).
 *           Native Google ID tokens require @react-native-google-signin, which is not in
 *           the Vibely native dependency tree. Adding it requires pod-install, Google Cloud
 *           Console native client setup, and EAS build changes — a separate engineering
 *           investment. Tracked as a future upgrade.
 *
 * REMOVAL
 * ───────
 * Unlink is shown only when canUnlinkProvider() is true (2+ identities linked).
 * The last identity can never be removed — the hook enforces this.
 */

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Platform,
  StyleSheet,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
  SafeAreaView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIdentityLinking, type ProviderType } from '../../hooks/useIdentityLinking';
import { withAlpha } from '@/lib/colorUtils';

// ---------- types ----------

interface LinkedSignInMethodsProps {
  theme: any;
}

type EmailSheetMode = null | 'add_password' | 'add_email' | 'email_pending';
type PhoneSheetStep = null | 'phone' | 'otp';

// ---------- provider meta ----------

interface ProviderInfo {
  id: ProviderType;
  label: string;
  sublabel: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  isAvailable: boolean;
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'google',
    label: 'Google',
    sublabel: 'Sign in with Google',
    icon: 'logo-google',
    isAvailable: true,
  },
  {
    id: 'apple',
    label: 'Apple',
    sublabel: 'Sign in with Apple ID',
    icon: 'logo-apple',
    isAvailable: Platform.OS === 'ios',
  },
  {
    id: 'email',
    label: 'Email & password',
    sublabel: 'Sign in with email + password',
    icon: 'mail-outline',
    isAvailable: true,
  },
  {
    id: 'phone',
    label: 'Phone (SMS code)',
    sublabel: 'Sign in with a one-time SMS code',
    icon: 'call-outline',
    isAvailable: true,
  },
];

// ---------- component ----------

export function LinkedSignInMethods({ theme }: LinkedSignInMethodsProps) {
  const {
    identities,
    isLoading,
    error,
    isLinking,
    linkingProvider,
    hasGoogle,
    hasApple,
    hasEmail,
    hasPhone,
    canUnlinkProvider,
    sessionEmail,
    fetchIdentities,
    linkProvider,
    unlinkProvider,
    addPasswordToAccount,
    linkNewEmail,
    linkPhone,
    verifyPhoneLink,
    cancelPhoneLink,
  } = useIdentityLinking();

  const [displayError, setDisplayError] = useState<string | null>(null);

  // Email modal state
  const [emailMode, setEmailMode] = useState<EmailSheetMode>(null);
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);

  // Phone modal state
  const [phoneStep, setPhoneStep] = useState<PhoneSheetStep>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);
  const linkedPhoneRef = useRef('');

  const isLinkedMap: Record<ProviderType, boolean> = {
    google: hasGoogle,
    apple: hasApple,
    email: hasEmail,
    phone: hasPhone,
  };

  const showError = (msg: string) => {
    setDisplayError(msg);
    setTimeout(() => setDisplayError(null), 6000);
  };

  // ─── OAuth ───────────────────────────────────────────────────────────────

  const handleLinkOAuth = async (provider: ProviderType) => {
    setDisplayError(null);
    await linkProvider(provider);
    setTimeout(() => fetchIdentities(), 1000);
  };

  const handleUnlinkConfirm = (provider: ProviderType, label: string) => {
    Alert.alert(
      `Remove ${label} sign-in?`,
      'You will no longer be able to sign in with this method.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await unlinkProvider(provider);
            } catch (err) {
              showError(err instanceof Error ? err.message : `Failed to unlink ${label}.`);
            }
          },
        },
      ],
    );
  };

  // ─── Email ───────────────────────────────────────────────────────────────

  const openEmailModal = () => {
    setDisplayError(null);
    setEmailMode(sessionEmail ? 'add_password' : 'add_email');
  };

  const handleAddPassword = async () => {
    if (passwordInput.length < 8) {
      showError('Password must be at least 8 characters.');
      return;
    }
    setEmailBusy(true);
    setDisplayError(null);
    try {
      await addPasswordToAccount(passwordInput);
      setEmailMode(null);
      setPasswordInput('');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to set password.');
    } finally {
      setEmailBusy(false);
    }
  };

  const handleAddEmail = async () => {
    const trimmed = emailInput.trim();
    if (!trimmed) return;
    setEmailBusy(true);
    setDisplayError(null);
    try {
      await linkNewEmail(trimmed);
      setEmailMode('email_pending');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to add email.');
      setEmailMode(null);
    } finally {
      setEmailBusy(false);
    }
  };

  const resetEmailModal = () => {
    setEmailMode(null);
    setEmailInput('');
    setPasswordInput('');
    setDisplayError(null);
  };

  // ─── Phone ───────────────────────────────────────────────────────────────

  const handleSendPhoneOtp = async () => {
    const trimmed = phoneInput.trim();
    if (!/^\+\d{7,15}$/.test(trimmed)) {
      showError('Enter a phone number in international format, e.g. +447911123456');
      return;
    }
    setPhoneBusy(true);
    setDisplayError(null);
    try {
      await linkPhone(trimmed);
      linkedPhoneRef.current = trimmed;
      setPhoneStep('otp');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to send code.');
      setPhoneStep(null);
    } finally {
      setPhoneBusy(false);
    }
  };

  const handleVerifyPhone = async () => {
    setPhoneBusy(true);
    setDisplayError(null);
    try {
      await verifyPhoneLink(linkedPhoneRef.current, otpInput.trim());
      setPhoneStep(null);
      setPhoneInput('');
      setOtpInput('');
      linkedPhoneRef.current = '';
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setPhoneBusy(false);
    }
  };

  const resetPhoneModal = () => {
    cancelPhoneLink();
    setPhoneStep(null);
    setPhoneInput('');
    setOtpInput('');
    linkedPhoneRef.current = '';
    setDisplayError(null);
  };

  // ─── render ──────────────────────────────────────────────────────────────

  const availableProviders = PROVIDERS.filter(p => p.isAvailable);

  return (
    <View style={{ marginVertical: 16 }}>
      <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>
        SIGN-IN METHODS
      </Text>

      <View style={[styles.card, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
        {isLoading ? (
          <View style={styles.centerLoader}>
            <ActivityIndicator size="small" color={theme.tint} />
          </View>
        ) : (
          <>
            <View style={styles.descriptionBox}>
              <Text style={[styles.descriptionText, { color: theme.mutedForeground }]}>
                Link multiple methods so you can always reach your account.
              </Text>
            </View>

            {availableProviders.map((provider, idx) => {
              const isLinked = isLinkedMap[provider.id];
              const isBusy = isLinking && linkingProvider === provider.id;
              const canUnlink = canUnlinkProvider(provider.id);
              const identity = identities.find(i => i.provider === provider.id);
              const isLast = idx === availableProviders.length - 1;

              let sublabel = provider.sublabel;
              if (provider.id === 'email' && !isLinked && sessionEmail) {
                sublabel = `${sessionEmail} — no password`;
              }

              return (
                <View
                  key={provider.id}
                  style={[
                    styles.providerRow,
                    {
                      backgroundColor: theme.surface,
                      borderBottomColor: !isLast ? theme.border : 'transparent',
                    },
                  ]}
                >
                  <View style={styles.providerLeft}>
                    <Ionicons
                      name={provider.icon}
                      size={20}
                      color={isLinked ? theme.success : theme.tint}
                      style={{ marginRight: 12 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.providerLabel, { color: theme.text }]}>
                        {provider.label}
                      </Text>
                      {isLinked && identity?.identity_data?.email ? (
                        <Text style={[styles.providerSub, { color: theme.mutedForeground }]}>
                          {identity.identity_data.email}
                        </Text>
                      ) : isLinked && identity?.identity_data?.phone ? (
                        <Text style={[styles.providerSub, { color: theme.mutedForeground }]}>
                          {identity.identity_data.phone}
                        </Text>
                      ) : (
                        <Text style={[styles.providerSub, { color: theme.mutedForeground }]}>
                          {sublabel}
                        </Text>
                      )}
                    </View>
                  </View>

                  <View style={styles.providerRight}>
                    {/* Unlink */}
                    {isLinked && canUnlink && !isBusy && (
                      <Pressable
                        onPress={() => handleUnlinkConfirm(provider.id, provider.label)}
                        hitSlop={8}
                        style={{ marginRight: 8 }}
                      >
                        <Ionicons name="trash-outline" size={16} color={theme.danger} />
                      </Pressable>
                    )}

                    {isBusy ? (
                      <ActivityIndicator size="small" color={theme.tint} />
                    ) : isLinked ? (
                      <View style={styles.linkedBadge}>
                        <Ionicons name="checkmark-circle" size={18} color={theme.success} />
                        <Text style={[styles.linkedText, { color: theme.success }]}>Linked</Text>
                      </View>
                    ) : provider.id === 'google' || provider.id === 'apple' ? (
                      <Pressable
                        onPress={() => handleLinkOAuth(provider.id)}
                        style={({ pressed }) => [
                          styles.actionBtn,
                          { backgroundColor: withAlpha(theme.tint, pressed ? 0.15 : 0.1) },
                        ]}
                      >
                        <Text style={[styles.actionBtnText, { color: theme.tint }]}>Link</Text>
                      </Pressable>
                    ) : provider.id === 'email' ? (
                      <Pressable
                        onPress={openEmailModal}
                        style={({ pressed }) => [
                          styles.actionBtn,
                          { backgroundColor: withAlpha(theme.tint, pressed ? 0.15 : 0.1) },
                        ]}
                      >
                        <Text style={[styles.actionBtnText, { color: theme.tint }]}>
                          {sessionEmail ? 'Add password' : 'Add email'}
                        </Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => setPhoneStep('phone')}
                        style={({ pressed }) => [
                          styles.actionBtn,
                          { backgroundColor: withAlpha(theme.tint, pressed ? 0.15 : 0.1) },
                        ]}
                      >
                        <Text style={[styles.actionBtnText, { color: theme.tint }]}>Add SMS</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}

            {(displayError || error) && (
              <View
                style={[
                  styles.errorBox,
                  {
                    backgroundColor: withAlpha(theme.danger, 0.1),
                    borderColor: withAlpha(theme.danger, 0.3),
                  },
                ]}
              >
                <Ionicons name="alert-circle" size={16} color={theme.danger} style={{ marginRight: 8 }} />
                <Text style={[styles.errorText, { color: theme.danger }]}>
                  {displayError || error}
                </Text>
              </View>
            )}

            <View style={[styles.noteBox, { backgroundColor: withAlpha(theme.tint, 0.08) }]}>
              <Text style={[styles.noteText, { color: theme.mutedForeground }]}>
                You can remove a method as long as at least one other remains.
              </Text>
            </View>
          </>
        )}
      </View>

      {/* ── Email modal ── */}
      <Modal
        visible={emailMode !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={resetEmailModal}
      >
        <SafeAreaView style={[styles.modalSafe, { backgroundColor: theme.background }]}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>
                  {emailMode === 'add_password' ? 'Add password sign-in' : 'Add email sign-in'}
                </Text>
                <Pressable onPress={resetEmailModal} hitSlop={12}>
                  <Ionicons name="close" size={22} color={theme.mutedForeground} />
                </Pressable>
              </View>

              {displayError ? (
                <View style={[styles.errorBox, { backgroundColor: withAlpha(theme.danger, 0.1), borderColor: withAlpha(theme.danger, 0.3), marginBottom: 12 }]}>
                  <Ionicons name="alert-circle" size={16} color={theme.danger} style={{ marginRight: 8 }} />
                  <Text style={[styles.errorText, { color: theme.danger }]}>{displayError}</Text>
                </View>
              ) : null}

              {emailMode === 'add_password' && (
                <>
                  <Text style={[styles.modalHint, { color: theme.mutedForeground }]}>
                    Set a password so you can sign in with{' '}
                    <Text style={{ color: theme.text }}>{sessionEmail}</Text>
                    {' '}and a password. Takes effect immediately — no confirmation email.
                  </Text>
                  <TextInput
                    style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
                    placeholder="New password (min 8 characters)"
                    placeholderTextColor={theme.mutedForeground}
                    value={passwordInput}
                    onChangeText={setPasswordInput}
                    secureTextEntry
                    autoComplete="new-password"
                  />
                  <Pressable
                    onPress={handleAddPassword}
                    disabled={passwordInput.length < 8 || emailBusy}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      { backgroundColor: theme.tint, opacity: (passwordInput.length < 8 || emailBusy || pressed) ? 0.6 : 1 },
                    ]}
                  >
                    {emailBusy
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.primaryBtnText}>Set password</Text>}
                  </Pressable>
                </>
              )}

              {emailMode === 'add_email' && (
                <>
                  <Text style={[styles.modalHint, { color: theme.mutedForeground }]}>
                    Add an email address. A confirmation link will be sent — click it to activate
                    email sign-in. You can set a password afterwards.
                  </Text>
                  <TextInput
                    style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
                    placeholder="Email address"
                    placeholderTextColor={theme.mutedForeground}
                    value={emailInput}
                    onChangeText={setEmailInput}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                  />
                  <Pressable
                    onPress={handleAddEmail}
                    disabled={!emailInput.trim() || emailBusy}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      { backgroundColor: theme.tint, opacity: (!emailInput.trim() || emailBusy || pressed) ? 0.6 : 1 },
                    ]}
                  >
                    {emailBusy
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.primaryBtnText}>Send confirmation</Text>}
                  </Pressable>
                </>
              )}

              {emailMode === 'email_pending' && (
                <View style={styles.pendingBox}>
                  <Ionicons name="mail" size={36} color={theme.success} style={{ marginBottom: 12 }} />
                  <Text style={[styles.pendingTitle, { color: theme.text }]}>Check your inbox</Text>
                  <Text style={[styles.pendingBody, { color: theme.mutedForeground }]}>
                    Confirmation sent to{' '}
                    <Text style={{ color: theme.text }}>{emailInput}</Text>.
                    Tap the link to activate email sign-in.
                  </Text>
                  <Pressable
                    onPress={resetEmailModal}
                    style={[styles.primaryBtn, { backgroundColor: theme.tint }]}
                  >
                    <Text style={styles.primaryBtnText}>Done</Text>
                  </Pressable>
                </View>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── Phone modal ── */}
      <Modal
        visible={phoneStep !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={resetPhoneModal}
      >
        <SafeAreaView style={[styles.modalSafe, { backgroundColor: theme.background }]}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>
                  {phoneStep === 'otp' ? 'Verify your number' : 'Add phone sign-in'}
                </Text>
                <Pressable onPress={resetPhoneModal} hitSlop={12}>
                  <Ionicons name="close" size={22} color={theme.mutedForeground} />
                </Pressable>
              </View>

              {displayError ? (
                <View style={[styles.errorBox, { backgroundColor: withAlpha(theme.danger, 0.1), borderColor: withAlpha(theme.danger, 0.3), marginBottom: 12 }]}>
                  <Ionicons name="alert-circle" size={16} color={theme.danger} style={{ marginRight: 8 }} />
                  <Text style={[styles.errorText, { color: theme.danger }]}>{displayError}</Text>
                </View>
              ) : null}

              {phoneStep === 'phone' && (
                <>
                  <Text style={[styles.modalHint, { color: theme.mutedForeground }]}>
                    Enter your number in international format (e.g. +447911123456).
                    Phone sign-in uses one-time SMS codes — there is no phone+password option.
                  </Text>
                  <TextInput
                    style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
                    placeholder="+447911123456"
                    placeholderTextColor={theme.mutedForeground}
                    value={phoneInput}
                    onChangeText={setPhoneInput}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                  />
                  <Pressable
                    onPress={handleSendPhoneOtp}
                    disabled={!phoneInput.trim() || phoneBusy}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      { backgroundColor: theme.tint, opacity: (!phoneInput.trim() || phoneBusy || pressed) ? 0.6 : 1 },
                    ]}
                  >
                    {phoneBusy
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.primaryBtnText}>Send code</Text>}
                  </Pressable>
                </>
              )}

              {phoneStep === 'otp' && (
                <>
                  <Text style={[styles.modalHint, { color: theme.mutedForeground }]}>
                    Enter the code sent to{' '}
                    <Text style={{ color: theme.text }}>{linkedPhoneRef.current}</Text>.
                  </Text>
                  <TextInput
                    style={[styles.input, styles.otpInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
                    placeholder="123456"
                    placeholderTextColor={theme.mutedForeground}
                    value={otpInput}
                    onChangeText={v => setOtpInput(v.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    maxLength={6}
                  />
                  <Pressable
                    onPress={handleVerifyPhone}
                    disabled={otpInput.length < 4 || phoneBusy}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      { backgroundColor: theme.tint, opacity: (otpInput.length < 4 || phoneBusy || pressed) ? 0.6 : 1 },
                    ]}
                  >
                    {phoneBusy
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.primaryBtnText}>Verify</Text>}
                  </Pressable>
                  <Pressable onPress={resetPhoneModal} style={{ alignSelf: 'center', marginTop: 12 }}>
                    <Text style={[styles.noteText, { color: theme.mutedForeground }]}>
                      Wrong number? Start over
                    </Text>
                  </Pressable>
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

// ---------- styles ----------

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, paddingLeft: 4, marginBottom: 12 },
  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  centerLoader: { height: 60, justifyContent: 'center', alignItems: 'center' },
  descriptionBox: { paddingHorizontal: 16, paddingVertical: 12 },
  descriptionText: { fontSize: 13, lineHeight: 18 },
  providerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  providerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  providerRight: { flexDirection: 'row', alignItems: 'center' },
  providerLabel: { fontSize: 15, fontWeight: '600' },
  providerSub: { fontSize: 12, marginTop: 1 },
  linkedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkedText: { fontSize: 12, fontWeight: '600' },
  actionBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  actionBtnText: { fontSize: 13, fontWeight: '600' },
  errorBox: {
    marginHorizontal: 16, marginTop: 12, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center',
  },
  errorText: { fontSize: 12, flex: 1, lineHeight: 16 },
  noteBox: { marginHorizontal: 16, marginBottom: 12, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  noteText: { fontSize: 11, lineHeight: 15 },
  // modal
  modalSafe: { flex: 1 },
  modalScroll: { padding: 24, flexGrow: 1 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalHint: { fontSize: 14, lineHeight: 20, marginBottom: 20 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 12 },
  otpInput: { letterSpacing: 8, textAlign: 'center', fontSize: 22 },
  primaryBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  pendingBox: { alignItems: 'center', paddingTop: 32 },
  pendingTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  pendingBody: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 28 },
});
