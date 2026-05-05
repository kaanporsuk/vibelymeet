# Vibely RHRN Product Module Specification

**Feature:** Right Here Right Now  
**Abbreviation:** RHRN  
**Tab label:** RHRN  
**Web route:** `/rhrn`  
**Screen title:** Right Here Right Now  
**Bottom navigation order:** Now / Events / RHRN / Matches / You  
**Status:** Product locked; implementation pending Sprint 0 architecture synthesis  
**Primary implementation agent:** Codex in VS Code Studio  

---

## 1. Executive Summary

Right Here Right Now, abbreviated **RHRN**, is Vibely’s live, consent-based local discovery room. It lets users discover people who are actively participating in RHRN in their immediate vicinity, people who were active recently, and users who have used Teleport to join a selected place.

RHRN is **not** a map, not a swipe deck, not a nearby-user tracker, and not a generic local chat room. It is a live social presence layer that helps users meet people who are open to connect **right here, right now**.

The user-facing promise is:

> Right Here Right Now shows people who are open to connect in your vicinity, only while participating in RHRN. Exact distance and exact location are never shown.

RHRN must be built as a **bounded plug-in module** inside Vibely. It should have its own backend objects, state machine, screens, settings, admin configuration, statistics, place search, and interaction logic. It should interact with Core Vibely only through explicit adapter-style touchpoints.

---

## 2. Product Doctrine

RHRN is a live, reciprocal, proximity-based social room.

The core doctrine:

1. Users only see RHRN people while participating in RHRN.
2. Users never see exact distances, counts, map pins, or raw coordinates.
3. Location and visibility decisions are backend-owned.
4. RHRN uses Vibely’s existing profile, match, message, notification, moderation, entitlement, credit, and admin systems through explicit touchpoints.
5. RHRN does not create a parallel chat/match universe.
6. RHRN is modular enough to be disabled, rolled back, feature-flagged, or later reused in other Vibely-like products.

Product summary:

> RHRN is a rolling live local discovery room. Opening RHRN makes a user live. Turning it off removes the grid immediately, but the user remains visible as Active recently for a short window. Fresh and Met-before users receive Vibe requests. Premium and VIP users can attach scarce Vibe Notes. Mutual Vibe creates a normal Vibely match and opens the existing chat. Existing matches show as Matched and go directly to Message. Hide Profile is RHRN-only. Block is global. Teleport is a premium selected-place presence labeled Teleported. Google Places powers place search from day one, while Vibely builds its own RHRN Place Memory and location statistics over time.

---

## 3. Plug-In Architecture Principle

RHRN must be implemented as a **bounded module**.

### 3.1 RHRN Owns

RHRN owns:

- live session state
- active-recently state
- RHRN presence
- RHRN radius fields
- RHRN geospatial visibility logic
- RHRN Vibes
- RHRN Vibe Notes
- RHRN request expiry and cooldowns
- RHRN-only Hide Profile
- RHRN Teleport
- RHRN At/Around place mode
- Google Places-backed RHRN place search
- Vibely RHRN Place Memory
- RHRN place statistics
- RHRN settings
- RHRN admin config and analytics
- RHRN feature flags and rollout gates

### 3.2 Core Vibely Owns

Core Vibely owns:

- authentication and identity
- profiles
- photos and public profile rendering
- subscription tier / entitlements
- Stripe and RevenueCat settlement
- global blocks
- reports and moderation
- matches
- messages and chat
- notifications and notification preferences
- existing Event, Daily Drop, and video-date history
- admin authentication and role checks

### 3.3 RHRN Must Not Do

RHRN must not:

- reuse Event Lobby deck logic directly
- reuse `get_visible_events` directly for live proximity
- reuse profile city or saved event-discovery location for physical RHRN
- show distance labels from reused profile components
- create pre-match chat messages outside the Vibe/Vibe Note consent flow
- create a parallel chat or match screen
- expose Google API keys to web or native clients
- expose raw RHRN coordinates to clients
- depend on client-side premium flags for entitlement decisions
- change Core Vibely behavior while RHRN is disabled

---

## 4. Core Vibely Touchpoint Map

RHRN may touch Core Vibely only through controlled interfaces.

### 4.1 Auth and Identity

RHRN needs:

- authenticated user id
- Supabase session/JWT
- profile completion state
- account active/paused/suspended/deleted state
- admin role where needed

RHRN must not create its own auth model.

### 4.2 Profiles

RHRN reads profile card/full-profile data:

- profile id
- display name
- age
- gender
- interested-in/dating preferences
- photos/avatar
- verification status
- vibe tags / profile vibes
- profile prompts and public profile fields for full profile view
- subscription tier snapshot only through backend-authoritative tier checks

RHRN should reuse safe full-profile components, but suppress distance labels and any Event Lobby-specific context.

### 4.3 Entitlements, Subscriptions, and Credits

RHRN reads:

- free / premium / VIP tier
- Vibe Note included allowance
- Vibe Note purchased credits
- Teleport included allowance
- Teleport purchased credits
- Teleport extension credits

RHRN writes:

