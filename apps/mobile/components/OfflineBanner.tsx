/**
 * Offline banner: slides in from top when disconnected. Reference: src/components/OfflineBanner.tsx
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useIsOffline } from '@/lib/useNetworkStatus';
import { spacing } from '@/constants/theme';

const BANNER_HEIGHT = 44;

export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const isOffline = useIsOffline();
  const translateY = useRef(new Animated.Value(-BANNER_HEIGHT - 20)).current;

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: isOffline ? 0 : -BANNER_HEIGHT - 20,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [isOffline, translateY]);

  return (
    <Animated.View
      style={[
        styles.banner,
        {
          top: 0,
          paddingTop: insets.top + spacing.sm,
          paddingBottom: spacing.sm,
          transform: [{ translateY }],
        },
      ]}
      pointerEvents={isOffline ? 'auto' : 'none'}
    >
      <Ionicons name="cloud-offline" size={20} color="#fff" />
      <Text style={styles.text}>No internet connection</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#c2410c',
    zIndex: 9999,
  },
  text: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
