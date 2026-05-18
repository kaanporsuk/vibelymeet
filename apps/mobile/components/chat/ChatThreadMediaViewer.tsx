import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { resolvePreservedMediaSelectionId } from '../../../../shared/chat/mediaSelection';
import {
  attachSafeExpoSharedObjectPromise,
  safeExpoSharedObjectCall,
  safeRemoveExpoSharedObjectSubscription,
} from '@/lib/expoSharedObjectSafe';

export type ChatThreadPhotoItem = { id: string; uri: string; sourceRef?: string | null };

const SPRING = { damping: 22, stiffness: 260 };
const CLIP_PLAYBACK_LOAD_TIMEOUT_MS = 12_000;

function isPlayableVideoUri(uri: string): boolean {
  return /^https?:\/\//i.test(uri) || uri.startsWith('file:') || uri.startsWith('blob:') || uri.startsWith('data:');
}

function isHlsUri(uri: string): boolean {
  return /\.m3u8(?:[?#]|$)/i.test(uri);
}

function videoSourceForUri(uri: string): VideoSource {
  return isHlsUri(uri) ? { uri, contentType: 'hls' } : uri;
}

function ZoomablePhotoPage({
  uri,
  onLoadError,
  onSwipeDismiss,
}: {
  uri: string;
  onLoadError?: () => void;
  onSwipeDismiss: () => void;
}) {
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
            onError={onLoadError}
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
  onRefreshItem,
}: {
  items: ChatThreadPhotoItem[];
  initialId: string;
  onClose: () => void;
  onRefreshItem?: (item: ChatThreadPhotoItem) => Promise<string | null>;
}) {
  const insets = useSafeAreaInsets();
  const [selectedId, setSelectedId] = useState(
    () => items.find((i) => i.id === initialId)?.id ?? items[0]?.id ?? initialId,
  );
  const [uriOverridesById, setUriOverridesById] = useState<Record<string, string>>({});
  const refreshAttemptedForUriRef = useRef<string | null>(null);
  const lastInitialIdRef = useRef(initialId);
  const previousItemsRef = useRef(items);

  useEffect(() => {
    const previousItems = previousItemsRef.current;
    const initialChanged = lastInitialIdRef.current !== initialId;
    lastInitialIdRef.current = initialId;
    setSelectedId((prevId) => {
      return resolvePreservedMediaSelectionId({
        items,
        previousItems,
        previousId: prevId,
        initialId,
        initialChanged,
      });
    });
    previousItemsRef.current = items;
  }, [initialId, items]);

  const index = Math.max(0, items.findIndex((i) => i.id === selectedId));
  const current = items[index];
  const currentUri = current ? uriOverridesById[current.id] ?? current.uri : null;

  useEffect(() => {
    refreshAttemptedForUriRef.current = null;
  }, [current?.id]);

  const refreshCurrent = useCallback(async () => {
    if (!current || !currentUri || !onRefreshItem || refreshAttemptedForUriRef.current === currentUri) return;
    const freshUri = await onRefreshItem(current);
    if (!freshUri || freshUri === currentUri) return;
    refreshAttemptedForUriRef.current = currentUri;
    setUriOverridesById((prev) => (prev[current.id] === freshUri ? prev : { ...prev, [current.id]: freshUri }));
  }, [current, currentUri, onRefreshItem]);
  const goPrev = useCallback(() => {
    setSelectedId((prevId) => {
      if (!items.length) return prevId;
      const currentIndex = items.findIndex((i) => i.id === prevId);
      const fromIndex = currentIndex >= 0 ? currentIndex : 0;
      return items[fromIndex > 0 ? fromIndex - 1 : items.length - 1]?.id ?? prevId;
    });
  }, [items]);
  const goNext = useCallback(() => {
    setSelectedId((prevId) => {
      if (!items.length) return prevId;
      const currentIndex = items.findIndex((i) => i.id === prevId);
      const fromIndex = currentIndex >= 0 ? currentIndex : 0;
      return items[fromIndex < items.length - 1 ? fromIndex + 1 : 0]?.id ?? prevId;
    });
  }, [items]);

  if (!current || !currentUri) return null;

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
          <ZoomablePhotoPage
            key={current.id}
            uri={currentUri}
            onLoadError={() => {
              void refreshCurrent();
            }}
            onSwipeDismiss={onClose}
          />
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
  onRefreshItem,
}: {
  visible: boolean;
  items: ChatThreadPhotoItem[];
  initialId: string;
  onClose: () => void;
  onRefreshItem?: (item: ChatThreadPhotoItem) => Promise<string | null>;
}) {
  if (!visible || items.length === 0) return null;

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <PhotoViewerBody items={items} initialId={initialId} onClose={onClose} onRefreshItem={onRefreshItem} />
    </Modal>
  );
}

