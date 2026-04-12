import React, { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  View as RNView,
  Text,
  Pressable,
  Image,
  StyleSheet,
  BackHandler,
  Dimensions,
  ScrollView,
  FlatList,
  LayoutAnimation,
  Platform,
  UIManager,
  KeyboardAvoidingView,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

import { AddPhotoSourcePopover, type AddPhotoAnchor } from '@/components/photos/AddPhotoSourcePopover';
import { fonts, radius } from '@/constants/theme';
import { getImageUrl } from '@/lib/imageUrl';
import {
  getPhotoDraftDisplayUri,
  type PhotoBatchLaunchAction,
  type PhotoDraftItem,
  usePhotoBatchController,
} from '@/lib/photoBatchController';
import { supabase } from '@/lib/supabase';
import { useVibelyDialog } from '@/components/VibelyDialog';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const MAX_PHOTOS = 6;
/** Match VibePickerSheet: sheet caps at 88% of window; handle strip reserves top of sheet */
const SHEET_MAX_HEIGHT_PCT = 0.88;
const SHEET_HANDLE_STRIP = 28;

/** Same semantics as web @dnd-kit/sortable arrayMove — index 0 stays main photo */
function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  if (from === to) return arr;
  if (from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

type SlotRect = { x: number; y: number; width: number; height: number };

/**
 * Resolve drop slot from window coordinates using measured tile bounds (asymmetric grid safe).
 * 1) Point-in-rect for each filled slot (0..n-1).
 * 2) If the finger is in the gap between tiles, pick the slot whose center is nearest (euclidean).
 */
function resolveDropTargetIndex(
  x: number,
  y: number,
  layouts: (SlotRect | undefined)[],
  n: number,
): number | null {
  let hit: number | null = null;
  for (let i = 0; i < n; i++) {
    const L = layouts[i];
    if (!L || L.width <= 1 || L.height <= 1) continue;
    if (x >= L.x && x <= L.x + L.width && y >= L.y && y <= L.y + L.height) {
      hit = i;
      break;
    }
  }
  if (hit !== null) return hit;

  let bestIdx: number | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const L = layouts[i];
    if (!L || L.width <= 1 || L.height <= 1) continue;
    const cx = L.x + L.width / 2;
    const cy = L.y + L.height / 2;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

interface PhotoManageDrawerProps {
  visible: boolean;
  onClose: () => void;
  photos: string[];
  onPhotosChanged: () => void;
  launchAction?: PhotoBatchLaunchAction | null;
  /** Reuse fullscreen viewer without showing the manage sheet. */
  fullscreenOnly?: boolean;
  /** Initial photo index when opening fullscreenOnly mode. */
  initialFullscreenIndex?: number | null;
}

function thumbUrl(path: string) {
  return getImageUrl(path, { width: 400, height: 400, crop: 'center' });
}

function fullUrl(path: string) {
  return getImageUrl(path, { width: 1200, height: 1200 });
}

function itemThumbUri(item: PhotoDraftItem | null | undefined) {
  const localUri = getPhotoDraftDisplayUri(item);
  if (!localUri) return null;
  if (item?.previewUri) return localUri;
  return thumbUrl(localUri);
}

function itemFullUri(item: PhotoDraftItem | null | undefined) {
  const localUri = getPhotoDraftDisplayUri(item);
  if (!localUri) return null;
  if (item?.previewUri) return localUri;
  return fullUrl(localUri);
}

/** Web `FullscreenViewer` image: max-w-[90vw] max-h-[85vh], scale-[2] when zoomed */
const FS_IMG_MAX_W = SCREEN_W * 0.9;
const FS_IMG_MAX_H = SCREEN_H * 0.85;
/** Fullscreen bottom strip — matches drawer filmstrip thumb size + spacing (visible photo list) */
const FS_STRIP_THUMB = 56;
const FS_STRIP_GAP = 8;
const FS_STRIP_SIDE_PAD = 20;
const FS_STRIP_THUMB_MIN = 44;
const FS_STRIP_GAP_MIN = 4;
const FS_STRIP_SIDE_PAD_MIN = 12;
const FS_STRIP_BORDER = 1;
const FS_ZOOM_SCALE = 2;
const FS_MAX_PINCH = 4;
const FS_ZOOM_EPS = 0.02;
/** Pager off and pan on when scale is at/above this (single threshold — no dead zone). */
const FS_PAGER_LOCK_SCALE = 1.028;
const FS_TAP_MAX_DIST = 10;
const FS_TAP_MAX_MS = 280;
const FS_SPRING = { damping: 22, stiffness: 220, mass: 0.6 };
/** Vertical stack below safe area: counter row (web top-4 + h-10 controls) */
const FS_TOP_ROW_BOTTOM_PAD = 8;
const FS_TOP_ROW_MIN_H = 40;
/** Reserved height for helper row (text + vertical rhythm to strip) */
const FS_HELPER_BLOCK = 42;
/** Strip bar: top padding above thumbs, extra gap above home indicator */
const FS_STRIP_PADDING_TOP = 12;
const FS_STRIP_EXTRA_BELOW_THUMB = 8;

function clampPanFullscreen(tx: number, ty: number, s: number, w: number, h: number) {
  'worklet';
  if (s <= 1) return { x: 0, y: 0 };
  const maxX = (w * (s - 1)) / 2;
  const maxY = (h * (s - 1)) / 2;
  return {
    x: Math.min(maxX, Math.max(-maxX, tx)),
    y: Math.min(maxY, Math.max(-maxY, ty)),
  };
}

function resolveFullscreenStripMetrics(total: number, viewportWidth: number) {
  if (total <= 0) {
    return {
      thumb: FS_STRIP_THUMB,
      gap: FS_STRIP_GAP,
      sidePad: FS_STRIP_SIDE_PAD,
      fits: true,
      contentWidth: 0,
      cell: FS_STRIP_THUMB + FS_STRIP_GAP,
    };
  }

  let thumb = FS_STRIP_THUMB;
  let gap = FS_STRIP_GAP;
  let sidePad = FS_STRIP_SIDE_PAD;

  const widthOf = (t: number, g: number, p: number) =>
    total * t + Math.max(0, total - 1) * g + p * 2;

  let contentWidth = widthOf(thumb, gap, sidePad);
  if (contentWidth > viewportWidth) {
    let overflow = contentWidth - viewportWidth;

    const padCapacity = Math.max(0, sidePad - FS_STRIP_SIDE_PAD_MIN) * 2;
    const padUse = Math.min(overflow, padCapacity);
    sidePad -= padUse / 2;
    overflow -= padUse;

    const gapCapacity = Math.max(0, gap - FS_STRIP_GAP_MIN) * Math.max(0, total - 1);
    const gapUse = Math.min(overflow, gapCapacity);
    if (total > 1) gap -= gapUse / (total - 1);
    overflow -= gapUse;

    const thumbCapacity = Math.max(0, thumb - FS_STRIP_THUMB_MIN) * total;
    const thumbUse = Math.min(overflow, thumbCapacity);
    thumb -= thumbUse / total;
  }

  thumb = Math.max(FS_STRIP_THUMB_MIN, Math.min(FS_STRIP_THUMB, Math.round(thumb)));
  gap = Math.max(FS_STRIP_GAP_MIN, Math.min(FS_STRIP_GAP, Math.round(gap)));
  sidePad = Math.max(FS_STRIP_SIDE_PAD_MIN, Math.min(FS_STRIP_SIDE_PAD, Math.round(sidePad)));
  contentWidth = widthOf(thumb, gap, sidePad);

  return {
    thumb,
    gap,
    sidePad,
    fits: contentWidth <= viewportWidth,
    contentWidth,
    cell: thumb + gap,
  };
}

type FullscreenPhotoPageProps = {
  uri: string;
  pageWidth: number;
  pageHeight: number;
  imageMaxW: number;
  imageMaxH: number;
  isActive: boolean;
  onZoomPagerLockChange: (locked: boolean) => void;
  /** Parent zoom icon calls this for the active page only (same behavior as tap-to-zoom). */
  zoomToggleRef?: React.MutableRefObject<(() => void) | null>;
};

/**
 * Fullscreen page: pinch zoom uses focal-point math (not center-only scale); outer = pan, inner = scale.
 * Pager locks with hysteresis when meaningfully zoomed; at ~1× only pinch+tap attach so horizontal swipe hits FlatList.
 */
function FullscreenPhotoPage({
  uri,
  pageWidth,
  pageHeight,
  imageMaxW,
  imageMaxH,
  isActive,
  onZoomPagerLockChange,
  zoomToggleRef,
}: FullscreenPhotoPageProps) {
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const panStartTx = useSharedValue(0);
  const panStartTy = useSharedValue(0);
  const pinchBaseScale = useSharedValue(1);
  const pinchBaseTx = useSharedValue(0);
  const pinchBaseTy = useSharedValue(0);
  const pinchComposeLatch = useSharedValue(0);
  const isActiveSV = useSharedValue(isActive);
  const pagerLockedSV = useSharedValue(false);

  const [zoomed, setZoomed] = useState(false);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const mx = pageWidth * 0.5;
  const my = pageHeight * 0.5;

  useEffect(() => {
    isActiveSV.value = isActive;
  }, [isActive, isActiveSV]);

  const notifyLock = useCallback(
    (locked: boolean) => {
      if (isActiveRef.current) onZoomPagerLockChange(locked);
    },
    [onZoomPagerLockChange],
  );

  const setZoomedFromWorklet = useCallback((z: boolean) => {
    setZoomed(z);
  }, []);

  useAnimatedReaction(
    () => ({
      s: scale.value,
      active: isActiveSV.value,
    }),
    (curr) => {
      if (!curr.active) {
        if (pagerLockedSV.value) {
          pagerLockedSV.value = false;
          runOnJS(notifyLock)(false);
          runOnJS(setZoomedFromWorklet)(false);
        }
        return;
      }
      const next = curr.s >= FS_PAGER_LOCK_SCALE;
      if (next !== pagerLockedSV.value) {
        pagerLockedSV.value = next;
        runOnJS(notifyLock)(next);
        runOnJS(setZoomedFromWorklet)(next);
      }
    },
    [notifyLock, setZoomedFromWorklet],
  );

  const toggleZoom = useCallback(() => {
    if (scale.value >= FS_PAGER_LOCK_SCALE) {
      scale.value = withSpring(1, FS_SPRING);
      tx.value = withSpring(0, FS_SPRING);
      ty.value = withSpring(0, FS_SPRING);
      pagerLockedSV.value = false;
      setZoomed(false);
      notifyLock(false);
    } else {
      scale.value = withSpring(FS_ZOOM_SCALE, FS_SPRING);
      pagerLockedSV.value = true;
      setZoomed(true);
      notifyLock(true);
    }
  }, [notifyLock, pagerLockedSV, scale, tx, ty]);

  useLayoutEffect(() => {
    if (!zoomToggleRef) return;
    if (!isActive) return;
    zoomToggleRef.current = toggleZoom;
    return () => {
      zoomToggleRef.current = null;
    };
  }, [isActive, toggleZoom, zoomToggleRef]);

  useEffect(() => {
    if (!isActive) {
      scale.value = 1;
      tx.value = 0;
      ty.value = 0;
      pinchComposeLatch.value = 0;
      pagerLockedSV.value = false;
      setZoomed(false);
      onZoomPagerLockChange(false);
    }
  }, [isActive, onZoomPagerLockChange, pinchComposeLatch, pagerLockedSV, scale, tx, ty]);

  const outerAnim = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));

  const innerAnim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const gesture = useMemo(() => {
    const tap = Gesture.Tap()
      .numberOfTaps(1)
      .maxDistance(FS_TAP_MAX_DIST)
      .maxDuration(FS_TAP_MAX_MS)
      .onEnd((_e, success) => {
        if (!success) return;
        if (scale.value >= FS_PAGER_LOCK_SCALE) {
          scale.value = withSpring(1, FS_SPRING);
          tx.value = withSpring(0, FS_SPRING);
          ty.value = withSpring(0, FS_SPRING);
          pagerLockedSV.value = false;
          runOnJS(notifyLock)(false);
          runOnJS(setZoomedFromWorklet)(false);
        } else {
          scale.value = withSpring(FS_ZOOM_SCALE, FS_SPRING);
          pagerLockedSV.value = true;
          runOnJS(notifyLock)(true);
          runOnJS(setZoomedFromWorklet)(true);
        }
      });

    const pan = Gesture.Pan()
      .onStart(() => {
        panStartTx.value = tx.value;
        panStartTy.value = ty.value;
      })
      .onUpdate((e) => {
        if (scale.value < FS_PAGER_LOCK_SCALE) return;
        const nx = panStartTx.value + e.translationX;
        const ny = panStartTy.value + e.translationY;
        const c = clampPanFullscreen(nx, ny, scale.value, imageMaxW, imageMaxH);
        tx.value = c.x;
        ty.value = c.y;
      });

    const pinch = Gesture.Pinch()
      .onBegin(() => {
        pinchComposeLatch.value = 0;
        pinchBaseScale.value = scale.value;
        pinchBaseTx.value = tx.value;
        pinchBaseTy.value = ty.value;
      })
      .onUpdate((e) => {
        const s0 = pinchBaseScale.value;
        if (s0 < 0.001) return;
        const s1 = Math.min(FS_MAX_PINCH, Math.max(1, s0 * e.scale));
        const ratio = s1 / s0;
        const fx = e.focalX;
        const fy = e.focalY;
        const ntx = fx - mx - ratio * (fx - mx - pinchBaseTx.value);
        const nty = fy - my - ratio * (fy - my - pinchBaseTy.value);
        const c = clampPanFullscreen(ntx, nty, s1, imageMaxW, imageMaxH);
        tx.value = c.x;
        ty.value = c.y;
        scale.value = s1;
        if (s1 >= FS_PAGER_LOCK_SCALE && pinchComposeLatch.value === 0) {
          pinchComposeLatch.value = 1;
          runOnJS(notifyLock)(true);
          runOnJS(setZoomedFromWorklet)(true);
        }
      })
      .onEnd(() => {
        if (scale.value < 1 + FS_ZOOM_EPS) {
          scale.value = withSpring(1, FS_SPRING);
          tx.value = withSpring(0, FS_SPRING);
          ty.value = withSpring(0, FS_SPRING);
          pagerLockedSV.value = false;
          runOnJS(notifyLock)(false);
          runOnJS(setZoomedFromWorklet)(false);
        }
      });

    const pinchAndTap = Gesture.Simultaneous(pinch, tap);
    if (zoomed) {
      return Gesture.Simultaneous(pinchAndTap, pan);
    }
    return pinchAndTap;
  }, [
    zoomed,
    notifyLock,
    scale,
    tx,
    ty,
    panStartTx,
    panStartTy,
    pinchBaseScale,
    pinchBaseTx,
    pinchBaseTy,
    pinchComposeLatch,
    pagerLockedSV,
    imageMaxW,
    imageMaxH,
    mx,
    my,
    setZoomedFromWorklet,
  ]);

  return (
    <GestureDetector gesture={gesture}>
      <RNView
        pointerEvents={isActive ? 'auto' : 'none'}
        style={{
          width: pageWidth,
          height: pageHeight,
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'visible',
        }}
      >
        <Animated.View style={outerAnim}>
          <Animated.View
            style={[
              {
                width: imageMaxW,
                height: imageMaxH,
                justifyContent: 'center',
                alignItems: 'center',
              },
              innerAnim,
            ]}
          >
            <Image
              source={{ uri }}
              style={{ width: imageMaxW, height: imageMaxH }}
              resizeMode="contain"
            />
          </Animated.View>
        </Animated.View>
      </RNView>
    </GestureDetector>
  );
}

function getCoachingMessage(count: number): string {
  if (count === 0) return '✨ Add your first photo to get started';
  if (count < 3) return '✨ Add at least 3 photos — profiles with 4+ get 2x more vibes';
  if (count < 6) return `✨ You have ${6 - count} empty slots — a full set gets more attention`;
  return '✨ Looking great! Your photos tell a complete story.';
}

export default function PhotoManageDrawer({
  visible,
  onClose,
  photos,
  onPhotosChanged,
  launchAction = null,
  fullscreenOnly = false,
  initialFullscreenIndex = null,
}: PhotoManageDrawerProps) {
  const insets = useSafeAreaInsets();
  const { show, dialog } = useVibelyDialog();
  const {
    items: draftItems,
    readyPaths,
    filledCount,
    remainingSlots,
    chooseFileSupported,
    isUploading,
    hasFailures,
    hasChanges,
    canSave,
    resetDraft,
    addManyFromLibrary,
    addManyFromDocument,
    replaceOneFromLibrary,
    replaceOneFromDocument,
    takeOnePhoto,
    moveItem,
    makeMain,
    removeById,
    retryItem,
    dismissFailedItem,
  } = usePhotoBatchController({
    initialPhotos: photos,
    context: 'profile_studio',
    show,
    maxPhotos: MAX_PHOTOS,
  });
  const [saving, setSaving] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  /** Which grid tile shows inline actions (web: hover overlay); only one at a time */
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  // Fullscreen viewer
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  /** When true, horizontal pager is off so pan/zoom own the gesture (web: zoom doesn't steal swipe at 1x). */
  const [fullscreenPagerLocked, setFullscreenPagerLocked] = useState(false);
  const fullscreenListRef = useRef<FlatList<PhotoDraftItem> | null>(null);
  /** Horizontal thumbnail strip under main image — scroll to keep selection visible */
  const fullscreenStripRef = useRef<ScrollView | null>(null);
  /** Active page registers tap-equivalent zoom toggle for the top-right zoom control */
  const fsZoomToggleRef = useRef<(() => void) | null>(null);

  /** Compact in-drawer add-photo source menu; `anchor` = measured trigger rect in window coords */
  const [addSourcePicker, setAddSourcePicker] = useState<{
    open: boolean;
    anchor: AddPhotoAnchor | null;
  }>({ open: false, anchor: null });
  const addPickerReplaceRef = useRef<number | undefined>(undefined);

  const filmstripAddTriggerRefs = useRef<(RNView | null)[]>([]);
  const gridEmptyTriggerRefs = useRef<(RNView | null)[]>([]);

  /** Drag reorder (web: dnd-kit arrayMove between filled slots only) */
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  /** Live drop target while dragging — grid renders preview order from this + draggingIndex */
  const [previewDropIndex, setPreviewDropIndex] = useState<number | null>(null);
  const [dragTranslation, setDragTranslation] = useState({ tx: 0, ty: 0 });
  const dragStartRectRef = useRef<SlotRect | null>(null);
  const slotLayoutsRef = useRef<(SlotRect | undefined)[]>([]);
  const slotWrapRefs = useRef<(RNView | null)[]>([]);
  /** Latest finger position in window coords (fallback if onEnd omits absoluteX/Y on some devices) */
  const lastDragAbsRef = useRef({ x: 0, y: 0 });
  const draggingIndexRef = useRef<number | null>(null);
  const previewDropIndexRef = useRef<number | null>(null);

  /** Content-led sheet (VibePickerSheet pattern): 88% cap includes handle + scroll + bottom safe padding */
  const sheetMaxHeight = useMemo(() => Math.round(SCREEN_H * SHEET_MAX_HEIGHT_PCT), []);
  const sheetBottomPad = Math.max(insets.bottom, 20);
  const galleryScrollMaxHeight = useMemo(
    () => sheetMaxHeight - SHEET_HANDLE_STRIP - sheetBottomPad,
    [sheetMaxHeight, sheetBottomPad],
  );

  const draftItemsRef = useRef(draftItems);
  draftItemsRef.current = draftItems;
  const handledLaunchActionRef = useRef<number | null>(null);

  /**
   * Keep a ref to the latest `photos` prop so the open-transition effect always
   * reads the current server snapshot without needing `photos` in its dep array.
   * Having `photos` in the dep array caused `resetDraft` to fire on every React
   * Query background-refetch while the drawer was open, wiping staged deletions.
   */
  const photosRef = useRef(photos);
  photosRef.current = photos;

  React.useEffect(() => {
    if (!visible) return;
    resetDraft(photosRef.current);
    setSelectedItemId(null);
    setActiveItemId(null);
    const latestPhotos = photosRef.current;
    const startFullscreenIndex =
      fullscreenOnly && typeof initialFullscreenIndex === 'number'
        ? Math.min(Math.max(0, initialFullscreenIndex), Math.max(0, latestPhotos.length - 1))
        : null;
    setFullscreenIndex(startFullscreenIndex);
    setFullscreenPagerLocked(false);
    setDraggingIndex(null);
    setPreviewDropIndex(null);
    setDragTranslation({ tx: 0, ty: 0 });
    dragStartRectRef.current = null;
    draggingIndexRef.current = null;
    previewDropIndexRef.current = null;
    setAddSourcePicker({ open: false, anchor: null });
  // `photos` is intentionally excluded from deps: photosRef always holds the
  // latest value, so background React Query refetches (new array reference, same
  // content) don't trigger resetDraft and wipe staged edits mid-session.
  }, [visible, fullscreenOnly, initialFullscreenIndex, resetDraft]);

  /** Closing the drawer must reset to the server snapshot and reconcile ephemeral uploads (abort + mark sessions). */
  const prevVisibleRef = React.useRef(visible);
  React.useEffect(() => {
    if (prevVisibleRef.current && !visible) {
      resetDraft(photosRef.current);
    }
    prevVisibleRef.current = visible;
  }, [visible, resetDraft]);

  React.useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  /** Order shown in grid + filmstrip while dragging (live reorder preview). */
  const displayItems = useMemo(() => {
    if (
      draggingIndex === null ||
      previewDropIndex === null ||
      previewDropIndex === draggingIndex
    ) {
      return draftItems;
    }
    const n = draftItems.length;
    if (n < 2) return draftItems;
    return arrayMove(draftItems, draggingIndex, previewDropIndex);
  }, [draftItems, draggingIndex, previewDropIndex]);
  const coaching = useMemo(() => getCoachingMessage(filledCount), [filledCount]);
  const displayItemsRef = useRef(displayItems);
  displayItemsRef.current = displayItems;

  const getDraftIndexById = useCallback((id: string) => {
    return draftItemsRef.current.findIndex((item) => item.id === id);
  }, []);

  const resolveNextSelectedIdAfterRemoval = useCallback((id: string) => {
    const current = displayItemsRef.current;
    const index = current.findIndex((item) => item.id === id);
    if (index === -1) return current[0]?.id ?? null;
    return current[index + 1]?.id ?? current[index - 1]?.id ?? null;
  }, []);

  React.useEffect(() => {
    if (draftItems.length === 0) {
      if (selectedItemId !== null) setSelectedItemId(null);
      if (activeItemId !== null) setActiveItemId(null);
    } else {
      if (!selectedItemId || !draftItems.some((item) => item.id === selectedItemId)) {
        setSelectedItemId(draftItems[0].id);
      }
      if (activeItemId && !draftItems.some((item) => item.id === activeItemId)) {
        setActiveItemId(null);
      }
    }
    if (fullscreenIndex !== null && fullscreenIndex >= filledCount) {
      setFullscreenIndex(filledCount > 0 ? filledCount - 1 : null);
    }
  }, [activeItemId, draftItems, filledCount, fullscreenIndex, selectedItemId]);

  // ── Photo picker ─────────────────────────────────────────────
  React.useEffect(() => {
    if (!visible || fullscreenOnly || !launchAction) return;
    if (handledLaunchActionRef.current === launchAction.id) return;

    handledLaunchActionRef.current = launchAction.id;

    if (launchAction.kind === 'add-many-library') {
      void addManyFromLibrary();
      return;
    }
    if (launchAction.kind === 'add-many-document') {
      void addManyFromDocument();
      return;
    }
    void takeOnePhoto();
  }, [
    visible,
    fullscreenOnly,
    launchAction,
    addManyFromLibrary,
    addManyFromDocument,
    takeOnePhoto,
  ]);

  const openAddSourcePicker = useCallback((replaceIndex: number | undefined, anchor: AddPhotoAnchor | null) => {
    addPickerReplaceRef.current = replaceIndex;
    setActiveItemId(null);
    setAddSourcePicker({ open: true, anchor });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const closeAddSourcePicker = useCallback(() => {
    setAddSourcePicker({ open: false, anchor: null });
  }, []);

  const commitAddPhotoLibrary = useCallback(() => {
    const replaceIndex = addPickerReplaceRef.current;
    if (replaceIndex === undefined) {
      void addManyFromLibrary();
      return;
    }
    void replaceOneFromLibrary(replaceIndex);
  }, [addManyFromLibrary, replaceOneFromLibrary]);

  const commitAddTakePhoto = useCallback(() => {
    void takeOnePhoto(addPickerReplaceRef.current);
  }, [takeOnePhoto]);

  const commitAddChooseFile = useCallback(() => {
    const replaceIndex = addPickerReplaceRef.current;
    if (replaceIndex === undefined) {
      void addManyFromDocument();
      return;
    }
    void replaceOneFromDocument(replaceIndex);
  }, [addManyFromDocument, replaceOneFromDocument]);

  React.useEffect(() => {
    if (!addSourcePicker.open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeAddSourcePicker();
      return true;
    });
    return () => sub.remove();
  }, [addSourcePicker.open, closeAddSourcePicker]);

  // ── Tile actions ─────────────────────────────────────────────

  const handleMakeMain = useCallback((index: number) => {
    const current = displayItemsRef.current[index];
    if (!current) return;
    const draftIndex = getDraftIndexById(current.id);
    if (draftIndex === -1) return;
    makeMain(draftIndex);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActiveItemId(null);
    setSelectedItemId(current.id);
  }, [getDraftIndexById, makeMain]);

  const handleRemove = useCallback(
    (id: string) => {
      // Use OS Alert instead of VibelyDialog (second RN Modal). Stacking Modals over
      // the photo sheet often fails to show or receive touches — other tile actions
      // work because they do not open another Modal.
      void Haptics.selectionAsync();
      Alert.alert(
        'Remove this photo?',
        'It will disappear from your profile.',
        [
          { text: 'Keep', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              const nextSelectedId =
                selectedItemId === id ? resolveNextSelectedIdAfterRemoval(id) : selectedItemId;
              removeById(id);
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveItemId(null);
              setSelectedItemId(nextSelectedId);
            },
          },
        ],
        { cancelable: true },
      );
    },
    [removeById, resolveNextSelectedIdAfterRemoval, selectedItemId],
  );

  const handleReplace = useCallback((id: string, slotIndex: number) => {
    const replaceIndex = getDraftIndexById(id);
    if (replaceIndex === -1) return;
    setActiveItemId(null);
    requestAnimationFrame(() => {
      const el = slotWrapRefs.current[slotIndex];
      if (el) {
        el.measureInWindow((x, y, width, height) => {
          openAddSourcePicker(replaceIndex, { x, y, width, height });
        });
      } else {
        openAddSourcePicker(replaceIndex, null);
      }
    });
  }, [getDraftIndexById, openAddSourcePicker]);

  // ── Save / Cancel / Close ────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!hasChanges) { onClose(); return; }
    if (!canSave) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase.rpc('publish_photo_set', {
        p_user_id: user.id,
        p_photos: readyPaths,
        p_context: 'profile_studio',
      });
      if (error) throw error;
      const result = data as Record<string, unknown> | null;
      if (result && result.success !== true) {
        throw new Error(String(result.error ?? 'Photo save failed'));
      }

      onPhotosChanged();
      onClose();
    } catch (e) {
      show({
        title: 'Save failed',
        message: e instanceof Error ? e.message : 'Could not save photos.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setSaving(false);
    }
  }, [canSave, hasChanges, onClose, onPhotosChanged, readyPaths, show]);

  const confirmDiscard = useCallback(() => {
    setActiveItemId(null);
    if (!hasChanges) {
      onClose();
      return;
    }
    show({
      title: 'Discard changes?',
      message: 'Your photo edits will be lost.',
      variant: 'destructive',
      primaryAction: { label: 'Discard', onPress: onClose },
      secondaryAction: { label: 'Keep editing', onPress: () => {} },
    });
  }, [hasChanges, onClose, show]);

  // ── Render grid tile (inline actions on selected tile — web SortableTile hover overlay) ──

  const onFilledTilePress = useCallback((slotIndex: number) => {
    const item = displayItemsRef.current[slotIndex];
    if (!item) return;
    setSelectedItemId(item.id);
    if (item.status !== 'ready') {
      setActiveItemId(null);
      return;
    }
    setActiveItemId((prev) => (prev === item.id ? null : item.id));
  }, []);

  const beginDrag = useCallback((slotIndex: number) => {
    setActiveItemId(null);
    if (!displayItemsRef.current[slotIndex]) return;

    const apply = (L: SlotRect) => {
      slotLayoutsRef.current[slotIndex] = L;
      dragStartRectRef.current = { ...L };
      lastDragAbsRef.current = { x: L.x + L.width / 2, y: L.y + L.height / 2 };
      draggingIndexRef.current = slotIndex;
      previewDropIndexRef.current = slotIndex;
      setDraggingIndex(slotIndex);
      setPreviewDropIndex(slotIndex);
      setDragTranslation({ tx: 0, ty: 0 });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    };

    const cached = slotLayoutsRef.current[slotIndex];
    if (cached && cached.width > 2 && cached.height > 2) {
      apply(cached);
      return;
    }
    slotWrapRefs.current[slotIndex]?.measureInWindow((x, y, width, height) => {
      apply({ x, y, width, height });
    });
  }, []);

  const updateDrag = useCallback((tx: number, ty: number, absX: number, absY: number) => {
    if (Number.isFinite(absX) && Number.isFinite(absY)) {
      lastDragAbsRef.current = { x: absX, y: absY };
    }
    setDragTranslation({ tx, ty });

    const from = draggingIndexRef.current;
    if (from === null) return;
    const n = draftItemsRef.current.length;
    if (n < 2) return;

    const ax = Number.isFinite(absX) ? absX : lastDragAbsRef.current.x;
    const ay = Number.isFinite(absY) ? absY : lastDragAbsRef.current.y;

    const raw = resolveDropTargetIndex(ax, ay, slotLayoutsRef.current, n);
    if (raw === null) return;

    /** Canonical target for drop — same value committed on release */
    previewDropIndexRef.current = raw;

    setPreviewDropIndex((prev) => {
      if (prev === raw) return prev;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      return raw;
    });
  }, []);

  const endDrag = useCallback((absoluteX: number, absoluteY: number, fromIndex: number) => {
    const n = draftItemsRef.current.length;
    const targetIndex = previewDropIndexRef.current;
    const movedItemId = draftItemsRef.current[fromIndex]?.id ?? null;

    dragStartRectRef.current = null;
    setDragTranslation({ tx: 0, ty: 0 });
    setDraggingIndex(null);
    setPreviewDropIndex(null);
    draggingIndexRef.current = null;
    previewDropIndexRef.current = null;

    if (n < 2 || targetIndex === null || targetIndex === fromIndex) return;

    /** Commit same order as live preview (ref updated every pan frame from resolveDropTargetIndex) */
    moveItem(fromIndex, targetIndex);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (movedItemId) setSelectedItemId(movedItemId);
  }, [moveItem]);

  const onDragFinalize = useCallback(() => {
    setDraggingIndex((prev) => {
      if (prev === null) return prev;
      dragStartRectRef.current = null;
      setDragTranslation({ tx: 0, ty: 0 });
      setPreviewDropIndex(null);
      draggingIndexRef.current = null;
      previewDropIndexRef.current = null;
      return null;
    });
  }, []);

  const tileGestures = useMemo(
    () =>
      [0, 1, 2, 3, 4, 5].map((slotIndex) =>
        Gesture.Exclusive(
          Gesture.Tap()
            .maxDuration(280)
            .onEnd((_e, success) => {
              if (success) {
                runOnJS(onFilledTilePress)(slotIndex);
              }
            }),
          Gesture.Pan()
            .activateAfterLongPress(400)
            .onStart(() => {
              runOnJS(beginDrag)(slotIndex);
            })
            .onUpdate((e) => {
              runOnJS(updateDrag)(e.translationX, e.translationY, e.absoluteX, e.absoluteY);
            })
            .onEnd((e, success) => {
              if (success) {
                runOnJS(endDrag)(e.absoluteX, e.absoluteY, slotIndex);
              } else {
                runOnJS(onDragFinalize)();
              }
            }),
        ),
      ),
    [beginDrag, updateDrag, endDrag, onFilledTilePress, onDragFinalize],
  );

  const renderTile = (slotIndex: number) => {
    const item = displayItems[slotIndex] ?? null;
    const previewUri = itemThumbUri(item);
    const isMain = slotIndex === 0 && item !== null;
    const isSelectedTile = item !== null && selectedItemId === item.id;
    const overlayOpen = item?.status === 'ready' && activeItemId === item.id;
    const isUploadingTile = item?.status === 'uploading';
    const isFailedTile = item?.status === 'failed';

    const isDragDestinationPlaceholder =
      draggingIndex !== null &&
      previewDropIndex !== null &&
      previewDropIndex !== draggingIndex &&
      slotIndex === previewDropIndex;

    const isDragSourceStillLifted =
      draggingIndex !== null &&
      previewDropIndex !== null &&
      previewDropIndex === draggingIndex &&
      slotIndex === draggingIndex;

    if (!item) {
      return (
        <RNView
          key={`empty-${slotIndex}`}
          ref={(r) => {
            gridEmptyTriggerRefs.current[slotIndex] = r;
          }}
          collapsable={false}
          style={{ flex: 1 }}
        >
          <Pressable
            onPress={() => {
              setActiveItemId(null);
              gridEmptyTriggerRefs.current[slotIndex]?.measureInWindow((x, y, width, height) => {
                openAddSourcePicker(undefined, { x, y, width, height });
              });
            }}
            style={[st.gridTile, st.emptyTile, { flex: 1 }]}
          >
            <Ionicons name="add" size={28} color="rgba(255,255,255,0.3)" />
            <Text style={st.emptyTileLabel}>
              {remainingSlots > 1 ? `Add up to ${remainingSlots}` : 'Add'}
            </Text>
          </Pressable>
        </RNView>
      );
    }

    return (
      <RNView
        key={`tile-wrap-${slotIndex}`}
        ref={(r) => {
          slotWrapRefs.current[slotIndex] = r;
        }}
        onLayout={() => {
          slotWrapRefs.current[slotIndex]?.measureInWindow((x, y, width, height) => {
            slotLayoutsRef.current[slotIndex] = { x, y, width, height };
          });
        }}
        style={{ flex: 1 }}
        collapsable={false}
      >
        {(() => {
          const tileBody = (
            <RNView
              style={[
                st.gridTile,
                st.filledTile,
                { flex: 1 },
                isSelectedTile && st.gridTileActive,
                isDragSourceStillLifted && { opacity: 0.35 },
              ]}
            >
              {isDragDestinationPlaceholder ? (
                <RNView style={[StyleSheet.absoluteFill, st.dragDropPlaceholder]} />
              ) : (
                previewUri ? (
                  <Image source={{ uri: previewUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                  <RNView style={[StyleSheet.absoluteFill, st.dragDropPlaceholder]} />
                )
              )}

              {!overlayOpen && (
                <>
                  <RNView style={st.positionBadge}>
                    <Text style={st.positionBadgeText}>{slotIndex + 1}</Text>
                  </RNView>
                  {isMain && (
                    <RNView style={st.mainBadge}>
                      <Text style={st.mainBadgeCrown}>👑</Text>
                      <Text style={st.mainBadgeLabel}>Main</Text>
                    </RNView>
                  )}
                </>
              )}

              {isUploadingTile ? (
                <RNView style={st.statusOverlay}>
                  <ActivityIndicator color="#fff" />
                  <Text style={st.statusOverlayText}>Uploading…</Text>
                  <RNView style={st.statusOverlayActions}>
                    <Pressable
                      onPress={(event) => {
                        event.stopPropagation();
                        handleRemove(item.id);
                      }}
                      style={({ pressed }) => [
                        st.statusActionBtn,
                        st.statusDeleteActionBtn,
                        pressed && st.statusDeleteActionBtnPressed,
                      ]}
                    >
                      <Text style={st.statusActionText}>Delete</Text>
                    </Pressable>
                  </RNView>
                </RNView>
              ) : null}

              {isFailedTile ? (
                <RNView style={st.statusOverlay}>
                  <Ionicons name="alert-circle-outline" size={18} color="#fff" />
                  <Text numberOfLines={2} style={st.statusOverlayText}>
                    {item.error ?? 'Upload failed'}
                  </Text>
                  <RNView style={st.statusOverlayActions}>
                    <Pressable
                      onPress={(event) => {
                        event.stopPropagation();
                        void retryItem(item.id);
                      }}
                      style={({ pressed }) => [
                        st.statusActionBtn,
                        pressed && st.statusActionBtnPressed,
                      ]}
                    >
                      <Text style={st.statusActionText}>Retry</Text>
                    </Pressable>
                    {item.replaceOldPath ? (
                      <Pressable
                        onPress={(event) => {
                          event.stopPropagation();
                          dismissFailedItem(item.id);
                        }}
                        style={({ pressed }) => [
                          st.statusActionBtn,
                          pressed && st.statusActionBtnPressed,
                        ]}
                      >
                        <Text style={st.statusActionText}>Keep current</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={(event) => {
                        event.stopPropagation();
                        handleRemove(item.id);
                      }}
                      style={({ pressed }) => [
                        st.statusActionBtn,
                        st.statusDeleteActionBtn,
                        pressed && st.statusDeleteActionBtnPressed,
                      ]}
                    >
                      <Text style={st.statusActionText}>Delete</Text>
                    </Pressable>
                  </RNView>
                </RNView>
              ) : null}

              {overlayOpen && (() => {
                /** Row 1: slots 0–2 (large + stacked pair). Row 2: slots 3–5 (three equal). */
                const isBottomRowTile = slotIndex >= 3;

                const iconBase = (pressed: boolean) => [st.tileIconBtn, pressed && st.tileIconBtnPressed];

                const actionNodes: React.ReactNode[] = [];
                if (slotIndex !== 0) {
                  actionNodes.push(
                    <Pressable
                      key="make-main"
                      onPress={(event) => {
                        event.stopPropagation();
                        handleMakeMain(slotIndex);
                      }}
                      style={({ pressed }) => iconBase(pressed)}
                      accessibilityLabel="Make Main"
                      hitSlop={6}
                    >
                      <Text style={st.tileIconEmoji}>👑</Text>
                    </Pressable>,
                  );
                }
                actionNodes.push(
                  <Pressable
                    key="expand"
                    onPress={(event) => {
                      event.stopPropagation();
                      setActiveItemId(null);
                      setFullscreenIndex(slotIndex);
                    }}
                    style={({ pressed }) => iconBase(pressed)}
                    accessibilityLabel="View full size"
                    hitSlop={6}
                  >
                    <Ionicons name="expand-outline" size={15} color="#fff" />
                  </Pressable>,
                  <Pressable
                    key="replace"
                    onPress={(event) => {
                      event.stopPropagation();
                      handleReplace(item.id, slotIndex);
                    }}
                    style={({ pressed }) => iconBase(pressed)}
                    accessibilityLabel="Replace"
                    hitSlop={6}
                  >
                    <Ionicons name="refresh-outline" size={15} color="#fff" />
                  </Pressable>,
                  <Pressable
                    key="remove"
                    onPress={(event) => {
                      event.stopPropagation();
                      handleRemove(item.id);
                    }}
                    style={({ pressed }) => iconBase(pressed)}
                    accessibilityLabel="Remove"
                    hitSlop={6}
                  >
                    <Ionicons name="trash-outline" size={15} color="#fff" />
                  </Pressable>,
                );

                const badgeEl = (
                  <RNView style={st.positionBadgeOverlay}>
                    <Text style={st.positionBadgeText}>{slotIndex + 1}</Text>
                  </RNView>
                );

                const mainBadgeEl = isMain ? (
                  <RNView style={st.tileOverlayMainBadge}>
                    <Text style={st.tileOverlayMainBadgeCrown}>👑</Text>
                    <Text style={st.tileOverlayMainBadgeLabel}>Main</Text>
                  </RNView>
                ) : null;

                if (isBottomRowTile) {
                  const mid = Math.ceil(actionNodes.length / 2);
                  const leftCol = actionNodes.slice(0, mid);
                  const rightCol = actionNodes.slice(mid);
                  return (
                    <RNView style={[st.tileOverlay, st.tileOverlayBottomVariant]} pointerEvents="box-none">
                      <RNView style={st.tileOverlayBadgeRowOnly}>{badgeEl}</RNView>
                      <RNView style={st.tileOverlaySplitCenter}>
                        <RNView style={st.tileVerticalIconCol}>{leftCol}</RNView>
                        <RNView style={st.tileVerticalIconCol}>{rightCol}</RNView>
                      </RNView>
                      {mainBadgeEl}
                    </RNView>
                  );
                }

                return (
                  <RNView style={st.tileOverlay} pointerEvents="box-none">
                    <RNView style={st.tileOverlayTopRow}>
                      {badgeEl}
                      <RNView style={st.tileActionIconsRow}>{actionNodes}</RNView>
                    </RNView>
                    {mainBadgeEl}
                  </RNView>
                );
              })()}
            </RNView>
          );

          if (item.status === 'ready' && !overlayOpen) {
            return <GestureDetector gesture={tileGestures[slotIndex]}>{tileBody}</GestureDetector>;
          }

          if (item.status !== 'ready') {
            return (
              <Pressable
                onPress={() => {
                  setSelectedItemId(item.id);
                  setActiveItemId(null);
                }}
                style={{ flex: 1 }}
              >
                {tileBody}
              </Pressable>
            );
          }

          return tileBody;
        })()}
      </RNView>
    );
  };

  // ── Fullscreen viewer (web runtime parity: swipe + arrows + tap zoom; pager off when zoomed)

  /** Same order as grid/filmstrip — includes staged local previews while editing. */
  const fullscreenItems = fullscreenOnly ? draftItems : displayItems;
  const fullscreenStripMetrics = useMemo(
    () => resolveFullscreenStripMetrics(fullscreenItems.length, SCREEN_W),
    [fullscreenItems.length],
  );

  const closeFullscreen = useCallback(() => {
    fsZoomToggleRef.current = null;
    setFullscreenPagerLocked(false);
    setFullscreenIndex(null);
    if (fullscreenOnly) onClose();
  }, [fullscreenOnly, onClose]);

  const navigateFullscreen = useCallback((nextIndex: number) => {
    setFullscreenPagerLocked(false);
    setFullscreenIndex(nextIndex);
    requestAnimationFrame(() => {
      fullscreenListRef.current?.scrollToIndex({ index: nextIndex, animated: true });
    });
  }, []);

  React.useEffect(() => {
    if (fullscreenIndex !== null) setFullscreenPagerLocked(false);
  }, [fullscreenIndex]);

  /** Keep fullscreen thumbnail strip scrolled to the active photo (parity with web runtime strip UX). */
  React.useEffect(() => {
    if (fullscreenIndex === null) return;
    const cell = fullscreenStripMetrics.cell;
    const x = Math.max(0, fullscreenIndex * cell - SCREEN_W / 2 + fullscreenStripMetrics.thumb / 2);
    const t = requestAnimationFrame(() => {
      fullscreenStripRef.current?.scrollTo({ x, y: 0, animated: true });
    });
    return () => cancelAnimationFrame(t);
  }, [fullscreenIndex, fullscreenStripMetrics.cell, fullscreenStripMetrics.thumb]);

  const renderFullscreen = () => {
    if (fullscreenIndex === null) return null;
    const items = fullscreenItems;
    const total = items.length;
    if (total === 0 || fullscreenIndex < 0 || fullscreenIndex >= total || !itemFullUri(items[fullscreenIndex])) {
      return null;
    }
    const idx = fullscreenIndex;
    const stripBottomPad = Math.max(insets.bottom, 10) + FS_STRIP_EXTRA_BELOW_THUMB;
    const stripBarHeight =
      FS_STRIP_BORDER + FS_STRIP_PADDING_TOP + FS_STRIP_THUMB + stripBottomPad;
    const topChromeH =
      insets.top + 16 + FS_TOP_ROW_MIN_H + FS_TOP_ROW_BOTTOM_PAD;
    const mainStageHeight = Math.max(
      200,
      SCREEN_H - topChromeH - FS_HELPER_BLOCK - stripBarHeight,
    );
    const imageMaxW = FS_IMG_MAX_W;
    const imageMaxH = Math.min(FS_IMG_MAX_H, mainStageHeight * 0.88);

    const helperText =
      total > 1
        ? 'Swipe to browse · Pinch, tap, or zoom icon to zoom'
        : 'Pinch, tap, or zoom icon to zoom';

    const stripContentStyle = [
      st.fsStripContent,
      {
        paddingHorizontal: fullscreenStripMetrics.sidePad,
        gap: fullscreenStripMetrics.gap,
      },
      fullscreenStripMetrics.fits && st.fsStripContentCentered,
    ];

    return (
      <Modal visible animationType="fade" onRequestClose={closeFullscreen}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <RNView style={st.fsContainer}>
            <Pressable
              style={[StyleSheet.absoluteFill, st.fsBackdrop]}
              onPress={closeFullscreen}
              accessibilityLabel="Dismiss"
            />

            <RNView style={st.fsStack} pointerEvents="box-none">
              <RNView style={[st.fsTopChromeRow, { paddingTop: insets.top + 16 }]}>
                <Text style={st.fsCounterText} accessibilityRole="text">
                  Photo {idx + 1} of {total}
                  {idx === 0 ? ' · Main' : ''}
                </Text>
                <RNView style={st.fsTopChromeSpacer} />
                <RNView style={st.fsTopRightIcons}>
                  <Pressable
                    style={({ pressed }) => [st.fsTopIconBtn, pressed && st.fsTopIconBtnPressed]}
                    hitSlop={8}
                    accessibilityLabel={fullscreenPagerLocked ? 'Zoom out' : 'Zoom in'}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      fsZoomToggleRef.current?.();
                    }}
                  >
                    <Ionicons
                      name={fullscreenPagerLocked ? 'contract-outline' : 'expand-outline'}
                      size={22}
                      color="rgba(255,255,255,0.95)"
                    />
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [st.fsTopIconBtn, pressed && st.fsTopIconBtnPressed]}
                    hitSlop={8}
                    accessibilityLabel="Close"
                    onPress={closeFullscreen}
                  >
                    <Ionicons name="close" size={22} color="rgba(255,255,255,0.95)" />
                  </Pressable>
                </RNView>
              </RNView>

              <RNView style={st.fsStage} pointerEvents="box-none">
                <FlatList
                  ref={fullscreenListRef}
                  style={st.fsPager}
                  data={items}
                  horizontal
                  pagingEnabled
                  scrollEnabled={!fullscreenPagerLocked}
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(item, i) => `fs-page-${i}-${item.id}`}
                  initialScrollIndex={idx}
                  initialNumToRender={Math.min(total, 8)}
                  maxToRenderPerBatch={8}
                  windowSize={5}
                  extraData={{ fullscreenIndex, fullscreenPagerLocked }}
                  getItemLayout={(_, index) => ({
                    length: SCREEN_W,
                    offset: SCREEN_W * index,
                    index,
                  })}
                  onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                    const x = e.nativeEvent.contentOffset.x;
                    const i = Math.round(x / SCREEN_W);
                    if (i >= 0 && i < total) setFullscreenIndex(i);
                  }}
                  onScrollToIndexFailed={(info) => {
                    const wait = new Promise<void>((r) => setTimeout(r, 100));
                    void wait.then(() => {
                      fullscreenListRef.current?.scrollToIndex({
                        index: info.index,
                        animated: false,
                      });
                    });
                  }}
                  renderItem={({ item, index: pageIndex }) => {
                    const uri = itemFullUri(item);
                    if (!uri) return <RNView style={{ width: SCREEN_W, height: mainStageHeight }} />;
                    return (
                      <FullscreenPhotoPage
                        uri={uri}
                        pageWidth={SCREEN_W}
                        pageHeight={mainStageHeight}
                        imageMaxW={imageMaxW}
                        imageMaxH={imageMaxH}
                        isActive={pageIndex === fullscreenIndex}
                        onZoomPagerLockChange={setFullscreenPagerLocked}
                        zoomToggleRef={fsZoomToggleRef}
                      />
                    );
                  }}
                />

                <RNView pointerEvents="box-none" style={st.fsArrowLayer}>
                  {idx > 0 ? (
                    <Pressable
                      style={[st.fsArrowBtn, st.fsArrowLeft]}
                      onPress={() => navigateFullscreen(idx - 1)}
                      accessibilityLabel="Previous photo"
                    >
                      <Ionicons name="chevron-back" size={28} color="white" />
                    </Pressable>
                  ) : null}
                  {idx < total - 1 ? (
                    <Pressable
                      style={[st.fsArrowBtn, st.fsArrowRight]}
                      onPress={() => navigateFullscreen(idx + 1)}
                      accessibilityLabel="Next photo"
                    >
                      <Ionicons name="chevron-forward" size={28} color="white" />
                    </Pressable>
                  ) : null}
                </RNView>
              </RNView>

              <Text style={st.fsHelperText} pointerEvents="none">
                {helperText}
              </Text>

              <RNView style={[st.fsStripBar, { paddingBottom: stripBottomPad }]}>
                <ScrollView
                  ref={fullscreenStripRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={stripContentStyle}
                  keyboardShouldPersistTaps="handled"
                >
                  {items.map((item, i) => {
                    const uri = itemThumbUri(item);
                    if (!uri) return null;
                    return (
                      <Pressable
                        key={`fs-strip-${i}-${item.id}`}
                        onPress={() => navigateFullscreen(i)}
                        accessibilityLabel={`Photo ${i + 1}`}
                        style={[
                          st.fsStripThumb,
                          {
                            width: fullscreenStripMetrics.thumb,
                            height: fullscreenStripMetrics.thumb,
                          },
                          i === idx && st.fsStripThumbActive,
                        ]}
                      >
                        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                        {i === 0 ? (
                          <RNView style={st.fsStripMainDot}>
                            <Text style={{ fontSize: 8 }}>👑</Text>
                          </RNView>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </RNView>
            </RNView>
          </RNView>
        </GestureHandlerRootView>
      </Modal>
    );
  };

  // ── Main render ──────────────────────────────────────────────

  const dragPreviewRect = draggingIndex !== null ? dragStartRectRef.current : null;

  if (fullscreenOnly) {
    return (
      <>
        {renderFullscreen()}
        {dialog}
      </>
    );
  }

  return (
    <>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={confirmDiscard}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={st.kavOverlay}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={confirmDiscard}
            accessibilityLabel="Dismiss"
          />
          <RNView
            style={[
              st.sheetShell,
              {
                maxHeight: sheetMaxHeight,
                paddingBottom: sheetBottomPad,
              },
            ]}
          >
            <RNView style={st.sheetHandle} />
            <ScrollView
              style={[st.drawerMainScroll, { maxHeight: galleryScrollMaxHeight }]}
              contentContainerStyle={[st.drawerScrollInner, { paddingBottom: 12 }]}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              scrollEnabled={draggingIndex === null}
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={() => {
                if (activeItemId !== null) setActiveItemId(null);
              }}
            >
              {/* ── Header ── */}
              <RNView style={st.header}>
                <RNView>
                  <Text style={st.headerTitle}>Manage Your Gallery</Text>
                  <Text style={st.headerSubtitle}>First impressions matter. Make them count.</Text>
                </RNView>
                <Pressable onPress={confirmDiscard} style={st.closeBtn} hitSlop={12}>
                  <Ionicons name="close" size={24} color="rgba(255,255,255,0.6)" />
                </Pressable>
              </RNView>

              {/* ── Filmstrip ── */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={st.filmstripContent}
                style={st.filmstrip}
                scrollEnabled={draggingIndex === null}
                onScrollBeginDrag={() => {
                  if (activeItemId !== null) setActiveItemId(null);
                }}
              >
                {displayItems.map((item, index) => {
                  const uri = itemThumbUri(item);
                  if (!uri) return null;
                  return (
                    <Pressable
                      key={`fs-${index}-${item.id}`}
                      onPress={() => {
                        setSelectedItemId(item.id);
                        setActiveItemId((prev) =>
                          item.status === 'ready'
                            ? (prev === item.id ? null : item.id)
                            : null,
                        );
                      }}
                      style={[
                        st.filmstripThumb,
                        selectedItemId === item.id && st.filmstripThumbActive,
                        selectedItemId !== item.id && { opacity: 0.55 },
                      ]}
                    >
                      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      {index === 0 && (
                        <RNView style={st.filmstripMainDot}>
                          <Text style={{ fontSize: 8 }}>👑</Text>
                        </RNView>
                      )}
                      {item.status === 'uploading' ? (
                        <RNView style={st.filmstripStatusDot}>
                          <ActivityIndicator size="small" color="#fff" />
                        </RNView>
                      ) : null}
                      {item.status === 'failed' ? (
                        <RNView style={st.filmstripStatusDot}>
                          <Ionicons name="alert-circle" size={14} color="#fff" />
                        </RNView>
                      ) : null}
                    </Pressable>
                  );
                })}
                {Array.from({ length: Math.max(0, MAX_PHOTOS - filledCount) }).map((_, i) => (
                  <RNView
                    key={`fs-empty-${i}`}
                    ref={(r) => {
                      filmstripAddTriggerRefs.current[i] = r;
                    }}
                    collapsable={false}
                  >
                    <Pressable
                      onPress={() => {
                        setActiveItemId(null);
                        filmstripAddTriggerRefs.current[i]?.measureInWindow((x, y, width, height) => {
                          openAddSourcePicker(undefined, { x, y, width, height });
                        });
                      }}
                      style={st.filmstripEmpty}
                    >
                      <Ionicons name="add" size={20} color="rgba(255,255,255,0.3)" />
                    </Pressable>
                  </RNView>
                ))}
              </ScrollView>

              {/* ── Grid ── */}
              <RNView style={st.gridContent}>
                <RNView style={{ flexDirection: 'row', gap: 8, height: 260 }}>
                  <RNView style={{ flex: 3 }}>{renderTile(0)}</RNView>
                  <RNView style={{ flex: 2, gap: 8 }}>
                    {renderTile(1)}
                    {renderTile(2)}
                  </RNView>
                </RNView>
                <RNView style={{ flexDirection: 'row', gap: 8, height: 130, marginTop: 8 }}>
                  {renderTile(3)}
                  {renderTile(4)}
                  {renderTile(5)}
                </RNView>

                <Text style={st.coachingText}>{coaching}</Text>
              </RNView>

              {/* ── Footer (in scroll — same relationship as VibePickerSheet Save/Cancel) ── */}
              <RNView style={st.footer}>
                <LinearGradient
                  colors={['#8B5CF6', '#E84393']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[st.saveGradient, { opacity: hasChanges && canSave ? 1 : 0.5 }]}
                >
                  <Pressable
                    onPress={() => void handleSave()}
                    disabled={saving || !canSave}
                    style={st.saveInner}
                  >
                    <Text style={st.saveText}>
                      {saving
                        ? 'Saving…'
                        : isUploading
                          ? 'Uploading…'
                          : hasFailures
                            ? 'Resolve failed uploads'
                            : hasChanges
                              ? 'Save Changes'
                              : 'Done'}
                    </Text>
                  </Pressable>
                </LinearGradient>

                <Pressable onPress={confirmDiscard} style={st.cancelBtn}>
                  <Text style={st.cancelText}>Cancel</Text>
                </Pressable>
              </RNView>
            </ScrollView>
          </RNView>
        </KeyboardAvoidingView>

      {draggingIndex !== null && dragPreviewRect && draftItems[draggingIndex] ? (
        <RNView pointerEvents="none" style={st.dragFloatLayer}>
          <RNView
            style={[
              st.dragFloatTile,
              {
                left: dragPreviewRect.x + dragTranslation.tx,
                top: dragPreviewRect.y + dragTranslation.ty,
                width: dragPreviewRect.width,
                height: dragPreviewRect.height,
              },
            ]}
          >
            {itemThumbUri(draftItems[draggingIndex]) ? (
              <Image
                source={{ uri: itemThumbUri(draftItems[draggingIndex])! }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
              />
            ) : null}
          </RNView>
        </RNView>
      ) : null}

      {addSourcePicker.open ? (
        <RNView style={[StyleSheet.absoluteFillObject, { zIndex: 10050 }]} pointerEvents="box-none">
          <AddPhotoSourcePopover
            visible={addSourcePicker.open}
            anchor={addSourcePicker.anchor}
            safeInsets={insets}
            onDismiss={closeAddSourcePicker}
            onPhotoLibrary={commitAddPhotoLibrary}
            onTakePhoto={commitAddTakePhoto}
            onChooseFile={commitAddChooseFile}
            chooseFileSupported={chooseFileSupported}
            useRootModal={false}
          />
        </RNView>
      ) : null}

      </GestureHandlerRootView>

      {/* ── Fullscreen Viewer ── */}
      {renderFullscreen()}
    </Modal>
    {dialog}
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const st = StyleSheet.create({
  /** Same shell role as VibePickerSheet overlay: dim + bottom-anchored sheet */
  kavOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheetShell: {
    width: '100%',
    backgroundColor: '#0A0A0F',
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.4)',
    marginTop: 10,
    marginBottom: 12,
  },
  /** Scroll viewport height capped so content scrolls inside sheet when needed */
  drawerMainScroll: {
    alignSelf: 'stretch',
    flexGrow: 0,
  },
  drawerScrollInner: {
    flexGrow: 0,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: fonts.displayBold,
    color: '#F5F5F5',
  },
  headerSubtitle: {
    fontSize: 14,
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 4,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Filmstrip
  filmstrip: {
    flexGrow: 0,
  },
  filmstripContent: {
    paddingHorizontal: 20,
    gap: 8,
    paddingVertical: 12,
  },
  filmstripThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: 'hidden',
  },
  filmstripThumbActive: {
    borderWidth: 2,
    borderColor: '#8B5CF6',
  },
  filmstripMainDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filmstripStatusDot: {
    position: 'absolute',
    top: 2,
    left: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 2,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filmstripEmpty: {
    width: 56,
    height: 56,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(139,92,246,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Grid
  gridContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
  },
  gridTile: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  filledTile: {
    backgroundColor: '#1A1A2E',
  },
  /** Reserved cell while dragging — image shown on floating layer only */
  dragDropPlaceholder: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(139,92,246,0.35)',
  },
  gridTileActive: {
    borderWidth: 2,
    borderColor: 'rgba(139, 92, 246, 0.85)',
  },
  tileOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.52)',
    padding: 8,
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  statusOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4, 6, 16, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    gap: 8,
  },
  statusOverlayText: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.bodySemiBold,
    color: 'rgba(255,255,255,0.96)',
    textAlign: 'center',
  },
  statusOverlayActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  statusActionBtn: {
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusActionBtnPressed: {
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  statusDeleteActionBtn: {
    backgroundColor: 'rgba(239,68,68,0.28)',
  },
  statusDeleteActionBtnPressed: {
    backgroundColor: 'rgba(239,68,68,0.4)',
  },
  statusActionText: {
    fontSize: 11,
    fontFamily: fonts.bodySemiBold,
    color: '#fff',
  },
  /** Bottom row (slots 3–5): split columns; middle section flexes between badge and Main */
  tileOverlayBottomVariant: {
    paddingTop: 6,
    paddingBottom: 8,
  },
  tileOverlayTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 28,
  },
  /** Bottom-row overlay: number badge only on top strip */
  tileOverlayBadgeRowOnly: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  /** Bottom row: two vertical columns, vertically centered in tile */
  tileOverlaySplitCenter: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    minHeight: 0,
  },
  tileVerticalIconCol: {
    gap: 8,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 30,
  },
  positionBadgeOverlay: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  /** Upper row (slots 0–2): single horizontal row, right-aligned; leaves room for # badge */
  tileActionIconsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginLeft: 6,
    minWidth: 0,
    flexWrap: 'nowrap',
  },
  tileIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileIconBtnPressed: {
    backgroundColor: 'rgba(139, 92, 246, 0.88)',
  },
  tileIconEmoji: {
    fontSize: 13,
    lineHeight: 16,
  },
  tileOverlayMainBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  tileOverlayMainBadgeCrown: {
    fontSize: 10,
    lineHeight: 12,
  },
  tileOverlayMainBadgeLabel: {
    fontSize: 10,
    fontFamily: fonts.bodySemiBold,
    color: 'rgba(255,255,255,0.95)',
  },
  emptyTile: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(139,92,246,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  emptyTileLabel: {
    fontSize: 11,
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.25)',
  },
  positionBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  positionBadgeText: {
    fontSize: 11,
    fontFamily: fonts.bodyBold,
    color: 'white',
  },
  mainBadge: {
    position: 'absolute',
    top: 8,
    left: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  mainBadgeCrown: {
    fontSize: 10,
    lineHeight: 12,
  },
  mainBadgeLabel: {
    fontSize: 10,
    fontFamily: fonts.bodySemiBold,
    color: 'rgba(255,255,255,0.95)',
  },

  // Coaching
  coachingText: {
    fontSize: 13,
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
  },

  // Footer
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#0A0A0F',
  },
  saveGradient: {
    borderRadius: 14,
  },
  saveInner: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveText: {
    color: 'white',
    fontFamily: fonts.bodyBold,
    fontSize: 16,
  },
  cancelBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: {
    color: 'rgba(255,255,255,0.5)',
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
  },

  // Drag reorder (web DragOverlay parity)
  dragFloatLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
  },
  dragFloatTile: {
    position: 'absolute',
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
  },

  // Fullscreen viewer — vertical stack (web runtime): top chrome → stage → helper → strip
  fsContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  fsBackdrop: {
    zIndex: 0,
  },
  fsStack: {
    flex: 1,
    minHeight: 0,
    zIndex: 1,
  },
  fsTopChromeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: FS_TOP_ROW_BOTTOM_PAD,
    minHeight: FS_TOP_ROW_MIN_H,
  },
  fsCounterText: {
    fontSize: 14,
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.6)',
  },
  fsTopChromeSpacer: {
    flex: 1,
  },
  fsTopRightIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fsTopIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fsTopIconBtnPressed: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  fsStage: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  fsPager: {
    flex: 1,
  },
  fsArrowLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    pointerEvents: 'box-none',
  },
  fsArrowBtn: {
    position: 'absolute',
    top: '50%',
    marginTop: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fsArrowLeft: {
    left: 16,
  },
  fsArrowRight: {
    right: 16,
  },
  fsHelperText: {
    fontSize: 13,
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 8,
  },
  fsStripBar: {
    borderTopWidth: FS_STRIP_BORDER,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: FS_STRIP_PADDING_TOP,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  fsStripContent: {
    paddingHorizontal: FS_STRIP_SIDE_PAD,
    gap: FS_STRIP_GAP,
    alignItems: 'center',
  },
  fsStripContentCentered: {
    flexGrow: 1,
    justifyContent: 'center',
    minWidth: '100%',
  },
  fsStripThumb: {
    width: FS_STRIP_THUMB,
    height: FS_STRIP_THUMB,
    borderRadius: 10,
    overflow: 'hidden',
  },
  fsStripThumbActive: {
    borderWidth: 2,
    borderColor: '#8B5CF6',
  },
  fsStripMainDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
