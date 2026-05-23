import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { encode, isBlurhashValid } from "https://esm.sh/blurhash@2.0.5";

export type MediaPlaceholderKind = "dominant_color" | "blurhash";

export type MediaPlaceholderMetadata = {
  placeholder_kind: MediaPlaceholderKind;
  placeholder_hash: string;
  dominant_color: string | null;
};

const DOMINANT_COLOR_RE = /^#[0-9a-f]{6}$/i;
const BLURHASH_RE = /^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]{6,120}$/;
const PLACEHOLDER_MAX_EDGE = 32;

function normalizeDominantColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const color = value.trim();
  return DOMINANT_COLOR_RE.test(color) ? color.toLowerCase() : null;
}

function normalizeBlurhash(value: string | null | undefined): string | null {
  if (!value) return null;
  const hash = value.trim();
  if (!BLURHASH_RE.test(hash)) return null;
  const validation = isBlurhashValid(hash);
  return validation.result ? hash : null;
}

function optionalFormString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rgbToHex(red: number, green: number, blue: number): string {
  const toHex = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

export function readImagePlaceholderMetadata(formData: FormData): MediaPlaceholderMetadata | null {
  const placeholderKind = optionalFormString(formData, "placeholder_kind");
  const dominantColor = normalizeDominantColor(optionalFormString(formData, "dominant_color"));

  if (placeholderKind === "blurhash") {
    const hash = normalizeBlurhash(optionalFormString(formData, "placeholder_hash"));
    if (hash) return { placeholder_kind: "blurhash", placeholder_hash: hash, dominant_color: dominantColor };
    return dominantColor
      ? { placeholder_kind: "dominant_color", placeholder_hash: dominantColor, dominant_color: dominantColor }
      : null;
  }

  if (!dominantColor) return null;
  const hash = normalizeDominantColor(optionalFormString(formData, "placeholder_hash")) ?? dominantColor;
  return {
    placeholder_kind: "dominant_color",
    placeholder_hash: hash,
    dominant_color: dominantColor,
  };
}

export async function createImagePlaceholderMetadata(
  buffer: ArrayBuffer,
): Promise<MediaPlaceholderMetadata | null> {
  let image: Image;
  try {
    image = await Image.decode(new Uint8Array(buffer));
  } catch {
    return null;
  }

  if (!image.width || !image.height || image.width <= 0 || image.height <= 0) return null;

  const scale = Math.min(1, PLACEHOLDER_MAX_EDGE / Math.max(image.width, image.height));
  const targetWidth = Math.max(1, Math.round(image.width * scale));
  const targetHeight = Math.max(1, Math.round(image.height * scale));
  if (targetWidth !== image.width || targetHeight !== image.height) {
    image = image.resize(targetWidth, targetHeight);
  }

  const width = Math.max(1, image.width);
  const height = Math.max(1, image.height);
  const pixels = new Uint8ClampedArray(width * height * 4);
  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let alphaTotal = 0;

  for (let y = 1; y <= height; y += 1) {
    for (let x = 1; x <= width; x += 1) {
      const rgba = image.getRGBAAt(x, y);
      const alpha = rgba[3] / 255;
      const red = rgba[0] * alpha + 255 * (1 - alpha);
      const green = rgba[1] * alpha + 255 * (1 - alpha);
      const blue = rgba[2] * alpha + 255 * (1 - alpha);
      const offset = ((y - 1) * width + (x - 1)) * 4;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = 255;
      if (alpha > 0.05) {
        redTotal += red * alpha;
        greenTotal += green * alpha;
        blueTotal += blue * alpha;
        alphaTotal += alpha;
      }
    }
  }

  const dominantColor = alphaTotal > 0
    ? rgbToHex(redTotal / alphaTotal, greenTotal / alphaTotal, blueTotal / alphaTotal)
    : "#f3f4f6";
  const componentX = Math.max(1, Math.min(4, width));
  const componentY = Math.max(1, Math.min(4, height, Math.round(componentX * (height / width))));
  const blurhash = encode(pixels, width, height, componentX, componentY);

  return {
    placeholder_kind: "blurhash",
    placeholder_hash: blurhash,
    dominant_color: dominantColor,
  };
}

export function mediaPlaceholderResponse(placeholder: MediaPlaceholderMetadata | null): Record<string, string | null> | undefined {
  if (!placeholder) return undefined;
  return {
    kind: placeholder.placeholder_kind,
    hash: placeholder.placeholder_hash,
    dominantColor: placeholder.dominant_color,
  };
}
