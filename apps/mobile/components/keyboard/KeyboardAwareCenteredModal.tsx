/**
 * Centered dialogs with text fields must wrap with keyboard avoidance (iOS).
 * Plain Modal + centered card leaves multiline inputs under the keyboard.
 */
import React from 'react';
import {
  Modal,
  View,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';

export type KeyboardAwareCenteredModalProps = {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
  animationType?: 'none' | 'slide' | 'fade';
  backdropColor?: string;
  keyboardVerticalOffset?: number;
  /** When true, tapping the dimmed area calls onRequestClose. */
  backdropDismissable?: boolean;
};

export function KeyboardAwareCenteredModal({
  visible,
  onRequestClose,
  children,
  animationType = 'fade',
  backdropColor = 'rgba(0,0,0,0.85)',
  keyboardVerticalOffset = 0,
  backdropDismissable = false,
}: KeyboardAwareCenteredModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      onRequestClose={onRequestClose}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <View style={styles.flex}>
          {backdropDismissable ? (
            <Pressable
              style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor }]}
              onPress={onRequestClose}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor }]} />
          )}
          <View style={styles.centerWrap} pointerEvents="box-none">
            <Pressable onPress={(e) => e.stopPropagation()}>{children}</Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centerWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
});

export default KeyboardAwareCenteredModal;
