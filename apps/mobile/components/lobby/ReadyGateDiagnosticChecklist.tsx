import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { spacing, radius } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import type {
  ReadyGateDiagnosticActionKind,
  ReadyGateDiagnosticCopy,
} from '@clientShared/matching/readyGateDiagnosticCopy';

type ReadyGateDiagnosticChecklistProps = {
  rows: ReadyGateDiagnosticCopy[];
  theme: typeof Colors.light;
  actionDisabled?: boolean;
  onAction?: (row: ReadyGateDiagnosticCopy) => void;
};

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function iconFor(row: ReadyGateDiagnosticCopy): IoniconName {
  if (row.status === 'ok') return 'checkmark-circle';
  if (row.status === 'blocked' || row.status === 'failed') return 'alert-circle';
  if (row.status === 'warning') return 'warning';
  return 'time-outline';
}

function colorFor(row: ReadyGateDiagnosticCopy, theme: typeof Colors.light): string {
  if (row.severity === 'success') return theme.success;
  if (row.severity === 'error') return theme.danger;
  if (row.severity === 'warning') return theme.neonYellow;
  return theme.textSecondary;
}

function canRenderAction(actionKind: ReadyGateDiagnosticActionKind): boolean {
  return actionKind !== 'none' && actionKind !== 'wait';
}

export function ReadyGateDiagnosticChecklist({
  rows,
  theme,
  actionDisabled = false,
  onAction,
}: ReadyGateDiagnosticChecklistProps) {
  return (
    <View
      style={[
        styles.wrap,
        {
          borderColor: theme.glassBorder,
        },
      ]}
      accessibilityRole="summary"
      accessibilityLabel="Ready Gate diagnostics"
    >
      {rows.map((row) => {
        const accent = colorFor(row, theme);
        const showAction = Boolean(row.actionLabel && canRenderAction(row.actionKind) && onAction);
        return (
          <View key={row.key} style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: withAlpha(accent, 0.14) }]}>
              <Ionicons name={iconFor(row)} size={15} color={accent} />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.label, { color: theme.text }]} numberOfLines={1}>
                {row.label}
              </Text>
              {row.status === 'ok' ? null : (
                <Text style={[styles.message, { color: theme.textSecondary }]} numberOfLines={2}>
                  {row.title}
                </Text>
              )}
            </View>
            {showAction ? (
              <Pressable
                onPress={() => onAction?.(row)}
                disabled={actionDisabled}
                accessibilityRole="button"
                accessibilityLabel={row.actionLabel ?? undefined}
                style={({ pressed }) => [
                  styles.action,
                  { borderColor: withAlpha(accent, 0.38) },
                  actionDisabled && { opacity: 0.45 },
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Text style={[styles.actionText, { color: accent }]} numberOfLines={1}>
                  {row.actionLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.xs,
    marginBottom: spacing.lg,
  },
  row: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  iconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
  },
  message: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
  action: {
    maxWidth: 108,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  actionText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
