# Deleted files restore matrix — 2026-04-14

**Deletion:** PR #399 / commit `7e7f23fb5` (15 files under `src/components/video-date/`).  
**Evidence doc:** `docs/audits/deleted-files-reverse-audit-2026-04-14.md`

| file | original purpose | current replacement | anything lost? | verdict | recommended action |
|------|-------------------|---------------------|----------------|---------|-------------------|
| `survey/MutualMatchCelebration.tsx` | Confetti celebration UI + haptics after “mutual” | `MatchSuccessModal` in `PostDateSurvey` celebration step (real profile/vibes data) | Alternate visual/haptics pattern only | safe delete | keep deleted; optional UX notes from git |
| `PostDateModal.tsx` | Standalone “Time’s up” pass/vibe modal (no API) | `survey/VerdictScreen.tsx` + `post-date-verdict` Edge | Marketing-style modal only | safe delete | keep deleted |
| `PostDateCheckpoint.tsx` | 3-step wizard (integrity → vibe sliders → verdict), **local state only**, navigate away | `PostDateSurvey` (verdict → highlights → safety) + DB + reports | **Would have lied** if shipped (no RPC persistence) | safe delete | keep deleted; do not restore without backend contract |
| `checkpoint/IntegrityAudit.tsx` | Yes/No safety toggles | `SafetyScreen` + `submitUserReportRpc` path | Toggle UX; weaker reporting | safe delete | keep deleted |
| `checkpoint/VibeMeter.tsx` | Sliders + notes in memory | `HighlightsScreen` → `date_feedback` columns | Slider UX not in DB | safe delete | keep deleted; re-spec sliders if needed |
| `checkpoint/FinalVerdict.tsx` | Pass/vibe buttons (callback only) | `VerdictScreen` + Edge | Button styling | safe delete | keep deleted |
| `checkpoint/HolographicLock.tsx` | Confetti + lock animation overlay | `MatchSuccessModal` / other celebration | Unique FX | safe but archive-worthy | keep deleted; recover from git if art direction returns |
| `VideoControls.tsx` | Mute/video/leave bar | `VideoDateControls.tsx` | Alternate glass styling | safe delete | keep deleted |
| `CompactTimer.tsx` | Small SVG countdown ring | `HandshakeTimer` / in-page timers in `VideoDate` | Compact ring design | safe delete | keep deleted |
| `VibeProgressRing.tsx` | Large gradient progress ring | Same family of timers in live page | Ring aesthetic | safe delete | keep deleted |
| `DraggablePIP.tsx` | Draggable snap PIP | `SelfViewPIP.tsx` (fixed behavior) | **Draggable** interaction never shipped | safe delete; partial idea | keep deleted; implement on `SelfViewPIP` if PM wants |
| `PartnerTeaseCard.tsx` | “Up next” teaser card | `PartnerProfileSheet` / handshake UX | Teaser layout | safe delete | keep deleted |
| `TipsCarousel.tsx` | Rotating static tips | `IceBreakerCard` / copy elsewhere | **Tip string** set | safe delete; copy may want archive | keep deleted; optional: paste tips into `docs/` |
| `AudioVisualizer.tsx` | Fake mic bars | — | Decorative only | safe delete | keep deleted |
| `SelfCheckMirror.tsx` | Self-view mock with **stock Unsplash** image | Real Daily + `SelfViewPIP` | Misleading prototype | safe delete | keep deleted |

---

## Explicit answers

1. **Did we delete any essential live feature?** **No.** Nothing in the set was on the live import graph from `App.tsx` or wired into `VideoDate` / `PostDateSurvey` at `d60626766`.

2. **Did we delete meaningful unfinished product work worth restoring?** **Meaningful as experiments / craft** (checkpoint flow, holographic lock, draggable PIP). **Not** restorable as-is without wiring to `post-date-verdict` and `date_feedback` — restoring raw files would **not** recover product value; it would risk **non-persistent** UX.

3. **Did we delete a useful rollback/fallback path?** **No runtime path** — these were never primary. **Git** remains the rollback for source.

4. **Still comfortable with every deletion?** **Yes for shipped behavior and security of user truth.** **Residual discomfort:** loss of optional **design assets** (animations, tip copy, draggable PIP spec) — recover selectively from `git show d60626766:<path>`, not wholesale restore.

---

## Doc follow-up (not file restore)

| Item | Action |
|------|--------|
| `_cursor_context/vibely-golden-snapshot_claude.md` L807 | Update “MutualMatchCelebration” → live celebration path (`MatchSuccessModal` / `PostDateSurvey`) |

---

**Comfort level:** Production stance — **keep deletions.** Design stance — **almost**, only if the team later decides to resurrect specific interactions (then re-implement against current contracts).
