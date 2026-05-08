import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EVENT_CATEGORIES,
  inferEventCategoryKeysFromLegacyTags,
  slugifyEventCategoryLabel,
} from "./eventCategories";

test("default event categories have stable emoji-backed keys", () => {
  assert.deepEqual(
    DEFAULT_EVENT_CATEGORIES.map((category) => [category.key, category.emoji, category.label]),
    [
      ["music_nightlife", "🎵", "Music & Nightlife"],
      ["tech_startups", "💻", "Tech & Startups"],
      ["art_creative", "🎨", "Art & Creative"],
      ["gaming", "🎮", "Gaming"],
      ["food_drink", "🍷", "Food & Drink"],
      ["wellness_fitness", "💪", "Wellness & Fitness"],
      ["outdoor_adventure", "🌿", "Outdoor & Adventure"],
      ["travel", "✈️", "Travel"],
      ["books_film", "📚", "Books & Film"],
      ["social_mixer", "🦋", "Social Mixer"],
      ["dating", "💕", "Dating"],
      ["professional_networking", "🤝", "Professional Networking"],
    ],
  );
});

test("category label slugification creates stable snake-case keys", () => {
  assert.equal(slugifyEventCategoryLabel("  Theater Night!  "), "theater_night");
  assert.equal(slugifyEventCategoryLabel("Food & Drink"), "food_drink");
  assert.equal(slugifyEventCategoryLabel("Música + Café"), "musica_cafe");
});

test("legacy themes and tags infer canonical category keys", () => {
  assert.deepEqual(
    inferEventCategoryKeysFromLegacyTags([
      "Foodie",
      "Wine",
      "Speed Dating",
      "Young Professionals",
      "Books",
      "Film",
      "Tech",
      "Creatives",
      "Fitness",
      "Music",
      "Traveler",
      "unknown",
    ]),
    [
      "food_drink",
      "dating",
      "professional_networking",
      "books_film",
      "tech_startups",
      "art_creative",
      "wellness_fitness",
      "music_nightlife",
      "travel",
    ],
  );
});