- RHRN Vibe Note usage records
- RHRN Teleport usage records
- RHRN credit spend records
- RHRN credit settlement audit records

Current aligned credit model:

- RHRN purchased/banked credits should be distinct from legacy video-date credits.
- Subscription allowances are rolling and non-bankable.
- Purchased RHRN credits are banked.

### 4.4 Blocks, Reports, Suspensions, Pauses

RHRN consumes Core Vibely safety state:

- blocked users
- reports
- suspensions
- account pause
- account deletion or protected states

Rules:

- Hide Profile is RHRN-only.
- Block is global Vibely separation.
- Report triggers protective separation while active/reviewed.
- Suspended, paused, deleted, or moderation-excluded users are not visible on RHRN.

### 4.5 Matches and Messages

RHRN reads:

- current match status
- archived/muted match state where relevant
- prior real two-sided connection history
- chat route/opening contract

RHRN writes:

- a Core Vibely match when mutual RHRN Vibe happens
- RHRN match context/banner metadata
- first chat message if an accepted Vibe Note exists

RHRN must use existing Vibely chat after mutual consent.

Chat banner:

```text
You met on Right Here Right Now
18:42 · 3 May 2026
```

No distance. No exact location. No Teleport disclosure in chat banner.

### 4.6 Events and Prior Interaction History

RHRN reads Core history only to classify relationship tags:

- current match → Matched
- prior real two-sided connection → Met before
- event lobby pass → no tag
- passive same-event exposure → no tag
- prior ignored RHRN Vibe → no tag

Met before requires a meaningful two-sided Vibely connection, not passive exposure or one-sided interest.

### 4.7 Notifications

RHRN uses existing notification infrastructure.

RHRN needs notification categories for:

- incoming RHRN Vibe
- incoming RHRN Vibe Note
- RHRN match
- Teleport ending soon

Push rules:

- no distance
- no counts
- no raw note text in push body
- no named nearby notification to users not participating in RHRN
- hidden/block/report suppression must apply
- quiet hours and category preferences must apply

### 4.8 Admin

RHRN needs a dedicated admin section.

Admin owns:

- RHRN feature flags
- tier-based radii
- session durations
- Active recently durations
- request expiry
- cooldowns
- Vibe Note allowances
- Teleport allowances
- Google Places config
- place type filters
- notification toggles
- ranking weights
- usage statistics
- Google Places usage/cost visibility
- RHRN reports and moderation insight

---

## 5. Product Placement and Navigation

### 5.1 Web

Route:

```text
/rhrn
```

Screen title:

```text
Right Here Right Now
```

### 5.2 Native

Native tab label:

```text
RHRN
```

Bottom nav order:

```text
Now / Events / RHRN / Matches / You
```

### 5.3 Settings

RHRN settings should be reachable from:

```text
RHRN screen → gear
Global Settings → RHRN
```

---

## 6. User Session Model

### 6.1 Session States

RHRN states:

```text
Off
Live
Active recently
Teleported
Expired
Manual off
Admin ended
```

### 6.2 Opening RHRN

Opening the RHRN screen starts or refreshes a RHRN session after first-time education and location permission are complete.

Default live session duration:

```text
60 minutes
```

Every RHRN screen check refreshes:

```text
live_expires_at = now + configured_session_duration
```

### 6.3 Manual Off

If a user toggles RHRN off:

1. the user immediately loses access to the RHRN grid;
2. live location refresh stops;
3. the user transitions to Active recently for the configured window;
4. other eligible RHRN users may still see the user as Active recently;
5. after the Active recently window expires, the user becomes Off.

Default Active recently duration:

```text
30 minutes
```

### 6.4 Active Recently

Active recently users:

- do not see the RHRN grid;
- remain visible in the eligible local RHRN grid;
- can receive Vibes;
- can receive Vibe Notes;
- must open RHRN again to respond;
- are not live-tracked while Active recently.

The Active recently chip says:

```text
Active recently
```

No exact time such as “17 minutes ago.”

### 6.5 Expiry

If the user does not check/open RHRN within the live session duration:

```text
Live → Active recently → Off
```

---

## 7. Location and Proximity Model

### 7.1 Physical RHRN Location

Physical RHRN requires fresh foreground precise/current location.

RHRN must not use:

- profile city
- saved profile location
- event registration location
- Events `get_visible_events` fallback logic
- background location

Required location payload:

```text
lat
lng
accuracy_meters
timestamp
platform
```

The backend validates accuracy and freshness.

### 7.2 No Background Location in v1

RHRN v1 must not introduce background location.

### 7.3 No Distance Display

RHRN never shows:

- exact meters
- distance labels
- map pins
- nearby counts
- raw coordinates

The user should understand that everyone shown is in the RHRN vicinity through education, not through tracker-like UI.

### 7.4 Default RHRN Fields

Default RHRN fields:

```text
Free: 40 meters
Premium: 70 meters
VIP: 100 meters
```

### 7.5 Visibility Field Rule

Two users can see each other when either user’s RHRN field reaches the other, subject to all filters.

Examples:

