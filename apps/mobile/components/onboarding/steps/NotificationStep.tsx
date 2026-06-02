import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import { NotificationDeniedRecoveryModal } from '@/components/notifications/NotificationDeniedRecovery';
import {
  markNativePushPermissionAsked,
  requestPushPermissionsAfterPrompt,
  syncBackendAfterPushGrant,
} from '@/lib/requestPushPermissions';
import { usePushPermission } from '@/lib/usePushPermission';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { PushSyncResult } from '@clientShared/pushDeliveryHealth';

const AMBER = '#F59E0B';

function nativePushSetupRecoveryMessage(sync?: PushSyncResult | null): string {
  if (!sync) return 'Notification setup did not finish. Check your connection and try again.';
  if (sync.code === 'no_player_id_after_retry') {
    return 'Notifications are allowed, but this device is still finishing setup. Try again in a moment.';
  }
  if (sync.code === 'sdk_not_ready' || sync.code === 'init_failed') {
    return 'Notifications are allowed, but the push service is still starting. Try again in a moment.';
  }
  if (sync.code === 'app_id_missing') {
    return 'Notifications are not available in this app environment. You can continue without push alerts.';
  }
  return sync.message || 'Notifications are allowed, but we could not save this device yet. Try again.';
}

export default function NotificationStep({ userId, onNext }: { userId: string; onNext: () => void }) {
  const theme = Colors[useColorScheme()];
  const { openSettings, isGranted } = usePushPermission();
  const [busy, setBusy] = useState(false);
  const [showDeniedRecovery, setShowDeniedRecovery] = useState(false);
  const [setupRecoveryMessage, setSetupRecoveryMessage] = useState<string | null>(null);
  const settingsRecoveryActiveRef = useRef(false);
  const recoveryUserIdRef = useRef<string | null>(null);
  const activeUserIdRef = useRef(userId);
  const mountedRef = useRef(true);
  activeUserIdRef.current = userId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isActivePromptUser = useCallback(
    (promptUserId: string) => mountedRef.current && activeUserIdRef.current === promptUserId,
    [],
  );

  useEffect(() => {
    settingsRecoveryActiveRef.current = false;
    recoveryUserIdRef.current = null;
    setBusy(false);
    setShowDeniedRecovery(false);
    setSetupRecoveryMessage(null);
  }, [userId]);

  useEffect(() => {
    if (!isGranted || (!showDeniedRecovery && !settingsRecoveryActiveRef.current)) return;
    const promptUserId = userId;
    settingsRecoveryActiveRef.current = false;
    recoveryUserIdRef.current = null;
    setShowDeniedRecovery(false);
    void syncBackendAfterPushGrant(promptUserId).then((sync) => {
      if (sync.code === 'stale_identity') return;
      if (!isActivePromptUser(promptUserId)) return;
      if (!sync.synced) {
        setSetupRecoveryMessage(nativePushSetupRecoveryMessage(sync));
        return;
      }
      onNext();
    }).catch((e) => {
      if (!isActivePromptUser(promptUserId)) return;
      setSetupRecoveryMessage(e instanceof Error ? e.message : 'Notification setup did not finish. Try again.');
    });
  }, [isActivePromptUser, isGranted, onNext, showDeniedRecovery, userId]);

  const ask = async () => {
    if (busy) return;
    const promptUserId = userId;
    setBusy(true);
    setSetupRecoveryMessage(null);
    try {
      const result = await requestPushPermissionsAfterPrompt(promptUserId);
      if (!isActivePromptUser(promptUserId)) return;
      if (result.outcome === 'already_denied' || result.outcome === 'denied_after_sheet') {
        recoveryUserIdRef.current = promptUserId;
        setShowDeniedRecovery(true);
        return;
      }
      if (result.outcome === 'stale_identity') {
        return;
      }
      if (result.outcome === 'granted' && !result.sync.synced) {
        setSetupRecoveryMessage(nativePushSetupRecoveryMessage(result.sync));
        return;
      }
      if (result.outcome === 'request_failed' || result.outcome === 'no_app_id') {
        setSetupRecoveryMessage(nativePushSetupRecoveryMessage());
        return;
      }
      onNext();
    } catch (e) {
      if (!isActivePromptUser(promptUserId)) return;
      setSetupRecoveryMessage(e instanceof Error ? e.message : 'Notification setup did not finish. Try again.');
    } finally {
      if (isActivePromptUser(promptUserId)) setBusy(false);
    }
  };

  const skipForActiveUser = () => {
    const promptUserId = userId;
    if (!isActivePromptUser(promptUserId)) return;
    void markNativePushPermissionAsked('skipped', promptUserId);
    onNext();
  };

  const openSettingsForActiveUser = () => {
    const promptUserId = recoveryUserIdRef.current ?? userId;
    if (!isActivePromptUser(promptUserId)) return;
    settingsRecoveryActiveRef.current = true;
    openSettings();
  };

  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>Don't miss a vibe</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>Matches, events, and date reminders.</Text>
      <View style={[styles.mockCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
        <Text style={{ color: theme.text }}>🎉 You matched with Alex at Friday Night Social!</Text>
      </View>
      {setupRecoveryMessage ? (
        <View style={[styles.recoveryCard, { borderColor: AMBER, backgroundColor: 'rgba(245,158,11,0.12)' }]}>
          <Text style={[styles.recoveryTitle, { color: theme.text }]}>Notification setup needs a retry</Text>
          <Text style={[styles.recoveryText, { color: theme.textSecondary }]}>{setupRecoveryMessage}</Text>
        </View>
      ) : null}
      <VibelyButton label="Turn on notifications" onPress={ask} variant="gradient" disabled={busy} />
      <Pressable onPress={skipForActiveUser}>
        <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Maybe later</Text>
      </Pressable>

      <NotificationDeniedRecoveryModal
        visible={showDeniedRecovery}
        onClose={() => {
          const promptUserId = recoveryUserIdRef.current ?? userId;
          settingsRecoveryActiveRef.current = false;
          recoveryUserIdRef.current = null;
          setShowDeniedRecovery(false);
          if (!isActivePromptUser(promptUserId)) return;
          void markNativePushPermissionAsked('skipped', promptUserId);
          onNext();
        }}
        onOpenSettings={openSettingsForActiveUser}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  h1: { fontSize: 30, fontWeight: '700' },
  sub: { fontSize: 14 },
  mockCard: { borderWidth: 1, borderRadius: 14, padding: 12 },
  recoveryCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 4 },
  recoveryTitle: { fontSize: 14, fontWeight: '700' },
  recoveryText: { fontSize: 13, lineHeight: 18 },
});
