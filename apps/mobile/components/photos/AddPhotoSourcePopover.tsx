import React, { useMemo } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View as RNView,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';

import { fonts } from '@/constants/theme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export type AddPhotoAnchor = { x: number; y: number; width: number; height: number };

export const ADD_POPOVER_GAP = 6;
/** Three rows + padding + dividers (no title — matches web-style compact menu) */
export const ADD_POPOVER_EST_HEIGHT = 176;
/** Photo Library + Take Photo only (no Choose File row) */
export const ADD_POPOVER_EST_HEIGHT_TWO_ACTIONS = 122;
export const ADD_POPOVER_MAX_W = 244;
const ADD_POPOVER_BOTTOM_BREATH = 92;

type Insets = { top: number; bottom: number; left: number; right: number };

/**
 * Place popover near trigger: prefer below, flip above if needed; clamp to safe area.
 */
export function layoutAddPhotoPopover(
  anchor: AddPhotoAnchor,
  popoverW: number,
  popoverH: number,
  insets: Insets,
): { left: number; top: number; width: number } {
  const margin = 8;
  const w = Math.min(popoverW, SCREEN_W - 2 * margin);

  // Center to trigger tile so the menu feels visually attached.
  let left = anchor.x + (anchor.width - w) / 2;
  if (left + w > SCREEN_W - margin) left = SCREEN_W - margin - w;
  left = Math.max(margin, left);

  let top = anchor.y + anchor.height + ADD_POPOVER_GAP;
  const bottomLimit = SCREEN_H - insets.bottom - margin - ADD_POPOVER_BOTTOM_BREATH;
  const spaceBelow = bottomLimit - top;
  const spaceAbove = anchor.y - insets.top - margin;

  if (spaceBelow < popoverH && spaceAbove > spaceBelow) {
    top = anchor.y - popoverH - ADD_POPOVER_GAP;
  }

  top = Math.max(insets.top + margin, top);
  if (top + popoverH > bottomLimit) {
    top = Math.max(insets.top + margin, bottomLimit - popoverH);
  }

  return { left, top, width: w };
}

/** When measure fails: tuck a compact menu above bottom safe inset (not screen-centered). */
export function layoutAddPhotoPopoverFallback(
  insets: Insets,
  popoverW: number,
  popoverH: number,
): { left: number; top: number; width: number } {
  const margin = 12;
  const w = Math.min(popoverW, SCREEN_W - 2 * margin);
  const left = Math.max(margin, SCREEN_W / 2 - w / 2);
  const tabBarReserve = 72;
  const top = Math.max(
    insets.top + margin,
    SCREEN_H - insets.bottom - tabBarReserve - popoverH - margin,
  );
  return { left, top, width: w };
}

export type AddPhotoSourcePopoverProps = {
  visible: boolean;
  anchor: AddPhotoAnchor | null;
  safeInsets: Insets;
  onDismiss: () => void;
  onPhotoLibrary: () => void;
  onTakePhoto: () => void;
  onChooseFile: () => void;
  /** When false, hides Choose File (e.g. native module not in dev client). */
  chooseFileSupported?: boolean;
  /**
   * `true`: full-screen Modal (Profile / scroll parents).
   * `false`: absolute overlay — parent must fill the window (e.g. photo manage Modal).
   */
  useRootModal: boolean;
};

export function AddPhotoSourcePopover({
  visible,
  anchor,
  safeInsets,
  onDismiss,
  onPhotoLibrary,
  onTakePhoto,
  onChooseFile,
  chooseFileSupported = true,
  useRootModal,
}: AddPhotoSourcePopoverProps) {
  const placement = useMemo(() => {
    if (!visible) return null;
    const w = Math.min(ADD_POPOVER_MAX_W, SCREEN_W - 16);
    const h = chooseFileSupported ? ADD_POPOVER_EST_HEIGHT : ADD_POPOVER_EST_HEIGHT_TWO_ACTIONS;
    if (!anchor) return layoutAddPhotoPopoverFallback(safeInsets, w, h);
    return layoutAddPhotoPopover(anchor, w, h, safeInsets);
  }, [visible, anchor, safeInsets, chooseFileSupported]);

  const body = !visible || !placement ? null : (
    <RNView style={st.root} pointerEvents="box-none">
      <Pressable
        style={st.backdrop}
        onPress={onDismiss}
        accessibilityLabel="Dismiss add photo options"
      />
      <RNView
        style={[st.anchorWrap, { left: placement.left, top: placement.top, width: placement.width }]}
        pointerEvents="box-none"
      >
        <RNView style={st.cardOuter}>
          {Platform.OS === 'ios' ? (
            <BlurView intensity={55} tint="light" style={StyleSheet.absoluteFill} />
          ) : null}
          <RNView style={[st.cardInner, Platform.OS === 'ios' && st.cardInnerIos]}>
            <MenuRow
              icon="images-outline"
              label="Photo Library"
              onPress={() => {
                onDismiss();
                onPhotoLibrary();
              }}
            />
            <RNView style={st.divider} />
            <MenuRow
              icon="camera-outline"
              label="Take Photo"
              onPress={() => {
                onDismiss();
                onTakePhoto();
              }}
            />
            {chooseFileSupported ? (
              <>
                <RNView style={st.divider} />
                <MenuRow
                  icon="document-text-outline"
                  label="Choose File"
                  onPress={() => {
                    onDismiss();
                    onChooseFile();
                  }}
                />
              </>
            ) : null}
          </RNView>
        </RNView>
      </RNView>
    </RNView>
  );

  if (!visible) return null;

  if (useRootModal) {
    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={onDismiss}
        statusBarTranslucent
      >
        <RNView style={st.modalShell}>{body}</RNView>
      </Modal>
    );
  }

  return body;
}

function MenuRow({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [st.row, pressed && st.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color="rgba(196,181,253,0.98)" style={st.rowIcon} />
      <Text style={st.rowLabel}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  modalShell: {
    flex: 1,
  },
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4, 6, 16, 0.38)',
  },
  anchorWrap: {
    position: 'absolute',
    zIndex: 2,
  },
  cardOuter: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#05030f',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.44,
    shadowRadius: 26,
    elevation: 16,
  },
  cardInner: {
    backgroundColor: 'rgba(12, 12, 22, 0.96)',
    paddingVertical: 5,
    paddingHorizontal: 5,
  },
  cardInnerIos: {
    backgroundColor: 'rgba(14, 14, 28, 0.78)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    paddingHorizontal: 11,
    borderRadius: 11,
    minHeight: 44,
  },
  rowPressed: {
    backgroundColor: 'rgba(139, 92, 246, 0.18)',
  },
  rowIcon: {
    width: 24,
    textAlign: 'center',
  },
  rowLabel: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: 'rgba(255,255,255,0.92)',
    letterSpacing: -0.2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.13)',
    marginHorizontal: 8,
  },
});
