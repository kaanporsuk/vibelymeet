import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';

import { getDocumentAsyncSafe, isDocumentPickerAvailable } from '@/lib/safeDocumentPicker';
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
    previewUri: asset.uri,
    status: 'uploading',
    error: null,
    replaceOldPath: null,
    sourceAsset: asset,
    origin,
  };
}

function normalizePickerAsset(
  asset: Pick<ImagePicker.ImagePickerAsset, 'uri' | 'mimeType' | 'fileName'>,
): PhotoUploadAsset | null {
  const uri = asset.uri?.trim();
  if (!uri) return null;
  return {
    uri,
    mimeType: asset.mimeType ?? 'image/jpeg',
    fileName: asset.fileName ?? undefined,
  };
}

function normalizeDocumentAsset(
  asset: { uri: string; mimeType?: string | null; name?: string | null },
): PhotoUploadAsset | null {
  const uri = asset.uri?.trim();
  if (!uri) return null;
  const mime = asset.mimeType ?? 'image/jpeg';
  if (!mime.startsWith('image/')) return null;
  return {
    uri,
    mimeType: mime,
    fileName: asset.name ?? undefined,
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
  const [activeUploadCount, setActiveUploadCount] = useState(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const initialPathsRef = useRef<string[]>(initialPhotos);
  const sessionVersionRef = useRef(0);
  const chooseFileSupported = useMemo(() => isDocumentPickerAvailable(), []);

  const resetDraft = useCallback((nextPhotos: string[]) => {
    sessionVersionRef.current += 1;
    initialPathsRef.current = nextPhotos;
    if (isMountedRef.current) {
      setActiveUploadCount(0);
    }
    setItems(nextPhotos.map(createExistingDraft));
  }, []);

  const readyPaths = useMemo(
    () =>
      items.flatMap((item) => (item.status === 'ready' && item.storagePath ? [item.storagePath] : [])),
    [items],
  );

  const filledCount = items.length;
  const remainingSlots = Math.max(0, maxPhotos - filledCount);
  const isUploading = activeUploadCount > 0;
  const hasFailures = items.some((item) => item.status === 'failed');
  const isExitUnsafe = isUploading || hasFailures;
  const hasChanges = useMemo(() => {
    const initial = initialPathsRef.current;
    if (items.length !== initial.length) return true;
    return items.some((item, index) => item.status !== 'ready' || item.storagePath !== initial[index]);
  }, [items]);

  const startUpload = useCallback(
    async (
      draftId: string,
      asset: PhotoUploadAsset,
      replaceOldPath: string | null,
      expectedVersion: number,
    ) => {
      try {
        const path = await uploadProfilePhoto(asset, replaceOldPath, context);
        if (!isMountedRef.current || expectedVersion !== sessionVersionRef.current) return;
        setItems((prev) => {
          const index = prev.findIndex((item) => item.id === draftId);
          if (index === -1) return prev;
          const current = prev[index];
          const next = [...prev];
          next[index] = {
            ...current,
            storagePath: path,
            status: 'ready',
            error: null,
            replaceOldPath: null,
            sourceAsset: null,
          };
          return next;
        });
      } catch (error) {
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
        if (isMountedRef.current && expectedVersion === sessionVersionRef.current) {
          setActiveUploadCount((prev) => Math.max(0, prev - 1));
        }
      }
    },
    [context],
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
      setActiveUploadCount((prev) => prev + stagedItems.length);
      setItems((prev) => [...prev, ...stagedItems]);
      stagedItems.forEach((item, index) => {
        void startUpload(item.id, assets[index], null, expectedVersion);
      });
    },
    [startUpload, trimAssetsToRemaining],
  );

  const replaceAtIndex = useCallback(
    (index: number, asset: PhotoUploadAsset, origin: 'library' | 'document' | 'camera') => {
      const target = itemsRef.current[index];
      if (!target) return;
      const expectedVersion = sessionVersionRef.current;
      setActiveUploadCount((prev) => prev + 1);
      setItems((prev) => {
        if (!prev[index]) return prev;
        const next = [...prev];
        next[index] = {
          ...prev[index],
          previewUri: asset.uri,
          status: 'uploading',
          error: null,
          replaceOldPath: prev[index].storagePath,
          sourceAsset: asset,
          origin,
        };
        return next;
      });
      void startUpload(target.id, asset, target.storagePath, expectedVersion);
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
    });
    if (result.canceled || !result.assets?.length) return;

    const assets = result.assets
      .map((asset) => normalizePickerAsset(asset))
      .filter((asset): asset is PhotoUploadAsset => asset !== null);
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
      .map((asset) => normalizeDocumentAsset(asset))
      .filter((asset): asset is PhotoUploadAsset => asset !== null);

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
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = normalizePickerAsset(result.assets[0]);
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

      const asset = normalizeDocumentAsset(result.assets[0]);
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

      const asset = normalizePickerAsset(result.assets[0]);
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

  const removeAtIndex = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  const removeById = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const retryItem = useCallback(
    async (draftId: string) => {
      const current = itemsRef.current.find((item) => item.id === draftId);
      if (!current || current.status !== 'failed' || !current.sourceAsset) return;
      const expectedVersion = sessionVersionRef.current;
      setActiveUploadCount((prev) => prev + 1);
      setItems((prev) =>
        prev.map((item) =>
          item.id === draftId
            ? {
                ...item,
                status: 'uploading',
                error: null,
              }
            : item,
        ),
      );
      void startUpload(draftId, current.sourceAsset, current.replaceOldPath, expectedVersion);
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
