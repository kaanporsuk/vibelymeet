/**
 * Verification badges: phone, email, photo. Verify CTA opens native flows for phone/email; photo stays web link.
 * Reference: src/components/VerificationBadge.tsx, PhoneVerifiedBadge, PhotoVerifiedMark.
 */
import React from 'react';
import { View, Pressable, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { VibelyText } from '@/components/ui';

const VERIFY_PHOTO_WEB_URL = 'https://vibelymeet.com/profile';

type VerificationBadgesRowProps = {
  phoneVerified?: boolean | null;
  emailVerified?: boolean | null;
  photoVerified?: boolean | null;
  onVerifyPhone?: () => void;
  onVerifyEmail?: () => void;
};

export function VerificationBadgesRow({
  phoneVerified,
  emailVerified,
  photoVerified,
  onVerifyPhone,
  onVerifyEmail,
}: VerificationBadgesRowProps) {
  const theme = Colors[useColorScheme()];
  const verifiedColor = theme.success ?? '#22c55e';

  return (
    <View style={styles.wrap}>
      {phoneVerified ? (
        <View style={[styles.badge, { backgroundColor: `${verifiedColor}20` }]}>
          <Ionicons name="checkmark-circle" size={16} color={verifiedColor} />
          <VibelyText variant="caption" style={[styles.badgeLabel, { color: verifiedColor }]}>Phone</VibelyText>
        </View>
      ) : (
        <Pressable
          onPress={onVerifyPhone}
          style={[styles.badge, styles.badgeUnverified, { borderColor: theme.border }]}
        >
          <Ionicons name="ellipse-outline" size={14} color={theme.textSecondary} />
          <VibelyText variant="caption" style={[styles.badgeLabel, { color: theme.textSecondary }]}>Phone</VibelyText>
          <VibelyText variant="caption" style={{ color: theme.tint, marginLeft: 4 }}>Verify</VibelyText>
        </Pressable>
      )}
      {emailVerified ? (
        <View style={[styles.badge, { backgroundColor: `${verifiedColor}20` }]}>
          <Ionicons name="checkmark-circle" size={16} color={verifiedColor} />
          <VibelyText variant="caption" style={[styles.badgeLabel, { color: verifiedColor }]}>Email</VibelyText>
        </View>
      ) : (
        <Pressable
          onPress={onVerifyEmail}
          style={[styles.badge, styles.badgeUnverified, { borderColor: theme.border }]}
        >
          <Ionicons name="ellipse-outline" size={14} color={theme.textSecondary} />
          <VibelyText variant="caption" style={[styles.badgeLabel, { color: theme.textSecondary }]}>Email</VibelyText>
          <VibelyText variant="caption" style={{ color: theme.tint, marginLeft: 4 }}>Verify</VibelyText>
        </Pressable>
      )}
      {photoVerified ? (
        <View style={[styles.badge, { backgroundColor: `${verifiedColor}20` }]}>
          <Ionicons name="checkmark-circle" size={16} color={verifiedColor} />
          <VibelyText variant="caption" style={[styles.badgeLabel, { color: verifiedColor }]}>Photo</VibelyText>
        </View>
      ) : (
        <Pressable
          onPress={() => Linking.openURL(VERIFY_PHOTO_WEB_URL)}
          style={[styles.badge, styles.badgeUnverified, { borderColor: theme.border }]}
        >
          <Ionicons name="ellipse-outline" size={14} color={theme.textSecondary} />
          <VibelyText variant="caption" style={[styles.badgeLabel, { color: theme.textSecondary }]}>Photo</VibelyText>
          <VibelyText variant="caption" style={{ color: theme.tint, marginLeft: 4 }}>Verify</VibelyText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill },
  badgeUnverified: { borderWidth: 1 },
  badgeLabel: { fontWeight: '600' },
});
