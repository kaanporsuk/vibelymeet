import React, { useMemo, useState } from 'react';
import { FlatList, LayoutChangeEvent, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const CARDS = [
  {
    icon: '🎪',
    pain: 'Tired of swiping into the void?',
    solution: 'Meet through real events, not algorithms.',
    detail: 'Join events. See attendee previews. Match with people who actually show up.',
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
  const [containerWidth, setContainerWidth] = useState(0);
  const { width: screenWidth } = useWindowDimensions();
  const dots = useMemo(() => Array.from({ length: CARDS.length }), []);
  const slideWidth = Math.max(280, containerWidth || screenWidth - 32);
  const valueCardWidth = Math.min(360, slideWidth - 10);
  const textBlockWidth = Math.min(306, valueCardWidth - 30);

  const handleRootLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (!width || Math.abs(width - containerWidth) < 1) return;
    setContainerWidth(width);
  };

  return (
    <View style={styles.root} onLayout={handleRootLayout}>
      <FlatList
        style={styles.carousel}
        data={CARDS}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        disableIntervalMomentum
        bounces={false}
        overScrollMode="never"
        snapToInterval={slideWidth}
        snapToAlignment="start"
        keyExtractor={(item) => item.solution}
        getItemLayout={(_, i) => ({ length: slideWidth, offset: slideWidth * i, index: i })}
        onMomentumScrollEnd={(e) => {
          const x = e.nativeEvent.contentOffset.x;
          setIndex(Math.round(x / Math.max(1, slideWidth)));
        }}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width: slideWidth }]}>
            <View
              style={[
                styles.valueCard,
                {
                  width: valueCardWidth,
                  borderColor: theme.border,
                  backgroundColor: 'rgba(19,20,27,0.72)',
                },
              ]}
            >
              <View style={[styles.iconAnchor, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
                <Text style={styles.icon}>{item.icon}</Text>
              </View>
              <Text style={[styles.pain, { color: theme.textSecondary, maxWidth: textBlockWidth }]}>{item.pain}</Text>
              <Text style={[styles.solution, { color: theme.text, maxWidth: textBlockWidth }]}>{item.solution}</Text>
              <Text style={[styles.detail, { color: theme.textSecondary, maxWidth: textBlockWidth }]}>{item.detail}</Text>
            </View>
          </View>
        )}
      />
      <View style={styles.dots}>
        {dots.map((_, i) => (
          <View key={i} style={[styles.dot, { backgroundColor: i === index ? theme.tint : theme.border }]} />
        ))}
      </View>
      <View style={styles.ctaWrap}>
        <VibelyButton
          label="Let's build your profile"
          onPress={onNext}
          variant="gradient"
          style={styles.ctaButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 18, paddingTop: 2, paddingBottom: 6 },
  carousel: { marginTop: -4 },
  slide: { alignItems: 'center', justifyContent: 'flex-start' },
  valueCard: {
    minHeight: 352,
    borderWidth: 1,
    borderRadius: 24,
    paddingTop: 18,
    paddingBottom: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
    elevation: 12,
  },
  iconAnchor: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  icon: { fontSize: 30, textAlign: 'center' },
  pain: { textAlign: 'center', fontStyle: 'italic', fontSize: 13, lineHeight: 18, marginBottom: 6, flexShrink: 1 },
  solution: { textAlign: 'center', fontSize: 22, fontWeight: '700', lineHeight: 29, marginBottom: 10, flexShrink: 1 },
  detail: { textAlign: 'center', fontSize: 15, lineHeight: 22, flexShrink: 1 },
  dots: { flexDirection: 'row', alignSelf: 'center', gap: 7, marginTop: 2, marginBottom: 14 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ctaWrap: { width: '100%', paddingHorizontal: 12, paddingBottom: 4 },
  ctaButton: { width: '100%', borderRadius: 16 },
});