```text
Free + Free at 35m → visible
Free + Free at 55m → not visible
Premium + Free at 60m → visible
VIP + Free at 90m → visible
```

Premium and VIP users expand the room.

---

## 8. Eligibility and Visibility Filters

A candidate can appear in the RHRN grid only if all applicable filters pass.

### 8.1 Participation Filters

The candidate must be one of:

- Live
- Active recently
- Teleported

The viewer must be allowed to see the RHRN grid, generally by being Live or Teleported.

### 8.2 Account Filters

Exclude:

- self
- suspended users
- paused users
- deleted/protected account states
- moderation-excluded users
- users with incomplete minimum RHRN eligibility

### 8.3 Safety Filters

Exclude pairs where there is:

- Core block
- active/protective report state
- RHRN Hide Profile
- admin/moderation pair exclusion

### 8.4 Dating Preference Filters

RHRN v1 respects:

- age range
- gender
- dating preference / interested-in compatibility

Current matches may still show even if current preferences changed, unless hidden/block/report applies.

### 8.5 Location Filters

Visibility uses the current/last valid RHRN center and the tier field rule.

Physical Live users use fresh foreground location.

Active recently users use the last valid RHRN session location, without continued tracking.

Teleported users use the selected place as their RHRN center.

---

## 9. Relationship and Presence Chips

### 9.1 Relationship Tags

Relationship tags:

```text
Matched
Met before
No tag
```

Rules:

| Situation | Tag |
|---|---|
| Current match | Matched |
| Prior real two-sided connection, no current match | Met before |
| Fresh user | No tag |
| Event lobby pass | No tag |
| Passive same-event exposure | No tag |
| Prior RHRN Vibe ignored/skipped | No tag |

Priority:

```text
Safety exclusion first
Matched beats Met before
```

### 9.2 Presence Chips

Presence chips:

```text
Active recently
Teleported
```

Relationship tags and presence chips are separate.

Examples:

```text
Matched
Met before
Active recently
Teleported
Matched · Active recently
Met before · Teleported
```

Maximum two visible chips on a grid card.

### 9.3 Info Popovers

Tags/chips on the full profile include an `i` info popover that auto-disappears after a few seconds.

Popover copy:

```text
Matched:
You already have a Vibely match with this person.

Met before:
You previously connected through a Vibely moment.

Teleported:
This person used Teleport to join this place on RHRN for a limited time.

Active recently:
This person was recently live on RHRN here.
```

---

## 10. RHRN Grid

### 10.1 Single-Screen Model

RHRN uses one screen, not a separate inbox tab.

Grid ordering:

```text
1. People who vibed you
2. People you vibed
3. Live users
4. Active recently users
```

Within each group, use ranking with:

- relationship affinity
- shared vibes
- profile quality
- recent RHRN activity
- random jitter

Do not sort by exact distance.

### 10.2 Card Content

Each RHRN card may show:

- photo
- name
- age
- verification badge
- optional RHRN tag/message
- relationship tag
- presence chip
- At/Around context where appropriate and visually safe
- CTA

No distance. No counts. No map.

### 10.3 Card Actions

| Candidate state | CTA |
|---|---|
| Current match | Message |
| Fresh | Vibe |
| Met before | Vibe |
| Incoming Vibe | View profile / Vibe back / Not now |
| Outgoing Vibe | Vibe sent |

No Pass button.

No deck-style Nope.

No pre-match Message button.

### 10.4 Full Profile

Every visible RHRN card can open the full profile.

Full profile should show:

- existing profile details
- RHRN relationship/presence tags
- optional RHRN tag/message
- RHRN action CTA
- overflow menu with Hide Profile / Block / Report

Any reused full-profile component must suppress distance labels inside RHRN.

---

## 11. Optional RHRN Tag / Message

Users may optionally enter a RHRN tag/message.

Prompt:

```text
What’s your right-now vibe?
```

Rules:

- optional
- editable while Live
- visible only inside RHRN
- not mandatory on join/rejoin
- may be prefilled from previous tag
- should be moderated
- should reject phone numbers, external handles, links, and unsafe content if moderation rules are enabled

No “open to what” chips in v1.

---

## 12. Hide Profile / Block / Report

### 12.1 Hide Profile

Hide Profile is RHRN-only and bidirectional inside RHRN.

If A hides B:

- A does not see B on RHRN;
- B does not see A on RHRN;
- no RHRN Vibes between them;
- no RHRN Vibe Notes between them;
- no RHRN notifications between them;
- existing Core Vibely match/chat remains unaffected;
- Events and other Core Vibely surfaces remain unaffected.

Hide Profile confirmation copy:

```text
Hide this profile on RHRN?
You and this person will no longer see each other on Right Here Right Now. This does not block them elsewhere on Vibely.
```

Unhide location:

```text
RHRN Settings → Manage hidden profiles
```

The hidden profiles list must not show:

- live status
- RHRN tag
- distance
- current place
- nearby hints

### 12.2 Block

Block is global Vibely separation.

If A blocks B:

