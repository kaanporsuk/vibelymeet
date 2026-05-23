import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMediaPlaceholderPayload } from "../media/placeholders";
import { normalizeProfilePhotoDerivatives } from "./photoDerivatives";

test("normalizes only safe profile photo derivative refs", () => {
  assert.deepEqual(
    normalizeProfilePhotoDerivatives({
      "photos/user/photo.jpg": {
        thumb: "photos/user/photo@thumb.jpg",
        display: "photos/user/photo@display.jpg",
        hero: "photos/user/photo@hero.jpg",
        placeholderKind: "dominant_color",
        placeholderHash: "#ABCDEF",
        dominantColor: "#123456",
      },
      "photos/user/blurhash.jpg": {
        placeholderKind: "blurhash",
        placeholderHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
        dominantColor: "#654321",
      },
      "/photos/user/bad.jpg": { thumb: "photos/user/bad-thumb.jpg" },
      "photos/user/escape.jpg": { hero: "../private.jpg" },
      "photos/user/bad-display.jpg": { display: "https://cdn.example.com/bad.jpg" },
      "photos/user/url.jpg": { hero: "https://cdn.example.com/url.jpg" },
      "photos/user/bad-blurhash.jpg": {
        placeholderKind: "blurhash",
        placeholderHash: "bad",
        dominantColor: "#111111",
      },
      "photos/user/hash-only-color.jpg": {
        placeholderKind: "dominant_color",
        placeholderHash: "#C0FFEE",
      },
    }),
    {
      "photos/user/photo.jpg": {
        thumb: "photos/user/photo@thumb.jpg",
        display: "photos/user/photo@display.jpg",
        hero: "photos/user/photo@hero.jpg",
        placeholderKind: "dominant_color",
        placeholderHash: "#abcdef",
        dominantColor: "#123456",
      },
      "photos/user/blurhash.jpg": {
        placeholderKind: "blurhash",
        placeholderHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
        dominantColor: "#654321",
      },
      "photos/user/bad-blurhash.jpg": {
        dominantColor: "#111111",
      },
      "photos/user/hash-only-color.jpg": {
        placeholderKind: "dominant_color",
        placeholderHash: "#c0ffee",
        dominantColor: "#c0ffee",
      },
    },
  );
});

test("derives dominant color from dominant-color placeholder hash when payload omits it", () => {
  assert.deepEqual(
    normalizeMediaPlaceholderPayload({
      kind: "dominant_color",
      hash: "#ABCDEF",
    }),
    {
      kind: "dominant_color",
      hash: "#abcdef",
      dominantColor: "#abcdef",
    },
  );
});
