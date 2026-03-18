/**
 * Vibely design tokens — aligned to web (src/index.css, tailwind.config.ts).
 * Single source for spacing, radii, typography, shadows, layout, borders.
 */

// ─── Spacing (web: Tailwind 1=4px, 2=8, 3=12, 4=16, 6=24, 8=32)
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
} as const;

// ─── Radii (web: --radius 1rem; tailwind lg=var(--radius), md=-2px, sm=-4px, 2xl=1.5rem, 3xl=2rem)
export const radius = {
  base: 16, // --radius 1rem
  xs: 4,
  sm: 12, // web rounded-sm (--radius - 4px)
  md: 14, // web rounded-md (--radius - 2px)
  lg: 16, // web rounded-lg
  /** Web Tailwind rounded-xl default (0.75rem) */
  xl: 12,
  '2xl': 24, // web rounded-2xl (glass-card, cards)
  '3xl': 32, // web rounded-3xl
  pill: 999,
  /** Button default (web: rounded-2xl) */
  button: 24,
  /** Web shadcn Input: rounded-md = calc(--radius - 2px) = 14 */
  input: 14,
} as const;

// ─── Border (web: border-border, border width 1 / 2)
export const border = {
  width: {
    hairline: 1,
    thin: 1,
    medium: 2,
  },
} as const;

/**
 * Font family tokens (web: Inter = body, Space Grotesk = display).
 * Loaded in app/_layout.tsx via @expo-google-fonts/inter and @expo-google-fonts/space-grotesk.
 */
export const fonts = {
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
  display: 'SpaceGrotesk_600SemiBold',
  displayBold: 'SpaceGrotesk_700Bold',
} as const;

// ─── Typography scale (web: font-sans Inter, font-display Space Grotesk)
// Each style uses a specific font file so weight is baked in; no fontWeight needed.
export const typography = {
  /** Web text-2xl */
  titleXL: { fontSize: 24, letterSpacing: 0.3, fontFamily: fonts.displayBold },
  /** Web text-xl */
  titleLG: { fontSize: 20, letterSpacing: 0.2, fontFamily: fonts.displayBold },
  titleMD: { fontSize: 18, fontFamily: fonts.display },
  titleSM: { fontSize: 16, fontFamily: fonts.display },
  /** Web text-base */
  body: { fontSize: 16, fontFamily: fonts.body },
  bodySecondary: { fontSize: 14, opacity: 0.8, fontFamily: fonts.body },
  caption: { fontSize: 12, opacity: 0.75, fontFamily: fonts.body },
  overline: { fontSize: 11, letterSpacing: 1, opacity: 0.9, fontFamily: fonts.bodySemiBold },
} as const;

// ─── Shadows / elevation (web: shadow utilities; native: shadowColor/Offset/Opacity/Radius + elevation)
export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 5,
  },
  glowViolet: {
    shadowColor: 'hsl(263, 70%, 66%)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  glowPink: {
    shadowColor: 'hsl(330, 81%, 60%)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 4,
  },
  glowCyan: {
    shadowColor: 'hsl(187, 94%, 43%)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 4,
  },
} as const;

// ─── Layout (web: container padding 1rem, max-w-lg 512px, input h-12)
export const layout = {
  /** Container horizontal padding (web: 1rem); use for screen gutters and header horizontal */
  containerPadding: 16,
  screenPadding: {
    default: 20,
    compact: 16,
  },
  contentWidth: 512,
  /** Web shadcn Input h-10 */
  inputHeight: 40,
  /** Extra padding below scroll when tab bar visible (web h-16 content + rhythm) */
  tabBarScrollPadding: 88,
  /** tabBarScrollPadding + vertical rhythm */
  scrollContentPaddingBottomTab: 88 + spacing.xl,

  // ─── Shell (navigation chrome parity; web BottomNav h-16 = 64px)
  tabBarContentHeightIos: 64,
  tabBarContentHeightAndroid: 60,
  tabBarPaddingTop: 8,
  tabBarPaddingBottomAndroid: 10,
  /** Header: extra padding above first row (add to insets.top); bottom padding of header bar */
  headerPaddingTopExtra: spacing.sm,
  headerPaddingBottom: spacing.md,
  /** Top padding for main content below header (web py-6); use for scroll content / first section breathing room */
  mainContentPaddingTop: spacing.xl,
  /** Minimum touch target size (Android HIG 48dp); use for list rows, tab items, icon buttons */
  minTouchTargetSize: 48,
} as const;

// ─── Button sizes (web: h-10 sm, h-12 default, h-14 lg; rounded-xl sm, rounded-2xl default/lg)
export const button = {
  height: {
    sm: 40,
    default: 48,
    lg: 56,
  },
  radius: {
    sm: 12, // web Button sm rounded-xl (Tailwind default 12px)
    default: 24, // rounded-2xl
    lg: 24,
  },
} as const;

/**
 * Gradient definitions (web: --gradient-primary, --gradient-accent).
 * Native has no CSS gradients; these are color-stop arrays for future use (e.g. expo-linear-gradient).
 * Current mobile styling uses solid primary/accent; no runtime gradient applied in Stage 2.
 */
export const gradient = {
  primary: ['hsl(263, 70%, 66%)', 'hsl(330, 81%, 60%)'] as const,
  accent: ['hsl(330, 81%, 60%)', 'hsl(187, 94%, 43%)'] as const,
} as const;