- no RHRN;
- no Events resurfacing;
- no discovery;
- no Daily Drop;
- no messages;
- no match visibility;
- no notifications.

Block confirmation copy:

```text
Block this person?
You and this person will no longer see or contact each other anywhere on Vibely.
```

### 12.3 Report

Report triggers protective separation while active/reviewed and integrates with Core Vibely moderation.

Report confirmation copy:

```text
Report this person?
We will review this. You and this person will not see each other while the report is active.
```

---

## 13. RHRN Vibe Flow

### 13.1 Outgoing Vibe

For Fresh and Met-before users:

```text
Vibe
```

If the sender is eligible for a Vibe Note, they may attach a note.

Sender confirmation:

```text
Vibe sent. If they vibe back, you’ll match.
```

The sender does not see whether the receiver viewed, ignored, or rejected it.

### 13.2 Incoming Vibe

Incoming Vibes appear at the top of the RHRN screen.

Actions:

```text
View profile
Vibe back
Not now
```

If there is a Vibe Note, show it inside the request card.

### 13.3 Vibe Back

If the receiver taps Vibe back:

1. backend validates request is still valid;
2. backend creates or restores normal Core Vibely match;
3. backend creates RHRN match context;
4. if there was a Vibe Note, it becomes the first chat message;
5. chat opens using the existing Vibely chat route/screen;
6. chat banner shows RHRN origin.

### 13.4 Not Now

If the receiver taps Not now:

- request disappears;
- sender is not notified;
- no match;
- no Met before tag;
- 7-day same-target cooldown applies if the request was seen.

### 13.5 Ignore

If the receiver ignores a seen request until expiry:

- request disappears;
- sender is not notified;
- no match;
- no Met before tag;
- 7-day same-target cooldown applies.

If the request expires unseen:

- no relationship tag;
- 24-hour same-target cooldown applies.

---

## 14. Vibe Notes

A Vibe Note is a short note attached to a Vibe request. It is not open chat.

### 14.1 Default Allowance

```text
Free: 0 per rolling 24h
Premium: 1 per rolling 24h
VIP: 3 per rolling 24h
Max length: 140 characters
Additional Vibe Notes: purchasable
```

Subscription allowances do not roll over.

Purchased Vibe Note credits are banked.

UI language:

```text
Add a note to your Vibe
```

Do not call it “Send first message” before match.

### 14.2 Consumption Rules

Consume a Vibe Note allowance/credit when the Vibe Note is successfully delivered.

| Scenario | Consume? |
|---|---|
| Delivered successfully | Yes |
| Recipient ignores | Yes |
| Recipient taps Not now | Yes |
| Request expires after delivery | Yes |
| Recipient accepts | Yes |
| Server rejects because target inactive/ineligible | No |
| Server rejects because hidden/block/report | No |
| Server/provider failure before delivery | No |

### 14.3 Safety Rules

Vibe Notes should reject or moderate:

- phone numbers
- external handles
- links
- explicit sexual content
- threats
- harassment
- surveillance-like language such as “I can see you by the window”

Vibe Note text must not appear in push notification body.

---

## 15. Request Expiry and Cooldowns

### 15.1 Request Expiry

Default request expiry:

```text
60 minutes
```

A pending Vibe request expires when:

- request TTL reaches 60 minutes;
- Hide Profile happens;
- Block happens;
- Report happens;
- one user becomes suspended/ineligible;
- match is created;
- admin invalidates the request.

If a Vibe was valid when sent, it remains valid until expiry even if one user later moves outside the RHRN field, unless a terminating condition applies.

### 15.2 Movement After Sending

The main grid updates based on current RHRN eligibility.

Pending request validity is based on valid send-time eligibility plus expiry.

This avoids false negatives when users move during real-life outings.

### 15.3 Cooldowns

Same-target cooldowns:

```text
Seen + Not now: 7 days
Seen + ignored until expiry: 7 days
Unseen before expiry: 24 hours
Accepted: match created
Hidden/block/report: exclusion
```

No read receipts.

No sender-visible “seen” or “ignored” state.

---

## 16. Existing Matches

Existing matches appear in the same RHRN grid.

Card tag:

```text
Matched
```

CTA:

```text
Message
```

Tapping Message opens existing Vibely chat.

No RHRN Vibe is required for current matches.

If a current match is muted/archived, it still shows as Matched unless Hide Profile, Block, Report, or safety exclusion applies.

---

## 17. Met Before

Met before appears when the users had a real prior two-sided Vibely connection but are not currently matched.

Examples:

- previous match, now unmatched
- completed video date / handshake
- prior chat existed but no current match
- accepted Daily Drop opener/reply or equivalent two-sided flow
- previous RHRN mutual match, now unmatched

Not Met before:

- event lobby pass
- passive same-event attendance
- event profile seen but no connection
- one-sided event vibe
- one-sided RHRN Vibe
- ignored/skipped RHRN Vibe
- Daily Drop generated but unopened
- profile exposure only

---

## 18. Teleport

### 18.1 Product Meaning

Teleport lets a user select a place and join RHRN there for a limited time.

User-facing label:

```text
Teleported
```

Popover:

```text
This person used Teleport to join this place on RHRN for a limited time.
```

Do not use “Visiting virtually” or “RHRN Visit.”

Do not mention Teleport in the chat banner after mutual match.

### 18.2 Default Entitlements

| User type | Included Teleports | Purchasable? | Duration | Field |
|---|---:|---:|---:|---:|
| Free | 0/week | Yes | 60 min | 40m |
| Premium | 0/week | Yes | 60 min | 70m |
| VIP | 1/rolling week | Yes | 60 min | 100m |

Everyone can extend Teleport duration with purchases/credits if enabled.

All values are admin-controlled.

### 18.3 Teleport Visibility

Teleport uses selected place + user tier field.

A teleported VIP has a 100m field around the selected place.

Eligible physical users within that field see the teleported user.

The teleported user sees eligible RHRN users inside that field.

### 18.4 No Arbitrary Pin

Teleport v1 does not allow arbitrary map pins.

Teleport requires Google Places-backed selected place search.

---

## 19. Place Search, Place Memory, and At/Around

### 19.1 Google Places from Day One

RHRN uses Google Places from the start for place search.

Clients call Vibely backend functions only.

Clients must not call Google directly.

Server secret:

```text
GOOGLE_PLACES_API_KEY
```

This must be a Supabase Edge secret only, never `VITE_*` or `EXPO_PUBLIC_*`.

### 19.2 Provider Boundary

Backend functions:

```text
rhrn-place-search
rhrn-place-resolve
```

Search flow:

```text
User searches a place
→ backend checks Vibely RHRN Place Memory first
→ if valid/fresh match exists, return Vibely result
→ if missing/stale, call Google Places
→ user selects result
→ backend resolves minimal required fields
→ backend stores Place Memory and usage stats
→ Teleport or At/Around session starts
```

### 19.3 Google Data Policy

Do not store all Google data indefinitely.

Durably store where allowed:

- Google Place ID
- Vibely internal place id
- first/last selected timestamps
- Vibely-owned aggregate stats

Cache with TTL/compliance discipline:

- display name
- formatted/short address
- lat/lng
- types / primary type
- business status if used

Do not store for v1:

- photos
- reviews
- ratings
- phone numbers
- opening hours
- websites
- rich Google metadata

Show “Powered by Google” attribution when Google results are displayed.

### 19.4 RHRN Place Memory

RHRN Place Memory is not manual curation.

It is a Vibely-owned memory of places selected by users.

Purpose:

- reduce Google cost over time
- rank popular RHRN places
- understand where RHRN energy occurs
- allow admin to block problematic places
- build future venue intelligence

### 19.5 Place Statistics

Track per-place statistics:

- search count
- selection count
- physical sessions
- Teleport sessions
- At count
- Around count
- live minutes
- active recently minutes
- Vibes sent
- Vibe Notes sent
- Vibes accepted
- matches created
- reports
- Hide Profile actions
- premium upgrades from RHRN
- VIP upgrades from RHRN
- Teleport credit purchases

Stats are admin/product intelligence only in v1.

No public heatmaps.

No public counts.

### 19.6 At / Around

When a user selects a place, they choose:

```text
At this place
Around this place
```

Default:

```text
Around
```

At means:

> I am intentionally checking into this place.

Around means:

> Use this place as my area anchor without implying I am inside the venue.

For privacy, Around should be default for physical place selection and Teleport.

---

## 20. RHRN Settings

RHRN settings locations:

```text
RHRN screen → gear
Global Settings → RHRN
```

RHRN Settings should include:

- How RHRN works
- current RHRN status
- Manage hidden profiles
- location permission status
- RHRN notification preferences
- Vibe Note balance
- Teleport balance
- Teleport purchase/extension entry
- At/Around explanation
- privacy explanation

Manage hidden profiles must not show live status, RHRN tags, distances, locations, or nearby hints.

---

## 21. Notifications

### 21.1 Categories

Required categories:

```text
Incoming RHRN Vibe
Incoming RHRN Vibe Note
RHRN match
Teleport ending soon
```

Codex should map these to exact existing notification preference naming conventions.

### 21.2 Push Copy

Incoming Vibe:

```text
Maya vibed you on RHRN.
```

Incoming Vibe with note:

```text
Maya vibed you on RHRN.
```

Do not include note text in push.

Mutual match:

```text
You matched on RHRN.
```

Teleport ending:

```text
Your Teleport is ending soon.
```

### 21.3 Deep Links

RHRN notification deep links should route to:

```text
/rhrn
```

After match creation, normal chat notifications may route to:

```text
/chat/:otherUserId
```

The repo-specific chat route expects other user id, not match id.

---

## 22. Payment and Credits

### 22.1 Vibe Note Credits

RHRN Vibe Note credits are distinct from existing video-date credits.

Subscription allowances:

```text
Free: 0 per rolling 24h
Premium: 1 per rolling 24h
VIP: 3 per rolling 24h
```

Purchased Vibe Note credits are banked.

Subscription allowances do not roll over.

### 22.2 Teleport Credits

