import { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Pressable,
  Image,
  Dimensions,
  StyleSheet,
  Text,
  ActivityIndicator,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { safeVideoPlayerCall } from '@/lib/expoVideoSafe';

export type ChatThreadPhotoItem = { id: string; uri: string };

const SPRING = { damping: 22, stiffness: 260 };

function ZoomablePhotoPage({ uri, onSwipeDismiss }: { uri: string; onSwipeDismiss: () => void }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const panStartTx = useSharedValue(0);
  const panStartTy = useSharedValue(0);
  const dismissY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      const next = Math.min(4, Math.max(1, savedScale.value * e.scale));
      scale.value = next;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value < 1.02) {
        scale.value = withSpring(1, SPRING);
        savedScale.value = 1;
        tx.value = withSpring(0, SPRING);
        ty.value = withSpring(0, SPRING);
      }
    });

  const pan = Gesture.Pan()
    .onStart(() => {
      panStartTx.value = tx.value;
      panStartTy.value = ty.value;
    })
    .onUpdate((e) => {
      if (scale.value > 1.05) {
        tx.value = panStartTx.value + e.translationX;
        ty.value = panStartTy.value + e.translationY;
      } else {
        dismissY.value = e.translationY;
      }
    })
    .onEnd((e) => {
      if (scale.value > 1.05) {
        return;
      }
      if (Math.abs(dismissY.value) > 88 || Math.abs(e.velocityY) > 800) {
        runOnJS(onSwipeDismiss)();
      }
      dismissY.value = withSpring(0, SPRING);
    });

  const composed = Gesture.Simultaneous(pinch, pan);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const { width: W, height: H } = Dimensions.get('window');
  const maxW = W - 24;
  const maxH = H * 0.78;

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[styles.zoomShell, { width: W, height: H * 0.82 }]}>
        <Animated.View style={imageStyle}>
          <Image
            source={{ uri }}
            style={{ width: maxW, height: maxH }}
            resizeMode="contain"
            accessibilityLabel="Chat photo"
          />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

function PhotoViewerBody({
  items,
  initialId,
  onClose,
}: {
  items: ChatThreadPhotoItem[];
  initialId: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const start = Math.max(0, items.findIndex((i) => i.id === initialId));
  const [index, setIndex] = useState(start);

  useEffect(() => {
    setIndex(Math.max(0, items.findIndex((i) => i.id === initialId)));
  }, [initialId, items]);

  const current = items[index];
  const goPrev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : items.length - 1));
  }, [items.length]);
  const goNext = useCallback(() => {
    setIndex((i) => (i < items.length - 1 ? i + 1 : 0));
  }, [items.length]);

  if (!current) return null;

  return (
    <GestureHandlerRootView style={styles.flex}>
      <View style={[styles.photoRoot, { paddingTop: insets.top + 8 }]}>
        <View style={styles.photoTopBar}>
          <Text style={styles.counter}>
            {items.length > 1 ? `${index + 1} / ${items.length}` : ' '}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityLabel="Close photo"
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="close" size={28} color="rgba(255,255,255,0.95)" />
          </Pressable>
        </View>

        <View style={styles.photoStage}>
          <ZoomablePhotoPage key={current.id} uri={current.uri} onSwipeDismiss={onClose} />
        </View>

        {items.length > 1 ? (
          <>
            <Pressable
              style={[styles.chevronLeft, { top: '42%' }]}
              onPress={goPrev}
              hitSlop={16}
              accessibilityLabel="Previous photo"
            >
              <Ionicons name="chevron-back" size={36} color="rgba(255,255,255,0.88)" />
            </Pressable>
            <Pressable
              style={[styles.chevronRight, { top: '42%' }]}
              onPress={goNext}
              hitSlop={16}
              accessibilityLabel="Next photo"
            >
              <Ionicons name="chevron-forward" size={36} color="rgba(255,255,255,0.88)" />
            </Pressable>
          </>
        ) : null}

        <Text style={[styles.hint, { paddingBottom: Math.max(12, insets.bottom + 6) }]}>
          Pinch to zoom · swipe down to close
        </Text>
      </View>
    </GestureHandlerRootView>
  );
}

export function ChatThreadPhotoViewerModal({
  visible,
  items,
  initialId,
  onClose,
}: {
  visible: boolean;
  items: ChatThreadPhotoItem[];
  initialId: string;
  onClose: () => void;
}) {
  if (!visible || items.length === 0) return null;

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <PhotoViewerBody items={items} initialId={initialId} onClose={onClose} />
    </Modal>
  );
}

