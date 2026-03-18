/**
 * Vibely Neon Noir palette — aligned to web (src/index.css :root).
 * Semantic names match Tailwind/Shadcn usage for parity.
 */
const vibelyPrimary = 'hsl(263, 70%, 66%)'; // --primary / --neon-violet
const vibelyAccent = 'hsl(330, 81%, 60%)'; // --accent / --neon-pink
const vibelyCyan = 'hsl(187, 94%, 43%)'; // --neon-cyan
const vibelyYellow = 'hsl(45, 93%, 58%)'; // --neon-yellow

const base = {
  // Background & surface (web: --background, --card, --popover)
  background: 'hsl(240, 10%, 4%)',
  surface: 'hsl(240, 10%, 8%)', // --card
  surfaceSubtle: 'hsl(240, 10%, 10%)',

  // Foreground / text (web: --foreground, --muted-foreground)
  text: 'hsl(0, 0%, 98%)',
  textSecondary: 'hsl(240, 5%, 60%)', // --muted-foreground

  // Semantic surfaces (web: --secondary, --muted)
  secondary: 'hsl(240, 10%, 14%)',
  secondaryForeground: 'hsl(0, 0%, 98%)',
  muted: 'hsl(240, 10%, 16%)',
  mutedForeground: 'hsl(240, 5%, 60%)',

  // Borders & input (web: --border, --input)
  border: 'hsl(240, 10%, 18%)',
  input: 'hsl(240, 10%, 18%)',
  ring: 'hsl(263, 70%, 66%)', // --ring, same as primary

  // Primary (web: --primary, --primary-foreground)
  tint: vibelyPrimary,
  primaryForeground: 'hsl(0, 0%, 100%)',

  // Accent (web: --accent, --accent-foreground)
  accent: vibelyAccent,
  accentSoft: 'hsla(330, 81%, 60%, 0.2)',

  // Destructive (web: --destructive, --destructive-foreground)
  danger: 'hsl(0, 84%, 60%)',
  dangerSoft: 'hsla(0, 84%, 60%, 0.16)',

  // Popover (web: same as card)
  popover: 'hsl(240, 10%, 8%)',
  popoverForeground: 'hsl(0, 0%, 98%)',

  // Success (app-specific)
  success: '#22c55e',
  successSoft: 'rgba(34, 197, 94, 0.16)',

  // Tab bar
  tabIconDefault: 'hsl(240, 5%, 60%)',
  tabIconSelected: vibelyPrimary,
  tintSoft: 'rgba(139,92,246,0.26)', // bg-primary/20 equivalent

  // Neon (web: --neon-*)
  neonViolet: vibelyPrimary,
  neonPink: vibelyAccent,
  neonCyan: vibelyCyan,
  neonYellow: vibelyYellow,

  // Glass (web: glass-card bg-card/60 ≈ hsl(240,10%,8%) @ 60%)
  glassSurface: 'rgba(20,20,24,0.6)',
  glassBorder: 'rgba(255,255,255,0.1)',
} as const;

// Mobile is dark-first like web; light and dark share the same palette for now.
const light = { ...base };
const dark = { ...base };

export default {
  light,
  dark,
};