Teleport credits are distinct from Vibe Note credits.

Default:

```text
Free: 0 included per week, purchasable
Premium: 0 included per week, purchasable
VIP: 1 included per rolling week, purchasable extras
```

Teleport extensions use their own purchase/credit logic.

### 22.3 Web and Native Settlement

Web uses Stripe.

Native uses RevenueCat where appropriate for native purchasable products/entitlements.

RHRN must not create native subscription rows from consumable credit products.

Credit settlement must be idempotent.

---

## 23. Backend Data Model — Proposed RHRN Objects

Exact names may be adjusted by Codex after repo inspection, but objects should remain RHRN-prefixed.

### 23.1 `rhrn_config`

Admin-controlled configuration.

Stores:

- feature flags
- tier radii
- session durations
- Active recently durations
- request expiry
- cooldowns
- Vibe Note allowances
- Teleport allowances
- Google Places config
- accuracy/freshness thresholds
- notification toggles
- ranking weights

### 23.2 `rhrn_config_audit`

Audit log for admin config changes.

Stores:

- key changed
- old value
- new value
- changed by
- changed at
- reason/metadata

### 23.3 `rhrn_rollout_users` / Cohorts

DB-backed rollout control.

Supports:

- admin-only testing
- selected users
- selected cohorts
- city/country rollout
- per-feature enablement

### 23.4 `rhrn_sessions`

Historical truth of user RHRN session lifecycle.

Tracks:

- user id
- mode: physical / teleport
- state: live / active_recently / expired / manual_off / admin_ended
- started_at
- live_expires_at
- active_recently_expires_at
- ended_at
- end_reason
- tier snapshot
- radius snapshot
- platform
- location accuracy snapshot
- optional tag/message
- selected place id
- At/Around mode

### 23.5 `rhrn_presence_locations`

Query-optimized current/last valid RHRN center.

Tracks:

- session id
- user id
- current/last valid point
- accuracy
- timestamp
- radius snapshot
- mode
- status
- place reference

Clients must not be able to read raw presence locations directly.

### 23.6 `rhrn_hides`

RHRN-only Hide Profile relationships.

Tracks:

- hider user
- hidden user
- created_at
- unhidden_at
- active flag
- source surface

Visibility filtering must treat this as bidirectional inside RHRN.

### 23.7 `rhrn_vibes`

RHRN Vibe request lifecycle.

Tracks:

- sender
- receiver
- sender session id
- receiver session id if known
- state
- sent_at
- seen_at
- responded_at
- expires_at
- accepted match id
- invalidation reason
- same-target cooldown metadata

### 23.8 `rhrn_vibe_notes`

Can be separate or merged into `rhrn_vibes` if justified.

Tracks:

- vibe id
- note text snapshot
- note source: tier allowance / purchased credit / admin grant
- moderation status
- credit/allowance usage reference

### 23.9 `rhrn_vibe_note_usages`

Usage ledger for rolling subscription allowances and purchased credits.

Tracks:

- user id
- source
- tier snapshot
- created_at
- idempotency key
- associated vibe id

### 23.10 `rhrn_teleports`

Teleport session records.

Tracks:

- user id
- selected place id
- center lat/lng snapshot or point
- radius snapshot
- tier snapshot
- started_at
- expires_at
- ended_at
- entitlement source
- extension count
- status

### 23.11 `rhrn_teleport_usages`

Usage ledger for VIP weekly allowance and purchased Teleport credits.

Tracks:

- user id
- source
- tier snapshot
- idempotency key
- created_at
- teleport id

### 23.12 `rhrn_places`

Vibely-owned RHRN Place Memory.

Tracks:

- Vibely place id
- provider
- Google Place ID
- cached display/metadata with TTL
- country/city/context
- category/type
- status: active / blocked / needs_review
- first_seen_at
- last_selected_at
- cache_expires_at

### 23.13 `rhrn_place_stats`

Aggregate place statistics.

Tracks product-owned usage data by place.

### 23.14 `rhrn_place_provider_usage_events`

Provider usage/cost observability.

Tracks:

- user id or hashed user id
- provider
- action: search / resolve
- cache hit/miss
- query hash
- session token hash
- result count
- field mask
- HTTP status
- latency
- estimated cost bucket
- created_at

### 23.15 `rhrn_match_context`

Links Core Vibely matches to RHRN origin.

Tracks:

- match id
- accepted vibe id
- sender session id
- receiver session id
- created_at
- banner timestamp
- teleport involved internally
- safe metadata

Do not expose exact location.

### 23.16 RHRN Credit Balances / Ledger

Codex should inspect current credit implementation and choose the safest additive model.

Likely RHRN-specific banked credit buckets:

- RHRN Vibe Note credits
- RHRN Teleport credits
- RHRN Teleport Extension credits

Rolling allowances should remain in RHRN usage ledgers, not banked wallet columns.

---

## 24. Backend Functions / RPCs — Proposed RHRN Surfaces

Exact names may be adjusted, but all should be RHRN-prefixed.

### 24.1 User-Facing Functions

