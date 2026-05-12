import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const exists = (path: string) => existsSync(new URL(`../../${path}`, import.meta.url));

test("web other-user profile entry points render canonical profile content", () => {
  const userRoute = read("src/pages/UserProfile.tsx");
  const drawer = read("src/components/ProfileDetailDrawer.tsx");
  const chatHeader = read("src/components/chat/ChatHeader.tsx");
  const chat = read("src/pages/Chat.tsx");
  const matches = read("src/pages/Matches.tsx");
  const swipeRow = read("src/components/SwipeableMatchCard.tsx");
  const partnerSheet = read("src/components/video-date/PartnerProfileSheet.tsx");
  const videoDate = read("src/pages/VideoDate.tsx");

  assert.match(userRoute, /OtherUserFullProfileView/);
  assert.match(userRoute, /useOtherUserFullProfile/);
  assert.match(drawer, /OtherUserFullProfileView/);
  assert.match(drawer, /useOtherUserFullProfile/);
  assert.match(partnerSheet, /OtherUserFullProfileView/);
  assert.match(partnerSheet, /partnerProfileId/);
  assert.match(videoDate, /partnerProfileId=\{partnerId\}/);

  assert.match(chatHeader, /ProfileDetailDrawer/);
  assert.match(chat, /ProfileDetailDrawer/);
  assert.match(matches, /ProfileDetailDrawer/);
  assert.match(swipeRow, /ProfileDetailDrawer/);
});

test("adaptive web media is used for hero, gallery, and fullscreen profile photos", () => {
  const media = read("src/components/profile/AdaptiveProfileMedia.tsx");
  const canonical = read("src/components/profile/OtherUserFullProfileView.tsx");
  const fullscreen = read("src/components/PhotoPreviewModal.tsx");

  assert.match(media, /object-contain/);
  assert.match(media, /object-cover/);
  assert.match(media, /h-\[clamp\(360px,62dvh,680px\)\]/);
  assert.match(media, /h-\[clamp\(260px,48dvh,520px\)\]/);
  assert.match(canonical, /variant="hero"/);
  assert.match(canonical, /variant="gallery"/);
  assert.match(canonical, /PhotoPreviewModal/);
  assert.match(canonical, /vibeVideo\.state === "failed" \|\| vibeVideo\.state === "error"/);
  assert.match(fullscreen, /object-contain/);
});

test("native chat and matches route profile actions to the canonical user route", () => {
  const nativeChat = read("apps/mobile/app/chat/[id].tsx");
  const nativeMatches = read("apps/mobile/app/(tabs)/matches/index.tsx");
  const nativeVideoDate = read("apps/mobile/app/date/[id].tsx");
  const nativePartnerSheet = read("apps/mobile/components/video-date/PartnerProfileSheet.tsx");

  assert.match(nativeChat, /openOtherProfile/);
  assert.match(nativeChat, /\/user\/\$\{encodeURIComponent\(otherUserId\)\}/);
  assert.match(nativeChat, /headerCenter:[\s\S]*minHeight: 44/);
  assert.match(nativeChat, /headerAvatar:[\s\S]*width: 44[\s\S]*height: 44/);
  assert.doesNotMatch(nativeChat, /ProfileDetailSheet/);
  assert.doesNotMatch(nativeChat, /setShowProfileSheet/);

  assert.match(nativeMatches, /\/user\/\$\{encodeURIComponent\(actionsMatch\.id\)\}/);
  assert.match(nativeMatches, /\/user\/\$\{encodeURIComponent\(m\.id\)\}/);
  assert.doesNotMatch(nativeMatches, /ProfileDetailSheet/);
  assert.doesNotMatch(nativeMatches, /setProfileSheetMatch/);
  assert.match(nativeVideoDate, /PartnerProfileSheet/);
  assert.match(nativePartnerSheet, /UserProfileFullView/);
  assert.doesNotMatch(nativePartnerSheet, /ProfileDetailSheet/);
  assert.equal(exists("apps/mobile/components/match/ProfileDetailSheet.tsx"), false);
});

test("web and native fetchers preserve legacy prompt shapes for the canonical view model", () => {
  const webFetcher = read("src/services/fetchUserProfile.ts");
  const nativeFetcher = read("apps/mobile/lib/fetchUserProfile.ts");

  for (const source of [webFetcher, nativeFetcher]) {
    assert.match(source, /row\.prompt/);
    assert.match(source, /row\.title/);
    assert.match(source, /row\.label/);
    assert.match(source, /row\.response/);
    assert.match(source, /row\.value/);
    assert.match(source, /row\.text/);
    assert.match(source, /normalizeVibeTags/);
    assert.match(source, /row\.vibe_tags/);
  }
});

test("native full profile includes adaptive media and explicit verification status coverage", () => {
  const nativeFullView = read("apps/mobile/components/profile/UserProfileFullView.tsx");

  assert.match(nativeFullView, /AdaptiveNativeProfileMedia/);
  assert.match(nativeFullView, /resizeMode="contain"/);
  assert.match(nativeFullView, /Math\.min\(winHeight \* 0\.58, 620\)/);
  assert.match(nativeFullView, /Math\.min\(winHeight \* 0\.48, 500\)/);
  assert.match(nativeFullView, /Verification Status/);
  assert.match(nativeFullView, /isOwnProfile[\s\S]*Birthday/);
  assert.match(nativeFullView, /Zodiac/);
  assert.doesNotMatch(nativeFullView, /ABOUT_ME_MIN_CHARS/);
});

test("profile RPC includes new safe fields and does not return private profile data", () => {
  const migration = read("supabase/migrations/20260512023000_canonical_other_profile_safe_fields.sql");
  const selectBlock = migration.slice(migration.indexOf("SELECT\n    p.id"), migration.indexOf("INTO v_profile"));
  const returnBlock = migration.slice(migration.indexOf("RETURN jsonb_build_object"), migration.indexOf(");\nEND;", migration.indexOf("RETURN jsonb_build_object")));

  for (const safeField of ["p.birth_date", "p.company", "p.email_verified", "p.phone_verified"]) {
    assert.match(selectBlock, new RegExp(safeField.replace(".", "\\.")));
  }
  assert.match(migration, /jsonb_build_object\([\s\S]*'id', vt\.id[\s\S]*'emoji', vt\.emoji[\s\S]*'category', vt\.category/);
  for (const safeKey of ["'birth_date'", "'company'", "'email_verified'", "'phone_verified'", "'vibe_tags'"]) {
    assert.match(returnBlock, new RegExp(safeKey));
  }

  for (const privateField of ["phone_number", "verified_email", "proof_selfie_url", "location_data"]) {
    assert.doesNotMatch(selectBlock, new RegExp(privateField));
    assert.doesNotMatch(returnBlock, new RegExp(privateField));
  }
});

test("canonical profile views do not render private PII fields", () => {
  const webCanonical = read("src/components/profile/OtherUserFullProfileView.tsx");
  const nativeFullView = read("apps/mobile/components/profile/UserProfileFullView.tsx");

  for (const source of [webCanonical, nativeFullView]) {
    assert.doesNotMatch(source, /phone_number/);
    assert.doesNotMatch(source, /verified_email/);
    assert.doesNotMatch(source, /proof_selfie_url/);
  }
});
