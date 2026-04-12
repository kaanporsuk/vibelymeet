import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import {
  normalizeDocumentAssetForUpload,
  normalizePickerAssetForUpload,
} from '@/lib/imageAssetNormalize';
import { getDocumentAsyncSafe, isDocumentPickerAvailable } from '@/lib/safeDocumentPicker';
import { supabase } from '@/lib/supabase';
import { uploadProfilePhoto } from '@/lib/uploadImage';

const MAX_PHOTOS_DEFAULT = 6;

type DialogAction = {
  label: string;
  onPress: () => void;
};

type DialogVariant = 'info' | 'warning' | 'success' | 'destructive';

type DialogShow = (config: {
  title: string;
  message: string;
  variant: DialogVariant;
  primaryAction: DialogAction;
  secondaryAction?: DialogAction;
}) => void;

export type PhotoBatchContext = 'onboarding' | 'profile_studio';

export type PhotoBatchLaunchAction =
  | { id: number; kind: 'add-many-library' }
  | { id: number; kind: 'add-many-document' }
  | { id: number; kind: 'take-one-photo' };

export type PhotoBatchOrigin = 'existing' | 'library' | 'document' | 'camera';

export type PhotoDraftStatus = 'ready' | 'uploading' | 'failed';

export type PhotoUploadAsset = {
  uri: string;
  mimeType?: string;
  fileName?: string;
};

export type PhotoDraftItem = {
  id: string;
  storagePath: string | null;
  /** Draft media session id from upload-image (ready to reconcile with publish / discard) */
  sessionId: string | null;
  previewUri: string | null;
  status: PhotoDraftStatus;
  error: string | null;
  replaceOldPath: string | null;
  sourceAsset: PhotoUploadAsset | null;
  origin: PhotoBatchOrigin;
};

type UsePhotoBatchControllerOptions = {
  initialPhotos: string[];
  context: PhotoBatchContext;
  show: DialogShow;
  maxPhotos?: number;
};

let draftIdCounter = 0;

/** iOS 14+ — request JPEG/compatible representation when possible (library only; camera unchanged). */
const iosLibraryPreferredCompat =
  Platform.OS === 'ios'
    ? {
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      }
    : {};

function nextDraftId(prefix: string): string {
  draftIdCounter += 1;
  return `${prefix}-${Date.now()}-${draftIdCounter}`;
}

function arrayMove<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function createExistingDraft(path: string): PhotoDraftItem {
  return {
    id: nextDraftId('existing'),
    storagePath: path,
    sessionId: null,
    previewUri: null,
    status: 'ready',
    error: null,
    replaceOldPath: null,
    sourceAsset: null,
    origin: 'existing',
  };
}

function createPendingDraft(asset: PhotoUploadAsset, origin: Exclude<PhotoBatchOrigin, 'existing'>): PhotoDraftItem {
  return {
    id: nextDraftId(origin),
    storagePath: null,
    sessionId: null,
    previewUri: asset.uri,
    status: 'uploading',
    error: null,
    replaceOldPath: null,
    sourceAsset: asset,
    origin,
  };
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function showOkDialog(show: DialogShow, title: string, message: string, variant: DialogVariant = 'info') {
  show({
    title,
    message,
    variant,
    primaryAction: { label: 'OK', onPress: () => {} },
  });
}

function isAbortError(error: unknown): boolean {
  if (error == null) return false;
  if (typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'AbortError') {
    return true;
  }
  if (error instanceof Error && /aborted/i.test(error.message)) return true;
  return false;
}

/** Paths uploaded in this edit session that are not in the keeper set (server snapshot). */
function collectEphemeralStoragePaths(
  items: PhotoDraftItem[],
  keepPaths: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.status === 'ready' && it.storagePath && !keepPaths.has(it.storagePath)) {
      out.push(it.storagePath);
    }
  }
  return out;
}

async function markPhotoDraftsDeletedOnServer(paths: string[]): Promise<void> {
  const unique = [...new Set(paths)].filter(Boolean);
  if (unique.length === 0) return;
  const { error } = await supabase.rpc('mark_photo_drafts_deleted', { p_paths: unique });
  if (error && __DEV__) {
    console.warn('[photoBatchController] mark_photo_drafts_deleted failed:', error.message);
  }
}

export function getPhotoDraftDisplayUri(item: PhotoDraftItem | null | undefined): string | null {
  return item?.previewUri?.trim() || item?.storagePath?.trim() || null;
}