```text
rhrn-get-config
rhrn-open-or-refresh
rhrn-turn-off
rhrn-nearby-grid
rhrn-update-tag
rhrn-hide-profile
rhrn-unhide-profile
rhrn-list-hidden-profiles
rhrn-send-vibe
rhrn-respond-vibe
rhrn-mark-vibe-seen
rhrn-place-search
rhrn-place-resolve
rhrn-start-teleport
rhrn-extend-teleport
rhrn-end-teleport
```

### 24.2 Maintenance / Admin Functions

```text
rhrn-cleanup-expired
rhrn-admin-config
rhrn-admin-stats
```

### 24.3 Auth Posture

- user functions require authenticated user context;
- admin functions verify admin role;
- cleanup functions use cron secret or service-role-only SQL path;
- all functions read DB-backed RHRN config first and fail closed when disabled.

---

## 25. Security and RLS Principles

RHRN security posture:

- no raw RHRN location reads by clients;
- grid payload only through secure backend function/RPC;
- no exact distances in responses;
- no nearby counts in responses;
- no lat/lng of other users in responses;
- server derives tier, radius, entitlement, and eligibility;
- server applies blocks/reports/suspensions/pauses;
- server applies RHRN Hide Profile;
- server applies dating preferences;
- admin config/stats admin-only;
- provider usage and place stats protected;
- clients cannot compute proximity or visibility.

---

## 26. Admin Configuration

### 26.1 Hard-Coded Invariants

These should not be admin-overridable:

- no exact distance shown
- no counts shown
- no raw lat/lng returned to users
- no map pins
- no direct chat before mutual Vibe unless already matched
- Hide Profile excludes both users from each other on RHRN
- Block is global
- Report protects/separates while active
- RHRN grid access requires valid participation state
- client cannot decide radius/entitlement/cooldown/visibility

### 26.2 Admin-Controlled Variables

Feature flags:

```text
rhrn_enabled
rhrn_grid_enabled
rhrn_vibes_enabled
rhrn_vibe_notes_enabled
rhrn_teleport_enabled
rhrn_google_places_enabled
rhrn_notifications_enabled
rhrn_enabled_for_admins_only
rhrn_enabled_for_free
rhrn_enabled_for_premium
rhrn_enabled_for_vip
rhrn_enabled_countries
rhrn_enabled_cities
```

Radius:

```text
rhrn_radius_free_meters = 40
rhrn_radius_premium_meters = 70
rhrn_radius_vip_meters = 100
```

Sessions:

```text
rhrn_session_duration_free_minutes = 60
rhrn_session_duration_premium_minutes = 60
rhrn_session_duration_vip_minutes = 60
rhrn_active_recently_free_minutes = 30
rhrn_active_recently_premium_minutes = 30
rhrn_active_recently_vip_minutes = 30
```

Requests:

```text
rhrn_request_expiry_minutes = 60
rhrn_same_target_seen_cooldown_days = 7
rhrn_same_target_unseen_cooldown_hours = 24
```

Vibe Notes:

```text
rhrn_vibe_note_free_per_24h = 0
rhrn_vibe_note_premium_per_24h = 1
rhrn_vibe_note_vip_per_24h = 3
rhrn_vibe_note_max_chars = 140
rhrn_vibe_note_purchasable = true
```

Teleport:

```text
rhrn_teleport_free_included_per_week = 0
rhrn_teleport_premium_included_per_week = 0
rhrn_teleport_vip_included_per_week = 1
rhrn_teleport_duration_minutes = 60
rhrn_teleport_extension_enabled = true
```

Google Places:

```text
rhrn_google_places_cache_ttl_days
rhrn_google_places_max_requests_per_user_per_hour
rhrn_google_places_daily_budget_limit
rhrn_google_places_allowed_place_types
rhrn_google_places_blocked_place_types
rhrn_google_places_disallow_address_only_results
rhrn_google_places_allowed_countries
rhrn_google_places_allowed_cities
```

Location quality:

```text
rhrn_location_max_accuracy_free_meters
rhrn_location_max_accuracy_premium_meters
rhrn_location_max_accuracy_vip_meters
rhrn_location_max_age_minutes
rhrn_location_revalidate_on_open = true
rhrn_location_revalidate_on_vibe_send = true
```

Active recently:

```text
rhrn_allow_vibes_to_active_recently = true
rhrn_allow_vibe_notes_to_active_recently = true
```

Ranking:

```text
rhrn_sort_incoming_vibes_first = true
rhrn_sort_outgoing_vibes_second = true
rhrn_sort_live_before_recently_active = true
rhrn_sort_relationship_weight
rhrn_sort_shared_vibes_weight
rhrn_sort_random_jitter_weight
```

Notifications:

```text
rhrn_notifications_incoming_vibe_enabled
rhrn_notifications_match_enabled
rhrn_notifications_teleport_expiring_enabled
```

Moderation:

```text
rhrn_tag_max_length
rhrn_tag_moderation_enabled
rhrn_vibe_note_moderation_enabled
rhrn_block_external_links_in_notes
rhrn_block_phone_numbers_in_notes
rhrn_block_social_handles_in_notes
```