function VideoViewerBody({
  uri,
  posterUri,
  onClose,
}: {
  uri: string;
  posterUri?: string | null;
  onClose: () => void;
}) {
  const [retryKey, setRetryKey] = useState(0);
  return (
    <VideoViewerStage
      key={`${uri}-${retryKey}`}
      uri={uri}
      posterUri={posterUri}
      onClose={onClose}
      onRemountPlayer={() => setRetryKey((k) => k + 1)}
    />
  );
}

/**
 * Isolated stage so `useVideoPlayer` + cleanup run per mount — preserves safeVideoPlayerCall teardown
 * and allows Try again to recreate the player after errors.
 */
function VideoViewerStage({
  uri,
  posterUri,
  onClose,
  onRemountPlayer,
}: {
  uri: string;
  posterUri?: string | null;
  onClose: () => void;
  onRemountPlayer: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');

  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    const sub = player.addListener('statusChange', (payload) => {
      if (payload.status === 'error') {
        setPhase('error');
        return;
      }
      if (payload.status === 'readyToPlay') {
        setPhase('ready');
      }
      if (payload.status === 'loading') {
        setPhase('loading');
      }
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    safeVideoPlayerCall(() => {
      player.play();
    });
    return () => {
      safeVideoPlayerCall(() => {
        player.pause();
      });
    };
  }, [player]);

  return (
    <View style={styles.videoRoot}>
      <View style={[styles.videoTopBar, { paddingTop: insets.top + 10, paddingHorizontal: 16 }]}>
        <Text style={styles.videoStageTitle}>VIDEO</Text>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityLabel="Close video"
          style={({ pressed }) => [styles.videoClose, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="close" size={26} color="rgba(255,255,255,0.95)" />
        </Pressable>
      </View>

      <View style={styles.videoStageWrap}>
        <View style={[styles.videoFrame, { marginBottom: Math.max(12, insets.bottom + 8) }]}>
          {posterUri && phase === 'loading' ? (
            <Image
              source={{ uri: posterUri }}
              style={StyleSheet.absoluteFillObject}
              resizeMode="contain"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          ) : null}

          <VideoView style={styles.videoView} player={player} nativeControls contentFit="contain" />

          {phase === 'loading' ? (
            <View style={styles.videoLoadingOverlay} pointerEvents="none">
              <View style={styles.videoLoadingPill}>
                <ActivityIndicator color="rgba(216,180,254,0.95)" size="small" />
                <Text style={styles.videoLoadingText}>Preparing playback…</Text>
              </View>
            </View>
          ) : null}

          {phase === 'error' ? (
            <View style={styles.videoErrorOverlay}>
              <Ionicons name="alert-circle-outline" size={40} color="rgba(196,181,253,0.9)" />
              <Text style={styles.videoErrorText}>Couldn&apos;t play this video.</Text>
              <Pressable
                onPress={onRemountPlayer}
                style={({ pressed }) => [styles.videoRetryBtn, pressed && { opacity: 0.88 }]}
              >
                <Text style={styles.videoRetryLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <Text style={[styles.videoStageHint, { paddingBottom: Math.max(10, insets.bottom) }]}>
          System controls below · fullscreen
        </Text>
      </View>
    </View>
  );
}

export function ChatThreadVideoViewerModal({
  visible,
  uri,
  posterUri,
  onClose,
}: {
  visible: boolean;
  uri: string;
  posterUri?: string | null;
  onClose: () => void;
}) {
  if (!visible || !uri) return null;

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <VideoViewerBody key={uri} uri={uri} posterUri={posterUri} onClose={onClose} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  photoRoot: {
    flex: 1,
    backgroundColor: '#000',
  },
  photoTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  counter: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  iconBtn: {
    padding: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  photoStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomShell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronLeft: {
    position: 'absolute',
    left: 4,
    zIndex: 10,
    padding: 8,
  },
  chevronRight: {
    position: 'absolute',
    right: 4,
    zIndex: 10,
    padding: 8,
  },
  hint: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
  },
  videoRoot: {
    flex: 1,
    backgroundColor: '#030308',
  },
  videoTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 30,
  },
  videoStageTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    color: 'rgba(216,180,254,0.85)',
  },
  videoStageWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  videoFrame: {
    flex: 1,
    maxHeight: Dimensions.get('window').height * 0.78,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(168,85,247,0.28)',
    backgroundColor: '#000',
  },
  videoLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    zIndex: 8,
  },
  videoLoadingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(192,132,252,0.25)',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  videoLoadingText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '600',
  },
  videoErrorOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(3,3,8,0.92)',
    paddingHorizontal: 24,
    gap: 12,
  },
  videoErrorText: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  videoRetryBtn: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(192,132,252,0.45)',
    backgroundColor: 'rgba(139,92,246,0.15)',
  },
  videoRetryLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(233,213,255,0.95)',
  },
  videoStageHint: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.32)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 8,
  },
  videoClose: {
    padding: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  videoView: {
    flex: 1,
    width: '100%',
  },
});
