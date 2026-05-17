import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const webVerification = read("src/components/verification/SimplePhotoVerification.tsx");
const webProfileStudio = read("src/pages/ProfileStudio.tsx");
const webPayloadHelper = read("src/lib/webProofSelfieUpload.ts");
const nativeVerification = read("apps/mobile/components/verification/PhotoVerificationFlow.tsx");
const nativePayloadHelper = read("apps/mobile/lib/proofSelfiePrepareUpload.ts");
const storagePolicy = read("supabase/migrations/20251229003354_00812dea-4711-4487-bc86-f845cae730ba.sql");
const verificationPolicy = read("supabase/migrations/20260507170000_photo_verification_admin_hardening.sql");
const adminReview = read("supabase/migrations/20260506103000_admin_p2_backend_authoritative_hardening.sql");

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("web proof-selfie upload mirrors native byte-upload semantics without data-url blob conversion", () => {
  assert.match(webPayloadHelper, /base64ToArrayBuffer/);
  assert.match(webPayloadHelper, /globalThis\.atob/);
  assert.match(webPayloadHelper, /bytes\[0\] !== 0xff \|\| bytes\[1\] !== 0xd8/);
  assert.match(webPayloadHelper, /contentType: "image\/jpeg"/);
  assert.match(webVerification, /prepareWebProofSelfieUploadPayload\(capturedImage\)/);
  assert.match(webVerification, /\.upload\(fileName, payload\.body, \{[\s\S]*contentType: payload\.contentType,[\s\S]*cacheControl: "3600",[\s\S]*upsert: false,[\s\S]*\}\)/);
  assert.doesNotMatch(webVerification, /fetch\(capturedImage\)[\s\S]{0,120}\.blob\(\)/);
});

test("web capture and entry gates handle slow cameras and duplicate pending state", () => {
  assert.match(webVerification, /const \[isCameraReady, setIsCameraReady\] = useState\(false\)/);
  assert.match(webVerification, /const markCameraReady = useCallback/);
  assert.match(webVerification, /setIsCameraReady\(!!video && video\.videoWidth > 0 && video\.videoHeight > 0\)/);
  assert.match(webVerification, /onLoadedMetadata=\{markCameraReady\}/);
  assert.match(webVerification, /onCanPlay=\{markCameraReady\}/);
  assert.match(webVerification, /disabled=\{!isCameraReady\}/);
  assert.match(webVerification, /Camera is still starting/);
  assert.match(webVerification, /fetchMyProfileSettings\(\)/);
  assert.doesNotMatch(webVerification, /select\("photos, photo_verified, photo_verification_expires_at"\)/);
  assert.match(webVerification, /currentStatus === "approved"/);
  assert.match(webVerification, /const profilePhoto = firstProfilePhoto\(profileData\?\.photos\)/);
  assert.match(
    webProfileStudio,
    /case "photo_verify":[\s\S]*photoVerificationStatus === "approved"[\s\S]*photoVerificationStatus === "pending"[\s\S]*setShowPhotoVerification\(true\)/,
  );
});

test("web and native store proof selfies under authenticated user-owned paths", () => {
  assert.match(webVerification, /const submissionUserId = authData\.user\?\.id/);
  assert.match(webVerification, /const fileName = `\$\{submissionUserId\}\/\$\{Date\.now\(\)\}_verification\.jpg`/);
  assert.match(webVerification, /user_id: submissionUserId/);
  assert.doesNotMatch(webVerification, /userId:/);
  assert.match(nativeVerification, /const user = auth\.user/);
  assert.match(nativeVerification, /const fileName = `\$\{user\.id\}\/\$\{Date\.now\(\)\}_verification\.jpg`/);
  assert.match(nativeVerification, /user_id: user\.id/);
  assert.match(storagePolicy, /bucket_id = 'proof-selfies'[\s\S]*auth\.uid\(\)::text = \(storage\.foldername\(name\)\)\[1\]/);
});

test("native proof-selfie flow remains on the existing Expo-normalized ArrayBuffer path", () => {
  assert.match(nativeVerification, /prepareProofSelfieUploadPayload\(selfieUri\)/);
  assert.match(nativePayloadHelper, /expo-image-manipulator/);
  assert.match(nativePayloadHelper, /FileSystem\.readAsStringAsync/);
  assert.match(nativePayloadHelper, /base64ToArrayBuffer/);
  assert.doesNotMatch(nativeVerification, /fetch\(`data:/);
});

test("photo verification remains pending-only client submission and admin-only approval", () => {
  assert.match(verificationPolicy, /CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_verifications_one_pending_per_user/);
  assert.match(verificationPolicy, /CREATE POLICY "Users can submit pending verifications"[\s\S]*auth\.uid\(\) = user_id[\s\S]*status = 'pending'/);
  assert.match(webVerification, /status: "pending"/);
  assert.match(nativeVerification, /status: 'pending'/);
  assert.doesNotMatch(stripComments(webVerification), /photo_verified\s*[:=]\s*true/);
  assert.doesNotMatch(stripComments(nativeVerification), /photo_verified\s*[:=]\s*true/);
  assert.match(adminReview, /SET photo_verified = true/);
  assert.match(adminReview, /SET photo_verified = false/);
});
