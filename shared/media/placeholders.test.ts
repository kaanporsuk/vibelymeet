import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeBlurhash,
  normalizeDominantColor,
  normalizeMediaPlaceholderDominantColor,
  normalizeMediaPlaceholderHash,
  normalizeMediaPlaceholderKind,
  normalizeMediaPlaceholderPayload,
} from "./placeholders.ts";

const VALID_BLURHASH = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";

test("blurhash normalization accepts semantically valid hashes only", () => {
  assert.equal(normalizeBlurhash(VALID_BLURHASH), VALID_BLURHASH);
  assert.equal(normalizeBlurhash(" badbad "), null);
  assert.equal(normalizeBlurhash("not a blurhash"), null);
  assert.equal(normalizeBlurhash(null), null);
});

test("dominant color normalization is lowercased and safe", () => {
  assert.equal(normalizeDominantColor("#ABCDEF"), "#abcdef");
  assert.equal(normalizeDominantColor("#abcdeg"), null);
  assert.equal(normalizeMediaPlaceholderDominantColor("dominant_color", "#C0FFEE", null), "#c0ffee");
});

test("media placeholder payload rejects malformed blurhash and preserves color fallback", () => {
  assert.deepEqual(
    normalizeMediaPlaceholderPayload({
      kind: "blurhash",
      hash: VALID_BLURHASH,
      dominantColor: "#654321",
    }),
    {
      kind: "blurhash",
      hash: VALID_BLURHASH,
      dominantColor: "#654321",
    },
  );

  assert.deepEqual(
    normalizeMediaPlaceholderPayload({
      kind: "blurhash",
      hash: "badbad",
      dominantColor: "#111111",
    }),
    {
      kind: "dominant_color",
      hash: "#111111",
      dominantColor: "#111111",
    },
  );
  assert.equal(
    normalizeMediaPlaceholderPayload({
      kind: "blurhash",
      hash: "badbad",
    }),
    null,
  );
  assert.equal(normalizeMediaPlaceholderKind("blurhash"), "blurhash");
  assert.equal(normalizeMediaPlaceholderHash("blurhash", "badbad"), null);
});
