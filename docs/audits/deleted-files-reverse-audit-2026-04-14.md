# Reverse audit: files deleted in cleanup pass (PR #399 / commit `7e7f23fb5`)

**Baseline commit (last tree before deletion):** `d60626766`  
**Deletion commit:** `7e7f23fb5` (squash merge of audit closure)  
**Method:** `git show d60626766:<path>` for full source; `git grep <symbol> d60626766 -- '*.tsx' '*.ts'` for reachability; doc grep; adversarial read of whether live flows depended on these files.

**Global finding:** None of the 15 files were imported from `src/pages/VideoDate.tsx`, `PostDateSurvey.tsx`, or any file outside `src/components/video-date/` at `d60626766`. The static import graph was already disconnected from `App.tsx` before deletion (see prior surface audit). **No production route or live parent component mounted them.**

---

## 1. `src/components/video-date/survey/MutualMatchCelebration.tsx`

1. **Path:** `src/components/video-date/survey/MutualMatchCelebration.tsx`
2. **What it did:** Full-screen **mutual-match celebration** UI: Framer Motion entrance, `ParticleBurst` confetti (🎉💚✨), pulsing partner avatar, heart badge, copy (“It’s a Vibe!”, “Chat is now unlocked”), primary CTA `onContinue`, `haptics.celebration()` on mount.
3. **Reachable?** **No** — `git grep MutualMatchCelebration d60626766 -- '*.tsx'` only matched this file. Never imported by `PostDateSurvey` (live survey uses `MatchSuccessModal` for `step === "celebration"`).
4. **Dependencies:** `framer-motion`, `lucide-react`, `@/components/chat/ParticleBurst`, `@/lib/haptics`. No Supabase/RPC.
5. **Feature overlap:** **`src/components/match/MatchSuccessModal.tsx`** + celebration step inside `PostDateSurvey.tsx` (loads partner age + shared vibes from DB). **Replacement is fuller** (real data wiring).
6. **Product value:** Polished **alternate** celebration skin + haptics; **not** wired to verdict pipeline. **Ideas worth keeping:** particle density / copy variants — optional doc or future A/B only.
7. **Deletion safety:** **Safe delete** for live product — duplicate surface, zero integration.
8. **Why:** Evidence: zero importers; live flow already uses `MatchSuccessModal`.
9. **Action:** **Keep deleted.** Optionally mine UX notes into a design doc if product wants a second celebration variant later.

---

## 2. `src/components/video-date/PostDateModal.tsx`

1. **Path:** `src/components/video-date/PostDateModal.tsx`
2. **What it did:** **Standalone modal** “Time’s Up! ⏱️” with Pass / “Let’s Connect” vibe buttons, glass backdrop, confetti on vibe, `navigator.vibrate`, delayed `onPass` / `onVibe` callbacks — **presentation-only** (no `session_id`, no Edge invoke).
3. **Reachable?** **No** — no imports outside self (`git grep PostDateModal d60626766`).
4. **Dependencies:** `framer-motion`, `ParticleBurst`, local state. No backend.
5. **Feature overlap:** **`survey/VerdictScreen.tsx`** inside `PostDateSurvey` is the real verdict UI, backed by **`post-date-verdict`** Edge + analytics. **Full replacement** for *function*; modal was a parallel mock.
6. **Product value:** Rich marketing-style UX; **unfinished** in the sense it never called production APIs.
7. **Deletion safety:** **Safe delete.**
8. **Why:** Dead code; live verdict path is `VerdictScreen` + Edge.
9. **Action:** **Keep deleted.**

---

## 3. `src/components/video-date/PostDateCheckpoint.tsx`

