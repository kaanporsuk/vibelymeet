export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
} as const;

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 24,
  '3xl': 32,
  pill: 999,
} as const;

export const typography = {
  titleXL: { fontSize: 28, fontWeight: '700' as const, letterSpacing: 0.3 },
  titleLG: { fontSize: 22, fontWeight: '700' as const, letterSpacing: 0.2 },
  titleMD: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 14 },
  bodySecondary: { fontSize: 14, opacity: 0.8 },
  caption: { fontSize: 12, opacity: 0.75 },
} as const;

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 5,
  },
} as const;

export const layout = {
  screenPadding: {
    default: 20,
    compact: 16,
  },
  contentWidth: 640,
} as const;

