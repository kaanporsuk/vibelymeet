import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConnectivity } from '@/lib/useConnectivity';

export function OfflineBanner() {
  const state = useConnectivity();
  const insets = useSafeAreaInsets();
  const [showToast, setShowToast] = useState(false);
  const prevState = useRef(state);
  const mountTime = useRef(Date.now());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Only show "back online" toast if:
    // 1. Previous state was 'offline'
    // 2. New state is 'online'
    // 3. App has been running for at least 12 seconds (past startup)
    if (
      prevState.current === 'offline' &&
      state === 'online' &&
      Date.now() - mountTime.current > 12000
    ) {
      setShowToast(true);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setShowToast(false), 3000);
    }
    prevState.current = state;

    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [state]);

  if (state === 'offline') {
    return (
      <View style={[styles.banner, styles.offlineBanner, { paddingTop: insets.top + 4 }]}>
        <Text style={styles.offlineIcon}>☁</Text>
        <View>
          <Text style={styles.title}>You&apos;re offline</Text>
          <Text style={styles.subtitle}>We&apos;ll reconnect automatically</Text>
        </View>
      </View>
    );
  }

  if (showToast) {
    return (
      <View style={[styles.toast, { top: insets.top + 8 }]}>
        <Text style={styles.toastText}>✦ Back online</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  offlineBanner: {
    backgroundColor: 'rgba(15, 12, 30, 0.97)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245, 158, 11, 0.3)',
  },
  title: {
    color: '#F5F5F5',
    fontSize: 14,
    fontWeight: '600',
  },
  subtitle: {
    color: 'rgba(245,245,245,0.55)',
    fontSize: 12,
    marginTop: 1,
  },
  offlineIcon: {
    fontSize: 18,
  },
  toast: {
    position: 'absolute',
    left: '50%',
    transform: [{ translateX: -80 }],
    zIndex: 9998,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: 'rgba(10, 30, 30, 0.97)',
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
  toastText: {
    color: '#06B6D4',
    fontSize: 13,
    fontWeight: '600',
  },
});