1. **Path:** `src/components/video-date/PostDateCheckpoint.tsx`
2. **What it did:** **Three-step wizard** (“Safety” / “Chemistry” / “Decision”): `IntegrityAudit` (camera/profile/safe toggles) → `VibeMeter` (sliders + secret notes) → `FinalVerdict` (pass/vibe). Exported `CheckpointData` type. On unsafe integrity: toast + `navigate("/dashboard")`. On vibe: toast “Vibe Logged…” + `navigate("/dashboard")` — **no** `post-date-verdict`, **no** `date_feedback` insert/update, **no** `submit_user_report`.
3. **Reachable?** **No** — not imported by `VideoDate` or `PostDateSurvey` at `d60626766`.
4. **Dependencies:** `./checkpoint/*`, `react-router-dom`, `sonner`. **No** shared RPC contracts — **intentionally isolated experiment.**
5. **Feature overlap:** Current **`PostDateSurvey`** covers verdict + highlights + safety with **server persistence**. Checkpoint’s “integrity” and “vibe meter” **do not map** to DB columns used by production feedback (different model).
6. **Product value:** **Unique UX** (stepper, neon glass, `HolographicLock` success). **Unfinished / misleading** if shipped: users would think feedback was recorded when it was only local state + navigation.
7. **Deletion safety:** **Safe delete** for production truth; **archive-worthy** as a **design prototype** (not a rollback of live behavior — live never used it).
8. **Why:** No parent import; live path is strictly `PostDateSurvey` + Edge.
9. **Action:** **Keep deleted.** If product revives “checkpoint” concept, re-spec against `date_feedback` schema and `post-date-verdict` — do not restore this file verbatim.

---

## 4. `src/components/video-date/checkpoint/IntegrityAudit.tsx`

1. **Path:** `src/components/video-date/checkpoint/IntegrityAudit.tsx`
2. **What it did:** Step 1 UI: three Yes/No toggles (`cameraVisible`, `matchedProfile`, `feltSafe`) with motion; `onComplete(false)` if unsafe → parent toast + redirect (no formal report RPC).
3. **Reachable?** Only via `PostDateCheckpoint` (which was itself dead).
4. **Dependencies:** `CheckpointData` from `PostDateCheckpoint`, `@/components/ui/button`.
5. **Feature overlap:** **`survey/SafetyScreen.tsx`** + reporting in `PostDateSurvey` — **strictly superior** for production (uses `submitUserReportRpc` path when needed).
6. **Product value:** Nice toggle UX; **weaker** than live safety flow (no backend report on “unsafe”).
7. **Deletion safety:** **Safe delete.**
8. **Why:** Subtree of dead checkpoint.
9. **Action:** **Keep deleted.**

---

## 5. `src/components/video-date/checkpoint/VibeMeter.tsx`

1. **Path:** `src/components/video-date/checkpoint/VibeMeter.tsx`
2. **What it did:** Step 2: gradient sliders for “conversation flow” / curiosity, `Textarea` for secret notes, wired to `CheckpointData` in memory only.
3. **Reachable?** Only `PostDateCheckpoint`.
4. **Dependencies:** `Slider`, `Textarea`, `CheckpointData`.
5. **Feature overlap:** **`survey/HighlightsScreen.tsx`** persists tags + energy + flow strings to **`date_feedback`** via Supabase `.update`. **Replacement is real persistence**; checkpoint sliders did not write DB.
6. **Product value:** Slider UX could inspire highlights; **data not ported** to schema.
7. **Deletion safety:** **Safe delete.**
8. **Why:** Never connected to `date_feedback`.
9. **Action:** **Keep deleted**; if sliders wanted, re-implement against existing columns.

---

## 6. `src/components/video-date/checkpoint/FinalVerdict.tsx`

1. **Path:** `src/components/video-date/checkpoint/FinalVerdict.tsx`
2. **What it did:** Step 3: “The Final Vibe Check” copy, pass vs “It’s a Vibe Fit” buttons calling `onVerdict("pass"|"vibe")` only — parent handled toast/navigation **without** backend.
3. **Reachable?** Only `PostDateCheckpoint`.
4. **Dependencies:** None beyond framer + icons.
5. **Feature overlap:** **`VerdictScreen`** + `handleVerdict` → **`post-date-verdict`** Edge. **Production replacement complete.**
6. **Product value:** Flashy button styling; **no** mutual match logic.
7. **Deletion safety:** **Safe delete.**
8. **Why:** Demo verdict only.
9. **Action:** **Keep deleted.**

---

