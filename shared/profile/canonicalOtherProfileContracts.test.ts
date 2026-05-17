import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const exists = (path: string) => existsSync(new URL(`../../${path}`, import.meta.url));

test("web other-user profile entry points render canonical profile content", () => {
  const userRoute = read("src/pages/UserProfile.tsx");
  const profilePreview = read("src/pages/ProfilePreview.tsx");
  const drawer = read("src/components/ProfileDetailDrawer.tsx");
  const chatHeader = read("src/components/chat/ChatHeader.tsx");
  const chat = read("src/pages/Chat.tsx");
  const matches = read("src/pages/Matches.tsx");
  const swipeRow = read("src/components/SwipeableMatchCard.tsx");
  const lobbyCard = read("src/components/lobby/LobbyProfileCard.tsx");
  const eventDetails = read("src/pages/EventDetails.tsx");
  const partnerSheet = read("src/components/video-date/PartnerProfileSheet.tsx");
  const videoDate = read("src/pages/VideoDate.tsx");

  assert.match(userRoute, /OtherUserFullProfileView/);
  assert.match(userRoute, /useOtherUserFullProfile/);
  assert.match(profilePreview, /OtherUserFullProfileView/);
  assert.match(profilePreview, /useOtherUserFullProfile/);
  assert.match(profilePreview, /useOtherUserFullProfile\(profileId\)/);
  assert.match(profilePreview, /refetch\(\)[\s\S]*result\.isError/);
  assert.match(profilePreview, /result\.data\?\.id !== profileId/);
  assert.match(profilePreview, /freshPreviewFailed \|\| !profile/);
  assert.doesNotMatch(profilePreview, /ProfilePhoto|LifestyleDetails|BottomNav|VibePlayer|resolveWebVibeVideoState/);
  assert.match(drawer, /OtherUserFullProfileView/);
  assert.match(drawer, /useOtherUserFullProfile/);
  assert.match(partnerSheet, /OtherUserFullProfileView/);
  assert.match(partnerSheet, /partnerProfileId/);
  assert.match(videoDate, /partnerProfileId=\{partnerId\}/);
  assert.match(lobbyCard, /navigate\(`\/user\/\$\{profile\.id\}`\)/);
  assert.match(eventDetails, /navigate\(`\/user\/\$\{attendee\.id\}`\)/);
  assert.match(eventDetails, /navigate\(`\/user\/\$\{profileId\}`\)/);

  assert.match(chatHeader, /ProfileDetailDrawer/);
  assert.match(chat, /ProfileDetailDrawer/);
  assert.match(matches, /ProfileDetailDrawer/);
  assert.match(swipeRow, /ProfileDetailDrawer/);
  assert.equal(exists("src/components/ProfilePreview.tsx"), false);
});

test("adaptive web media is used for hero, gallery, and fullscreen profile photos", () => {
  const media = read("src/components/profile/AdaptiveProfileMedia.tsx");
  const canonical = read("src/components/profile/OtherUserFullProfileView.tsx");
  const fullscreen = read("src/components/PhotoPreviewModal.tsx");

  assert.match(media, /object-contain/);
  assert.match(media, /object-cover/);
  assert.match(media, /h-\[clamp\(360px,62dvh,680px\)\]/);
  assert.match(media, /h-\[clamp\(260px,36dvh,420px\)\]/);
  assert.match(canonical, /variant="hero"/);
  assert.match(canonical, /variant="gallery"/);
  assert.match(canonical, /PhotoPreviewModal/);
  assert.match(canonical, /vibeVideo\.state === "failed" \|\| vibeVideo\.state === "error"/);
  assert.match(fullscreen, /object-contain/);
});

test("web profile hero controls keep reliable touch targets", () => {
  const canonical = read("src/components/profile/OtherUserFullProfileView.tsx");

  assert.match(canonical, /left-4 top-4 z-20 h-11 min-h-11 rounded-full px-3 sm:hidden/);
  assert.match(canonical, /right-4 top-4 z-20 hidden h-11 min-h-11 w-11 rounded-full sm:inline-flex/);
  assert.match(canonical, /flex h-11 min-h-11 flex-1 items-start/);
  assert.match(canonical, /block h-1\.5 w-full rounded-full transition-colors/);
});

test("web canonical profile keeps substance above the body photo gallery", () => {
  const canonical = read("src/components/profile/OtherUserFullProfileView.tsx");
  const chat = read("src/pages/Chat.tsx");

  const identityStart = canonical.indexOf("<section className=\"space-y-3\">");
  const identityEnd = canonical.indexOf("{vibeVideo.state !== \"none\"");
  assert.ok(identityStart > -1 && identityEnd > identityStart);
  const identityBlock = canonical.slice(identityStart, identityEnd);
  assert.match(identityBlock, /Verified/);
  assert.doesNotMatch(identityBlock, /Email verified|Phone verified|Photo verified/);

  const detailsIndex = canonical.indexOf("title=\"Details\"");
  const verificationIndex = canonical.indexOf("title=\"Verification Status\"");
  const photosIndex = canonical.indexOf("title=\"Photos\"");
  assert.ok(detailsIndex > -1 && verificationIndex > -1 && photosIndex > -1);
  assert.ok(detailsIndex < photosIndex);
  assert.ok(verificationIndex < photosIndex);

  assert.match(chat, /Voice note loading[\s\S]*className=\{quickActionButtonClass\}/);
  assert.match(chat, /VoiceRecorder[\s\S]*className=\{quickActionButtonClass\}/);
  assert.doesNotMatch(chat, /className=\{cn\(quickActionButtonClass, "col-span-2 justify-center text-center"\)\}/);
  assert.match(chat, /<span className="whitespace-nowrap">Schedule<\/span>/);
});

