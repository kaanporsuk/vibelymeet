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
  assert.match(profilePreview, /const previewProfile = profile\?\.id === profileId \? profile : null/);
  assert.match(profilePreview, /\(isLoading && !previewProfile\) \|\| \(!hasFreshPreview && !previewProfile\)/);
  assert.match(profilePreview, /if \(!previewProfile\)/);
  assert.match(profilePreview, /profile=\{previewProfile\}/);
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
  assert.match(media, /type ImageLoadState/);
  assert.match(media, /loadState\.src === resolvedSrc && loadState\.status === "loaded"/);
  assert.match(media, /loadState\.src === resolvedSrc && loadState\.status === "failed"/);
  assert.match(media, /foregroundRef/);
  assert.match(media, /\(img\.currentSrc \|\| img\.src\) === resolvedSrc/);
  assert.match(media, /img\.complete && img\.naturalWidth > 0/);
  assert.match(media, /fetchPriority=\{variant === "hero" \? "high" : "auto"\}/);
  assert.doesNotMatch(media, /setLoaded\(false\)|setFailed\(false\)/);
  assert.doesNotMatch(media, /loadedSrc|failedSrc/);
  const backgroundStart = media.indexOf('key={`background-${resolvedSrc}`}');
  const foregroundStart = media.indexOf('key={`foreground-${resolvedSrc}`}');
  assert.ok(backgroundStart > -1 && foregroundStart > backgroundStart);
  const backgroundBlock = media.slice(backgroundStart, foregroundStart);
  assert.doesNotMatch(backgroundBlock, /setLoadState|onError/);
  assert.match(canonical, /variant="hero"/);
  assert.match(canonical, /variant="gallery"/);
  assert.match(canonical, /PhotoPreviewModal/);
  assert.match(canonical, /effectiveVibeVideoState === "failed" \|\| effectiveVibeVideoState === "error"/);
  assert.match(fullscreen, /object-contain/);
});

