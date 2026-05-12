import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAgeFromBirthDate,
  dedupeOtherUserPhotos,
  getOtherUserLifestyleDetails,
  getZodiacFromBirthDate,
  normalizeOtherUserFullProfile,
  normalizeOtherUserPrompts,
  normalizeOtherUserVibes,
} from "./otherUserProfileViewModel.ts";

test("other-user photo gallery dedupes photos and keeps avatar reachable", () => {
  assert.deepEqual(
    dedupeOtherUserPhotos([" photos/a.jpg ", "photos/b.jpg?width=100", "PHOTOS/B.JPG?width=300"], "photos/avatar.jpg"),
    ["photos/a.jpg", "photos/b.jpg?width=100", "photos/avatar.jpg"],
  );
  assert.deepEqual(dedupeOtherUserPhotos([], "photos/avatar.jpg"), ["photos/avatar.jpg"]);
});

test("other-user prompts normalize legacy shapes and preserve every valid answer", () => {
  const prompts = normalizeOtherUserPrompts([
    { question: "Simple pleasure", answer: "Late coffee" },
    { prompt: "Together we could", response: "Find new music" },
    { title: "Blank", answer: "" },
    { label: "Life goal", text: "Build something kind" },
  ]);

  assert.deepEqual(prompts, [
    { question: "Simple pleasure", answer: "Late coffee" },
    { question: "Together we could", answer: "Find new music" },
    { question: "Life goal", answer: "Build something kind" },
  ]);
});

test("other-user age, zodiac, work, lifestyle aliases, and verification badges are derived", () => {
  const now = new Date(2026, 4, 12);
  assert.equal(calculateAgeFromBirthDate("1994-06-01", now), 31);
  assert.equal(calculateAgeFromBirthDate("1994-06-01T00:00:00.000Z", now), 31);
  assert.equal(getZodiacFromBirthDate("1994-06-01"), "Gemini");
  assert.equal(calculateAgeFromBirthDate("2026-02-31", now), null);
  assert.equal(getZodiacFromBirthDate("2026-02-31"), null);

  assert.deepEqual(
    getOtherUserLifestyleDetails({
      smoke: "never",
      alcohol: "socially",
      gym: "often",
      diet: "vegan",
      animals: ["dog", "cat"],
      kids: "not-sure",
    }),
    [
      { key: "smoking", label: "Smoking", value: "Never" },
      { key: "drinking", label: "Drinking", value: "Socially" },
      { key: "exercise", label: "Workout", value: "Often" },
      { key: "diet", label: "Diet", value: "Vegan" },
      { key: "pets", label: "Animals", value: "Dog, Cat" },
      { key: "children", label: "Kids", value: "Not sure" },
    ],
  );

  const vm = normalizeOtherUserFullProfile(
    {
      id: "user-1",
      name: " Kaan ",
      age: 99,
      birth_date: "1994-06-01",
      job: "Founder",
      company: "Vibely",
      photos: ["photos/a.jpg"],
      avatar_url: "photos/a.jpg",
      prompts: [{ question: "I geek out on", answer: "Systems" }],
      lifestyle: { workout: "daily" },
      email_verified: true,
      phone_verified: true,
      photo_verified: true,
    },
    now,
  );

  assert.equal(vm.age, 31);
  assert.equal(vm.zodiac, "Gemini");
  assert.equal(vm.workLabel, "Founder at Vibely");
  assert.deepEqual(vm.photos, ["photos/a.jpg"]);
  assert.deepEqual(vm.verification, { email: true, phone: true, photo: true });
  assert.deepEqual(vm.lifestyleDetails, [{ key: "exercise", label: "Workout", value: "Daily" }]);
});

test("other-user vibes preserve metadata when canonical RPC provides it", () => {
  assert.deepEqual(
    normalizeOtherUserVibes([
      { id: "1", label: "Deep Talker", emoji: "chat", category: "energy" },
      "Deep Talker",
      { id: "2", name: "Night Owl", emoji: "moon", category: "social_style" },
    ]),
    [
      { id: "1", label: "Deep Talker", emoji: "chat", category: "energy" },
      { id: "2", label: "Night Owl", emoji: "moon", category: "social_style" },
    ],
  );

  const vm = normalizeOtherUserFullProfile({
    id: "user-vibes",
    vibes: ["Fallback"],
    vibe_tags: [{ id: "3", label: "Spontaneous", emoji: "dice", category: "social_style" }],
  });

  assert.deepEqual(vm.vibes, [{ id: "3", label: "Spontaneous", emoji: "dice", category: "social_style" }]);
});
