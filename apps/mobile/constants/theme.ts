/** Vibely design tokens — aligned to web (index.css, --radius 1rem, glass-card rounded-2xl) */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
} as const;

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,   // --radius 1rem
  xl: 20,
  '2xl': 24, // glass-card rounded-2xl
  '3xl': 32,
  pill: 999,
} as const;

export const typography = {
  /** Screen titles, large headings */
  titleXL: { fontSize: 28, fontWeight: '700' as const, letterSpacing: 0.3 },
  titleLG: { fontSize: 22, fontWeight: '700' as const, letterSpacing: 0.2 },
  titleMD: { fontSize: 18, fontWeight: '600' as const },
  titleSM: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 14 },
  bodySecondary: { fontSize: 14, opacity: 0.8 },
  caption: { fontSize: 12, opacity: 0.75 },
  overline: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 1, opacity: 0.9 },
} as const;

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 5,
  },
  /** Subtle glow for tab bar / primary surfaces (neon parity) */
  glowViolet: {
    shadowColor: 'hsl(263, 70%, 66%)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
} as const;

export const layout = {
  screenPadding: {
    default: 20,
    compact: 16,
  },
  /** Max content width — web max-w-lg ~ 512px; allow slightly wider on tablet */
  contentWidth: 512,
  /** Input height for parity with web form controls */
  inputHeight: 44,
} as const;