## 7. `src/components/video-date/checkpoint/HolographicLock.tsx`

1. **Path:** `src/components/video-date/checkpoint/HolographicLock.tsx`
2. **What it did:** Full-screen phased animation (slam / glow / burst) + **canvas-confetti** burst + lock icon; celebratory overlay after checkpoint “vibe” choice.
3. **Reachable?** Only `PostDateCheckpoint`.
4. **Dependencies:** `canvas-confetti` (still in app for other uses).
5. **Feature overlap:** None in live path — `MatchSuccessModal` + Framer for mutual celebration.
6. **Product value:** **Unique** high-drama FX; **not** tied to real match creation.
7. **Deletion safety:** **Safe delete** for live; **archive-worthy** as visual reference.
8. **Why:** Part of dead checkpoint subtree.
9. **Action:** **Keep deleted**; extract idea to design doc only if product asks.

---

## 8. `src/components/video-date/VideoControls.tsx`

1. **Path:** `src/components/video-date/VideoControls.tsx`
2. **What it did:** Glass **control bar**: mute, video toggle, leave — `Button` + Framer.
3. **Reachable?** **No** external imports at `d60626766`.
4. **Dependencies:** `@/components/ui/button`.
5. **Feature overlap:** **`VideoDateControls.tsx`** is the live control surface on `VideoDate.tsx`. **Full replacement.**
6. **Product value:** Alternate styling; no unique RPC behavior.
7. **Deletion safety:** **Safe delete.**
8. **Why:** Superseded by `VideoDateControls`.
9. **Action:** **Keep deleted.**

---

## 9. `src/components/video-date/CompactTimer.tsx`

1. **Path:** `src/components/video-date/CompactTimer.tsx`
2. **What it did:** Small circular **SVG countdown** (mm:ss), color by urgency (critical / urgent / normal).
3. **Reachable?** **No** external imports.
4. **Dependencies:** `framer-motion` only.
5. **Feature overlap:** **`HandshakeTimer`** and timing in **`VideoDate.tsx`** / session phase — live timers exist elsewhere.
6. **Product value:** Compact ring design variant.
7. **Deletion safety:** **Safe delete.**
8. **Why:** Unused duplicate timer widget.
9. **Action:** **Keep deleted.**

---

## 10. `src/components/video-date/VibeProgressRing.tsx`

1. **Path:** `src/components/video-date/VibeProgressRing.tsx`
2. **What it did:** Larger **gradient ring** progress (SVG), urgent state styling, animated colors by `timeLeft`.
3. **Reachable?** **No** external imports.
4. **Dependencies:** `framer-motion`.
5. **Feature overlap:** Same as CompactTimer — **phase timer visuals** exist in live `VideoDate` stack (`UrgentBorderEffect`, etc.).
6. **Product value:** Alternative visual language for countdown.
7. **Deletion safety:** **Safe delete.**
8. **Why:** Orphan widget.
9. **Action:** **Keep deleted.**

---

## 11. `src/components/video-date/DraggablePIP.tsx`

1. **Path:** `src/components/video-date/DraggablePIP.tsx`
2. **What it did:** **Draggable** picture-in-picture shell with corner snap (`framer-motion` drag), shows partner image or video-off state.
3. **Reachable?** **No** external imports.
4. **Dependencies:** `framer-motion` drag APIs.
5. **Feature overlap:** **`SelfViewPIP.tsx`** is imported by `VideoDate.tsx` and `ActiveCallOverlay.tsx`. Live PIP behavior is there.
6. **Product value:** Draggable snap logic — **could** be UX improvement vs fixed PIP; **never integrated**.
7. **Deletion safety:** **Safe delete** for current product; **partial recovery candidate** only if product prioritizes draggable PIP (re-implement on `SelfViewPIP`, not restore file blindly).
8. **Why:** Never wired into `VideoDate`.
9. **Action:** **Keep deleted**; if draggable PIP returns, spec against `SelfViewPIP`.

---

## 12. `src/components/video-date/PartnerTeaseCard.tsx`

