import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';

import { fonts } from '@/constants/theme';

const SIZE = 48;
const R = 21;
const CX = 24;
const CY = 24;
const CIRCUMFERENCE = 2 * Math.PI * R;

type Props = {
  score: number;
};

export default function VibeScoreCircle({ score }: Props) {
  const clamped = Math.min(100, Math.max(0, score));
  const strokeDashoffset = CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <View style={s.wrap} pointerEvents="none">
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Defs>
          <SvgLinearGradient id="scoreGradCircle" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#8B5CF6" />
            <Stop offset="1" stopColor="#E84393" />
          </SvgLinearGradient>
        </Defs>
        <Circle
          cx={CX}
          cy={CY}
          r={R}
          fill="#1a1a2e"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={3}
        />
        <Circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke="url(#scoreGradCircle)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          strokeDashoffset={strokeDashoffset}
          transform={`rotate(-90 ${CX} ${CY})`}
        />
      </Svg>
      <View style={s.scoreNumWrap}>
        <Text style={s.scoreNum}>{Math.round(clamped)}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreNumWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreNum: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: fonts.displayBold,
    color: '#fff',
  },
});
