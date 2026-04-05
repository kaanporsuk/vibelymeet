/**
 * Text-entry bottom sheets must use this wrapper (or an equivalent that adds KeyboardAvoidingView
 * inside the Modal). Plain Modal + bottom-aligned `Pressable` content does not lift with the
 * keyboard on iOS — focused inputs end up hidden.
 *
 * Do not add new modal text-entry flows without keyboard-aware containment.
 * Centered dialogs (alerts-with-inputs) should use `KeyboardAwareCenteredModal`.
 */
import React from 'react';
import {
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  StyleProp,
  ViewStyle,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';

export type KeyboardAwareBottomSheetModalProps = {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
  /** Pinned below the scroll area (primary actions). */
  footer?: React.ReactNode;
  /**
   * When true (default), `children` are wrapped in a vertical ScrollView with
   * `keyboardShouldPersistTaps="handled"`. Set false when `children` already include their own
   * ScrollView or the sheet is very short.
   */
  scrollable?: boolean;
  animationType?: 'none' | 'slide' | 'fade';
  onShow?: () => void;
  sheetStyle?: StyleProp<ViewStyle>;
  backdropColor?: string;
  /** Cap sheet height as a fraction of window height (default 0.88). */
  maxHeightRatio?: number;
  showHandle?: boolean;
  handleStyle?: StyleProp<ViewStyle>;
  /** iOS only — offset when a header overlaps the keyboard avoidance region. */
  keyboardVerticalOffset?: number;
};

const DEFAULT_BACKDROP = 'rgba(0,0,0,0.55)';
const DEFAULT_MAX_RATIO = 0.88;

export function KeyboardAwareBottomSheetModal({
  visible,
  onRequestClose,
  children,
  footer,
  scrollable = true,
  animationType = 'slide',
  onShow,
  sheetStyle,
  backdropColor = DEFAULT_BACKDROP,
  maxHeightRatio = DEFAULT_MAX_RATIO,
  showHandle = false,
  handleStyle,
  keyboardVerticalOffset = 0,
}: KeyboardAwareBottomSheetModalProps) {
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme()];
  const maxH = Dimensions.get('window').height * maxHeightRatio;

  return (
    <Modal
      transparent
      visible={visible}
      animationType={animationType}
      onRequestClose={onRequestClose}
      onShow={onShow}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss sheet"
          style={[styles.backdrop, { backgroundColor: backdropColor }]}
          onPress={onRequestClose}
        >
          <Pressable
            style={[
              styles.sheet,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
                maxHeight: maxH,
                paddingBottom: Math.max(insets.bottom, spacing.lg),
              },
              sheetStyle,
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            {showHandle ? (
              <View style={[styles.handle, { backgroundColor: theme.muted }, handleStyle]} />
            ) : null}
            {scrollable ? (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                contentContainerStyle={styles.scrollContent}
              >
                {children}
              </ScrollView>
            ) : (
              children
            )}
            {footer}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 12,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.sm,
  },
});

export default KeyboardAwareBottomSheetModal;
