import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Pressable,
  Dimensions,
  StyleSheet,
  Text,
  ActivityIndicator,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView, type VideoPlayerStatus, type VideoSource } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { resolvePreservedMediaSelectionId } from '../../../../shared/chat/mediaSelection';
import {
  attachSafeExpoSharedObjectPromise,
  safeExpoSharedObjectCall,
  safeExpoSharedObjectRead,
  safeRemoveExpoSharedObjectSubscription,
} from '@/lib/expoSharedObjectSafe';
import { useReduceMotionState } from '@/hooks/useReduceMotion';
import {
  resolveMediaFallbackCopy,
  resolveNativeMediaPlaybackFallbackReason,
  type MediaFallbackReason,
} from '@clientShared/media/mediaFallbackCopy';

export type ChatThreadPhotoItem = { id: string; uri: string; sourceRef?: string | null };

const SPRING = { damping: 22, stiffness: 260 };
const CLIP_PLAYBACK_LOAD_TIMEOUT_MS = 12_000;

function isPlayableVideoUri(uri: string): boolean {
  return /^https?:\/\//i.test(uri) || uri.startsWith('file:') || uri.startsWith('blob:') || uri.startsWith('data:');
}

function displayablePosterUri(uri: string | null | undefined): string | null {
  return uri && isPlayableVideoUri(uri) ? uri : null;
}

