# Native preserve-first reconciliation plan

Generated on the `feat/native-preserve-reconciliation` branch after committing the auth-shell cleanup slice. **No code has been discarded.** This document classifies every remaining dirty file and recommends commit groupings so all prior work is preserved.

---

## 1. Already committed (this session)

| Commit | Files | Description |
|--------|--------|-------------|
| **Auth-shell (R6)** | `app/_layout.tsx`, `app/(auth)/_layout.tsx`, `app/(auth)/sign-in.tsx`, `app/(auth)/sign-up.tsx`, `app/(auth)/reset-password.tsx` | Auth shell cleanup; no "(auth)" or duplicate headers; safe area + theme on auth screens. |

---

## 2. Remaining modified files (full list)

| File | Type | Earlier work / slice |
|------|------|----------------------|
| `apps/mobile/.env.example` | Config | R5 provider/runtime — optional `EXPO_PUBLIC_BUNNY_CDN_PATH_PREFIX` doc |
| `apps/mobile/.gitignore` | Config | Disk/build cleanup — `.tmp-build/` entry |
| `apps/mobile/app/(tabs)/events/index.tsx` | Code | R3 photo trace — `eventCoverUrl(event.image, 'event_image')` |
| `apps/mobile/app/(tabs)/profile/index.tsx` | Code | R3 photo trace — `avatarUrl(photoUrl, 'profile_photo')` |
| `apps/mobile/lib/chatApi.ts` | Code | R3 photo trace — `avatarUrl(photo, 'avatar')` |
| `apps/mobile/lib/imageUrl.ts` | Code | R3 trace + R5 path prefix — path prefix, trace labels, __DEV__ warn |
| `src/utils/imageUrl.ts` | Code | R5 web sync — `VITE_BUNNY_CDN_PATH_PREFIX` and path construction |
| `apps/mobile/assets/images/android-icon-background.png` | Asset | Binary — size change (likely higher-res or re-export) |
| `apps/mobile/assets/images/android-icon-foreground.png` | Asset | Binary — size change |
| `apps/mobile/assets/images/android-icon-monochrome.png` | Asset | Binary — size change |
| `apps/mobile/assets/images/favicon.png` | Asset | Binary — size change |
| `apps/mobile/assets/images/icon.png` | Asset | Binary — size change |
| `apps/mobile/assets/images/splash-icon.png` | Asset | Binary — size change |

---

## 3. Preserve-first classification

| File | Classification | Notes |
|------|----------------|--------|
| `apps/mobile/.env.example` | **B — follow-up commit** | Functional config doc for path prefix; belongs with imageUrl work. |
| `apps/mobile/.gitignore` | **B — follow-up commit** | Useful for local builds; low-risk. |
| `apps/mobile/app/(tabs)/events/index.tsx` | **B — follow-up commit** | Trace label only; part of R3 photo diagnostics. |
| `apps/mobile/app/(tabs)/profile/index.tsx` | **B — follow-up commit** | Trace label only; part of R3 photo diagnostics. |
| `apps/mobile/lib/chatApi.ts` | **B — follow-up commit** | Trace label only; part of R3 photo diagnostics. |
| `apps/mobile/lib/imageUrl.ts` | **B — follow-up commit** | Core: path prefix, trace, __DEV__ warn. Do not drop. |
| `src/utils/imageUrl.ts` | **B — follow-up commit** | Web parity for path prefix. Do not drop. |
| `apps/mobile/assets/images/*` (6 files) | **B — follow-up commit (after confirmation)** | Binary changes; assume intentional. Confirm they are the desired icon/splash set before committing. |

**No file is classified as C (revert/approval)** — nothing is discarded. Asset commits are recommended only after you confirm the new image files are intended.

---

## 4. Recommended commit grouping (preserves everything)

Apply in order on `feat/native-preserve-reconciliation` (or a child branch):

1. **Runtime/image URL (R3 + R5)**  
   - `apps/mobile/lib/imageUrl.ts`  
   - `src/utils/imageUrl.ts`  
   - `apps/mobile/.env.example`  
   - `apps/mobile/app/(tabs)/events/index.tsx`  
   - `apps/mobile/app/(tabs)/profile/index.tsx`  
   - `apps/mobile/lib/chatApi.ts`  
   - Message: `fix(native): image URL path prefix, trace labels, env example (R3/R5 preserve)`

2. **Build/config**  
   - `apps/mobile/.gitignore`  
   - Message: `chore(mobile): ignore .tmp-build for local builds`

3. **Assets (after you confirm)**  
   - All 6 files under `apps/mobile/assets/images/`  
   - Message: `chore(mobile): update app icon and splash assets` (or your preferred message)

Optional: combine (1) and (2) into a single “native runtime + config preserve” commit if you prefer fewer commits.

---

## 5. What each slice does (no code lost)

- **R3 photo trace**: `PhotoTraceLabel` and `traceLabel` on `getImageUrl` / `avatarUrl` / `eventCoverUrl`; __DEV__-only log of first URL per label. Call sites in events index, profile index, chatApi pass the labels.
- **R5 path prefix**: `EXPO_PUBLIC_BUNNY_CDN_PATH_PREFIX` (mobile) and `VITE_BUNNY_CDN_PATH_PREFIX` (web); URL built as `host/prefix/path` when prefix is set; .env.example documents the key.
- **.gitignore**: `.tmp-build/` to avoid Xcode/Metro temp dir issues.
- **Assets**: Updated icon/splash binaries; keep if they are the intended branding set.

---

## 6. New file (this pass)

| File | Action |
|------|--------|
| `docs/native-preserve-reconciliation-plan.md` | This plan; add to a follow-up commit (e.g. with the runtime preserve commit or a small `docs(native): add preserve-reconciliation plan` commit). |

---

## 7. Manual step

- **Confirm** whether the 6 modified image assets under `apps/mobile/assets/images/` are the correct icon/splash set for the app. If yes, commit them with the grouping above. If not, replace with the correct assets and then commit.