function VideoViewerBody({
  uri,
  posterUri,
  onRefreshMedia,
  onClose,
}: {
  uri: string;
  posterUri?: string | null;
  onRefreshMedia?: () => Promise<{ uri?: string | null; posterUri?: string | null } | null>;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [retryKey, setRetryKey] = useState(0);
  const [playableUri, setPlayableUri] = useState(uri);
  const [playablePosterUri, setPlayablePosterUri] = useState(posterUri ?? null);
  const [resolveFailed, setResolveFailed] = useState(false);
  const refreshAttemptedForUriRef = useRef<string | null>(null);

  useEffect(() => {
    setPlayableUri(uri);
    setPlayablePosterUri(posterUri ?? null);
    setResolveFailed(false);
    refreshAttemptedForUriRef.current = null;
  }, [posterUri, uri]);

  const refreshMedia = useCallback(async (): Promise<boolean> => {
    if (!onRefreshMedia || refreshAttemptedForUriRef.current === playableUri) return false;
    const fresh = await onRefreshMedia();
    if (fresh?.posterUri) setPlayablePosterUri(fresh.posterUri);
    if (!fresh?.uri || fresh.uri === playableUri) return false;
    refreshAttemptedForUriRef.current = playableUri;
    setResolveFailed(false);
    setPlayableUri(fresh.uri);
    return true;
  }, [onRefreshMedia, playableUri]);

  useEffect(() => {
    if (isPlayableVideoUri(playableUri)) {
      setResolveFailed(false);
      return;
    }
    let cancelled = false;
    void refreshMedia()
      .then((didRefresh) => {
        if (!cancelled && !didRefresh) setResolveFailed(true);
      })
      .catch(() => {
        if (!cancelled) setResolveFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [playableUri, refreshMedia]);

  if (!isPlayableVideoUri(playableUri)) {
    return (
      <View style={styles.videoRoot}>
        <View style={[styles.videoTopBar, { paddingTop: insets.top + 10, paddingHorizontal: 16 }]}>
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
            {resolveFailed ? (
              <View style={styles.videoErrorOverlay}>
                <Ionicons name="alert-circle-outline" size={40} color="rgba(196,181,253,0.9)" />
                <Text style={styles.videoErrorText}>Couldn&apos;t play this video.</Text>
                <Pressable
                  onPress={() => {
                    refreshAttemptedForUriRef.current = null;
                    setResolveFailed(false);
                    void refreshMedia()
                      .then((didRefresh) => {
                        if (!didRefresh) setResolveFailed(true);
                      })
                      .catch(() => setResolveFailed(true));
                  }}
                  style={({ pressed }) => [styles.videoRetryBtn, pressed && { opacity: 0.88 }]}
                >
                  <Text style={styles.videoRetryLabel}>Try again</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.videoLoadingOverlay} pointerEvents="none">
                <View style={styles.videoLoadingPill}>
                  <ActivityIndicator color="rgba(216,180,254,0.95)" size="small" />
                  <Text style={styles.videoLoadingText}>Preparing playback…</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  }

  return (
    <VideoViewerStage
      key={`${playableUri}-${retryKey}`}
      uri={playableUri}
      posterUri={playablePosterUri}
      onClose={onClose}
      onRefreshMedia={refreshMedia}
      onRemountPlayer={() => {
        refreshAttemptedForUriRef.current = null;
        setRetryKey((k) => k + 1);
      }}
      onResetPlaybackRefreshAttempt={() => {
        refreshAttemptedForUriRef.current = null;
      }}
    />
  );
}

/**
 * Isolated stage so `useVideoPlayer` + cleanup run per mount, and Try again
 * can recreate the player after errors.
 */
function VideoViewerStage({
  uri,
  posterUri,
  onClose,
  onRefreshMedia,
  onRemountPlayer,
  onResetPlaybackRefreshAttempt,
}: {
  uri: string;
  posterUri?: string | null;
  onClose: () => void;
  onRefreshMedia: () => Promise<boolean>;
  onRemountPlayer: () => void;
  onResetPlaybackRefreshAttempt: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');

  const player = useVideoPlayer(videoSourceForUri(uri), (p) => {
    p.loop = false;
  });

  useEffect(() => {
    const sub = safeExpoSharedObjectCall(
      () => player.addListener('statusChange', (payload) => {
        if (payload.status === 'error') {
          void onRefreshMedia()
            .then((didRefresh) => {
              if (!didRefresh) setPhase('error');
            })
            .catch(() => setPhase('error'));
          return;
        }
        if (payload.status === 'readyToPlay') {
          setPhase('ready');
        }
        if (payload.status === 'loading') {
          setPhase('loading');
        }
      }),
      {
        label: 'chat.viewerVideo.statusListener',
        fallback: null,
        swallowAll: true,
      },
    );
    return () => safeRemoveExpoSharedObjectSubscription(sub, 'chat.viewerVideo.statusListener.remove');
  }, [onRefreshMedia, player]);

  useEffect(() => {
    const playResult = safeExpoSharedObjectCall(() => player.play(), {
      label: 'chat.viewerVideo.play',
      swallowAll: true,
    });
    attachSafeExpoSharedObjectPromise(playResult, undefined, 'chat.viewerVideo.play');
    return () => {
      const pauseResult = safeExpoSharedObjectCall(() => player.pause(), {
        label: 'chat.viewerVideo.pause.unmount',
        swallowAll: true,
      });
      attachSafeExpoSharedObjectPromise(pauseResult, undefined, 'chat.viewerVideo.pause.unmount');
    };
  }, [player]);

  useEffect(() => {
    if (phase !== 'loading') return;
    const timeoutId = setTimeout(() => {
      void onRefreshMedia()
        .then((didRefresh) => {
          if (!didRefresh) setPhase('error');
        })
        .catch(() => setPhase('error'));
    }, CLIP_PLAYBACK_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeoutId);
  }, [onRefreshMedia, phase, uri]);

  return (
    <View style={styles.videoRoot}>
      <View style={[styles.videoTopBar, { paddingTop: insets.top + 10, paddingHorizontal: 16 }]}>
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
                onPress={() => {
                  onResetPlaybackRefreshAttempt();
                  setPhase('loading');
                  void onRefreshMedia()
                    .then((didRefresh) => {
                      if (!didRefresh) onRemountPlayer();
                    })
                    .catch(onRemountPlayer);
                }}
                style={({ pressed }) => [styles.videoRetryBtn, pressed && { opacity: 0.88 }]}
              >
                <Text style={styles.videoRetryLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export function ChatThreadVideoViewerModal({
  visible,
  uri,
  posterUri,
  onRefreshMedia,
  onClose,
}: {
  visible: boolean;
  uri: string;
  posterUri?: string | null;
  onRefreshMedia?: () => Promise<{ uri?: string | null; posterUri?: string | null } | null>;
  onClose: () => void;
}) {
  if (!visible || !uri) return null;

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <VideoViewerBody key={uri} uri={uri} posterUri={posterUri} onRefreshMedia={onRefreshMedia} onClose={onClose} />
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
    justifyContent: 'flex-end',
    zIndex: 30,
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
