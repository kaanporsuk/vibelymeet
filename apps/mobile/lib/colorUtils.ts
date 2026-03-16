/**
 * Color utilities — e.g. safe alpha for HSL/hex (avoid invalid concatenation like hsl(...)20).
 */
export function withAlpha(color: string, alpha: number): string {
  const trimmed = color.trim();
  if (trimmed.startsWith('hsl')) {
    const match = trimmed.match(/hsla?\(\s*([^)]*)\)/i);
    if (!match) return color;
    const parts = match[1].split(',').map((p) => p.trim());
    const [h, s, l] = parts;
    if (!h || !s || !l) return color;
    return `hsla(${h}, ${s}, ${l}, ${alpha})`;
  }
  if (/^#([0-9a-fA-F]{6})$/.test(trimmed)) {
    const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0');
    return `${trimmed}${alphaHex}`;
  }
  return color;
}
