/**
 * Delivery/read status for sent messages: sending (spinner), sent (single check), delivered/read (double check).
 * Reference: src/components/chat/MessageStatus.tsx
 */
import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { MessageStatusType } from '@/lib/chatApi';

type MessageStatusProps = {
  status: MessageStatusType;
  time: string;
  isMyMessage?: boolean;
  suppressSendingIndicator?: boolean;
  showSendingSpinner?: boolean;
  assistiveLabel?: string;
};

export function MessageStatus({
  status,
  time,
  isMyMessage = true,
  suppressSendingIndicator = false,
  showSendingSpinner = true,
  assistiveLabel,
}: MessageStatusProps) {
  const theme = Colors[useColorScheme()];
  const color = isMyMessage ? 'rgba(255,255,255,0.85)' : theme.textSecondary;

  if (!isMyMessage) {
    return <Text style={[styles.time, { color }]}>{time}</Text>;
  }

  return (
    <View
      style={styles.wrap}
      accessibilityRole={status === 'sending' ? 'text' : undefined}
      accessibilityLabel={status === 'sending' ? assistiveLabel ?? 'Sending message' : undefined}
    >
      <Text style={[styles.time, { color }]}>{time}</Text>
      {status === 'sending' && !suppressSendingIndicator ? (
        <>
          {showSendingSpinner ? <ActivityIndicator size="small" color={color} style={styles.spinner} /> : null}
        </>
      ) : null}
      {status === 'sent' && <Ionicons name="checkmark" size={12} color={color} />}
      {(status === 'delivered' || status === 'read') && (
        <View style={styles.doubleCheck}>
          <Ionicons name="checkmark-done" size={14} color={status === 'read' ? theme.tint : color} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  time: { fontSize: 10 },
  sendingLabel: { fontSize: 10, opacity: 0.88 },
  spinner: { marginLeft: 0 },
  doubleCheck: {},
});
