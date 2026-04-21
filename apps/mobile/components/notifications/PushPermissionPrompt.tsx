import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  Animated,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Colors from '@/constants/Colors';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';
import {
  requestPushPermissionsAfterPrompt,
  setDashboardPushOsPermissionRequestInFlight,
  setDashboardPushPrepromptVisible,
  syncBackendAfterPushGrant,
  VIBELY_PUSH_PERMISSION_ASKED_KEY,
} from '@/lib/requestPushPermissions';
import { getStableOsPushPermissionState, pushPermDevLog, type OsPushPermissionState } from '@/lib/osPushPermission';
import { NotificationDeniedRecoverySurface } from '@/components/notifications/NotificationDeniedRecovery';
import { usePushPermission } from '@/lib/usePushPermission';

const DISMISS_BEFORE_OS_PERMISSION_MS = 200;

type Phase = 'preprompt' | 'deniedRecovery';

type Props = {
  visible: boolean;
  onClose: () => void;
  userId: string | undefined;
  onCompleted?: () => void;
};

export function PushPermissionPrompt({ visible, onClose, userId, onCompleted }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 40, 380);
  const pulse = useRef(new Animated.Value(0.55)).current;
  const [enableBusy, setEnableBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>('preprompt');
  const { refresh, openSettings, isGranted, isDenied, osStatus, permissionStateHydrated } = usePushPermission();
  const grantedBaselineRef = useRef<boolean | null>(null);
  const prepromptVisibleRef = useRef(false);
  const osPermissionRequestInFlightRef = useRef(false);

  useEffect(() => {
    prepromptVisibleRef.current = visible;
    setDashboardPushPrepromptVisible(visible);
    if (!visible) {
      setEnableBusy(false);
      setPhase('preprompt');
      grantedBaselineRef.current = null;
    }
    return () => {
      if (visible) {
        prepromptVisibleRef.current = false;
        setDashboardPushPrepromptVisible(false);
      }
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    void refresh('push_prompt_visible');
  }, [visible, refresh]);

  useEffect(() => {
    if (!visible || !permissionStateHydrated || phase !== 'preprompt' || enableBusy) return;
    if (!isGranted && !isDenied) return;
    if (__DEV__) {
      pushPermDevLog('preprompt_suppressed', {
        reason: 'visible_but_os_state_terminal',
        osStatus,
      });
    }
    onClose();
    onCompleted?.();
  }, [
    visible,
    permissionStateHydrated,
    phase,
    enableBusy,
    isGranted,
    isDenied,
    osStatus,
    onClose,
    onCompleted,
  ]);

  /** After returning from OS Settings (or split-screen), reconcile to granted without a reload. */
  useEffect(() => {
    if (!visible || !userId) return;
    if (grantedBaselineRef.current === null) {
      grantedBaselineRef.current = isGranted;
      return;
    }
    const prev = grantedBaselineRef.current;
    grantedBaselineRef.current = isGranted;
    if (prev || !isGranted) return;
    void (async () => {
      await AsyncStorage.setItem(VIBELY_PUSH_PERMISSION_ASKED_KEY, 'true');
      await syncBackendAfterPushGrant(userId);
      setPhase('preprompt');
      onClose();
      onCompleted?.();
    })();
  }, [visible, userId, isGranted, onClose, onCompleted]);

  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 1400, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);

  const handleNotNow = async () => {
    if (!prepromptVisibleRef.current) return;
    if (osPermissionRequestInFlightRef.current) {
      if (__DEV__) {
        pushPermDevLog('preprompt_suppressed', {
          reason: 'dismiss_while_os_request_in_flight',
        });
      }
      return;
    }
    if (__DEV__) pushPermDevLog('PushPermissionPrompt: Not now / cancel — dismiss, no OS request');
    await AsyncStorage.setItem(VIBELY_PUSH_PERMISSION_ASKED_KEY, 'skipped');
    onClose();
    onCompleted?.();
  };

  const handleEnable = async () => {
    if (!prepromptVisibleRef.current) return;
    if (enableBusy || osPermissionRequestInFlightRef.current) {
      if (__DEV__) {
        pushPermDevLog('preprompt_suppressed', {
          reason: enableBusy ? 'enable_busy' : 'os_permission_request_in_flight',
        });
      }
      return;
    }
    osPermissionRequestInFlightRef.current = true;
    setDashboardPushOsPermissionRequestInFlight(true);
    setEnableBusy(true);
    try {
      if (!userId) {
        await AsyncStorage.setItem(VIBELY_PUSH_PERMISSION_ASKED_KEY, 'true');
        onClose();
        onCompleted?.();
        return;
      }
      await refresh('push_prompt_enable_pressed');
      let os: OsPushPermissionState;
      try {
        os = await getStableOsPushPermissionState('push_prompt_enable_before_request');
      } catch (e) {
        if (__DEV__) {
          pushPermDevLog('prompt_suppressed', {
            reason: 'permission_state_read_failed',
            message: e instanceof Error ? e.message : String(e),
          });
        }
        onClose();
        onCompleted?.();
        return;
      }
      if (os === 'denied') {
        if (__DEV__) pushPermDevLog('PushPermissionPrompt: OS denied — passive recovery only, no requestPermission');
        await AsyncStorage.setItem(VIBELY_PUSH_PERMISSION_ASKED_KEY, 'true');
        setPhase('deniedRecovery');
        return;
      }
      if (os === 'granted') {
        await AsyncStorage.setItem(VIBELY_PUSH_PERMISSION_ASKED_KEY, 'true');
        await syncBackendAfterPushGrant(userId);
        onClose();
        onCompleted?.();
        return;
      }
      /** Persist before closing modal so no other effect can re-show preprompt while the system sheet runs. */
      await AsyncStorage.setItem(VIBELY_PUSH_PERMISSION_ASKED_KEY, 'true');
      if (__DEV__) pushPermDevLog('PushPermissionPrompt: undetermined — close branded modal, then OS sheet');
      onClose();
      await new Promise<void>((resolve) => setTimeout(resolve, DISMISS_BEFORE_OS_PERMISSION_MS));
      await requestPushPermissionsAfterPrompt(userId);
      onCompleted?.();
    } finally {
      osPermissionRequestInFlightRef.current = false;
      setDashboardPushOsPermissionRequestInFlight(false);
      setEnableBusy(false);
    }
  };

  const cardBorder = withAlpha(theme.tint, 0.38);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleNotNow}>
      <View style={styles.root}>
        <BlurView intensity={Platform.OS === 'ios' ? 88 : 72} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.dim} pointerEvents="none" />
        {phase === 'deniedRecovery' ? (
          <View style={{ width: Math.min(width - 40, 400), alignSelf: 'center' }}>
            <NotificationDeniedRecoverySurface
              onOpenSettings={() => {
                void AsyncStorage.setItem(VIBELY_PUSH_PERMISSION_ASKED_KEY, 'true');
                openSettings();
                onClose();
                onCompleted?.();
              }}
              onDismiss={handleNotNow}
              compact
            />
          </View>
        ) : (
          <View style={[styles.card, { width: cardWidth, borderColor: cardBorder, backgroundColor: theme.glassSurface }]}>
            <View style={styles.iconWrap}>
              <Animated.View
                style={[
                  styles.glow,
                  {
                    opacity: pulse,
                    shadowColor: theme.tint,
                    backgroundColor: withAlpha(theme.tint, 0.22),
                  },
                ]}
              />
              <Ionicons name="notifications" size={34} color={theme.tint} />
            </View>
            <Text style={[styles.title, { color: theme.text }]}>Never miss a vibe</Text>
            <Text style={[styles.body, { color: theme.mutedForeground }]}>
              Get notified when someone matches with you, messages you, or when your event and date activity needs your
              attention. You stay in control in Settings.
            </Text>
            <Pressable
              onPress={() => void handleEnable()}
              disabled={enableBusy}
              style={({ pressed }) => [styles.primaryWrap, pressed && { opacity: 0.92 }]}
            >
              <LinearGradient
                colors={[theme.tint, theme.accent]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.primaryBtn}
              >
                <Text style={styles.primaryBtnText}>Turn On Notifications</Text>
              </LinearGradient>
            </Pressable>
            <Pressable onPress={handleNotNow} hitSlop={12} style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.65 }]}>
              <Text style={[styles.secondaryText, { color: theme.mutedForeground }]}>Not now</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  card: {
    borderRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 18,
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.45,
        shadowRadius: 28,
      },
      android: {
        elevation: 18,
      },
    }),
  },
  iconWrap: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  glow: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 18,
    elevation: 10,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 20,
  },
  primaryWrap: {
    marginTop: 20,
    borderRadius: 14,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: 'hsl(263, 70%, 50%)',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 12,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  primaryBtn: {
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  secondaryBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 2,
  },
  secondaryText: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
});
