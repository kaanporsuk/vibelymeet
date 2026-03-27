import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { radius, spacing } from '@/constants/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function ActiveDateSuggestionWarningModal({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme()];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingTop: Math.max(insets.top, spacing.lg), paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss warning" />
        <View style={[styles.card, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
          <View style={[styles.iconWrap, { backgroundColor: 'rgba(139,92,246,0.18)', borderColor: 'rgba(139,92,246,0.45)' }]}>
            <Ionicons name="calendar-outline" size={18} color={theme.neonViolet} />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>Date suggestion already active</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            You already have a live date suggestion in this chat. Use the card in the conversation to continue, respond, or cancel it before starting a new one.
          </Text>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.primaryBtn, { backgroundColor: theme.tint, opacity: pressed ? 0.9 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Got it"
          >
            <Text style={[styles.primaryBtnText, { color: theme.primaryForeground }]}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4,6,12,0.74)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  primaryBtn: {
    minHeight: 44,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
