/**
 * Notification permission flow — parity with web: intro, requesting, success, denied + Open Settings when denied.
 */
import React, { useState, useRef, useEffect } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { VibelyButton } from '@/components/ui';
import { withAlpha } from '@/lib/colorUtils';
import { spacing, radius } from '@/constants/theme';
import { trackEvent } from '@/lib/analytics';
import { NotificationDeniedRecoverySurface } from '@/components/notifications/NotificationDeniedRecovery';

type Step = 'intro' | 'requesting' | 'success' | 'denied';

type NotificationPermissionFlowProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestPermission: () => Promise<boolean>;
  openSettings?: () => void;
};

export function NotificationPermissionFlow({
  open,
  onOpenChange,
  onRequestPermission,
  openSettings = () => { if (Platform.OS === 'ios') Linking.openURL('app-settings:'); else Linking.openSettings(); },
}: NotificationPermissionFlowProps) {
  const theme = Colors[useColorScheme()];
  const [step, setStep] = useState<Step>('intro');
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
    };
  }, []);

  const handleEnable = async () => {
    setStep('requesting');
    const granted = await onRequestPermission();
    setStep(granted ? 'success' : 'denied');
    if (granted) {
      trackEvent('push_permission_granted');
      if (closeTimeoutRef.current !== null) clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = setTimeout(() => {
        onOpenChange(false);
        closeTimeoutRef.current = null;
      }, 2000);
    }
  };

  const handleClose = () => {
    if (step === 'intro') {
      trackEvent('push_permission_deferred');
    }
    if (closeTimeoutRef.current !== null) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setStep('intro');
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <Modal visible transparent animationType="fade">
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable style={[styles.dialog, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]} onPress={(e) => e.stopPropagation()}>
          {step === 'intro' && (
            <>
              <View style={[styles.iconWrap, { backgroundColor: theme.tintSoft }]}>
                <Ionicons name="notifications" size={40} color={theme.tint} />
              </View>
              <Text style={[styles.title, { color: theme.text }]}>Never Miss a Vibe</Text>
              <Text style={[styles.sub, { color: theme.textSecondary }]}>
                Get notified when your daily drop arrives and when your dates are about to start.
              </Text>
              <View style={styles.bullets}>
                <View style={[styles.bullet, { backgroundColor: withAlpha(theme.tintSoft, 0.5) }]}>
                  <Text style={styles.bulletEmoji}>💧</Text>
                  <Text style={[styles.bulletText, { color: theme.text }]}>Daily drop ready at 6 PM</Text>
                </View>
                <View style={[styles.bullet, { backgroundColor: withAlpha(theme.neonCyan, 0.125) }]}>
                  <Text style={styles.bulletEmoji}>📅</Text>
                  <Text style={[styles.bulletText, { color: theme.text }]}>Date reminders before start</Text>
                </View>
                <View style={[styles.bullet, { backgroundColor: withAlpha(theme.accent, 0.125) }]}>
                  <Text style={styles.bulletEmoji}>💬</Text>
                  <Text style={[styles.bulletText, { color: theme.text }]}>New matches & messages</Text>
                </View>
              </View>
              <View style={styles.actions}>
                <VibelyButton label="Not Now" onPress={handleClose} variant="secondary" style={styles.actionBtn} />
                <VibelyButton label="Enable Notifications" onPress={handleEnable} variant="primary" style={styles.actionBtn} />
              </View>
            </>
          )}
          {step === 'requesting' && (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={theme.tint} />
              <Text style={[styles.sub, { color: theme.text, marginTop: spacing.lg }]}>Please allow notifications...</Text>
            </View>
          )}
          {step === 'success' && (
            <View style={styles.centered}>
              <View style={[styles.iconWrap, { backgroundColor: withAlpha(theme.success, 0.19) }]}>
                <Ionicons name="checkmark-circle" size={40} color={theme.success} />
              </View>
              <Text style={[styles.title, { color: theme.text }]}>You're All Set!</Text>
              <Text style={[styles.sub, { color: theme.textSecondary }]}>We'll notify you about important vibes.</Text>
            </View>
          )}
          {step === 'denied' && (
            <NotificationDeniedRecoverySurface
              compact
              onOpenSettings={() => {
                openSettings();
                handleClose();
              }}
              onDismiss={handleClose}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  dialog: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    padding: spacing.xl,
    alignItems: 'center',
  },
  iconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  title: { fontSize: 20, fontWeight: '700', marginBottom: spacing.sm, textAlign: 'center' },
  sub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  bullets: { width: '100%', gap: spacing.sm, marginVertical: spacing.lg },
  bullet: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, gap: spacing.sm },
  bulletEmoji: { fontSize: 18 },
  bulletText: { fontSize: 14, flex: 1 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg, width: '100%' },
  actionBtn: { flex: 1 },
  centered: { alignItems: 'center', paddingVertical: spacing.xl },
});
