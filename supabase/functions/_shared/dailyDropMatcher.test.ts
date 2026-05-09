import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalPairKey,
  isGenderCompatible,
  isAgeCompatible,
  buildPickReasons,
  scorePairs,
  greedyPair,
  pickPairs,
  type MatcherUser,
  type TagInfo,
  type MatcherInput,
} from "./dailyDropMatcher";

const NO_EXCLUSIONS: Pick<MatcherInput, "matchSet" | "blockSet" | "reportSet" | "cooldownSet"> = {
  matchSet: new Set(),
  blockSet: new Set(),
  reportSet: new Set(),
  cooldownSet: new Set(),
};

function makeUser(overrides: Partial<MatcherUser> & { id: string }): MatcherUser {
  return {
    gender: "f",
    interested_in: ["m"],
    age: 28,
    preferred_age_min: null,
    preferred_age_max: null,
    ...overrides,
  };
}

const TAG_MAP: Record<string, TagInfo> = {
  hike: { label: "Hiking", emoji: "🥾" },
  cook: { label: "Cooking", emoji: "🍳" },
  read: { label: "Reading", emoji: "📚" },
  art:  { label: "Art",     emoji: "🎨" },
};

test("canonicalPairKey is order-insensitive", () => {
  assert.equal(canonicalPairKey("a", "b"), "a:b");
  assert.equal(canonicalPairKey("b", "a"), "a:b");
});

test("isGenderCompatible: empty interested_in is permissive (legacy default)", () => {
  const a = makeUser({ id: "a", gender: "f", interested_in: [] });
  const b = makeUser({ id: "b", gender: "m", interested_in: [] });
  assert.equal(isGenderCompatible(a, b), true);
});

test("isGenderCompatible: rejects when one side excludes the other's gender", () => {
  const f = makeUser({ id: "f", gender: "f", interested_in: ["f"] });
  const m = makeUser({ id: "m", gender: "m", interested_in: ["f"] });
  assert.equal(isGenderCompatible(f, m), false);
});

test("isAgeCompatible: respects min and max preferences on both sides", () => {
  // viewer wants 30..40 but partner is 27 → viewer rejects
  const viewer = makeUser({ id: "v", age: 32, preferred_age_min: 30, preferred_age_max: 40 });
  const tooYoung = makeUser({ id: "ty", age: 27 });
  assert.equal(isAgeCompatible(viewer, tooYoung), false, "viewer min=30 rejects partner age=27");

  // partner wants 25..28 but viewer is 32 → partner rejects (asymmetric)
  const partnerStrict = makeUser({ id: "ps", age: 26, preferred_age_min: 25, preferred_age_max: 28 });
  assert.equal(isAgeCompatible(viewer, partnerStrict), false, "partner max=28 rejects viewer age=32");

  // both ranges overlap on both ages
  const inRange = makeUser({ id: "in", age: 32, preferred_age_min: 28, preferred_age_max: 36 });
  const alsoOk  = makeUser({ id: "ok", age: 30, preferred_age_min: 25, preferred_age_max: 40 });
  assert.equal(isAgeCompatible(inRange, alsoOk), true);
});

test("isAgeCompatible: missing prefs accept any age", () => {
  const a = makeUser({ id: "a", age: 22 });
  const b = makeUser({ id: "b", age: 55 });
  assert.equal(isAgeCompatible(a, b), true);
});

test("buildPickReasons formats shared vibes, flags strong alignment, and falls back", () => {
  const r1 = buildPickReasons({ sharedTagIds: ["hike", "cook", "read", "art"], tagMap: TAG_MAP, overlap: 4 });
  assert.equal(r1[0], "Shared vibes: 🥾 Hiking, 🍳 Cooking, 📚 Reading", "caps at 3 labels");
  assert.equal(r1[1], "Strong vibe alignment", "overlap >=3 emits strong-alignment");
  const r2 = buildPickReasons({ sharedTagIds: ["hike"], tagMap: TAG_MAP, overlap: 1 });
  assert.deepEqual(r2, ["Shared vibes: 🥾 Hiking"], "no strong-alignment when overlap < 3");
  const r3 = buildPickReasons({ sharedTagIds: [], tagMap: TAG_MAP, overlap: 0 });
  assert.deepEqual(r3, ["New connection opportunity"], "fallback when no overlap");
});

