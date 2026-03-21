/**
 * Bidirectional swipe on chat list rows: right → profile, left → unmatch (callback).
 * Coordinates with parent for single open row + scroll dismiss.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Gesture, GestureDetector, Pressable } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import type { SharedValue } from 'react-native-reanimated';

const THRESHOLD = 80;
const MAX_DRAG = 120;

const SPRING = { damping: 28, stiffness: 280 };

export type SwipeableMatchConversationRowProps = {
  matchId: string;
  /** Front row content */
  children: React.ReactNode;
  backgroundColor: string;
  onPress: () => void;
  onLongPress: () => void;
  onSwipeRightCommit: () => void;
  onSwipeLeftCommit: () => void;
  /** Parent sets this when any row starts a horizontal pan; other rows close. */
  activeSwipeMatchId: string | null;
  /** Increment on FlatList scroll begin to close all swipes. */
  scrollCloseNonce: SharedValue<number>;
  onSwipeBegin: (id: string) => void;
  onSwipeEnd: () => void;
};

function triggerLightHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function SwipeableMatchConversationRow({
  matchId,
  children,
  backgroundColor,
  onPress,
  onLongPress,
  onSwipeRightCommit,
  onSwipeLeftCommit,
  activeSwipeMatchId,
  scrollCloseNonce,
  onSwipeBegin,
  onSwipeEnd,
}: SwipeableMatchConversationRowProps) {
  const translateX = useSharedValue(0);
  const hapticGate = useSharedValue(0);
  const activeSV = useSharedValue<string | null>(null);
  const matchIdSV = useSharedValue(matchId);

  useEffect(() => {
    activeSV.value = activeSwipeMatchId;
  }, [activeSwipeMatchId, activeSV]);

  useEffect(() => {
    matchIdSV.value = matchId;
  }, [matchId, matchIdSV]);

  useAnimatedReaction(
    () => activeSV.value,
    (cur) => {
      if (cur !== null && cur !== matchIdSV.value && Math.abs(translateX.value) > 0.5) {
        translateX.value = withSpring(0, SPRING);
      }
    }
  );

  useAnimatedReaction(
    () => scrollCloseNonce.value,
    () => {
      translateX.value = withSpring(0, SPRING);
    }
  );

  const pan = Gesture.Pan()
    .activeOffsetX([-22, 22])
    .failOffsetY([-14, 14])
    .onBegin(() => {
      hapticGate.value = 0;
      runOnJS(onSwipeBegin)(matchId);
    })
    .onUpdate((e) => {
      'worklet';
      const tx = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, e.translationX));
      translateX.value = tx;
      if (tx > THRESHOLD && hapticGate.value !== 1) {
        hapticGate.value = 1;
        runOnJS(triggerLightHaptic)();
      } else if (tx < -THRESHOLD && hapticGate.value !== -1) {
        hapticGate.value = -1;
        runOnJS(triggerLightHaptic)();
      } else if (Math.abs(tx) < THRESHOLD * 0.55) {
        hapticGate.value = 0;
      }
    })
    .onEnd(() => {
      'worklet';
      const tx = translateX.value;
      if (tx > THRESHOLD) {
        runOnJS(onSwipeRightCommit)();
        translateX.value = withSpring(0, SPRING);
      } else if (tx < -THRESHOLD) {
        runOnJS(onSwipeLeftCommit)();
        translateX.value = withSpring(0, SPRING);
      } else {
        translateX.value = withSpring(0, SPRING);
      }
      runOnJS(onSwipeEnd)();
    });

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    backgroundColor,
  }));

  const leftBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, 36, THRESHOLD], [0, 0.45, 1], Extrapolation.CLAMP),
  }));

  const rightBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-THRESHOLD, -36, 0], [1, 0.45, 0], Extrapolation.CLAMP),
  }));

  return (
    <View style={styles.wrap}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={styles.actionsRow}>
          <Animated.View style={[styles.leftStrip, leftBgStyle]}>
            <Ionicons name="person-outline" size={20} color="#fff" />
            <Text style={styles.actionLabel}>Profile</Text>
          </Animated.View>
          <View style={styles.actionsSpacer} />
          <Animated.View style={[styles.rightStrip, rightBgStyle]}>
            <Text style={styles.actionLabel}>Unmatch</Text>
            <Ionicons name="heart-dislike-outline" size={20} color="#fff" />
          </Animated.View>
        </View>
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.front, frontStyle]}>
          <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            delayLongPress={450}
            style={styles.pressableFill}
          >
            {children}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    overflow: 'hidden',
  },
  actionsRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  leftStrip: {
    width: 140,
    backgroundColor: '#7C3AED',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 20,
    gap: 8,
  },
  rightStrip: {
    width: 140,
    backgroundColor: '#EF4444',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 20,
    gap: 8,
  },
  actionsSpacer: { flex: 1 },
  front: {
    width: '100%',
  },
  pressableFill: {
    width: '100%',
  },
  actionLabel: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
});
