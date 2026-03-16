# Phase 5 — Ready Gate & Daily Drop visible-surface pass

UI-only pass for Ready Gate and Daily Drop so these surfaces feel like Vibely product surfaces. All server-owned mechanics preserved: `ready_gate_transition`, `daily_drop_transition`, `daily-drop-actions`.

---

## Files changed

| File | Changes |
|------|--------|
| `apps/mobile/components/lobby/ReadyGateOverlay.tsx` | Card `variant="glass"`; subtitle copy ("You matched with … — say hi on your video date!"); partner avatar ring (`borderColor: theme.tint + '50'`); primary CTA "I'm Ready ✨" `size="lg"` and full width; skip copy "Not right now — skip this one"; typography tokens; spacing and padding aligned to theme. |
| `apps/mobile/app/ready/[id].tsx` | **Shell:** GlassHeaderBar, back + "Ready to vibe?"; ScrollView with padded content. **Card:** Partner label "Your match", avatar with tint ring, partner name, status pill (countdown "Join in Xs" / "Partner is ready!" / "Partner needs a moment — back in M:SS" / "Waiting for partner..."); partner-ready cue (green/success styling); snoozed cue. **CTAs:** Primary "I'm Ready ✨" (VibelyButton lg); secondary row "Snooze — give me 2 min" · "Not ready? Step away"; after ready: "You're ready! Waiting for …" pill + "Cancel & go back". **States:** Invalid session → ErrorState + Go back; transitioning → full-screen "Connecting your vibe date..." + "Get ready to shine ✨" with sparkles icon. **Copy:** Step-away confirm dialog clarified. |
| `apps/mobile/app/daily-drop.tsx` | **Shell:** GlassHeaderBar with "Daily Drop" + timer pill ("X:XX left") in header; ScrollView with layout padding and bottom safe area. **Partner card:** Card variant glass, avatar (or person icon), name+age, bio. **Empty:** Icon circle (gift), "No drop for today", "Check back tomorrow…", VibelyButton "Refresh". **Expired:** Icon circle (time), "This drop has expired", "You'll get a new match tomorrow.", Refresh. **Loading:** LoadingState with title/message. **Opener flow:** Section label, themed input, char count, "Send opener" primary button. **Reply flow:** "First message" bubble (them/me styling), reply input, "Send reply" primary. **Connected:** "You're connected! Chat is unlocked." cue + "Open chat" primary. **Pass:** Ghost "Pass on this drop" with confirm dialog (unchanged). All colors/radius/spacing from theme; no logic or API changes. |
| `docs/phase5-ready-gate-daily-drop-visible-pass.md` | This report. |

---

## Visible-state improvements

- **Ready Gate overlay (lobby):** Clear hierarchy (title → subtitle → avatar → CTA → skip); glass card and tint ring; prominent "I'm Ready ✨"; explanatory skip copy.
- **Ready Gate standalone screen:** Header and card layout; countdown/status in one pill; partner-ready and snoozed states with distinct cues; primary + secondary actions; transitioning full-screen; invalid session → ErrorState with recovery.
- **Daily Drop:** Header with timer; partner card as glass card with avatar/name/bio; empty and expired states with icon, copy, and Refresh; loading with LoadingState; opener/reply inputs and bubbles themed; connected state with cue + Open chat; pass as ghost with existing confirm.

---

## Remaining awkwardness from current data shape

- **Ready Gate overlay:** No countdown or partner-ready/snoozed state in the overlay (lobby doesn’t subscribe to ready-gate state). To match web overlay fully, lobby would need to pass in `iAmReady` / `partnerReady` / `snoozedByPartner` / `timeLeft` or open the standalone ready screen instead of the overlay.
- **Ready Gate screen:** Countdown is local (30s) and not synced with server timeout; if server uses a different timeout, UI can show 0 before server forfeit. Realtime keeps partner state in sync.
- **Daily Drop:** No "cooldown" or "next drop at" copy; if the API doesn’t return next_eligible_at, we can’t show it. Empty state is "no drop for today" which is correct when there’s no row; any "try again later" would need backend support.

---

## State polish as the only remaining Phase 5 slice

- **Ready Gate / Daily Drop:** This pass completes the visible-surface work for these two flows. Remaining gaps are either data-driven (timer sync, cooldown copy) or product choices (overlay vs standalone ready screen).
- **Phase 5 as a whole:** Events list/detail, lobby/deck, Ready Gate, and Daily Drop have all had parity/polish passes. A final **state polish** slice could: (1) add any missing loading/skeleton/error recovery patterns, (2) unify copy and tone across surfaces, (3) add any small transitions or microcopy that still feel missing. That would be the only remaining Phase 5 slice before calling the phase complete.