export function usePhotoBatchController({
  initialPhotos,
  context,
  show,
  maxPhotos = MAX_PHOTOS_DEFAULT,
}: UsePhotoBatchControllerOptions) {
  const [items, setItems] = useState<PhotoDraftItem[]>(() => initialPhotos.map(createExistingDraft));
  const [activeUploadIds, setActiveUploadIds] = useState<Set<string>>(() => new Set());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const isMountedRef = useRef(true);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const initialPathsRef = useRef<string[]>(initialPhotos);
  const sessionVersionRef = useRef(0);
  const chooseFileSupported = useMemo(() => isDocumentPickerAvailable(), []);

  const takeAbortSlot = useCallback((draftId: string): AbortController => {
    abortControllersRef.current.get(draftId)?.abort();
    const ac = new AbortController();
    abortControllersRef.current.set(draftId, ac);
    return ac;
  }, []);

  const releaseAbortSlot = useCallback((draftId: string, ac: AbortController) => {
    if (abortControllersRef.current.get(draftId) === ac) {
      abortControllersRef.current.delete(draftId);
    }
  }, []);

  const abortAllUploads = useCallback(() => {
    abortControllersRef.current.forEach((ac) => ac.abort());
    abortControllersRef.current.clear();
  }, []);

  const resetDraft = useCallback(
    (nextPhotos: string[]) => {
      const keep = new Set(nextPhotos);
      const toMark = collectEphemeralStoragePaths(itemsRef.current, keep);

      sessionVersionRef.current += 1;
      abortAllUploads();

      if (isMountedRef.current) {
        setActiveUploadIds(new Set());
      }

      initialPathsRef.current = nextPhotos;
      setItems(nextPhotos.map(createExistingDraft));

      if (toMark.length > 0) {
        void markPhotoDraftsDeletedOnServer(toMark);
      }
    },
    [abortAllUploads],
  );

  useEffect(() => {
    return () => {
      const keep = new Set(initialPathsRef.current);
      const toMark = collectEphemeralStoragePaths(itemsRef.current, keep);
      abortAllUploads();
      if (toMark.length > 0) {
        void markPhotoDraftsDeletedOnServer(toMark);
      }
    };
  }, [abortAllUploads]);

  const readyPaths = useMemo(
    () =>
      items.flatMap((item) => (item.status === 'ready' && item.storagePath ? [item.storagePath] : [])),
    [items],
  );

  const filledCount = items.length;
  const remainingSlots = Math.max(0, maxPhotos - filledCount);
  const isUploading = activeUploadIds.size > 0;
  const hasFailures = items.some((item) => item.status === 'failed');
  const isExitUnsafe = isUploading || hasFailures;
  const hasChanges = useMemo(() => {
    const initial = initialPathsRef.current;
    if (items.length !== initial.length) return true;
    return items.some((item, index) => item.status !== 'ready' || item.storagePath !== initial[index]);
  }, [items]);

  const startUpload = useCallback(
    async (draftId: string, asset: PhotoUploadAsset, expectedVersion: number) => {
      const ac = takeAbortSlot(draftId);
      try {
        const result = await uploadProfilePhoto(asset, context, { signal: ac.signal });
        if (ac.signal.aborted) return;
        if (!isMountedRef.current || expectedVersion !== sessionVersionRef.current) {
          void markPhotoDraftsDeletedOnServer([result.path]);
          return;
        }
        setItems((prev) => {
          const index = prev.findIndex((item) => item.id === draftId);
          if (index === -1) {
            void markPhotoDraftsDeletedOnServer([result.path]);
            return prev;
          }
          const current = prev[index];
          const next = [...prev];
          next[index] = {
            ...current,
            storagePath: result.path,
            sessionId: result.sessionId,
            status: 'ready',
            error: null,
            replaceOldPath: null,
            sourceAsset: null,
          };
          return next;
        });
      } catch (error) {
        if (isAbortError(error)) return;
        if (!isMountedRef.current || expectedVersion !== sessionVersionRef.current) return;
        const message = error instanceof Error ? error.message : 'Upload failed';
        setItems((prev) => {
          const index = prev.findIndex((item) => item.id === draftId);
          if (index === -1) return prev;
          const current = prev[index];
          const next = [...prev];
          next[index] = {
            ...current,
            status: 'failed',
            error: message,
          };
          return next;
        });
      } finally {
        releaseAbortSlot(draftId, ac);
        if (isMountedRef.current && expectedVersion === sessionVersionRef.current) {
          setActiveUploadIds((prev) => {
            if (!prev.has(draftId)) return prev;
            const next = new Set(prev);
            next.delete(draftId);
            return next;
          });
        }
      }
    },
    [context, releaseAbortSlot, takeAbortSlot],
  );

  const trimAssetsToRemaining = useCallback(
    (assets: PhotoUploadAsset[], sourceLabel: 'library' | 'document' | 'camera') => {
      if (remainingSlots <= 0) {
        showOkDialog(
          show,
          'Gallery full',
          `You can have up to ${maxPhotos} photos. Remove one to add another.`,
        );
        return [] as PhotoUploadAsset[];
      }
      if (assets.length <= remainingSlots) return assets;

      console.warn(
        `[photoBatchController] Trimmed ${assets.length - remainingSlots} ${sourceLabel} selection(s) to ${remainingSlots} remaining slot(s).`,
      );
      showOkDialog(
        show,
        'Only some photos were added',
        `You only have ${remainingSlots} slot${remainingSlots === 1 ? '' : 's'} left, so the extra selection${assets.length - remainingSlots === 1 ? '' : 's'} were skipped.`,
      );
      return assets.slice(0, remainingSlots);
    },
    [maxPhotos, remainingSlots, show],
  );

  const stageNewAssets = useCallback(
    (incomingAssets: PhotoUploadAsset[], origin: 'library' | 'document' | 'camera') => {
      const assets = trimAssetsToRemaining(incomingAssets, origin);
      if (assets.length === 0) return;

      const stagedItems = assets.map((asset) => createPendingDraft(asset, origin));
      const expectedVersion = sessionVersionRef.current;
      setActiveUploadIds((prev) => {
        const next = new Set(prev);
        stagedItems.forEach((item) => next.add(item.id));
        return next;
      });
      setItems((prev) => [...prev, ...stagedItems]);
      stagedItems.forEach((item, index) => {
        void startUpload(item.id, assets[index], expectedVersion);
      });
    },
    [startUpload, trimAssetsToRemaining],
  );

  const replaceAtIndex = useCallback(
    (index: number, asset: PhotoUploadAsset, origin: 'library' | 'document' | 'camera') => {
      const target = itemsRef.current[index];
      if (!target) return;
      const expectedVersion = sessionVersionRef.current;
      setActiveUploadIds((prev) => {
        const next = new Set(prev);
        next.add(target.id);
        return next;
      });
      setItems((prev) => {
        if (!prev[index]) return prev;
        const next = [...prev];
        next[index] = {
          ...prev[index],
          previewUri: asset.uri,
          status: 'uploading',
          error: null,
          sessionId: null,
          replaceOldPath: prev[index].storagePath,
          sourceAsset: asset,
          origin,
        };
        return next;
      });
      void startUpload(target.id, asset, expectedVersion);
    },
    [startUpload],
  );

  const addManyFromLibrary = useCallback(async () => {
    if (remainingSlots <= 0) {
      showOkDialog(
        show,
        'Gallery full',
        `You can have up to ${maxPhotos} photos. Remove one to add another.`,
      );
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      showOkDialog(show, 'Photos need access', 'Allow access to your photos to add profile pictures.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      allowsMultipleSelection: remainingSlots > 1,
      selectionLimit: remainingSlots,
      quality: 0.9,
      ...iosLibraryPreferredCompat,
    });
    if (result.canceled || !result.assets?.length) return;

    const assets = result.assets
      .map((asset) => normalizePickerAssetForUpload(asset))
      .filter((asset): asset is NonNullable<typeof asset> => asset !== null);
    stageNewAssets(assets, 'library');
  }, [maxPhotos, remainingSlots, show, stageNewAssets]);

  const addManyFromDocument = useCallback(async () => {
    if (remainingSlots <= 0) {
      showOkDialog(
        show,
        'Gallery full',
        `You can have up to ${maxPhotos} photos. Remove one to add another.`,
      );
      return;
    }

    const result = await getDocumentAsyncSafe({
      type: ['image/jpeg', 'image/png', 'image/webp'],
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result === null) {
      showOkDialog(
        show,
        'Choose File unavailable',
        'Rebuild the dev client after adding document picker, or use Photo Library or Take Photo.',
      );
      return;
    }
    if (result.canceled || !result.assets?.length) return;

    const assets = result.assets
      .map((asset) => normalizeDocumentAssetForUpload(asset))
      .filter((asset): asset is NonNullable<typeof asset> => asset !== null);

    if (assets.length === 0) {
      showOkDialog(show, 'Not an image', 'Please choose a JPEG, PNG, or WebP file.', 'warning');
      return;
    }

    stageNewAssets(assets, 'document');
  }, [maxPhotos, remainingSlots, show, stageNewAssets]);

  const replaceOneFromLibrary = useCallback(
    async (index: number) => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        showOkDialog(show, 'Photos need access', 'Allow access to your photos to replace this shot.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
        ...iosLibraryPreferredCompat,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = normalizePickerAssetForUpload(result.assets[0]);
      if (!asset) return;
      replaceAtIndex(index, asset, 'library');
    },
    [replaceAtIndex, show],
  );

  const replaceOneFromDocument = useCallback(
    async (index: number) => {
      const result = await getDocumentAsyncSafe({
        type: ['image/jpeg', 'image/png', 'image/webp'],
        copyToCacheDirectory: true,
      });
      if (result === null) {
        showOkDialog(
          show,
          'Choose File unavailable',
          'Rebuild the dev client after adding document picker, or use Photo Library or Take Photo.',
        );
        return;
      }
      if (result.canceled || !result.assets?.[0]) return;

      const asset = normalizeDocumentAssetForUpload(result.assets[0]);
      if (!asset) {
        showOkDialog(show, 'Not an image', 'Please choose a JPEG, PNG, or WebP file.', 'warning');
        return;
      }

      replaceAtIndex(index, asset, 'document');
    },
    [replaceAtIndex, show],
  );

  const takeOnePhoto = useCallback(
    async (replaceIndex?: number) => {
      if (replaceIndex === undefined && remainingSlots <= 0) {
        showOkDialog(
          show,
          'Gallery full',
          `You can have up to ${maxPhotos} photos. Remove one to add another.`,
        );
        return;
      }

      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission.status !== 'granted') {
        showOkDialog(show, 'Camera access', 'Allow camera access to take a new photo.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = normalizePickerAssetForUpload(result.assets[0]);
      if (!asset) return;

      if (replaceIndex === undefined) {
        stageNewAssets([asset], 'camera');
        return;
      }

      replaceAtIndex(replaceIndex, asset, 'camera');
    },
    [maxPhotos, remainingSlots, replaceAtIndex, show, stageNewAssets],
  );

  const moveItem = useCallback((from: number, to: number) => {
    setItems((prev) => arrayMove(prev, from, to));
  }, []);

  const makeMain = useCallback((index: number) => {
    setItems((prev) => arrayMove(prev, index, 0));
  }, []);

  const reconcileRemoveItem = useCallback((item: PhotoDraftItem | undefined) => {
    if (!item) return;
    abortControllersRef.current.get(item.id)?.abort();
    abortControllersRef.current.delete(item.id);
    if (
      item.status === 'ready' &&
      item.storagePath &&
      !initialPathsRef.current.includes(item.storagePath)
    ) {
      void markPhotoDraftsDeletedOnServer([item.storagePath]);
    }
  }, []);

  const removeAtIndex = useCallback(
    (index: number) => {
      const target = itemsRef.current[index];
      reconcileRemoveItem(target);
      setActiveUploadIds((prev) => {
        if (!target || !prev.has(target.id)) return prev;
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
      setItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    },
    [reconcileRemoveItem],
  );

  const removeById = useCallback(
    (id: string) => {
      const target = itemsRef.current.find((item) => item.id === id);
      reconcileRemoveItem(target);
      setActiveUploadIds((prev) => {
        if (!target || !prev.has(target.id)) return prev;
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
      setItems((prev) => prev.filter((item) => item.id !== id));
    },
    [reconcileRemoveItem],
  );

  const retryItem = useCallback(
    async (draftId: string) => {
      const current = itemsRef.current.find((item) => item.id === draftId);
      if (!current || current.status !== 'failed' || !current.sourceAsset) return;
      const expectedVersion = sessionVersionRef.current;
      setActiveUploadIds((prev) => {
        const next = new Set(prev);
        next.add(draftId);
        return next;
      });
      setItems((prev) =>
        prev.map((item) =>
          item.id === draftId
            ? {
                ...item,
                status: 'uploading',
                error: null,
                sessionId: null,
              }
            : item,
        ),
      );
      void startUpload(draftId, current.sourceAsset, expectedVersion);
    },
    [startUpload],
  );

  const dismissFailedItem = useCallback((draftId: string) => {
    setItems((prev) => {
      const index = prev.findIndex((item) => item.id === draftId);
      if (index === -1) return prev;
      const item = prev[index];
      if (item.status !== 'failed') return prev;

      if (item.replaceOldPath) {
        const next = [...prev];
        next[index] = {
          ...item,
          previewUri: null,
          status: 'ready',
          error: null,
          replaceOldPath: null,
          sourceAsset: null,
          sessionId: null,
          origin: 'existing',
        };
        return next;
      }

      return prev.filter((candidate) => candidate.id !== draftId);
    });
  }, []);

  return {
    items,
    readyPaths,
    filledCount,
    remainingSlots,
    chooseFileSupported,
    isUploading,
    hasFailures,
    isExitUnsafe,
    hasChanges,
    canAdd: remainingSlots > 0,
    canSave: !isUploading && !hasFailures,
    resetDraft,
    addManyFromLibrary,
    addManyFromDocument,
    replaceOneFromLibrary,
    replaceOneFromDocument,
    takeOnePhoto,
    moveItem,
    makeMain,
    removeAtIndex,
    removeById,
    retryItem,
    dismissFailedItem,
  };
}

export function photoReadyPathsEqual(a: readonly string[], b: readonly string[]): boolean {
  return arraysEqual(a, b);
}
