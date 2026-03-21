import React, { useEffect, useRef } from 'react';
import { Animated, View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { withAlpha } from '@/lib/colorUtils';
import { useConnectivity } from '@/lib/useConnectivity';
import { useColorScheme } from '@/components/useColorScheme';

export function OfflineBanner() {
  const scheme = useColorScheme() ?? 'dark';
  const theme = Colors[scheme];
  const insets = useSafeAreaInsets();
  const netState = useConnectivity();
  const showOfflineBanner = netState === 'offline' || netState === 'reconnecting';

  const bannerAnim = useRef(new Animated.Value(0)).current;
  const toastAnim = useRef(new Animated.Value(0)).current;
  const prevState = useRef(netState);

  const topOffset = insets.top + 8;

  useEffect(() => {
    if (showOfflineBanner) {
      Animated.spring(bannerAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();
    } else {
      bannerAnim.setValue(0);
    }

    if (
      netState === 'online' &&
      (prevState.current === 'offline' || prevState.current === 'reconnecting')
    ) {
      Animated.sequence([
        Animated.spring(toastAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 12 }),
        Animated.delay(2500),
        Animated.timing(toastAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
    }

    prevState.current = netState;
  }, [netState, showOfflineBanner, bannerAnim, toastAnim]);

  const bannerTranslateY = bannerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-80, 0],
  });

  const toastTranslateY = toastAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-80, 0],
  });

  const AMBER = '#F59E0B';
  const CYAN = '#22D3EE';

  return (
    <>
      {showOfflineBanner ? (
        <Animated.View
          style={[
            styles.banner,
            {
              marginTop: topOffset,
              backgroundColor: withAlpha('#1C1A2E', 0.97),
              borderColor: withAlpha(AMBER, 0.35),
              transform: [{ translateY: bannerTranslateY }],
            },
          ]}
          pointerEvents="auto"
        >
          <View style={styles.bannerInner}>
            <View style={[styles.iconWrap, { backgroundColor: withAlpha(AMBER, 0.15) }]}>
              {netState === 'reconnecting' ? (
                <ActivityIndicatorIcon color={AMBER} />
              ) : (
                <Ionicons name="cloud-offline-outline" size={18} color={AMBER} />
              )}
            </View>
            <View style={styles.textWrap}>
              <Text style={[styles.title, { color: theme.text }]}>
                {netState === 'reconnecting' ? 'Reconnecting…' : "You're offline"}
              </Text>
              <Text style={[styles.subtitle, { color: withAlpha(theme.text, 0.55) }]}>
                {netState === 'reconnecting'
                  ? 'Restoring your connection'
                  : "We'll reconnect automatically"}
              </Text>
            </View>
          </View>
        </Animated.View>
      ) : null}

      <Animated.View
        style={[
          styles.toast,
          {
            marginTop: topOffset,
            backgroundColor: withAlpha('#0F1F1F', 0.97),
            borderColor: withAlpha(CYAN, 0.4),
            transform: [{ translateY: toastTranslateY }],
          },
        ]}
        pointerEvents="none"
      >
        <Ionicons name="wifi" size={16} color={CYAN} />
        <Text style={[styles.toastText, { color: CYAN }]}>Back online</Text>
        <Text style={[styles.toastSub, { color: withAlpha(CYAN, 0.65) }]}>· Live updates resumed</Text>
      </Animated.View>
    </>
  );
}

function ActivityIndicatorIcon({ color }: { color: string }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1000, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Ionicons name="sync-outline" size={18} color={color} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    borderRadius: 16,
    borderWidth: 1,
    zIndex: 9999,
    elevation: 20,
  },
  bannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600', letterSpacing: 0.1 },
  subtitle: { fontSize: 12, marginTop: 1 },
  toast: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    zIndex: 9998,
    elevation: 19,
  },
  toastText: { fontSize: 13, fontWeight: '700' },
  toastSub: { fontSize: 13, fontWeight: '400' },
});
