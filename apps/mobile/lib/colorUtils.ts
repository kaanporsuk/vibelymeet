/**
 * Color utilities — e.g. safe alpha for HSL/hex (avoid invalid concatenation like hsl(...)20).
 */
export function withAlpha(color: string, alpha: number): string {
  const trimmed = color.trim();
  const a = Math.max(0, Math.min(1, alpha));
  if (trimmed.startsWith('hsl')) {
    const match = trimmed.match(/hsla?\(\s*([^)]*)\)/i);
    if (!match) return color;
    const parts = match[1].split(',').map((p) => p.trim());
    const [h, s, l] = parts;
    if (!h || !s || !l) return color;
    return `hsla(${h}, ${s}, ${l}, ${a})`;
  }
  if (/^#([0-9a-fA-F]{8})$/.test(trimmed)) {
    const rgb = trimmed.slice(0, 7);
    const alphaHex = Math.round(a * 255).toString(16).padStart(2, '0');
    return `${rgb}${alphaHex}`;
  }
  if (/^#([0-9a-fA-F]{6})$/.test(trimmed)) {
    const alphaHex = Math.round(a * 255).toString(16).padStart(2, '0');
    return `${trimmed}${alphaHex}`;
  }
  return color;
}
