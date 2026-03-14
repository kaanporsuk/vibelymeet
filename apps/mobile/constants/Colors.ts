// Vibely Neon Noir palette — mirrored from web (see src/index.css)
const vibelyPrimary = 'hsl(263, 70%, 66%)'; // --primary / --neon-violet
const vibelyAccent = 'hsl(330, 81%, 60%)'; // --accent / --neon-pink
const vibelyCyan = 'hsl(187, 94%, 43%)'; // --neon-cyan

const base = {
  text: 'hsl(0, 0%, 98%)', // --foreground
  textSecondary: 'hsl(240, 5%, 60%)', // --muted-foreground
  background: 'hsl(240, 10%, 4%)', // --background
  surface: 'hsl(240, 10%, 8%)', // --card
  surfaceSubtle: 'hsl(240, 10%, 10%)',
  border: 'hsl(240, 10%, 18%)', // --border
  tint: vibelyPrimary,
  accent: vibelyAccent,
  accentSoft: 'hsla(330, 81%, 60%, 0.2)',
  neonViolet: vibelyPrimary,
  neonPink: vibelyAccent,
  neonCyan: vibelyCyan,
  danger: 'hsl(0, 84%, 60%)', // --destructive
  dangerSoft: 'hsla(0, 84%, 60%, 0.16)',
  success: '#22c55e',
  successSoft: 'rgba(34, 197, 94, 0.16)',
  tabIconDefault: 'hsl(240, 5%, 60%)',
  tabIconSelected: vibelyPrimary,
  /** Glass-style surfaces (header, tab bar) — web parity glass-card */
  glassSurface: 'rgba(20,20,24,0.92)',
  glassBorder: 'rgba(255,255,255,0.1)',
} as const;

// Mobile is dark-first like web; light and dark share the same palette for now.
const light = { ...base };
const dark = { ...base };

export default {
  light,
  dark,
};
