# Vibe Clips — Phase 10 funnel review framework

Internal note: how to read PostHog after Phase 9 instrumentation, and how to decide Phase 11 work.

**Source of truth for event names:** `shared/chat/vibeClipAnalytics.ts` (`VIBE_CLIP_EVENTS`, helpers).

---

## Canonical funnel stages

**Send path**

1. `clip_entry_opened`
2. `clip_record_started`
3. `clip_record_completed`
4. `clip_send_attempted`
5. `clip_send_succeeded` (or `clip_send_failed`)

**Playback**

- `clip_play_started` → `clip_play_completed`

**Reply / conversion (receiver, after play)**

- `clip_reply_with_clip_clicked`
- `clip_voice_reply_clicked`
- `clip_react_clicked`
- `clip_date_cta_clicked`

**Date (clip context)**

- `clip_date_cta_clicked` → `clip_date_flow_opened` → `clip_date_submitted_from_clip`

**Reserved (no UI today):** `clip_retake`

---

## Key segment cuts

Break down every funnel step by:

- `platform` (ios / android / web)
- `surface` (native / web)
- `thread_bucket` (cold / warm — threshold in `shared/chat/vibeClipPrompts.ts`)
- `duration_bucket` (0_10s / 10_20s / 20_30s / unknown)
- `has_poster` (playback / send success where emitted)
- `capture_source` (camera / library / web_recorder)
- `launched_from` (chat / clip_context) on entry and date-open
- `failure_class` on `clip_send_failed`

---

## Ranked friction hypotheses (pre-data)

Validate or falsify with the segments above.

1. **Native entry friction** — sheet before record vs web direct recorder; depresses `record_started / entry_opened`.
2. **Record → send drop** — picker cancel / abandon after `record_started`; watch `record_completed` and `send_attempted`.
3. **Playback completion** — users rarely reach `ended`; segment by `duration_bucket`, `has_poster`, `thread_bucket`.
4. **Voice > clip reply** — lower friction path; compare click counts among receivers with `play_started`.
5. **Date CTA underused** — secondary placement after play; `date_cta / play_started`, especially **warm** threads.
6. **Prompts weak** — optional copy only; compare cold-thread send over time when prompts change (no per-prompt id yet).
7. **Long or no-poster clips** — weaker `play_completed / play_started`.

---

## Ranked micro-optimization candidates (post–data review)

Ship small, copy/layout-only unless data proves otherwise.

1. Reduce native capture friction if (1) confirms.
2. Elevate reply-with-clip vs voice if (4) dominates.
3. Tighten date CTA / bridge copy in **warm** threads if (5) is weak.
4. Targeted failure / retry copy by `failure_class`.
5. Poster / thumbnail fallback polish if `has_poster` correlates with play completion.
6. Iterate `shared/chat/vibeClipPrompts.ts` if cold send is weak.
7. Softer push toward shorter clips if `20_30s` underperforms on completion.

---

## Three product questions the next dataset must answer

1. Where is the biggest drop: **entry → record**, **record → send**, or **play → reply**?
2. Is **native sheet cost** real vs web (after platform + `launched_from` cuts)?
3. Does **clip → date** earn clicks in **warm** threads, and do opens **submit**?

---

## Next implementation phase

**Phase 11 — funnel tighten:** After 1–2 review cycles in PostHog, pick the smallest validated leak; ship one PR (copy/layout/recorder polish only unless data forces a scoped technical fix). Re-measure with the same segments.
