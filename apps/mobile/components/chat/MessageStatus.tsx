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
};

export function MessageStatus({ status, time, isMyMessage = true }: MessageStatusProps) {
  const theme = Colors[useColorScheme()];
  const color = isMyMessage ? 'rgba(255,255,255,0.85)' : theme.textSecondary;

  if (!isMyMessage) {
    return <Text style={[styles.time, { color }]}>{time}</Text>;
  }

  return (
    <View style={styles.wrap}>
      <Text style={[styles.time, { color }]}>{time}</Text>
      {status === 'sending' && <ActivityIndicator size="small" color={color} style={styles.spinner} />}
      {status === 'sent' && <Ionicons name="checkmark" size={14} color={color} />}
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
  spinner: { marginLeft: 2 },
  doubleCheck: {},
});
