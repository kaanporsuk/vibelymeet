import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProfilePhotoDerivatives } from "./photoDerivatives";

test("normalizes only safe profile photo derivative refs", () => {
  assert.deepEqual(
    normalizeProfilePhotoDerivatives({
      "photos/user/photo.jpg": {
        thumb: "photos/user/photo@thumb.jpg",
        hero: "photos/user/photo@hero.jpg",
        placeholderKind: "dominant_color",
        placeholderHash: "#ABCDEF",
        dominantColor: "#123456",
      },
      "/photos/user/bad.jpg": { thumb: "photos/user/bad-thumb.jpg" },
      "photos/user/escape.jpg": { hero: "../private.jpg" },
      "photos/user/url.jpg": { hero: "https://cdn.example.com/url.jpg" },
    }),
    {
      "photos/user/photo.jpg": {
        thumb: "photos/user/photo@thumb.jpg",
        hero: "photos/user/photo@hero.jpg",
        placeholderKind: "dominant_color",
        placeholderHash: "#abcdef",
        dominantColor: "#123456",
      },
    },
  );
});