test("native chat and matches route profile actions to the canonical user route", () => {
  const nativeChat = read("apps/mobile/app/chat/[id].tsx");
  const nativeMatches = read("apps/mobile/app/(tabs)/matches/index.tsx");
  const nativeProfilePreview = read("apps/mobile/app/profile-preview.tsx");
  const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
  const nativeEventDetails = read("apps/mobile/app/(tabs)/events/[id].tsx");
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
  assert.match(nativeProfilePreview, /useUserProfile\(profileId\)/);
  assert.match(nativeProfilePreview, /UserProfileFullView/);
  assert.match(nativeProfilePreview, /isOwnProfile=\{false\}/);
  assert.match(nativeProfilePreview, /refetch\(\)[\s\S]*result\.isError/);
  assert.match(nativeProfilePreview, /result\.data\?\.id !== profileId/);
  assert.match(nativeProfilePreview, /freshPreviewFailed \|\| \(isError && !profile\) \|\| !profile/);
  assert.doesNotMatch(nativeProfilePreview, /fetchMyProfile/);
  assert.doesNotMatch(nativeProfilePreview, /profileRowToUserProfileView/);
  assert.doesNotMatch(nativeProfilePreview, /onEditProfile/);
  assert.match(nativeLobby, /router\.push\(`\/user\/\$\{profile\.id\}`\)/);
  assert.match(nativeEventDetails, /router\.push\(`\/user\/\$\{attendee\.id\}` as const\)/);
  assert.match(nativeVideoDate, /PartnerProfileSheet/);
  assert.match(nativePartnerSheet, /UserProfileFullView/);
  assert.match(nativePartnerSheet, /isOwnProfile=\{false\}/);
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
  assert.doesNotMatch(nativeFetcher, /profileRowToUserProfileView/);
  assert.doesNotMatch(nativeFetcher, /@\/lib\/profileApi/);
});

test("native full profile includes adaptive media and explicit verification status coverage", () => {
  const nativeFullView = read("apps/mobile/components/profile/UserProfileFullView.tsx");

  assert.match(nativeFullView, /AdaptiveNativeProfileMedia/);
  assert.match(nativeFullView, /resizeMode="contain"/);
  assert.match(nativeFullView, /Math\.min\(winHeight \* 0\.58, 620\)/);
  assert.match(nativeFullView, /Math\.max\(220, Math\.min\(winHeight \* 0\.4, 420\)\)/);
  assert.match(nativeFullView, /function CompactTrustPill/);
  assert.match(nativeFullView, /Verification Status/);
  const nativeDetailsIndex = nativeFullView.indexOf(">Details<");
  const nativeVerificationIndex = nativeFullView.indexOf(">Verification Status<");
  const nativePhotosIndex = nativeFullView.indexOf(">Photos<");
  assert.ok(nativeDetailsIndex > -1 && nativeVerificationIndex > -1 && nativePhotosIndex > -1);
  assert.ok(nativeDetailsIndex < nativePhotosIndex);
  assert.ok(nativeVerificationIndex < nativePhotosIndex);
  assert.match(nativeFullView, /isOwnProfile[\s\S]*Birthday/);
  assert.match(nativeFullView, /Zodiac/);
  assert.doesNotMatch(nativeFullView, /ABOUT_ME_MIN_CHARS/);
});

test("profile RPC includes new safe fields and does not return private profile data", () => {
  const migration = read("supabase/migrations/20260512023000_canonical_other_profile_safe_fields.sql");
  const selectBlock = migration.slice(migration.indexOf("SELECT\n    p.id"), migration.indexOf("INTO v_profile"));
  const returnBlock = migration.slice(migration.indexOf("RETURN jsonb_build_object"), migration.indexOf(");\nEND;", migration.indexOf("RETURN jsonb_build_object")));

  for (const safeField of ["p.updated_at", "p.birth_date", "p.company", "p.email_verified", "p.phone_verified"]) {
    assert.match(selectBlock, new RegExp(safeField.replace(".", "\\.")));
  }
  assert.match(migration, /jsonb_build_object\([\s\S]*'id', vt\.id[\s\S]*'emoji', vt\.emoji[\s\S]*'category', vt\.category/);
  for (const safeKey of ["'updated_at'", "'zodiac'", "'company'", "'email_verified'", "'phone_verified'", "'vibe_tags'"]) {
    assert.match(returnBlock, new RegExp(safeKey));
  }
  assert.doesNotMatch(returnBlock, /'birth_date'/);

  for (const privateField of ["phone_number", "verified_email", "proof_selfie_url", "location_data"]) {
    assert.doesNotMatch(selectBlock, new RegExp(privateField));
    assert.doesNotMatch(returnBlock, new RegExp(privateField));
  }
});

test("profile privacy hardening keeps subscription tier on canonical display reads only", () => {
  const migration = read("supabase/migrations/20260517123000_profile_direct_select_self_only.sql");
  const functionStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.get_profile_for_viewer");
  const selectBlock = migration.slice(
    migration.indexOf("SELECT\n    p.id", functionStart),
    migration.indexOf("INTO v_profile", functionStart),
  );
  const returnBlock = migration.slice(
    migration.indexOf("RETURN jsonb_build_object", functionStart),
    migration.indexOf(");\nEND;", migration.indexOf("RETURN jsonb_build_object", functionStart)),
  );
  const webFetcher = read("src/services/fetchUserProfile.ts");
  const nativeFetcher = read("apps/mobile/lib/fetchUserProfile.ts");

  assert.match(selectBlock, /p\.subscription_tier/);
  assert.match(returnBlock, /'subscription_tier', v_profile\.subscription_tier/);
  assert.match(webFetcher, /row\.subscription_tier/);
  assert.match(nativeFetcher, /row\.subscription_tier/);
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
