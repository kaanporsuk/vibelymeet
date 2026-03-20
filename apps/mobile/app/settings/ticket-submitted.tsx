import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { GlassHeaderBar, VibelyButton } from '@/components/ui';
import { spacing, layout, radius } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';
import type { PrimaryType } from '@/lib/supportCategories';

function responseCopy(primaryType: string | undefined): string {
  if (primaryType === 'feedback') {
    return 'We review all feedback. We\'ll reach out if we have questions.';
  }
  if (primaryType === 'safety') {
    return 'Safety reports are reviewed urgently. Usually within a few hours.';
  }
  return 'We typically respond within 24 hours.';
}

export default function TicketSubmittedScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const params = useLocalSearchParams<{
    referenceId?: string;
    ticketId?: string;
    primaryType?: string;
    userEmail?: string;
  }>();

  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 6,
      tension: 80,
      useNativeDriver: true,
    }).start();
  }, [scale]);

  const pt = params.primaryType as PrimaryType | undefined;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassHeaderBar insets={insets}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.replace('/settings/support')} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name="close" size={24} color={theme.text} />
          </Pressable>
        </View>
      </GlassHeaderBar>

      <View style={[styles.body, { paddingHorizontal: layout.containerPadding }]}>
        <Animated.View style={[styles.checkWrap, { transform: [{ scale }] }]}>
          <Ionicons name="checkmark-circle" size={72} color="#A78BFA" />
        </Animated.View>

        <Text style={[styles.title, { color: theme.text }]}>Request sent</Text>

        <View style={[styles.refCard, { backgroundColor: withAlpha(theme.tint, 0.12), borderColor: withAlpha(theme.tint, 0.25) }]}>
          <Text style={[styles.refLabel, { color: theme.mutedForeground }]}>Reference</Text>
          <Text style={[styles.refValue, { color: theme.tint }]}>{params.referenceId ?? '—'}</Text>
        </View>

        <Text style={[styles.blurb, { color: theme.textSecondary }]}>{responseCopy(pt)}</Text>

        {params.userEmail ? (
          <Text style={[styles.emailNote, { color: theme.textSecondary }]}>
            We&apos;ll also send updates to {params.userEmail}
          </Text>
        ) : null}

        <VibelyButton
          label="View request"
          onPress={() => {
            if (params.ticketId) router.replace(`/settings/ticket/${params.ticketId}`);
            else router.replace('/settings/support');
          }}
          variant="primary"
          style={{ marginTop: spacing.xl }}
        />

        <VibelyButton
          label="Done"
          onPress={() => router.replace('/settings/support')}
          variant="secondary"
          style={{ marginTop: spacing.md }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { padding: spacing.xs },
  body: { flex: 1, paddingTop: spacing.xl, alignItems: 'center' },
  checkWrap: { marginBottom: spacing.lg },
  title: { fontSize: 22, fontWeight: '800', marginBottom: spacing.lg },
  refCard: {
    width: '100%',
    maxWidth: 360,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
  },
  refLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  refValue: { fontSize: 20, fontWeight: '800', fontFamily: 'SpaceMono-Regular', marginTop: 4 },
  blurb: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: spacing.lg, maxWidth: 340 },
  emailNote: { fontSize: 13, textAlign: 'center', marginTop: spacing.md },
});
