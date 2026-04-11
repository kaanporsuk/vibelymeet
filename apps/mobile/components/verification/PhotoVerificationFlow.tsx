/**
 * Native photo verification: capture selfie → preview → submit (pending admin review).
 * Mirrors web `SimplePhotoVerification` semantics:
 * - upload selfie to `proof-selfies`
 * - insert `photo_verifications` with `status: "pending"`
 * - update `profiles.proof_selfie_url`
 * - do NOT set `profiles.photo_verified` client-side (admin-only approval)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Image, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { VibelyButton, VibelyText } from '@/components/ui';
import { withAlpha } from '@/lib/colorUtils';
import { supabase } from '@/lib/supabase';
import { KeyboardAwareBottomSheetModal } from '@/components/keyboard/KeyboardAwareBottomSheetModal';
import { prepareProofSelfieUploadPayload } from '@/lib/proofSelfiePrepareUpload';

type Step = 'capture' | 'preview' | 'submitting' | 'submitted';

export type PhotoVerificationFlowProps = {
  visible: boolean;
  onClose: () => void;
  /** Called after successful submission (persisted state is now pending review). */
  onSubmissionComplete?: () => void;
  /** Used as `profile_photo_url` for reviewer context. */
  profilePhotoUrl?: string | null;
};

export function PhotoVerificationFlow({ visible, onClose, onSubmissionComplete, profilePhotoUrl }: PhotoVerificationFlowProps) {
  const theme = Colors[useColorScheme()];
  const [step, setStep] = useState<Step>('capture');
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setStep('capture');
      setSelfieUri(null);
      setError(null);
    }
  }, [visible]);

  const canSubmit = useMemo(() => !!selfieUri && step !== 'submitting', [selfieUri, step]);

  const startCapture = async () => {
    setError(null);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setError('Allow camera access to take a selfie.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      allowsEditing: false,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const asset = result.assets[0];
    setSelfieUri(asset.uri);
    setStep('preview');
  };

  const submit = async () => {
    if (!selfieUri) return;
    setError(null);
    setStep('submitting');
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) throw new Error('Not authenticated');

      const fileName = `${user.id}/${Date.now()}_verification.jpg`;
      const { body, contentType, cleanup } = await prepareProofSelfieUploadPayload(selfieUri);
      try {
        const { error: uploadError, data: uploadData } = await supabase.storage
          .from('proof-selfies')
          .upload(fileName, body, { contentType, cacheControl: '3600', upsert: false });
        if (__DEV__) {
          console.warn('[proof-selfie] upload_result', {
            path: uploadData?.path ?? fileName,
            error: uploadError?.message ?? null,
            payloadBytes: body.byteLength,
          });
        }
        if (uploadError) throw uploadError;
      } finally {
        cleanup();
      }

      const selfieUrl = fileName;
      const profilePhoto = (profilePhotoUrl ?? '').trim();

      const { error: insertError } = await supabase.from('photo_verifications').insert({
        user_id: user.id,
        selfie_url: selfieUrl,
        profile_photo_url: profilePhoto,
        status: 'pending',
      });
      if (insertError) throw insertError;

      // For reviewer/audit reference. Does not imply approval.
      await supabase.from('profiles').update({ proof_selfie_url: selfieUrl }).eq('id', user.id);

      setStep('submitted');
      setTimeout(() => {
        onSubmissionComplete?.();
        onClose();
      }, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit. Please try again.');
      setStep('preview');
    }
  };

  return (
    <KeyboardAwareBottomSheetModal
      visible={visible}
      onRequestClose={onClose}
      backdropColor="rgba(0,0,0,0.8)"
      showHandle
      scrollable={false}
      sheetStyle={{ paddingTop: spacing.md }}
    >
      <View style={styles.headerRow}>
        <View style={[styles.iconCircle, { backgroundColor: withAlpha(theme.tint, 0.12) }]}>
          <Ionicons name="camera-outline" size={20} color={theme.tint} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <VibelyText variant="titleMD" style={{ color: theme.text }}>
            {step === 'submitted' ? 'Submitted' : 'Photo verification'}
          </VibelyText>
          <VibelyText variant="bodySecondary" style={{ color: theme.textSecondary, marginTop: 2 }}>
            {step === 'submitted' ? 'Under review — we’ll update your badge when approved.' : 'Take a quick selfie to verify you match your photos.'}
          </VibelyText>
        </View>
        <Pressable onPress={onClose} hitSlop={10} style={{ padding: 6 }}>
          <Ionicons name="close" size={20} color={theme.textSecondary} />
        </Pressable>
      </View>

      {error ? (
        <View style={[styles.banner, { backgroundColor: withAlpha(theme.danger, 0.12), borderColor: withAlpha(theme.danger, 0.25) }]}>
          <VibelyText variant="bodySecondary" style={{ color: theme.danger }}>
            {error}
          </VibelyText>
        </View>
      ) : null}

      {step === 'capture' ? (
        <View style={{ marginTop: spacing.md }}>
          <VibelyButton label="Open camera" onPress={startCapture} variant="gradient" />
          <VibelyText variant="caption" style={{ color: theme.textSecondary, marginTop: 10 }}>
            Tip: Good lighting, face visible, no sunglasses.
          </VibelyText>
        </View>
      ) : null}

      {step === 'preview' ? (
        <View style={{ marginTop: spacing.md }}>
          {selfieUri ? (
            <Image source={{ uri: selfieUri }} style={[styles.preview, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]} />
          ) : null}
          <View style={{ marginTop: spacing.md, gap: 10 }}>
            <VibelyButton label="Submit for review" onPress={submit} disabled={!canSubmit} variant="gradient" />
            <VibelyButton label="Retake selfie" onPress={startCapture} variant="secondary" />
          </View>
        </View>
      ) : null}

      {step === 'submitting' ? (
        <View style={{ marginTop: spacing.lg, alignItems: 'center', gap: 12 }}>
          <ActivityIndicator color={theme.tint} />
          <VibelyText variant="bodySecondary" style={{ color: theme.textSecondary }}>
            Uploading…
          </VibelyText>
        </View>
      ) : null}

      {step === 'submitted' ? (
        <View style={{ marginTop: spacing.lg, alignItems: 'center', gap: 10 }}>
          <View style={[styles.successCircle, { backgroundColor: withAlpha(theme.success, 0.14), borderColor: withAlpha(theme.success, 0.25) }]}>
            <Ionicons name="checkmark" size={18} color={theme.success} />
          </View>
          <VibelyText variant="titleSM" style={{ color: theme.text }}>
            Selfie submitted
          </VibelyText>
          <VibelyText variant="bodySecondary" style={{ color: theme.textSecondary, textAlign: 'center' }}>
            Your verification is now under review.
          </VibelyText>
        </View>
      ) : null}
    </KeyboardAwareBottomSheetModal>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
  },
  preview: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  successCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

