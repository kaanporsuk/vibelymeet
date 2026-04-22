import test from "node:test";
import assert from "node:assert/strict";
import { resolvePrimaryProfilePhotoPath } from "./resolvePrimaryProfilePhotoPath";

test("picks first valid photos[] entry, not just index 0", () => {
  const out = resolvePrimaryProfilePhotoPath({
    photos: ["", "   ", "photos/second.jpg"],
    avatar_url: "photos/avatar.jpg",
  });
  assert.equal(out, "photos/second.jpg");
});

test("falls back to avatar_url when photos[] has no valid entry", () => {
  const out = resolvePrimaryProfilePhotoPath({
    photos: ["", "   ", null, undefined],
    avatar_url: "photos/avatar.jpg",
  });
  assert.equal(out, "photos/avatar.jpg");
});

test("ignores whitespace, wrapping quotes, and bad entries", () => {
  const out = resolvePrimaryProfilePhotoPath({
    photos: ["  ", "\"\"", "'   '", "'photos/quoted.jpg'"],
    avatar_url: "photos/avatar.jpg",
  });
  assert.equal(out, "photos/quoted.jpg");
});

test("accepts /photos, full https, Supabase, and Bunny URL candidates", () => {
  assert.equal(
    resolvePrimaryProfilePhotoPath({
      photos: ["/photos/a.jpg"],
      avatar_url: null,
    }),
    "/photos/a.jpg",
  );
  assert.equal(
    resolvePrimaryProfilePhotoPath({
      photos: ["https://example.com/p.jpg"],
      avatar_url: null,
    }),
    "https://example.com/p.jpg",
  );
  assert.equal(
    resolvePrimaryProfilePhotoPath({
      photos: ["https://xyz.supabase.co/storage/v1/object/public/photos/p.jpg"],
      avatar_url: null,
    }),
    "https://xyz.supabase.co/storage/v1/object/public/photos/p.jpg",
  );
  assert.equal(
    resolvePrimaryProfilePhotoPath({
      photos: ["https://cdn.bunny.net/photos/p.jpg"],
      avatar_url: null,
    }),
    "https://cdn.bunny.net/photos/p.jpg",
  );
});
