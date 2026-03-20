import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import Colors from '@/constants/Colors';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';
import { requestPushPermissionsAfterPrompt, VIBELY_PUSH_PERMISSION_ASKED_KEY } from '@/lib/requestPushPermissions';

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'heart-outline', text: 'New matches and mutual vibes' },
  { icon: 'videocam-outline', text: 'Video date invitations' },
  { icon: 'calendar-outline', text: 'Event reminders and Daily Drop' },
];

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
  const cardWidth = Math.min(width - 48, 400);
  const pulse = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.6, duration: 1200, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);

  const handleNotNow = async () => {
    await AsyncStorage.setItem(VIBELY_PUSH_PERMISSION_ASKED_KEY, 'skipped');
    onClose();
    onCompleted?.();
  };

  const handleEnable = async () => {
    if (!userId) {
      await AsyncStorage.setItem(VIBELY_PUSH_PERMISSION_ASKED_KEY, 'true');
      onClose();
      onCompleted?.();
      return;
    }
    await requestPushPermissionsAfterPrompt(userId);
    onClose();
    onCompleted?.();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleNotNow}>
      <View style={[styles.overlay, { backgroundColor: withAlpha(theme.background, 0.95) }]}>
        <View style={[styles.card, { width: cardWidth, backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.iconWrap}>
            <Animated.View
              style={[
                styles.glow,
                {
                  opacity: pulse,
                  shadowColor: theme.tint,
                  backgroundColor: withAlpha(theme.tint, 0.2),
                },
              ]}
            />
            <Ionicons name="notifications" size={64} color={theme.tint} />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>Stay in the loop</Text>
          <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>
            Get notified when someone vibes you back,{'\n'}your video date is ready, and new events drop.
          </Text>
          <View style={styles.features}>
            {FEATURES.map((f) => (
              <View key={f.text} style={styles.featureRow}>
                <Ionicons name={f.icon} size={18} color={theme.tint} />
                <Text style={[styles.featureText, { color: theme.text }]}>{f.text}</Text>
              </View>
            ))}
          </View>
          <Pressable onPress={handleEnable} style={({ pressed }) => [pressed && { opacity: 0.92 }]}>
            <LinearGradient
              colors={[theme.tint, theme.accent]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryBtn}
            >
              <Text style={styles.primaryBtnText}>Enable Notifications</Text>
            </LinearGradient>
          </Pressable>
          <Pressable onPress={handleNotNow} style={styles.secondaryBtn}>
            <Text style={[styles.secondaryText, { color: theme.mutedForeground }]}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    borderRadius: 24,
    padding: 32,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  glow: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 24,
    elevation: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
  features: {
    marginTop: 20,
    marginBottom: 24,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 6,
  },
  featureText: {
    fontSize: 14,
    flex: 1,
  },
  primaryBtn: {
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  secondaryText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
