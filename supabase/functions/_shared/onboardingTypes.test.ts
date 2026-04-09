import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ONBOARDING_DATA,
  hasConfirmedOnboardingLocation,
  type OnboardingData,
  validateOnboardingData,
} from "./onboardingTypes";

function makeValidOnboardingData(overrides: Partial<OnboardingData> = {}): OnboardingData {
  return {
    ...DEFAULT_ONBOARDING_DATA,
    name: "Taylor",
    birthDate: "1995-06-15",
    gender: "woman",
    interestedIn: "men",
    relationshipIntent: "relationship",
    photos: ["photo-1.jpg", "photo-2.jpg"],
    location: "London, United Kingdom",
    locationData: { lat: 51.5074, lng: -0.1278 },
    country: "United Kingdom",
    communityAgreed: true,
    ...overrides,
  };
}

test("hasConfirmedOnboardingLocation requires location text, country, and valid coordinates", () => {
  assert.equal(
    hasConfirmedOnboardingLocation(
      makeValidOnboardingData({
        location: "Amsterdam, Netherlands",
        locationData: { lat: 52.3676, lng: 4.9041 },
        country: "Netherlands",
      }),
    ),
    true,
  );

  assert.equal(
    hasConfirmedOnboardingLocation(
      makeValidOnboardingData({
        location: "Amsterdam",
        locationData: null,
        country: "Netherlands",
      }),
    ),
    false,
  );

  assert.equal(
    hasConfirmedOnboardingLocation(
      makeValidOnboardingData({
        location: "Amsterdam",
        locationData: { lat: 190, lng: 4.9041 },
        country: "Netherlands",
      }),
    ),
    false,
  );
});

test("validateOnboardingData rejects loose text locations without confirmed coordinates", () => {
  const validation = validateOnboardingData(
    makeValidOnboardingData({
      location: "Paris",
      locationData: null,
      country: "France",
    }),
  );

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("Confirmed location is required"));
});