test("scorePairs respects exclusions: matches/blocks/reports/cooldowns", () => {
  const a = makeUser({ id: "a", gender: "f", interested_in: ["m"] });
  const b = makeUser({ id: "b", gender: "m", interested_in: ["f"] });

  const baseInput: MatcherInput = {
    users: [a, b],
    vibeMap: { a: new Set(["hike"]), b: new Set(["hike"]) },
    tagMap: TAG_MAP,
    ...NO_EXCLUSIONS,
  };

  assert.equal(scorePairs(baseInput).length, 1, "no exclusions ⇒ pair surfaces");
  assert.equal(
    scorePairs({ ...baseInput, matchSet: new Set(["a:b"]) }).length, 0,
    "existing match excludes",
  );
  assert.equal(
    scorePairs({ ...baseInput, blockSet: new Set(["a:b"]) }).length, 0,
    "block excludes (forward direction)",
  );
  assert.equal(
    scorePairs({ ...baseInput, blockSet: new Set(["b:a"]) }).length, 0,
    "block excludes (reverse direction)",
  );
  assert.equal(
    scorePairs({ ...baseInput, reportSet: new Set(["a:b"]) }).length, 0,
    "report excludes",
  );
  assert.equal(
    scorePairs({ ...baseInput, cooldownSet: new Set(["a:b"]) }).length, 0,
    "cooldown excludes",
  );
});

test("scorePairs ranks higher overlap first", () => {
  const a = makeUser({ id: "a" });
  const b = makeUser({ id: "b", gender: "m", interested_in: ["f"] });
  const c = makeUser({ id: "c", gender: "m", interested_in: ["f"] });
  const input: MatcherInput = {
    users: [a, b, c],
    vibeMap: {
      a: new Set(["hike", "cook", "read"]),
      b: new Set(["hike"]),
      c: new Set(["hike", "cook", "read"]),
    },
    tagMap: TAG_MAP,
    ...NO_EXCLUSIONS,
  };
  const scored = scorePairs(input);
  assert.equal(scored[0].id_a, "a");
  assert.equal(scored[0].id_b, "c", "a-c (overlap 3) ranks above a-b (overlap 1)");
  assert.equal(scored[0].score, 3);
});

test("greedyPair claims highest-affinity match per user", () => {
  const u1 = makeUser({ id: "u1" });
  const u2 = makeUser({ id: "u2", gender: "m", interested_in: ["f"] });
  const u3 = makeUser({ id: "u3", gender: "m", interested_in: ["f"] });
  const u4 = makeUser({ id: "u4" });

  const input: MatcherInput = {
    users: [u1, u2, u3, u4],
    vibeMap: {
      u1: new Set(["hike", "cook"]),
      u2: new Set(["hike", "cook"]),    // u1-u2 score 2
      u3: new Set(["hike"]),            // u1-u3 score 1
      u4: new Set(["read"]),            // u1-u4 score 0
    },
    tagMap: TAG_MAP,
    ...NO_EXCLUSIONS,
  };
  const scored = scorePairs(input);
  const pairs = greedyPair(scored);

  // u1-u2 wins (highest score). u3 and u4 are mutually compatible (both gender=f → wait actually u3 is m, u4 is f).
  // u4 default gender 'f', u3 'm'. Both interested_in is u3=[f], u4=[m]. Compatible.
  assert.equal(pairs.length, 2, "two pairs expected from four compatible users");
  const sortedPair = pairs.map((p) => `${p.user_a_id}:${p.user_b_id}`).sort();
  assert.ok(sortedPair.includes("u1:u2"), "highest-affinity pair claimed first");
});

test("pickPairs reports unpairedCount when an odd cohort cannot fully pair", () => {
  const u1 = makeUser({ id: "u1" });
  const u2 = makeUser({ id: "u2", gender: "m", interested_in: ["f"] });
  const u3 = makeUser({ id: "u3" });
  // u1 and u3 are both f; u2 is the only m. So only one f-m pair possible.
  const input: MatcherInput = {
    users: [u1, u2, u3],
    vibeMap: { u1: new Set(["hike"]), u2: new Set(["hike"]), u3: new Set() },
    tagMap: TAG_MAP,
    ...NO_EXCLUSIONS,
  };
  const result = pickPairs(input);
  assert.equal(result.pairs.length, 1);
  assert.equal(result.unpairedCount, 1, "odd one out tracked");
});

test("scorePairs filters age-incompatible candidates even when other criteria match", () => {
  const a = makeUser({ id: "a", age: 25, preferred_age_min: 28, preferred_age_max: 35 });
  const b = makeUser({ id: "b", gender: "m", interested_in: ["f"], age: 27 }); // below a's 28
  const input: MatcherInput = {
    users: [a, b],
    vibeMap: { a: new Set(["hike"]), b: new Set(["hike"]) },
    tagMap: TAG_MAP,
    ...NO_EXCLUSIONS,
  };
  assert.equal(scorePairs(input).length, 0);
});

test("scorePairs honours mutuallyDiscoverable callback (event-based discovery)", () => {
  const a = makeUser({ id: "a" });
  const b = makeUser({ id: "b", gender: "m", interested_in: ["f"] });
  const input: MatcherInput = {
    users: [a, b],
    vibeMap: { a: new Set(["hike"]), b: new Set(["hike"]) },
    tagMap: TAG_MAP,
    mutuallyDiscoverable: () => false,
    ...NO_EXCLUSIONS,
  };
  assert.equal(scorePairs(input).length, 0, "callback returning false excludes the pair");
});