---

## 27. UI and Screen Map

### 27.1 Web Screens

- `/rhrn` main screen
- RHRN first-time education
- location permission denied/weak accuracy states
- RHRN grid
- RHRN full profile drawer/page
- Vibe flow
- Vibe Note flow
- incoming/outgoing Vibe cards
- RHRN settings
- Manage hidden profiles
- Teleport flow
- At/Around selection
- RHRN admin panel

### 27.2 Native Screens

- RHRN tab screen
- RHRN first-time education
- native foreground location permission flow
- RHRN grid
- full profile sheet/screen
- Vibe/Vibe Note flow
- RHRN settings stack screen
- Manage hidden profiles
- Teleport search and start flow

### 27.3 Design System

RHRN must follow Vibely’s Neon Noir identity:

- dark cinematic surfaces
- neon violet and neon pink accents
- capsule/pill UI
- premium cards
- cinematic but highly legible profile surfaces

Do not introduce generic map-app styling.

---

## 28. Adaptive and Cross-Platform Requirements

RHRN must work across:

- web desktop
- web mobile
- native iOS
- native Android
- tablets where reasonable
- different browser/device permission states
- slow network
- offline/reconnect states
- denied location
- poor accuracy
- Google Places failure/rate limit

Native:

- no background location in v1
- no unsupported native modules
- no `expo-av` usage unless later explicitly allowed by the project’s native constraints
- respect safe areas and Android back behavior
- use foreground precise location

Web:

- secure context geolocation
- permission-denied UX
- responsive layouts
- touch-safe controls
- no hover-only controls

---

## 29. Production Safety and Rollout

RHRN must be disabled by default.

Rollout sequence:

```text
1. disabled globally
2. enabled for admins only
3. enabled for selected internal test users
4. enabled in one city/country
5. enabled for launch area
6. Teleport enabled separately
7. Vibe Notes/purchases enabled separately
8. Notifications enabled separately
```

Kill switches:

```text
rhrn_enabled
rhrn_grid_enabled
rhrn_vibes_enabled
rhrn_vibe_notes_enabled
rhrn_teleport_enabled
rhrn_google_places_enabled
rhrn_notifications_enabled
```

No existing Core Vibely behavior should change while RHRN is disabled.

---

## 30. QA Matrix

RHRN must be tested across:

- Free / Premium / VIP
- physical / teleported
- Live / Active recently / Off
- matched / met before / fresh
- Hide Profile / Block / Report
- Vibe accepted / Not now / ignored / expired
- seen vs unseen cooldown
- Vibe Note allowance / purchased credit
- Teleport included allowance / purchased credit / extension
- Google Places memory hit / miss / failure / rate limit
- At / Around
- web desktop / mobile browser / iOS / Android
- location denied / poor accuracy / permission revoked
- feature flags disabled
- notification preferences off / quiet hours / hidden pair suppression

---

## 31. Rebuild and Documentation Discipline

RHRN adds major rebuild-relevant surfaces:

- new route `/rhrn`
- native tab/screen
- new migrations
- new RHRN tables
- new Edge Functions
- new Google Places provider secret
- new notification categories
- new admin config
- new credit products/types
- new docs and manifests

Every implementation branch must emit a rebuild delta covering:

- routes
- native tabs
- migrations
- generated Supabase types
- `supabase/config.toml`
- Edge Function manifest
- migration manifest
- external dependency ledger
- Google Places provider sheet
- Supabase provider sheet
- machine-readable inventory
- notification preferences docs
- static inventory tests where applicable

---

## 32. Target End State

At target end state, RHRN works as a world-class plug-in module inside Vibely:

- users open `/rhrn` or the RHRN tab and automatically start/refresh a live local session;
- they see a single, polished RHRN grid of live, active-recently, and teleported eligible users;
- they never see exact distance, counts, map pins, or raw location;
- current matches show as Matched with Message CTA;
- prior meaningful connections show as Met before;
- fresh users have no relationship tag;
- Fresh and Met-before users receive Vibe requests, not direct pre-match messages;
- Premium/VIP users can attach scarce Vibe Notes;
- mutual Vibe creates a normal Vibely match and opens existing chat;
- chat carries a tasteful RHRN origin banner;
- Hide Profile is RHRN-only and reversible;
- Block remains global Vibely separation;
- Report protects and integrates with moderation;
- Teleport lets users join a selected Google Places-backed place with a Teleported chip;
- Vibely builds Place Memory and place statistics over time;
- all RHRN parameters are admin-configurable where safe;
- all safety invariants are hard-coded;
- RHRN can be rolled out, disabled, or extracted without destabilizing Core Vibely.

---

## 33. Handoff Notes for Codex

Codex should treat this document as the product module source of truth.

Before implementation, Codex should still inspect the live repo for exact file names, existing helpers, types, routing, admin patterns, notification preference schemas, credit structures, and function conventions.

Codex should choose exact variable, table, function, component, and hook names based on the live repo, but the product semantics and module boundaries in this document are locked.

