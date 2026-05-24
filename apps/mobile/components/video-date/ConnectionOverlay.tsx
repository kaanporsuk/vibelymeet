/**
 * Shown while connecting to Daily room. Pulsing rings + "Connecting you..." message.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Pressable, Image, ActivityIndicator } from 'react-native';
import { typography, spacing } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';
import { resolveVideoDatePartnerWaitMaxState } from '@clientShared/matching/videoDatePhase4';

/** `joining` = token/handshake/Daily connect; `waiting_peer` = local in room, peer not yet observed. */
export type ConnectionOverlayMode = 'joining' | 'waiting_peer';

type Props = {
  /** @deprecated Prefer `mode` — when set, overrides `isConnecting` mapping. */
  isConnecting?: boolean;
  mode?: ConnectionOverlayMode;
  onLeave: () => void;
  isLeaving?: boolean;
  /** When `waiting_peer`, optional title if server shows the peer has not joined Daily yet (vs generic wait). */
  waitingPeerTitle?: string;
  /** When `waiting_peer`, optional subtitle (e.g. reconnect vs not-in-app — caller decides). */
  waitingPeerSubtitle?: string;
  partnerName?: string | null;
  partnerAvatarUri?: string | null;
};

export function ConnectionOverlay({
  isConnecting,
  mode,
  onLeave,
  isLeaving = false,
  waitingPeerTitle,
  waitingPeerSubtitle,
  partnerName,
  partnerAvatarUri,
}: Props) {
  const resolvedMode: ConnectionOverlayMode =
    mode ?? (isConnecting ? 'joining' : 'waiting_peer');
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const ring1 = useRef(new Animated.Value(1)).current;
  const ring2 = useRef(new Animated.Value(1)).current;
  const openingPartnerName = resolvedMode === 'joining' && partnerName?.trim() ? partnerName.trim() : null;
  const showOpeningIdentity = resolvedMode === 'joining' && Boolean(openingPartnerName || partnerAvatarUri);
  const partnerInitial = openingPartnerName?.slice(0, 1).toUpperCase() || 'V';
  const [connectingElapsedMs, setConnectingElapsedMs] = useState(0);
  const [waitingStartedAtMs, setWaitingStartedAtMs] = useState<number | null>(null);
  const [waitingNowMs, setWaitingNowMs] = useState(() => Date.now());
  const [waitingResetNonce, setWaitingResetNonce] = useState(0);

  useEffect(() => {
    const anim1 = Animated.loop(
      Animated.sequence([
        Animated.timing(ring1, { toValue: 1.5, duration: 1000, useNativeDriver: true }),
        Animated.timing(ring1, { toValue: 1, duration: 0, useNativeDriver: true }),
      ])
    );
    const anim2 = Animated.loop(
      Animated.sequence([
        Animated.delay(400),
        Animated.timing(ring2, { toValue: 1.5, duration: 1000, useNativeDriver: true }),
        Animated.timing(ring2, { toValue: 1, duration: 0, useNativeDriver: true }),
      ])
    );
    anim1.start();
    anim2.start();
    return () => {
      anim1.stop();
      anim2.stop();
    };
  }, [ring1, ring2]);

  useEffect(() => {
    if (resolvedMode !== 'joining') {
      setConnectingElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    setConnectingElapsedMs(0);
    const intervalId = setInterval(() => {
      setConnectingElapsedMs(Math.max(0, Date.now() - startedAt));
    }, 250);
    return () => clearInterval(intervalId);
  }, [resolvedMode]);

  useEffect(() => {
    if (resolvedMode !== 'waiting_peer') {
      setWaitingStartedAtMs(null);
      return;
    }
    const startedAt = Date.now();
    setWaitingStartedAtMs(startedAt);
    setWaitingNowMs(startedAt);
    const intervalId = setInterval(() => {
      setWaitingNowMs(Date.now());
    }, 1000);
    return () => clearInterval(intervalId);
  }, [resolvedMode, waitingResetNonce]);

  if (resolvedMode === 'joining' && connectingElapsedMs < 700) return null;

  const connectingSlow = resolvedMode === 'joining' && connectingElapsedMs >= 3_000;
  const connectingVerySlow = resolvedMode === 'joining' && connectingElapsedMs >= 8_000;
  const partnerWaitMax = resolveVideoDatePartnerWaitMaxState(
    resolvedMode === 'waiting_peer' ? waitingStartedAtMs : null,
    waitingNowMs,
  ).showEscalation;

  return (
    <View style={styles.overlay}>
      <View style={styles.content}>
        <View style={styles.ringsWrap}>
          <Animated.View
            style={[
              styles.ring,
              { borderColor: theme.tint, opacity: 0.5 },
              { transform: [{ scale: ring1 }] },
            ]}
          />
          <Animated.View
            style={[
              styles.ring,
              { borderColor: theme.tint, opacity: 0.5 },
              { transform: [{ scale: ring2 }] },
            ]}
          />
          <View style={[styles.centerDot, { backgroundColor: withAlpha(theme.tint, 0.19) }]}>
            {showOpeningIdentity ? (
              <>
                {partnerAvatarUri ? (
                  <Image source={{ uri: partnerAvatarUri }} style={styles.partnerAvatar} resizeMode="cover" />
                ) : (
                  <Text style={[styles.partnerInitial, { color: theme.text }]}>{partnerInitial}</Text>
                )}
                <View style={[styles.loadingBadge, { backgroundColor: theme.background, borderColor: theme.glassBorder }]}>
                  <ActivityIndicator size="small" color={theme.tint} />
                </View>
              </>
            ) : (
              <View style={[styles.innerDot, { backgroundColor: theme.tint }]} />
            )}
          </View>
        </View>
        {openingPartnerName ? (
          <Text style={[styles.eyebrow, { color: theme.tint }]}>You're both ready</Text>
        ) : null}
        <Text style={[styles.title, { color: theme.text }]}>
          {resolvedMode === 'joining'
            ? connectingSlow
              ? 'Still connecting...'
              : 'Opening the room...'
            : partnerWaitMax
              ? 'Partner appears to have left'
              : waitingPeerTitle ?? 'Holding the room softly'}
        </Text>
        <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>
          {resolvedMode === 'joining'
            ? connectingVerySlow
              ? 'This is taking longer than usual. You can leave safely if the room does not open.'
              : connectingSlow
                ? 'This usually takes a moment.'
                : openingPartnerName
                  ? `Setting up a quiet start with ${openingPartnerName}.`
                  : 'Setting up a quiet start for your video date.'
            : partnerWaitMax
              ? 'Return to the deck, or keep this room open a little longer.'
              : waitingPeerSubtitle ?? 'Your date will start once you are both here.'}
        </Text>
        {partnerWaitMax ? (
          <Pressable
            onPress={() => setWaitingResetNonce((value) => value + 1)}
            disabled={isLeaving}
            style={({ pressed }) => [
              styles.keepWaitingBtn,
              { borderColor: theme.border, backgroundColor: withAlpha(theme.tint, 0.14) },
              pressed && styles.pressed,
              isLeaving && styles.disabled,
            ]}
          >
            <Text style={[styles.leaveBtnText, { color: theme.text }]}>Keep waiting</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onLeave}
          disabled={isLeaving}
          style={({ pressed }) => [
            styles.leaveBtn,
            { borderColor: theme.border },
            pressed && styles.pressed,
            isLeaving && styles.disabled,
          ]}
        >
          <Text style={[styles.leaveBtnText, { color: theme.text }]}>
            {isLeaving ? 'Leaving...' : partnerWaitMax ? 'Return to deck' : 'Leave'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 50,
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: spacing['2xl'],
    maxWidth: 320,
  },
  ringsWrap: {
    width: 96,
    height: 96,
    marginBottom: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
  },
  centerDot: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  partnerAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  partnerInitial: {
    fontSize: 24,
    fontWeight: '800',
  },
  loadingBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    marginBottom: spacing.xs,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    ...typography.titleMD,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  leaveBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 24,
    borderWidth: 1,
  },
  keepWaitingBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  leaveBtnText: {
    ...typography.body,
    fontSize: 16,
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.6,
  },
});
