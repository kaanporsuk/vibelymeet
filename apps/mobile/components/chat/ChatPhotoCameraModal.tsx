import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, type CameraType } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSendPhoto: (uri: string, mimeType?: string | null) => Promise<boolean>;
  disabled?: boolean;
};

const CAPTURE_MIME_TYPE = 'image/jpeg';

export function ChatPhotoCameraModal({ visible, onClose, onSendPhoto, disabled }: Props) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView | null>(null);
  const cameraSessionIdRef = useRef(0);
  const activeCameraKeyRef = useRef('back:0');
  const facingRef = useRef<CameraType>('back');
  const [facing, setFacing] = useState<CameraType>('back');
  const [cameraSessionId, setCameraSessionId] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canUseCamera = visible && !capturedUri;
  const canPress = !disabled && !isCapturing && !isSubmitting;
  const cameraViewKey = `${facing}:${cameraSessionId}`;

  const prepareCameraForFacing = useCallback((nextFacing: CameraType) => {
    const nextSessionId = cameraSessionIdRef.current + 1;
    const nextCameraKey = `${nextFacing}:${nextSessionId}`;
    cameraSessionIdRef.current = nextSessionId;
    activeCameraKeyRef.current = nextCameraKey;
    facingRef.current = nextFacing;
    cameraRef.current = null;
    setCameraReady(false);
    setFacing(nextFacing);
    setCameraSessionId(nextSessionId);
  }, []);

  useEffect(() => {
    if (visible) {
      prepareCameraForFacing('back');
      setCapturedUri(null);
      setErrorMessage(null);
      setIsCapturing(false);
      setIsSubmitting(false);
    }
  }, [prepareCameraForFacing, visible]);

  const handleCameraReady = useCallback((readyCameraKey: string) => {
    if (activeCameraKeyRef.current !== readyCameraKey) return;
    setCameraReady(true);
    setErrorMessage(null);
  }, []);

  const handleCameraMountError = useCallback((failedCameraKey: string) => {
    if (activeCameraKeyRef.current !== failedCameraKey) return;
    setCameraReady(false);
    setErrorMessage('Could not open the camera. Please try again.');
  }, []);

  const handleClose = useCallback(() => {
    if (isCapturing || isSubmitting) return;
    onClose();
  }, [isCapturing, isSubmitting, onClose]);

  const handleFlipCamera = useCallback(() => {
    if (!canPress || capturedUri) return;
    setErrorMessage(null);
    const nextFacing = facingRef.current === 'front' ? 'back' : 'front';
    prepareCameraForFacing(nextFacing);
  }, [canPress, capturedUri, prepareCameraForFacing]);

  const handleCapture = useCallback(async () => {
    if (!canPress || !cameraReady || !cameraRef.current) {
      setErrorMessage('Camera is still starting. Please wait a moment and try again.');
      return;
    }

    setIsCapturing(true);
    setErrorMessage(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        shutterSound: true,
      });
      if (!photo?.uri) throw new Error('missing_photo_uri');
      setCapturedUri(photo.uri);
      setCameraReady(false);
    } catch {
      setErrorMessage('Could not capture the photo. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  }, [cameraReady, canPress]);

  const handleRetake = useCallback(() => {
    if (isSubmitting) return;
    setCapturedUri(null);
    setErrorMessage(null);
    prepareCameraForFacing(facingRef.current);
  }, [isSubmitting, prepareCameraForFacing]);

  const handleSend = useCallback(async () => {
    if (!capturedUri || !canPress) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const sent = await onSendPhoto(capturedUri, CAPTURE_MIME_TYPE);
      if (sent) {
        onClose();
        return;
      }
      setErrorMessage('Could not send the photo. Please try again.');
    } catch {
      setErrorMessage('Could not send the photo. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [capturedUri, canPress, onClose, onSendPhoto]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {capturedUri ? (
          <Image source={{ uri: capturedUri }} style={styles.previewImage} resizeMode="cover" />
        ) : (
          <CameraView
            key={cameraViewKey}
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            mode="picture"
            facing={facing}
            mirror={facing === 'front'}
            active={canUseCamera}
            onCameraReady={() => handleCameraReady(cameraViewKey)}
            onMountError={() => handleCameraMountError(cameraViewKey)}
          />
        )}

        <View style={styles.vignette} pointerEvents="none" />

        <View style={[styles.topBar, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
          <Pressable
            onPress={handleClose}
            disabled={isCapturing || isSubmitting}
            style={({ pressed }) => [styles.iconCircle, { opacity: pressed ? 0.82 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Close camera"
          >
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>

          <View style={styles.titlePill}>
            <Ionicons name="camera-outline" size={14} color="#fff" />
            <Text style={styles.titlePillText}>Take Photo</Text>
          </View>

          {!capturedUri ? (
            <Pressable
              onPress={handleFlipCamera}
              disabled={!canPress}
              style={({ pressed }) => [styles.iconCircle, { opacity: !canPress ? 0.45 : pressed ? 0.82 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Switch camera"
            >
              <Ionicons name="camera-reverse-outline" size={24} color="#fff" />
            </Pressable>
          ) : (
            <View style={styles.iconCirclePlaceholder} />
          )}
        </View>

        {errorMessage ? (
          <View style={styles.errorPill} pointerEvents="none">
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 20) + 8 }]}>
          {capturedUri ? (
            <View style={styles.actionRow}>
              <Pressable
                onPress={handleRetake}
                disabled={isSubmitting}
                style={({ pressed }) => [styles.secondaryBtn, { opacity: isSubmitting ? 0.55 : pressed ? 0.86 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Retake photo"
              >
                <Ionicons name="refresh-outline" size={20} color="#fff" />
                <Text style={styles.secondaryLabel}>Retake</Text>
              </Pressable>

              <Pressable
                onPress={() => void handleSend()}
                disabled={!canPress}
                style={({ pressed }) => [styles.primaryTouchable, { opacity: !canPress ? 0.55 : pressed ? 0.92 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Send photo"
              >
                <LinearGradient
                  colors={['#8B5CF6', '#E84393']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.primaryBtn}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="send-outline" size={20} color="#fff" />
                  )}
                  <Text style={styles.primaryLabel}>Send photo</Text>
                </LinearGradient>
              </Pressable>
            </View>
          ) : (
            <View style={styles.captureColumn}>
              <Text style={styles.cameraHint}>
                {cameraReady ? 'Frame your photo' : 'Opening camera...'}
              </Text>
              <Pressable
                onPress={() => void handleCapture()}
                disabled={!canPress || !cameraReady}
                style={({ pressed }) => [
                  styles.captureOuter,
                  { opacity: !canPress || !cameraReady ? 0.55 : pressed ? 0.9 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Capture photo"
              >
                {isCapturing ? (
                  <ActivityIndicator size="large" color="#fff" />
                ) : (
                  <View style={styles.captureInner} />
                )}
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.08)',
    borderColor: 'rgba(0,0,0,0)',
    borderWidth: Platform.OS === 'android' ? 0 : StyleSheet.hairlineWidth,
  },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.52)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  iconCirclePlaceholder: {
    width: 44,
    height: 44,
  },
  titlePill: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.52)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 12,
  },
  titlePillText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  errorPill: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '18%',
    borderRadius: 18,
    backgroundColor: 'rgba(127,29,29,0.8)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(252,165,165,0.35)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: {
    color: '#fee2e2',
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  bottomBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 0,
  },
  captureColumn: {
    alignItems: 'center',
    gap: 14,
  },
  cameraHint: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13,
    fontWeight: '600',
  },
  captureOuter: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  captureInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryBtn: {
    minHeight: 54,
    flex: 1,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  secondaryLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  primaryTouchable: {
    minHeight: 54,
    flex: 1.1,
    borderRadius: 27,
    overflow: 'hidden',
  },
  primaryBtn: {
    minHeight: 54,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  primaryLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
});
