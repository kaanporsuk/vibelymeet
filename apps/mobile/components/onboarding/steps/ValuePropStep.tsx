import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const CARDS = [
  {
    icon: '🎪',
    pain: 'Tired of swiping into the void?',
    solution: 'Meet through real events, not algorithms.',
    detail: 'Join events. See who\'s going. Match with people who actually show up.',
  },
  {
    icon: '📹',
    pain: 'First dates should not feel like interviews.',
    solution: 'Progressive blur video dates build real chemistry.',
    detail: 'Start blurred. Earn clarity. Know the vibe before you meet IRL.',
  },
  {
    icon: '📅',
    pain: 'Matching is easy. Meeting is hard.',
    solution: 'Vibe Schedule makes plans happen.',
    detail: 'Skip endless loops. Suggest a date and lock it in.',
  },
  {
    icon: '💬',
    pain: 'Conversations dying after hey is the worst.',
    solution: 'Games, voice, and clips break the ice.',
    detail: 'Get to know each other through play, not just text.',
  },
];

export default function ValuePropStep({ onNext }: { onNext: () => void }) {
  const theme = Colors[useColorScheme()];
  const [index, setIndex] = useState(0);
  const dots = useMemo(() => Array.from({ length: CARDS.length }), []);

  return (
    <View style={styles.root}>
      <FlatList
        data={CARDS}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.solution}
        onMomentumScrollEnd={(e) => {
          const w = e.nativeEvent.layoutMeasurement.width;
          const x = e.nativeEvent.contentOffset.x;
          setIndex(Math.round(x / Math.max(1, w)));
        }}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.icon}>{item.icon}</Text>
            <Text style={[styles.pain, { color: theme.textSecondary }]}>{item.pain}</Text>
            <Text style={[styles.solution, { color: theme.text }]}>{item.solution}</Text>
            <Text style={[styles.detail, { color: theme.textSecondary }]}>{item.detail}</Text>
          </View>
        )}
      />
      <View style={styles.dots}>{dots.map((_, i) => <View key={i} style={[styles.dot, { backgroundColor: i === index ? theme.tint : theme.border }]} />)}</View>
      <VibelyButton label="Let's build your profile" onPress={onNext} variant="gradient" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  card: { width: 320, alignSelf: 'center', paddingVertical: 12, gap: 8 },
  icon: { fontSize: 38, textAlign: 'center' },
  pain: { textAlign: 'center', fontStyle: 'italic', fontSize: 14 },
  solution: { textAlign: 'center', fontSize: 22, fontWeight: '700', lineHeight: 28 },
  detail: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
  dots: { flexDirection: 'row', alignSelf: 'center', gap: 6, marginBottom: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
