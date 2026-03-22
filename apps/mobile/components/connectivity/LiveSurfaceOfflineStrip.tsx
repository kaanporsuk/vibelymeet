import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { withAlpha } from '@/lib/colorUtils';
import { useConnectivity } from '@/lib/useConnectivity';

export function LiveSurfaceOfflineStrip() {
  const state = useConnectivity();
  if (state !== 'offline') return null;

  const AMBER = '#F59E0B';
  return (
    <View
      style={[
        styles.strip,
        {
          backgroundColor: withAlpha('#1C1A2E', 0.95),
          borderColor: withAlpha(AMBER, 0.5),
        },
      ]}
    >
      <Ionicons name="cloud-offline-outline" size={14} color={AMBER} />
      <Text style={[styles.text, { color: AMBER }]}>Connection lost · Live updates paused</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  text: { fontSize: 12, fontWeight: '600' },
});
