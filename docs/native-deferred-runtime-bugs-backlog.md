# Native deferred runtime bugs backlog

> **Historical deferred backlog.** This file is not the active launch backlog. Use `docs/native-final-blocker-matrix.md` for current blocker ownership/status and `docs/active-doc-map.md` for the active doc chain.

Runtime and media issues explicitly deferred from Sprint R2 (native v1 feature-completeness). To be addressed in a later **hardening pass**. Do not block feature-completeness work on these.

---

## Deferred items

| Item | Description | When to address |
|------|-------------|-----------------|
| **Photo loading** | Profile/event/avatar images from Bunny CDN (`photos/` paths). Env and URL logic exist; if images still don’t load on device, debug CDN response, cache, or ATS. | Hardening pass |
| **Media loading** | Vibe/profile videos (Bunny HLS). No native HLS player for vibe video; product-deferred. Video dates use Daily (separate flow). | Hardening / v1.1 |
| **Dev-build chrome** | Expo dev client UI (reload, debug menu, gear). Expected in dev; not a bug. | N/A (dev only) |
| **Polish-only roughness** | Visual tweaks, accessibility improvements, loading-state polish that don’t block any P0 screen. | After v1 essential flows |

---

## Policy

- **Sprint R2 focus:** Close native v1 feature gaps (screens, views, buttons). Do not stop to fix image/media/runtime bugs unless they block building an essential screen.
- **After R2:** Run a dedicated hardening pass for photo loading, media, and polish.

See `docs/native-runtime-media-recovery-audit.md` for image URL root cause and env notes; `docs/native-screen-contract-map.md` for deferred screens (match celebration, public profile, vibe studio, schedule).
