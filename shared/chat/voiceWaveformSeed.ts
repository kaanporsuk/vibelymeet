/** Deterministic pseudo-waveform heights for voice UI (stable per seed). */
export function waveformHeightsFromSeed(seed: string, length: number): number[] {
  let h = 2166136261;
  for (let c = 0; c < seed.length; c++) {
    h ^= seed.charCodeAt(c);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    h ^= i * 2654435761;
    h = Math.imul(h, 1597334677);
    const t = (h >>> 0) / 4294967296;
    const wave =
      0.42 + 0.38 * Math.sin(i * 0.35 + t * 6.28) + 0.12 * Math.sin(i * 0.71 + t * 3.14);
    out.push(Math.min(1, Math.max(0.12, wave)));
  }
  return out;
}