function uniqueDisplayablePosterUris(
  ...groups: Array<string | null | undefined | readonly (string | null | undefined)[]>
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    const values = Array.isArray(group) ? group : [group];
    for (const value of values) {
      const uri = displayablePosterUri(value);
      if (!uri || seen.has(uri)) continue;
      seen.add(uri);
      urls.push(uri);
    }
  }
  return urls;
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
  const { reduceMotion } = useReduceMotionState();

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
        scale.value = reduceMotion ? 1 : withSpring(1, SPRING);
        savedScale.value = 1;
        tx.value = reduceMotion ? 0 : withSpring(0, SPRING);
        ty.value = reduceMotion ? 0 : withSpring(0, SPRING);
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
      dismissY.value = reduceMotion ? 0 : withSpring(0, SPRING);
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
          <ExpoImage
            source={{ uri }}
            style={{ width: maxW, height: maxH }}
            contentFit="contain"
            cachePolicy="memory-disk"
            accessibilityLabel="Chat photo"
            onError={() => onLoadError?.()}
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
  const refreshInFlightForUriRef = useRef<string | null>(null);
  const autoRefreshAttemptedForIdRef = useRef<string | null>(null);
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
    if (
      !current ||
      !currentUri ||
      !onRefreshItem ||
      refreshAttemptedForUriRef.current === currentUri ||
      refreshInFlightForUriRef.current === currentUri
    ) {
      return;
    }
    refreshInFlightForUriRef.current = currentUri;
    try {
      const freshUri = await onRefreshItem(current);
      if (!freshUri || freshUri === currentUri) return;
      refreshAttemptedForUriRef.current = currentUri;
      setUriOverridesById((prev) => (prev[current.id] === freshUri ? prev : { ...prev, [current.id]: freshUri }));
    } catch {
      // Keep transient refresh failures retryable for the current signed URI.
    } finally {
      if (refreshInFlightForUriRef.current === currentUri) {
        refreshInFlightForUriRef.current = null;
      }
    }
  }, [current, currentUri, onRefreshItem]);

  useEffect(() => {
    if (!current?.id || autoRefreshAttemptedForIdRef.current === current.id) return;
    autoRefreshAttemptedForIdRef.current = current.id;
    void refreshCurrent();
  }, [current?.id, refreshCurrent]);

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
  const { reduceMotion } = useReduceMotionState();

  if (!visible || items.length === 0) return null;

  return (
    <Modal visible animationType={reduceMotion ? 'none' : 'fade'} presentationStyle="fullScreen" onRequestClose={onClose}>
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
  onRefreshMedia?: (
    reason?: 'playback' | 'poster' | 'manual',
  ) => Promise<{ uri?: string | null; posterUri?: string | null; posterFallbackUris?: string[] | null } | null>;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [retryKey, setRetryKey] = useState(0);
  const [playableUri, setPlayableUri] = useState(uri);
  const [playablePosterUri, setPlayablePosterUri] = useState(displayablePosterUri(posterUri));
  const [posterFallbackUris, setPosterFallbackUris] = useState<string[]>([]);
  const [resolveFailed, setResolveFailed] = useState(false);
  const refreshAttemptedForUriRef = useRef<string | null>(null);
  const posterResolveAttemptedForUriRef = useRef<string | null>(null);
  const posterRefreshAttemptedForUriRef = useRef<string | null>(null);
  const posterRefreshInFlightForUriRef = useRef<string | null>(null);
  const playablePosterUriRef = useRef(displayablePosterUri(posterUri));
  const posterCandidateUrisRef = useRef<string[]>([]);
  const resolveFallbackCopy = resolveMediaFallbackCopy({ reason: 'unknown' });

  useEffect(() => {
    setPlayableUri(uri);
    const nextPosterUri = displayablePosterUri(posterUri);
    setPlayablePosterUri(nextPosterUri);
    setPosterFallbackUris([]);
    playablePosterUriRef.current = nextPosterUri;
    setResolveFailed(false);
    refreshAttemptedForUriRef.current = null;
    posterResolveAttemptedForUriRef.current = null;
    posterRefreshAttemptedForUriRef.current = null;
    posterRefreshInFlightForUriRef.current = null;
  }, [posterUri, uri]);

  const posterCandidateUris = useMemo(
    () => uniqueDisplayablePosterUris(playablePosterUri, posterFallbackUris),
    [playablePosterUri, posterFallbackUris],
  );

  useEffect(() => {
    playablePosterUriRef.current = playablePosterUri;
  }, [playablePosterUri]);

  useEffect(() => {
    posterCandidateUrisRef.current = posterCandidateUris;
  }, [posterCandidateUris]);

  const advancePosterCandidate = useCallback((): boolean => {
    const currentPosterUri = displayablePosterUri(playablePosterUriRef.current);
    const candidates = posterCandidateUrisRef.current;
    const currentIndex = currentPosterUri ? candidates.indexOf(currentPosterUri) : -1;
    const nextPosterUri = candidates.find((candidate, index) => index > currentIndex && candidate !== currentPosterUri);
    if (!nextPosterUri) return false;
    playablePosterUriRef.current = nextPosterUri;
    setPlayablePosterUri(nextPosterUri);
    return true;
  }, []);

  const refreshMedia = useCallback(async (reason: 'playback' | 'poster' | 'manual' = 'playback'): Promise<boolean> => {
    if (reason === 'poster' && advancePosterCandidate()) return true;
    if (!onRefreshMedia || (reason === 'playback' && refreshAttemptedForUriRef.current === playableUri)) return false;
    const posterRefreshKey = playableUri;
    if (reason === 'poster') {
      if (
        posterRefreshAttemptedForUriRef.current === posterRefreshKey ||
        posterRefreshInFlightForUriRef.current === posterRefreshKey
      ) {
        playablePosterUriRef.current = null;
        setPlayablePosterUri(null);
        setPosterFallbackUris([]);
        return false;
      }
      posterRefreshAttemptedForUriRef.current = posterRefreshKey;
      posterRefreshInFlightForUriRef.current = posterRefreshKey;
    }
    let fresh: { uri?: string | null; posterUri?: string | null; posterFallbackUris?: string[] | null } | null = null;
    try {
      fresh = await onRefreshMedia(reason);
    } catch {
      if (reason === 'poster') {
        playablePosterUriRef.current = null;
        setPlayablePosterUri(null);
        setPosterFallbackUris([]);
      }
      return false;
    } finally {
      if (reason === 'poster' && posterRefreshInFlightForUriRef.current === posterRefreshKey) {
        posterRefreshInFlightForUriRef.current = null;
      }
    }
    const freshPosterFallbackUris = uniqueDisplayablePosterUris(fresh?.posterFallbackUris ?? []);
    setPosterFallbackUris(freshPosterFallbackUris);
    const freshPosterUri = displayablePosterUri(fresh?.posterUri);
    if (freshPosterUri) {
      playablePosterUriRef.current = freshPosterUri;
      setPlayablePosterUri(freshPosterUri);
    } else if (reason === 'poster' && freshPosterFallbackUris.length > 0) {
      playablePosterUriRef.current = freshPosterFallbackUris[0];
      setPlayablePosterUri(freshPosterFallbackUris[0]);
      return true;
    }
    if (!fresh?.uri) return !!freshPosterUri;
    if (!isPlayableVideoUri(fresh.uri)) return reason === 'poster' ? !!freshPosterUri : false;
    if (fresh.uri === playableUri) {
      if (reason === 'poster') return !!freshPosterUri;
      refreshAttemptedForUriRef.current = playableUri;
      setResolveFailed(false);
      setRetryKey((k) => k + 1);
      return true;
    }
    refreshAttemptedForUriRef.current = playableUri;
    setResolveFailed(false);
    setPlayableUri(fresh.uri);
    return true;
  }, [advancePosterCandidate, onRefreshMedia, playableUri]);

  useEffect(() => {
    if (
      displayablePosterUri(playablePosterUri) ||
      !onRefreshMedia ||
      posterResolveAttemptedForUriRef.current === playableUri
    ) {
      return;
    }
    posterResolveAttemptedForUriRef.current = playableUri;
    void refreshMedia('poster');
  }, [onRefreshMedia, playablePosterUri, playableUri, refreshMedia]);

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
            {playablePosterUri ? (
              <ExpoImage
                source={{ uri: playablePosterUri }}
                style={StyleSheet.absoluteFillObject}
                contentFit="contain"
                cachePolicy="memory-disk"
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                onError={() => {
                  void refreshMedia('poster');
                }}
              />
            ) : null}
            {resolveFailed ? (
              <View style={styles.videoErrorOverlay}>
                <Ionicons name="alert-circle-outline" size={40} color="rgba(196,181,253,0.9)" />
                <Text style={styles.videoErrorTitle}>{resolveFallbackCopy.title}</Text>
                <Text style={styles.videoErrorText}>{resolveFallbackCopy.message}</Text>
                {resolveFallbackCopy.actionLabel ? (
                  <Pressable
                    onPress={() => {
                      refreshAttemptedForUriRef.current = null;
                      setResolveFailed(false);
                      void refreshMedia('manual')
                        .then((didRefresh) => {
                          if (!didRefresh) setResolveFailed(true);
                        })
                        .catch(() => setResolveFailed(true));
                    }}
                    style={({ pressed }) => [styles.videoRetryBtn, pressed && { opacity: 0.88 }]}
                  >
                    <Text style={styles.videoRetryLabel}>{resolveFallbackCopy.actionLabel}</Text>
                  </Pressable>
                ) : null}
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
      posterUri={displayablePosterUri(playablePosterUri)}
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
  onRefreshMedia: (reason?: 'playback' | 'poster' | 'manual') => Promise<boolean>;
  onRemountPlayer: () => void;
  onResetPlaybackRefreshAttempt: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [fallbackReason, setFallbackReason] = useState<MediaFallbackReason | null>(null);
  const [manualPlaybackRequested, setManualPlaybackRequested] = useState(false);
  const { reduceMotion, resolved: reduceMotionResolved } = useReduceMotionState();
  const playbackFallbackCopy = resolveMediaFallbackCopy({
    reason: fallbackReason ?? resolveNativeMediaPlaybackFallbackReason({ uri }),
  });
  const shouldAttachPlayback = reduceMotionResolved && (!reduceMotion || manualPlaybackRequested);
  const playerSource = useMemo<VideoSource>(() => (shouldAttachPlayback ? videoSourceForUri(uri) : null), [
    shouldAttachPlayback,
    uri,
  ]);
  const revealPlayer = useCallback(() => {
    setPhase((current) => (current === 'error' ? current : 'ready'));
  }, []);

  const player = useVideoPlayer(playerSource, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    setManualPlaybackRequested(false);
    setFallbackReason(null);
    setPhase('loading');
  }, [uri]);

  const handlePlayerStatus = useCallback((status: VideoPlayerStatus, payload?: unknown) => {
    if (status === 'error') {
      const reason = resolveNativeMediaPlaybackFallbackReason({ uri, error: payload });
      void onRefreshMedia()
        .then((didRefresh) => {
          if (!didRefresh) {
            setFallbackReason(reason);
            setPhase('error');
          }
        })
        .catch(() => {
          setFallbackReason(reason);
          setPhase('error');
        });
      return;
    }
    if (status === 'readyToPlay') {
      revealPlayer();
    }
    if (status === 'loading') {
      setPhase((current) => (current === 'ready' ? current : 'loading'));
    }
  }, [onRefreshMedia, revealPlayer, uri]);

  useEffect(() => {
    if (!shouldAttachPlayback) return;
    const sub = safeExpoSharedObjectCall(
      () => player.addListener('statusChange', (payload) => {
        handlePlayerStatus(payload.status, payload);
      }),
      {
        label: 'chat.viewerVideo.statusListener',
        fallback: null,
        swallowAll: true,
      },
    );
    const initialStatus = safeExpoSharedObjectRead<VideoPlayerStatus>(
      () => player.status,
      'idle',
      'chat.viewerVideo.status.initial',
    );
    handlePlayerStatus(initialStatus);
    return () => safeRemoveExpoSharedObjectSubscription(sub, 'chat.viewerVideo.statusListener.remove');
  }, [handlePlayerStatus, player, shouldAttachPlayback]);

  useEffect(() => {
    if (!shouldAttachPlayback) return;
    const playResult = safeExpoSharedObjectCall(() => player.play(), {
      label: 'chat.viewerVideo.play',
      swallowAll: true,
    });
    attachSafeExpoSharedObjectPromise(playResult, undefined, 'chat.viewerVideo.play');
  }, [player, shouldAttachPlayback]);

  useEffect(() => {
    if (phase !== 'loading') return;
    const timeoutId = setTimeout(() => {
      revealPlayer();
    }, CLIP_PLAYBACK_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeoutId);
  }, [phase, revealPlayer, uri]);

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
          <VideoView style={styles.videoView} player={player} nativeControls contentFit="contain" />

          {posterUri && phase === 'loading' ? (
            <ExpoImage
              source={{ uri: posterUri }}
              style={StyleSheet.absoluteFillObject}
              contentFit="contain"
              cachePolicy="memory-disk"
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              onError={() => {
                void onRefreshMedia('poster');
              }}
            />
          ) : null}
          {posterUri && phase !== 'error' ? (
            <ExpoImage
              source={{ uri: posterUri }}
              style={styles.videoPosterProbe}
              contentFit="contain"
              cachePolicy="memory-disk"
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              onError={() => {
                void onRefreshMedia('poster');
              }}
            />
          ) : null}

          {phase === 'loading' && shouldAttachPlayback ? (
            <View style={styles.videoLoadingOverlay} pointerEvents="none">
              <View style={styles.videoLoadingPill}>
                <ActivityIndicator color="rgba(216,180,254,0.95)" size="small" />
                <Text style={styles.videoLoadingText}>Preparing playback…</Text>
              </View>
            </View>
          ) : null}

          {reduceMotionResolved && reduceMotion && !manualPlaybackRequested ? (
            <Pressable
              style={styles.videoPlayOverlay}
              onPress={() => setManualPlaybackRequested(true)}
              accessibilityRole="button"
              accessibilityLabel="Play video"
            >
              <View style={styles.videoPlayButton}>
                <Text style={styles.videoPlayText}>Play</Text>
              </View>
            </Pressable>
          ) : null}

          {phase === 'error' ? (
            <View style={styles.videoErrorOverlay}>
              <Ionicons name="alert-circle-outline" size={40} color="rgba(196,181,253,0.9)" />
              <Text style={styles.videoErrorTitle}>{playbackFallbackCopy.title}</Text>
              <Text style={styles.videoErrorText}>{playbackFallbackCopy.message}</Text>
              {playbackFallbackCopy.actionLabel ? (
                <Pressable
                  onPress={() => {
                    onResetPlaybackRefreshAttempt();
                    setPhase('loading');
                    void onRefreshMedia('manual')
                      .then((didRefresh) => {
                        if (!didRefresh) onRemountPlayer();
                      })
                      .catch(onRemountPlayer);
                  }}
                  style={({ pressed }) => [styles.videoRetryBtn, pressed && { opacity: 0.88 }]}
                >
                  <Text style={styles.videoRetryLabel}>{playbackFallbackCopy.actionLabel}</Text>
                </Pressable>
              ) : null}
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
  onRefreshMedia?: (
    reason?: 'playback' | 'poster' | 'manual',
  ) => Promise<{ uri?: string | null; posterUri?: string | null; posterFallbackUris?: string[] | null } | null>;
  onClose: () => void;
}) {
  const { reduceMotion } = useReduceMotionState();

  if (!visible || !uri) return null;

  return (
    <Modal visible animationType={reduceMotion ? 'none' : 'fade'} presentationStyle="fullScreen" onRequestClose={onClose}>
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
  videoErrorTitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
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
  videoPosterProbe: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    opacity: 0,
  },
  videoPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  videoPlayButton: {
    minWidth: 68,
    minHeight: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(0,0,0,0.62)',
    paddingHorizontal: 18,
  },
  videoPlayText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
});
