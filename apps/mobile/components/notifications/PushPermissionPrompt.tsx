import React, { useEffect, useRef } from 'react';
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
import { requestPushPermissionsAfterPrompt, VIBELY_PUSH_PERMISSION_ASKED_KEY } from '@/lib/requestPushPermissions';

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

  const cardBorder = withAlpha(theme.tint, 0.38);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleNotNow}>
      <View style={styles.root}>
        <BlurView intensity={Platform.OS === 'ios' ? 88 : 72} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.dim} pointerEvents="none" />
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
          <Pressable onPress={handleEnable} style={({ pressed }) => [styles.primaryWrap, pressed && { opacity: 0.92 }]}>
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
