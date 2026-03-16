/**
 * Gradient surface — API-ready placeholder for Phase 1.
 *
 * Uses Stage 2 gradient tokens (theme.gradient.primary / gradient.accent).
 * No gradient-capable dependency is present in the repo (expo-linear-gradient
 * not installed), so this renders a solid fallback using the first token color.
 *
 * When a gradient dependency is added later:
 * - Replace the inner View with LinearGradient using gradient.primary or gradient.accent.
 * - Keep this component's API (variant, children, style) unchanged.
 *
 * Blocked: runtime gradient requires e.g. expo-linear-gradient; not introduced
 * in Phase 1 to avoid dependency churn.
 */
import React, { ReactNode } from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import { gradient } from '@/constants/theme';

export type GradientVariant = 'primary' | 'accent';

type GradientSurfaceProps = {
  variant?: GradientVariant;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

const gradientColors: Record<GradientVariant, readonly [string, string]> = {
  primary: gradient.primary,
  accent: gradient.accent,
};

export function GradientSurface({ variant = 'primary', children, style }: GradientSurfaceProps) {
  const colors = gradientColors[variant];
  const fallbackColor = colors[0];
  return (
    <View style={[{ backgroundColor: fallbackColor }, style]}>
      {children}
    </View>
  );
}
