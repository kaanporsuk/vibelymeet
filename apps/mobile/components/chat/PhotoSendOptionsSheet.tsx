import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { KeyboardAwareBottomSheetModal } from '@/components/keyboard/KeyboardAwareBottomSheetModal';
import Colors from '@/constants/Colors';
import { radius, spacing } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onTakePhoto: () => void;
  onChooseLibrary: () => void;
  disabled?: boolean;
};

export function PhotoSendOptionsSheet({
  visible,
  onClose,
  onTakePhoto,
  onChooseLibrary,
  disabled,
}: Props) {
  const theme = Colors[useColorScheme()];

  return (
    <KeyboardAwareBottomSheetModal
      visible={visible}
      onRequestClose={onClose}
      backdropColor="rgba(0,0,0,0.85)"
      showHandle
      handleStyle={{ width: 100, height: 8, borderRadius: 999, marginTop: 16, marginBottom: 12 }}
      scrollable={false}
    >
      <View style={styles.inner}>
        <View style={[styles.brandPill, { borderColor: 'rgba(232,67,147,0.35)', backgroundColor: 'rgba(232,67,147,0.14)' }]}>
          <Ionicons name="camera-outline" size={14} color={theme.neonPink} />
          <Text style={[styles.brandPillText, { color: theme.neonPink }]}>Photo</Text>
        </View>

        <Text style={[styles.title, { color: theme.text }]}>Send a photo</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Choose how you'd like to add your picture.
        </Text>

        <Pressable
          disabled={disabled}
          onPress={() => {
            if (!disabled) onTakePhoto();
          }}
          style={({ pressed }) => [
            styles.primaryTouchable,
            { opacity: disabled ? 0.55 : pressed ? 0.92 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Take Photo"
        >
          <LinearGradient
            colors={['#8B5CF6', '#E84393']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.primaryBtn}
          >
            <Ionicons name="camera-outline" size={22} color="#fff" />
            <View style={styles.primaryTextCol}>
              <Text style={styles.primaryLabel}>Take Photo</Text>
              <Text style={styles.primaryHint}>Use your camera</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.85)" />
          </LinearGradient>
        </Pressable>

        <Pressable
          disabled={disabled}
          onPress={() => {
            if (!disabled) onChooseLibrary();
          }}
          style={({ pressed }) => [
            styles.secondaryBtn,
            {
              borderColor: theme.border,
              backgroundColor: theme.surface,
              opacity: disabled ? 0.55 : pressed ? 0.9 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Choose from library"
        >
          <Ionicons name="images-outline" size={20} color={theme.textSecondary} />
          <View style={styles.secondaryTextCol}>
            <Text style={[styles.secondaryLabel, { color: theme.text }]}>Choose from library</Text>
            <Text style={[styles.secondaryHint, { color: theme.textSecondary }]}>Select an existing photo</Text>
          </View>
        </Pressable>

        <Pressable onPress={onClose} style={styles.cancelBtn} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text style={[styles.cancelText, { color: theme.textSecondary }]}>Cancel</Text>
        </Pressable>
      </View>
    </KeyboardAwareBottomSheetModal>
  );
}

const styles = StyleSheet.create({
  inner: {
    paddingBottom: spacing.xl,
  },
  brandPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.md,
  },
  brandPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  primaryTouchable: {
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 16,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
  },
  primaryTextCol: {
    flex: 1,
    gap: 2,
  },
  primaryLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  primaryHint: {
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.88)',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryTextCol: {
    flex: 1,
    gap: 2,
  },
  secondaryLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  cancelBtn: {
    alignSelf: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
