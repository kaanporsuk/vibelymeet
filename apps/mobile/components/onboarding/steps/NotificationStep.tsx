import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import { NotificationDeniedRecoveryModal } from '@/components/notifications/NotificationDeniedRecovery';
import { syncBackendAfterPushGrant } from '@/lib/requestPushPermissions';
import { usePushPermission } from '@/lib/usePushPermission';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

export default function NotificationStep({ userId, onNext }: { userId: string; onNext: () => void }) {
  const theme = Colors[useColorScheme()];
  const { requestPermission, openSettings, isGranted } = usePushPermission();
  const [busy, setBusy] = useState(false);
  const [showDeniedRecovery, setShowDeniedRecovery] = useState(false);

  useEffect(() => {
    if (!isGranted || !showDeniedRecovery) return;
    setShowDeniedRecovery(false);
    void syncBackendAfterPushGrant(userId);
  }, [isGranted, showDeniedRecovery, userId]);

  const ask = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await requestPermission();
      if (result.osDenied) {
        setShowDeniedRecovery(true);
        return;
      }
      if (result.granted) {
        await syncBackendAfterPushGrant(userId);
      }
      onNext();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>Don't miss a vibe</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>Matches, events, and date reminders.</Text>
      <View style={[styles.mockCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
        <Text style={{ color: theme.text }}>🎉 You matched with Alex at Friday Night Social!</Text>
      </View>
      <VibelyButton label="Turn on notifications" onPress={ask} variant="gradient" disabled={busy} />
      <Pressable onPress={onNext}>
        <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Maybe later</Text>
      </Pressable>

      <NotificationDeniedRecoveryModal
        visible={showDeniedRecovery}
        onClose={() => setShowDeniedRecovery(false)}
        onOpenSettings={() => {
          openSettings();
          setShowDeniedRecovery(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  h1: { fontSize: 30, fontWeight: '700' },
  sub: { fontSize: 14 },
  mockCard: { borderWidth: 1, borderRadius: 14, padding: 12 },
});