test("profile photo viewers are guarded against native and web self-reopen traps", () => {
  const canonical = read("src/components/profile/OtherUserFullProfileView.tsx");
  const fullscreen = read("src/components/PhotoPreviewModal.tsx");
  const nativeFullView = read("apps/mobile/components/profile/UserProfileFullView.tsx");
  const webPreview = read("src/pages/ProfilePreview.tsx");
  const nativePreview = read("apps/mobile/app/profile-preview.tsx");
  const nativeProfileStudio = read("apps/mobile/app/(tabs)/profile/ProfileStudio.tsx");

  assert.match(canonical, /PHOTO_PREVIEW_OPEN_GUARD_MS/);
  assert.match(canonical, /PHOTO_PREVIEW_CLOSE_GUARD_MS/);
  assert.match(canonical, /photoPreviewOpenBlockedUntilRef/);
  assert.match(canonical, /enableInlineHeroPhotoPaging\?: boolean/);
  assert.match(canonical, /enableInlineHeroPhotoPaging = true/);
  assert.match(canonical, /const inlineHeroPhotoPagingEnabled = enableInlineHeroPhotoPaging && photos\.length > 1/);
  assert.match(canonical, /const openHeroPhotoPreview = useCallback/);
  assert.match(canonical, /heroSwipeSuppressClickUntilRef/);
  assert.match(canonical, /heroTouchSwipeStartRef/);
  assert.match(canonical, /const commitHeroPhotoSwipe = useCallback/);
  assert.match(canonical, /const handleHeroPointerDown = useCallback/);
  assert.match(canonical, /const handleHeroPointerUp = useCallback/);
  assert.match(canonical, /event\.pointerType === "touch"/);
  assert.match(canonical, /const handleHeroTouchStart = useCallback/);
  assert.match(canonical, /const handleHeroTouchMove = useCallback/);
  assert.match(canonical, /const handleHeroTouchEnd = useCallback/);
  assert.match(canonical, /HERO_PHOTO_SWIPE_MIN_DISTANCE_PX/);
  assert.match(canonical, /touchAction: "pan-y"/);
  assert.match(canonical, /data-vaul-no-drag=\{inlineHeroPhotoPagingEnabled \? "" : undefined\}/);
  assert.match(canonical, /\[data-profile-hero-control\]/);
  assert.match(canonical, /const openPhotoPreview = useCallback/);
  assert.match(canonical, /Date\.now\(\) < photoPreviewOpenBlockedUntilRef\.current/);
  assert.match(canonical, /if \(!Number\.isInteger\(index\) \|\| index < 0 \|\| index >= photos\.length\) return/);
  assert.match(canonical, /onClick=\{openHeroPhotoPreview\}/);
  assert.match(canonical, /onTouchStart=\{handleHeroTouchStart\}/);
  assert.match(canonical, /onTouchCancel=\{handleHeroTouchCancel\}/);
  assert.match(canonical, /onTouchMove=\{handleHeroTouchMove\}/);
  assert.match(canonical, /onTouchEnd=\{handleHeroTouchEnd\}/);
  assert.match(canonical, /onClick=\{\(\) => openPhotoPreview\(index\)\}/);
  assert.doesNotMatch(canonical, /onClick=\{\(\) => setPhotoPreviewIndex/);

  assert.match(fullscreen, /safeInitialIndex/);
  assert.match(fullscreen, /const handleClose = useCallback/);
  assert.match(fullscreen, /event\.stopPropagation\(\);[\s\S]*handleClose\(\);/);
  assert.match(fullscreen, /if \(photos\.length === 0\)[\s\S]*handleClose\(\);/);
  assert.match(fullscreen, /current\.src === resolvedCurrentPhoto \? current : \{ src: resolvedCurrentPhoto, status: "loading" \}/);
  assert.match(fullscreen, /resolvedCurrentPhotoRef\.current === resolvedCurrentPhoto/);
  assert.match(fullscreen, /ImageOff/);
  assert.match(fullscreen, /Loader2/);
  assert.match(fullscreen, /role="dialog"/);
  assert.match(fullscreen, /aria-modal="true"/);
  assert.match(fullscreen, /tabIndex=\{-1\}/);
  assert.match(fullscreen, /previousFocusRef\.current\?\.focus\(\{ preventScroll: true \}\)/);

  assert.match(nativeFullView, /PHOTO_VIEWER_OPEN_GUARD_MS/);
  assert.match(nativeFullView, /PHOTO_VIEWER_CLOSE_GUARD_MS/);
  assert.match(nativeFullView, /PHOTO_VIEWER_TOUCH_INTENT_MS/);
  assert.match(nativeFullView, /enableInlineHeroPhotoPaging\?: boolean/);
  assert.match(nativeFullView, /enableInlineHeroPhotoPaging = false/);
  assert.match(nativeFullView, /const inlineHeroPhotoPagingEnabled = enableInlineHeroPhotoPaging && photos\.length > 1/);
  assert.match(nativeFullView, /const heroPagerRef = useRef<FlatList<string>>\(null\)/);
  assert.match(nativeFullView, /photoViewerOpenBlockedUntilRef/);
  assert.match(nativeFullView, /photoViewerTouchIntentRef/);
  assert.match(nativeFullView, /const registerPhotoViewerTouchIntent = useCallback/);
  const nativeTouchIntentStart = nativeFullView.indexOf("const registerPhotoViewerTouchIntent = useCallback");
  const nativeTouchIntentEnd = nativeFullView.indexOf("const openPhotoViewer = useCallback", nativeTouchIntentStart);
  assert.ok(nativeTouchIntentStart > -1 && nativeTouchIntentEnd > nativeTouchIntentStart);
  const nativeTouchIntentBlock = nativeFullView.slice(nativeTouchIntentStart, nativeTouchIntentEnd);
  assert.match(nativeTouchIntentBlock, /now < photoViewerOpenBlockedUntilRef\.current/);
  assert.match(nativeFullView, /const openPhotoViewer = useCallback/);
  assert.match(nativeFullView, /source: 'touch' \| 'accessibility' = 'touch'/);
  assert.match(nativeFullView, /intent\.index !== index \|\| intent\.expiresAt < now/);
  assert.match(nativeFullView, /now < photoViewerOpenBlockedUntilRef\.current/);
  assert.match(nativeFullView, /if \(!Number\.isInteger\(index\) \|\| index < 0 \|\| index >= photos\.length\) return/);
  assert.match(nativeFullView, /const prefetchProfilePhoto = useCallback/);
  assert.match(nativeFullView, /const placeholderUrl = getImageUrl\(photos\[index\], \{ width: 420, quality: 60 \}\)/);
  assert.match(nativeFullView, /const fullUrl = getImageUrl\(photos\[index\], \{ width: 1200, quality: 88 \}\)/);
  assert.match(nativeFullView, /ExpoImage\.prefetch\(urls, \{ cachePolicy: 'memory-disk' \}\)/);
  assert.match(nativeFullView, /presentationStyle="fullScreen"/);
  assert.match(nativeFullView, /const photoViewerVisible = photoViewerIndex !== null && photos\.length > 0/);
  assert.match(nativeFullView, /Math\.min\(Math\.max\(0, photoViewerIndex\), photos\.length - 1\)/);
  assert.match(nativeFullView, /\{photoViewerVisible \? \(/);
  assert.match(nativeFullView, /<FlatList/);
  assert.match(nativeFullView, /initialScrollIndex=\{activePhotoViewerIndex\}/);
  assert.match(nativeFullView, /initialNumToRender=\{1\}/);
  assert.match(nativeFullView, /getItemLayout=\{\(_, index\) => \(\{/);
  assert.match(nativeFullView, /const handleHeroPhotoScrollBeginDrag = useCallback/);
  assert.match(nativeFullView, /const handleHeroPhotoMomentumEnd = useCallback/);
  assert.match(nativeFullView, /const handleHeroPhotoScrollEndDrag = handleHeroPhotoMomentumEnd/);
  assert.match(nativeFullView, /heroPagerRef\.current\?\.scrollToIndex/);
  assert.match(nativeFullView, /setHeroPhotoIndex\(idx\)/);
  assert.match(nativeFullView, /const renderHeroPhotoItem = useCallback/);
  assert.match(nativeFullView, /inlineHeroPhotoPagingEnabled \? \(/);
  assert.match(nativeFullView, /horizontal[\s\S]{0,80}pagingEnabled/);
  assert.match(nativeFullView, /nestedScrollEnabled[\s\S]{0,80}directionalLockEnabled/);
  assert.match(nativeFullView, /onScrollBeginDrag=\{handleHeroPhotoScrollBeginDrag\}/);
  assert.match(nativeFullView, /onScrollEndDrag=\{handleHeroPhotoScrollEndDrag\}/);
  assert.match(nativeFullView, /onMomentumScrollEnd=\{handleHeroPhotoMomentumEnd\}/);
  assert.match(nativeFullView, /onScrollToIndexFailed=\{\(info\) =>/);
  assert.match(nativeFullView, /onPressIn=\{\(\) => registerPhotoViewerTouchIntent\(activeHeroPhotoIndex\)\}/);
  assert.match(nativeFullView, /onAccessibilityActivate=\{\(\) => openPhotoViewer\(activeHeroPhotoIndex, 'accessibility'\)\}/);
  assert.doesNotMatch(nativeFullView, /ModalProfilePhotoImage/);
  assert.match(nativeFullView, /NOOP_ZOOM_CHANGE/);
  assert.match(nativeFullView, /onZoomChange=\{isActive \? setPhotoViewerZoomed : NOOP_ZOOM_CHANGE\}/);
  assert.match(nativeFullView, /failedUri === resolvedUri/);
  assert.match(nativeFullView, /failedUri === uri/);
  assert.match(nativeFullView, /accessibilityViewIsModal/);
  assert.doesNotMatch(nativeFullView, /contentOffset=\{\{ x: activePhotoViewerIndex \* winWidth, y: 0 \}\}/);
  const nativePhotoModalStart = nativeFullView.indexOf("<Modal\n          visible");
  assert.ok(nativePhotoModalStart > -1);
  const nativePhotoModalOpenTag = nativeFullView.slice(
    nativePhotoModalStart,
    nativeFullView.indexOf(">", nativePhotoModalStart),
  );
  assert.doesNotMatch(nativePhotoModalOpenTag, /\btransparent\b/);

  assert.match(webPreview, /refetchRequestIdRef/);
  assert.match(webPreview, /refetchRequestIdRef\.current !== requestId/);
  assert.match(webPreview, /const previewProfile = profile\?\.id === profileId \? profile : null/);
  assert.match(webPreview, /\(isLoading && !previewProfile\) \|\| \(!hasFreshPreview && !previewProfile\)/);
  assert.match(webPreview, /if \(!previewProfile\)/);
  assert.match(webPreview, /profile=\{previewProfile\}/);
  assert.match(nativePreview, /refetchRequestIdRef/);
  assert.match(nativePreview, /refetchRequestIdRef\.current !== requestId/);
  assert.match(nativePreview, /const previewProfile = profile\?\.id === profileId \? profile : null/);
  assert.match(nativePreview, /\(isPending && !previewProfile\) \|\| \(!hasFreshPreview && !previewProfile\)/);
  assert.match(nativePreview, /if \(!previewProfile\)/);
  assert.match(nativePreview, /profile=\{previewProfile\}/);
  assert.match(nativePreview, /enableInlineHeroPhotoPaging/);

  assert.match(nativeProfileStudio, /PROFILE_PREVIEW_PUSH_GUARD_MS/);
  assert.match(nativeProfileStudio, /profilePreviewPushBlockedUntilRef/);
  assert.match(nativeProfileStudio, /const openProfilePreview = useCallback/);
  assert.match(nativeProfileStudio, /setPhotoViewerIndex\(null\)/);
  assert.match(nativeProfileStudio, /setShowPhotoDrawer\(false\)/);
  assert.match(nativeProfileStudio, /setPhotoDrawerLaunchAction\(null\)/);
  assert.match(nativeProfileStudio, /setPhotoSourceMenu\(\{ open: false, anchor: null \}\)/);
  assert.match(nativeProfileStudio, /onPress=\{openProfilePreview\}/);
  assert.match(nativeProfileStudio, /const openProfileStudioPhotoViewer = useCallback/);
  assert.match(nativeProfileStudio, /openProfileStudioPhotoViewer\(index\)/);
  assert.doesNotMatch(nativeProfileStudio, /onPress=\{\(\) => [^}]*\/profile-preview/);
  assert.doesNotMatch(nativeProfileStudio, /\? \(\) => setPhotoViewerIndex\(index\)/);
});

test("web profile hero controls keep reliable touch targets", () => {
  const canonical = read("src/components/profile/OtherUserFullProfileView.tsx");

  assert.match(canonical, /left-4 top-4 z-20 h-11 min-h-11 rounded-full px-3 sm:hidden/);
  assert.match(canonical, /right-4 top-4 z-20 hidden h-11 min-h-11 w-11 rounded-full sm:inline-flex/);
  assert.match(canonical, /flex h-11 min-h-11 flex-1 items-start/);
  assert.match(canonical, /block h-1\.5 w-full rounded-full transition-colors/);
  assert.match(canonical, /data-profile-hero-control="true"/);
});

test("web canonical profile keeps substance above the body photo gallery", () => {
  const canonical = read("src/components/profile/OtherUserFullProfileView.tsx");
  const chat = read("src/pages/Chat.tsx");

  const identityStart = canonical.indexOf("<section className=\"space-y-3\">");
  const identityEnd = canonical.indexOf("{effectiveVibeVideoState !== \"none\"");
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
  assert.match(chat, /<span className="truncate">Schedule<\/span>/);
});

test("native chat and matches route profile actions to the canonical user route", () => {
  const nativeChat = read("apps/mobile/app/chat/[id].tsx");
  const nativeMatches = read("apps/mobile/app/(tabs)/matches/index.tsx");
  const nativeProfilePreview = read("apps/mobile/app/profile-preview.tsx");
  const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
  const nativeEventDetails = read("apps/mobile/app/(tabs)/events/[id].tsx");
  const nativeVideoDate = read("apps/mobile/app/date/[id].tsx");
  const nativePartnerSheet = read("apps/mobile/components/video-date/PartnerProfileSheet.tsx");
  const nativeUserProfile = read("apps/mobile/app/user/[userId].tsx");

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
  assert.match(nativeProfilePreview, /const previewProfile = profile\?\.id === profileId \? profile : null/);
  assert.match(nativeProfilePreview, /\(isPending && !previewProfile\) \|\| \(!hasFreshPreview && !previewProfile\)/);
  assert.match(nativeProfilePreview, /if \(!previewProfile\)/);
  assert.match(nativeProfilePreview, /profile=\{previewProfile\}/);
  assert.doesNotMatch(nativeProfilePreview, /fetchMyProfile/);
  assert.doesNotMatch(nativeProfilePreview, /profileRowToUserProfileView/);
  assert.doesNotMatch(nativeProfilePreview, /onEditProfile/);
  assert.match(nativeProfilePreview, /<UserProfileFullView[\s\S]*enableInlineHeroPhotoPaging[\s\S]*\/>/);
  assert.match(nativeLobby, /router\.push\(`\/user\/\$\{profile\.id\}`\)/);
  assert.match(nativeEventDetails, /router\.push\(`\/user\/\$\{attendee\.id\}` as const\)/);
  assert.match(nativeVideoDate, /PartnerProfileSheet/);
  assert.match(nativePartnerSheet, /UserProfileFullView/);
  assert.match(nativePartnerSheet, /isOwnProfile=\{false\}/);
  assert.doesNotMatch(nativePartnerSheet, /ProfileDetailSheet/);
  assert.match(nativeUserProfile, /<UserProfileFullView[\s\S]*enableInlineHeroPhotoPaging[\s\S]*\/>/);
  assert.match(nativePartnerSheet, /<UserProfileFullView[\s\S]*enableInlineHeroPhotoPaging[\s\S]*\/>/);
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
  assert.match(nativeFullView, /Image as ExpoImage/);
  assert.match(nativeFullView, /contentFit="cover"/);
  assert.match(nativeFullView, /contentFit="contain"/);
  assert.match(nativeFullView, /cachePolicy="memory-disk"/);
  assert.match(nativeFullView, /recyclingKey=\{resolvedUri\}/);
  assert.match(nativeFullView, /recyclingKey=\{uri\}/);
  assert.match(nativeFullView, /placeholderContentFit="contain"/);
  assert.match(nativeFullView, /transition=\{0\}/);
  assert.match(nativeFullView, /failedUri === resolvedUri/);
  assert.match(nativeFullView, /failedUri === uri/);
  assert.doesNotMatch(nativeFullView, /resizeMode="contain"/);
  assert.doesNotMatch(nativeFullView, /type NativeImageLoadState/);
  assert.doesNotMatch(nativeFullView, /imageLoadState/);
  assert.doesNotMatch(nativeFullView, /adaptiveLoadingState/);
  const nativeBackgroundStart = nativeFullView.indexOf('recyclingKey={resolvedUri}');
  const nativeForegroundStart = nativeFullView.indexOf('style={s.adaptiveForeground}');
  assert.ok(nativeBackgroundStart > -1 && nativeForegroundStart > nativeBackgroundStart);
  const nativeBackgroundBlock = nativeFullView.slice(nativeBackgroundStart, nativeForegroundStart);
  assert.doesNotMatch(nativeBackgroundBlock, /setFailedUri|onError/);
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