1. **Path:** `src/components/video-date/PartnerTeaseCard.tsx`
2. **What it did:** “Up Next” **teaser card**: blind date mode, partner photo/name, vibe tags, countdown display — marketing-style **pre-reveal** UI.
3. **Reachable?** **No** external imports.
4. **Dependencies:** `framer-motion` only.
5. **Feature overlap:** Partner reveal happens in live **`PartnerProfileSheet`** / handshake flows in `VideoDate.tsx`.
6. **Product value:** Distinct “tease” layout; unused.
7. **Deletion safety:** **Safe delete.**
8. **Why:** Orphan.
9. **Action:** **Keep deleted.**

---

## 13. `src/components/video-date/TipsCarousel.tsx`

1. **Path:** `src/components/video-date/TipsCarousel.tsx`
2. **What it did:** Rotating **tips** array (lighting, travel prompts, etc.), 4s interval, `Lightbulb` header — **static copy** only.
3. **Reachable?** **No** external imports.
4. **Dependencies:** `framer-motion`, React state.
5. **Feature overlap:** Tips/icebreakers exist in **`IceBreakerCard`** and lobby copy elsewhere; not the same strings but same *role*.
6. **Product value:** **Copy library** could be reused; **no code dependency** lost.
7. **Deletion safety:** **Safe delete**; **archive-worthy** for copy (optional paste into content doc).
8. **Why:** Not mounted anywhere.
9. **Action:** **Keep deleted**; optional: add tip lines to `docs/` if PM wants exact strings preserved.

---

## 14. `src/components/video-date/AudioVisualizer.tsx`

1. **Path:** `src/components/video-date/AudioVisualizer.tsx`
2. **What it did:** **12-bar** fake audio visualizer (random heights every 100ms) when “active”.
3. **Reachable?** Only `SelfCheckMirror.tsx`.
4. **Dependencies:** `framer-motion`.
5. **Feature overlap:** None required for live call — decorative.
6. **Product value:** Lightweight mic-activity illusion; **no real audio analysis**.
7. **Deletion safety:** **Safe delete.**
8. **Why:** Only used by deleted `SelfCheckMirror`.
9. **Action:** **Keep deleted.**

---

## 15. `src/components/video-date/SelfCheckMirror.tsx`

1. **Path:** `src/components/video-date/SelfCheckMirror.tsx`
2. **What it did:** “Mirror” **self-view** shell: toggles for camera/mic/blur, embeds `AudioVisualizer`, uses a **fixed Unsplash stock image** as “camera on” placeholder (not real `getUserMedia` preview).
3. **Reachable?** **No** external imports.
4. **Dependencies:** `AudioVisualizer`, `@/components/ui/button`.
5. **Feature overlap:** Real pre-call / in-call video is **Daily + `SelfViewPIP`** / device flows in `VideoDate.tsx` — **production path is unrelated**.
6. **Product value:** **Prototype** only; stock photo makes it unsuitable for production as-is.
7. **Deletion safety:** **Safe delete.**
8. **Why:** Demo component; misleading if confused with live mirror.
9. **Action:** **Keep deleted.**

---

## Doc drift (post-deletion)

| Location | Issue |
|----------|--------|
| `_cursor_context/vibely-golden-snapshot_claude.md` (~L807) | Still says mutual match → **MutualMatchCelebration** — **false** vs live `MatchSuccessModal` / `PostDateSurvey`. **Update recommended** (separate doc hygiene PR). |

---

## Summary answers (strict)

1. **Essential live feature lost?** **No** — evidence: no live imports; live post-date path is `PostDateSurvey` + Edge + `date_feedback`.
2. **Meaningful unfinished product work?** **Yes as prototypes** (checkpoint wizard, draggable PIP, celebration variants) — **not** as shipped behavior. Restoring files **without** backend wiring would reintroduce **dangerous UX lies** (feedback not saved).
3. **Useful rollback path?** **Git history** remains the rollback; no feature-flag path was removed from runtime.
4. **Comfortable with every deletion?** **Yes for production correctness**, with **discomfort** that **design/craft** in checkpoint/modal was discarded — recover from `git show d60626766:<path>` if needed, not by blind restore.
