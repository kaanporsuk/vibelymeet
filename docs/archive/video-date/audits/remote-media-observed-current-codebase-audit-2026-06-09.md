# Remote Media Observed Audit — Vibely Vibe Video Date Flow

Audit date: 2026-06-09

Scope: answer the attached "Remote media observed" interrogation pack from the current local codebase plus linked Supabase catalog state. This is a documentation-only audit. It does not claim the Video Date path is fixed, because the hard proof bar remains a fresh disposable two-user production run through persisted `date_feedback`.

Current checkout: `codex/review-comments-1256-1262-followups`

Important context: the working tree was already dirty when this audit was written. The current working tree was treated as the current codebase; no source or migration files were changed for this audit.

Linked Supabase evidence checked during the investigation:

- `supabase migration list --linked` showed local and remote aligned through `20260609045533`.
- `supabase db push --linked --dry-run` reported the remote database is up to date.
- Live `pg_get_functiondef` checks matched the current remote-seen, stable-media, provider-overlap, lifecycle, and auto-promote functions.
- Function grants showed public RPCs execute through `authenticated`/`service_role`; helper/base functions are service-role only.

## 1 Current Canonical Behavior

The current canonical "Remote media observed" server entrypoint is:

`public.mark_video_date_remote_seen(p_session_id, p_owner_id, p_call_instance_id, p_provider_session_id, p_entry_attempt_id, p_owner_state, p_evidence_source)`

The current public RPC does not accept "participant joined" or "snapshot says present" as canonical remote-media evidence. It allowlists render/media sources before delegating to the provider-bound base. The accepted source list is:

- `loadeddata`
- `playing`
- `remote_track_mounted`
- `first_remote_frame`
- `request_video_frame_callback`

The RPC also requires current actor/session proof:

- authenticated caller
- caller is one of the two session participants
- session is not ended
- lifecycle eligibility passes for the event/session pair
- caller has current Daily provider-session join proof
- caller has fresh owner/call heartbeat proof for that same provider session

When accepted, the server stamps the caller's participant slot:

- participant 1 caller -> `video_sessions.participant_1_remote_seen_at`
- participant 2 caller -> `video_sessions.participant_2_remote_seen_at`

That field means "this participant reported visible remote date media." It is an observer-side stamp, not a direct claim that the partner's own slot should be updated.

The current promotion boundary is stricter than older "presence-only" notes, but not strictly "both decoded remote frames" only. The current stable-media gate can certify through either:

- bilateral remote-seen timestamps plus stable co-presence and active surface claims, or
- fresh bilateral owner heartbeat plus stable co-presence and active surface claims, when there is no one-sided remote-seen asymmetry.

That second branch is the most important current caveat: if product intends "Remote media observed" to mean decoded visible remote pixels for both users, current promotion remains looser than that target.

## 2 Stage Boundaries Table

| Stage | Server/client owner | Current canonical signal | Not enough by itself | Current status |
| --- | --- | --- | --- | --- |
| Daily room assigned | Ready Gate/server | `both_ready` plus canonical Daily room metadata | Daily room creation | Pass |
| Date route owns flow | Web `/date/:sessionId`, native `/date/[id]` | surface claim, date route state, Daily call pipeline | lobby or Ready Gate still rendering | Mostly pass, current dirty tree includes active ownership work |
| Both joined same Daily room | Daily client plus `mark_video_date_daily_joined` and webhooks | provider session join proof for both users | room URL existing | Pass as code/cloud contract, runtime unproven |
| Active co-presence | server helpers and provider/presence events | fresh join/heartbeat evidence without newer away/left | participant snapshot alone | Pass as code/cloud contract, runtime unproven |
| Remote media observed | `mark_video_date_remote_seen` | explicit allowlisted media/render source plus provider/current-call proof | participant joined, participant updated, snapshot present | Pass for DB stamp strictness; product caveat on weak sources |
| Session promotes to date | provider-overlap/auto-promote helpers | stable bilateral media gate then state/phase/date_started_at update | one-sided remote-seen | Pass for current gate; fail if the intended gate is strict decoded frames only |
| Survey truth | server terminal/survey state plus `/date/:sessionId` | terminal survey-required truth and `date_feedback` | returning to lobby before feedback | Out of scope for this stage; proof still requires live run |

## 3 Preconditions Table

| Precondition | Enforced where | Notes |
| --- | --- | --- |
| Caller is authenticated | `vd_remote_seen_render_base` | Anonymous clients cannot stamp remote-seen. |
| Caller is participant 1 or 2 | remote-seen base/lifecycle helper | The RPC derives actor slot from `auth.uid()`; the client does not choose a slot. |
| Session is not ended | lifecycle/base functions | Ended sessions are rejected before canonical repair. |
| Event registration still belongs to session | `video_date_session_lifecycle_eligibility_v1` | Guards stale event/session pairs. |
| Participant eligibility still holds | `video_date_participant_eligibility_v1` via lifecycle helper | Prevents non-current participants from repairing the encounter. |
| Evidence source is allowlisted | public `mark_video_date_remote_seen` wrapper | Rejected with `REMOTE_SEEN_RENDER_EVIDENCE_REQUIRED` when invalid. |
| Caller has current provider-session join proof | provider-bound remote-seen base | Latest provider event for actor must be joined, not superseded by leave. |
| Caller heartbeat matches owner/call/provider | provider-bound remote-seen base | Fresh `client_daily_alive` proof must match owner id, call instance, and provider session. |
| Heartbeat is fresh | provider-bound remote-seen base | Current window is 15 seconds in the provider-bound proof path. |
| Active surface claims exist for promotion | `video_date_active_surface_claims_v1` and stable-media gate | Promotion now needs route/surface ownership, not just provider events. |
| Stable co-presence exists for promotion | `video_date_stable_bilateral_media_gate_v1` | The gate evaluates provider and heartbeat overlap before promotion. |

## 4 Evidence-Source Map Table

| Source | Current emitters | Accepted by public RPC? | Evidence strength | Audit result |
| --- | --- | --- | --- | --- |
| `loadeddata` | Web `src/hooks/useVideoCall.ts` media element listener | Yes | Media data available, not necessarily a painted first frame | Product decision / weaker than decoded-frame proof |
| `playing` | Web media element listener | Yes | Playback started, closer to rendered media | Product decision / generally stronger than `loadeddata` |
| `request_video_frame_callback` | Web frame callback path | Yes | Strongest current web decoded-frame signal | Pass for web where supported |
| `first_remote_frame` | Web fallback using ready state and dimensions | Yes | Practical first-frame fallback | Pass as fallback, still browser-dependent |
| `remote_track_mounted` | Native date route | Yes | Track object mounted/available, not decoded-frame proof | Parity/product gap if decoded pixels are required |
| `participant_joined` | Web/native analytics and state only | No | Presence, not media | Correctly not canonical |
| `participant_updated` | Web/native analytics and state only | No | Presence/track state, not canonical by itself | Correctly not canonical |
| Snapshot/presence hydration | client state/support signals | No direct RPC source | Useful for UI/recovery, not canonical stamp | Correctly not canonical |
| Audio-only track | Web/native attach media | No direct RPC source | Remote audio, not visible remote media | Product decision needed |

## 5 Web Detection Path Table

| Web path | Code evidence | Calls canonical RPC? | Notes |
| --- | --- | --- | --- |
| `markRemoteSeenOnServer` | `src/hooks/useVideoCall.ts:1633` | Yes | Builds provider-bound args, dedupes, retries retryable failures, and updates local owner state on success. |
| `markRemoteFirstFrameRendered` | `src/hooks/useVideoCall.ts:1936` | Yes | Central callback that records first-frame state and calls `markRemoteSeenOnServer(source)`. |
| `loadeddata` listener | `src/hooks/useVideoCall.ts:2031` | Yes | Added only when a remote video track exists. |
| `playing` listener | `src/hooks/useVideoCall.ts:2032` | Yes | Added only when a remote video track exists. |
| `requestVideoFrameCallback` path | `src/hooks/useVideoCall.ts:2644` | Yes | Uses browser frame callback where available; fallback can emit `first_remote_frame`. |
| `attachTracks` | `src/hooks/useVideoCall.ts:2006` | Indirect | Attaches remote streams and wires media listeners for video tracks. |
| `logTrackMounted` | `src/hooks/useVideoCall.ts:2165` | No | Diagnostic/analytics track-mounted path, not canonical on web. |
| Daily `participant-joined` | `src/hooks/useVideoCall.ts:5364` | No | Updates remote participant state and analytics; not canonical remote-seen. |
| Daily `participant-updated` | `src/hooks/useVideoCall.ts:5418` | No | Reattaches tracks and analytics; not canonical remote-seen by itself. |
| Daily `participant-left` | `src/hooks/useVideoCall.ts:5573` | No | Clears remote render validation and starts reconnect/away handling. |

Web conclusion: canonical web remote-seen is media-element/render-bound, not mere provider presence. However, accepted sources include weaker pre-paint signals (`loadeddata`) as well as stronger decoded-frame signals (`request_video_frame_callback`).

## 6 Native Detection Path Table

| Native path | Code evidence | Calls canonical RPC? | Notes |
| --- | --- | --- | --- |
| `markRemoteSeenOnServer` | `apps/mobile/app/date/[id].tsx:4815` | Yes | Same provider-bound RPC contract as web. |
| Force-restamp source list | `apps/mobile/app/date/[id].tsx:4823` | Yes | Includes `remote_track_mounted`, `first_remote_frame`, and `request_video_frame_callback`. |
| Remote video track effect | `apps/mobile/app/date/[id].tsx:5175-5230` | Yes | Emits `remote_track_mounted` when a remote participant video track is mounted. |
| Participant listeners | `apps/mobile/app/date/[id].tsx:3037`, `3612-3613` | No direct remote-seen RPC | Presence and state path, not canonical remote-seen by itself. |
| Daily joined RPC | `apps/mobile/app/date/[id].tsx:10489-10620` | Not remote-seen | Provides provider/session join evidence used by later remote-seen proof. |

Native conclusion: native currently treats remote video track mount as canonical remote-media evidence. I did not find a native equivalent to web's decoded first-frame callback in the current route file. If the product definition is "visible remote pixels rendered," native parity is incomplete.

## 7 `mark_video_date_remote_seen` Contract Table

| Contract item | Current behavior |
| --- | --- |
| Public RPC args | `p_session_id`, `p_owner_id`, `p_call_instance_id`, `p_provider_session_id`, `p_entry_attempt_id`, `p_owner_state`, `p_evidence_source` |
| Client-chosen participant slot? | No. Slot is derived from `auth.uid()`. |
| Client-chosen partner id? | No. The RPC does not accept a remote user id. |
| Client-chosen room name? | No. Provider/current-call proof is derived from session/provider events and heartbeat. |
| Accepted evidence sources | `loadeddata`, `playing`, `remote_track_mounted`, `first_remote_frame`, `request_video_frame_callback` |
| Rejected evidence behavior | Returns `REMOTE_SEEN_RENDER_EVIDENCE_REQUIRED`, retryable. |
| Actor provider proof | Requires current joined provider session and matching fresh heartbeat. |
| Write target | Own observer slot remote-seen timestamp on `video_sessions`. |
| Idempotency | Repeated calls are tolerated and update latest timestamp behavior; no separate first/last evidence ledger exists. |
| Promotion side effect | May invoke provider-overlap promotion path after canonical repair if the stable-media gate passes. |
| Response shape | Includes remote-seen timestamps, repair/promotion flags, accepted evidence metadata, provider/current-call fields, and error/retry detail on failure. Exact payload depends on base helper path. |

## 8 Observer/Observed Semantics Table

| Question | Answer |
| --- | --- |
| Who is the observer? | The authenticated caller. |
| Which column is stamped? | The caller's participant slot: `participant_1_remote_seen_at` or `participant_2_remote_seen_at`. |
| Does participant 1 stamping mean participant 1 was seen? | No. It means participant 1 reported seeing remote media. |
| Can user A stamp user B's observer slot? | No, because slot is derived from `auth.uid()`. |
| Does the RPC record exactly which remote participant/track was observed? | No. It relies on session pair, provider/session proof, and surface ownership, but no remote track id/user id is persisted as canonical remote-seen evidence. |
| Is one-sided remote-seen enough for date promotion? | No under current stable-media gate. A one-sided remote-seen asymmetry blocks the heartbeat branch. |
| Is bilateral remote-seen required for promotion? | Not always. Current gate can also pass through fresh bilateral heartbeat plus active surface claims and stable co-presence. |

## 9 First-Frame / Media-Evidence Product Decision

Current implementation does not require a decoded remote first frame for every promotion path.

Evidence:

- Web can stamp through `loadeddata`, `playing`, `request_video_frame_callback`, or `first_remote_frame`.
- Native can stamp through `remote_track_mounted`.
- Promotion can pass through the stable heartbeat branch even without bilateral remote-seen timestamps.

Therefore, the current canonical product definition is closer to:

"The user is on the date surface, in the current provider session, with fresh owner/call proof, and the client has observed an allowlisted remote media/render event."

It is not strictly:

"Both users decoded and displayed at least one remote video frame."

If the intended product bar is visible remote pixels for both users, the current code has a product/implementation mismatch. The minimal technical change would be to make only decoded-frame-grade sources promotion-critical, add a native decoded-frame equivalent, and persist the evidence strength/source separately.

## 10 Audio-Only / Camera-Off Semantics

| Scenario | Current behavior | Classification |
| --- | --- | --- |
| Remote audio track only on web | Stream may attach, but canonical remote-seen listeners are wired only when a remote video track exists. | Product decision / likely no remote-seen |
| Remote camera off before first video track | No video-track media evidence path found. | Product decision |
| Remote video muted but track exists | Web media events/native track mount may still fire depending provider behavior. | Needs runtime test |
| Native audio-only remote | Native canonical effect keys off remote video track mount. | Product decision / likely no remote-seen |
| "I heard them but did not see them" | No explicit canonical audio-seen state exists. | Missing product rule |

Current code appears to treat visible remote video as the target for remote-seen, but it does not encode a complete camera-off/audio-only policy.

## 11 Same-Room / Stale-Provider Validation Table

| Risk | Current guard | Remaining gap |
| --- | --- | --- |
| Stale provider session stamps remote-seen | Provider-bound base checks latest joined provider session and rejects newer leave/stale provider session. | Needs live reconnect/device matrix proof. |
| Wrong owner id | Fresh heartbeat must match `p_owner_id`. | Client still supplies owner id; server validates against current heartbeat. |
| Wrong call instance | Fresh heartbeat must match `p_call_instance_id`. | Good code guard; needs runtime duplicate-tab proof. |
| Missing provider session id | Rejected before stamp. | Pass. |
| Provider session left before remote-seen | Rejected as left/stale. | Pass as code/cloud contract. |
| Wrong room/session remote object | Server validates actor provider/session proof, but the RPC does not pass or persist remote participant id, remote track id, or room name. | Partial guard; add remote subject evidence if strict auditability is required. |
| Snapshot-only presence | Not an allowlisted canonical evidence source. | Pass. |

## 12 Duplicate Device / Self-View Audit

| Case | Current answer |
| --- | --- |
| Self-view mistaken as remote on web | Daily local participant is filtered in remote participant handling; remote media code is keyed to remote participants. |
| Self-view mistaken as remote on native | Native listener/state paths distinguish local and remote participants. |
| User opens duplicate device/tab | Provider session/current heartbeat checks reduce stale-device risk. The duplicate-tab/parked singleton code helps on web, but live duplicate-device proof is still a test gap. |
| Same user appears as a remote Daily participant due provider behavior | Not proven impossible from code alone. The server does not accept a remote user id or track id, so live Daily identity tests remain needed. |
| Attacker tries to stamp partner slot | Blocked by auth-derived participant slot and RLS/RPC path. |

## 13 Date-Promotion Boundary Table

| Input state | Current promotion outcome |
| --- | --- |
| Active co-presence only, no active date surface claims | Should not promote under current stable-media gate. |
| One-sided remote-seen only | Should not promote; one-sided remote-seen blocks the heartbeat branch and bilateral remote-seen is false. |
| Bilateral remote-seen plus stable co-presence plus active surface claims | Eligible for promotion. |
| Fresh bilateral owner heartbeat plus stable co-presence plus active surface claims, no one-sided remote-seen asymmetry | Eligible for promotion even without bilateral `remote_seen_at`. |
| Already stable certified (`stable_bilateral_media_at` set) | Gate can preserve historical certification. |
| Already date | Current gate avoids using "already date" as a raw shortcut unless stable certification exists. |

The key answer: current code no longer promotes from a bare provider-overlap signal alone, but it still can promote without canonical bilateral remote-seen if the heartbeat/surface/stable-copresence branch passes.

## 14 Reconnect / Background / Reload Matrix Table

| Scenario | Expected current behavior | Audit result |
| --- | --- | --- |
| Remote participant briefly leaves | Client clears remote render validation and enters reconnect/away handling. | Code pass, runtime unproven |
| Browser visibility hidden while Daily active | Visibility/page lifecycle should not be authoritative transport truth while Daily is active. | Supported by current flow intent; needs runtime proof |
| Page reload during same session | Date route and Daily pipeline should reuse/claim same session when possible, with heartbeat/provider proof rebuilt. | Code direction pass, runtime unproven |
| Stale heartbeat after reload | Remote-seen rejects without fresh owner/call/provider heartbeat. | Pass |
| Provider session changes during reconnect | Remote-seen requires latest joined provider session; stale provider session should reject. | Pass as code/cloud contract |
| Existing joined Daily call already present | Web path has singleton/parking logic to avoid destroying same-session calls unnecessarily. | Code direction pass, runtime unproven |
| Terminal survey truth appears | Date route should hard-stop Daily/reconnect churn and show survey. | Out of this stage; proof remains live run |

## 15 Security / RLS / Spoofing Audit

| Concern | Current answer |
| --- | --- |
| Can unauthenticated users stamp remote-seen? | No. RPC requires authenticated actor. |
| Can authenticated nonparticipants stamp? | No. Actor must be one of the session participants. |
| Can caller choose which participant slot to write? | No. Slot derives from `auth.uid()`. |
| Can caller bypass table RLS with direct update? | No normal authenticated table UPDATE grant was found for `video_sessions`; the RPC path is the intended write path. |
| Can caller spoof evidence source? | Only allowlisted strings are accepted, but the server cannot independently prove the browser actually fired the event. It couples the source to provider/current-call proof. |
| Can caller spoof provider session? | Stale/missing/mismatched provider session is rejected against latest provider/heartbeat proof. |
| Are helper/base functions public? | Live grants showed base/gate/helper functions service-role only; public entrypoints are constrained RPCs. |
| Is remote participant identity cryptographically proven in remote-seen call? | No. The RPC does not receive or persist remote user/track identity. |

## 16 Web / Native Parity

| Area | Web | Native | Parity result |
| --- | --- | --- | --- |
| RPC contract | Provider-bound args and evidence source | Provider-bound args and evidence source | Pass |
| Presence events | Participant joined/updated are state/analytics only | Same general model | Pass |
| Strong first-frame proof | Uses `requestVideoFrameCallback` when available, fallback ready-state/dimensions | No native decoded-frame equivalent found | Gap |
| Track-mounted canonical source | Accepted by server but not emitted canonically on web | Main native canonical source | Gap/product decision |
| Audio-only handling | No canonical remote-seen without video track | No canonical remote-seen without video track | Same de facto behavior, product rule missing |
| Live parity proof | Not found | Not found | Test gap |

## 17 Observability / Support

Current observable artifacts include:

- `video_sessions.participant_1_remote_seen_at`
- `video_sessions.participant_2_remote_seen_at`
- provider join/leave events in `video_date_daily_webhook_events`
- client alive/presence events in `video_date_presence_events`
- promotion/stable-media fields including `stable_bilateral_media_at`, `stable_bilateral_media_source`, and `stable_bilateral_media_detail`
- event/observability rows for some remote-seen and promotion paths
- client analytics/checkpoints in web/native code

Support gaps:

- There is no first-class remote-seen evidence ledger with source strength, observed user id, remote track id, provider room, and first/last timestamps.
- The accepted `p_evidence_source` is returned in RPC payloads but not stored as a dedicated canonical column on `video_sessions`.
- `participant_*_remote_seen_at` does not tell support whether the proof came from `loadeddata`, `playing`, native track mount, or decoded frame callback.
- Analytics labels named `VIDEO_DATE_REMOTE_SEEN` can be emitted from participant presence paths, which can confuse canonical DB remote-seen debugging unless support distinguishes analytics from RPC truth.

## 18 Existing Tests And Missing Tests

Existing static/contract tests found:

| Test file | What it covers |
| --- | --- |
| `shared/matching/videoDateStrictDailyJoinRemoteSeen.test.ts` | Public RPC allowlist, render-evidence requirement, web render-bound sources, native `remote_track_mounted`, generated types. |
| `shared/matching/videoDateStableBilateralMediaGateContracts.test.ts` | Stable bilateral media gate, active surface claims, no raw already-date shortcut, provider/confirmed/auto-promote gate checks, pre-stable absence behavior, route/surface continuity. |
| `shared/matching/reviewComments1242_1256Followups.test.ts` | Remote-seen requires current owner/call heartbeat proof. |

Missing or insufficient tests:

- Fresh two-user production run through survey completion.
- Live Daily web-web, web-native, native-web, and native-native media-observed runs.
- Physical-device native proof that `remote_track_mounted` corresponds to visible rendered remote media.
- Browser matrix for `requestVideoFrameCallback`, `loadeddata`, `playing`, hidden tab, and autoplay edge cases.
- Camera-off/audio-only policy tests.
- Duplicate tab/device tests against stale provider sessions and self-view misclassification.
- Linked database integration tests that execute the RPCs against realistic rows, rather than only static file contracts.
- Support/observability tests proving exact evidence source can be reconstructed after incident review.

## 19 Acceptance Checklist

| Acceptance question | Answer | Status |
| --- | --- | --- |
| Is remote-seen separate from Daily joined? | Yes. Different RPC and stricter proof. | Pass |
| Is remote-seen separate from active co-presence? | Yes for DB stamp; promotion can also pass heartbeat/stable-copresence path. | Partial |
| Are participant-joined/updated rejected as canonical evidence? | Yes, they are not in the RPC allowlist. | Pass |
| Are exact accepted sources known? | Yes: five allowlisted sources listed above. | Pass |
| Does server require provider/current-call proof? | Yes. | Pass |
| Does server require a decoded first frame? | No. | Fail if that is the product requirement |
| Does web have decoded-frame-grade evidence? | Yes via `requestVideoFrameCallback`, with fallback. | Pass/partial |
| Does native have decoded-frame-grade evidence? | Not found. | Gap |
| Can audio-only satisfy remote media observed? | No explicit canonical path found. | Product decision |
| Can one user stamp both remote-seen slots? | No. | Pass |
| Is one-sided remote-seen enough for promotion? | No. | Pass |
| Is bilateral remote-seen always required for promotion? | No. | Product decision / potential bug |
| Is wrong/stale provider session rejected? | Yes by current-call/provider proof. | Pass as code/cloud contract |
| Is remote observed participant/track persisted? | No. | Observability gap |
| Is there complete web/native parity? | No. | Gap |
| Is local Supabase aligned with linked cloud? | Yes from CLI/catalog checks during this audit. | Pass |
| Was a live two-user run completed? | No. | Not accepted as fixed |
| Can support reconstruct exact proof source from DB columns? | Not reliably. | Gap |
| Are existing tests enough to prove runtime? | No, mostly static contract tests. | Test gap |

## 20 Potential Gaps / Improvement Areas

| Gap | Classification | Why it matters |
| --- | --- | --- |
| `remote_track_mounted` is promotion-capable evidence | Product decision / possible bug | Track mount is weaker than visible decoded media. |
| `loadeddata` is promotion-capable evidence | Product decision / possible bug | Media data availability may precede visible frame paint. |
| Stable heartbeat branch can promote without bilateral remote-seen | Product decision / possible bug | Good for launch resilience, weaker than strict "both saw media" semantics. |
| No native decoded-frame equivalent found | Web/native parity gap | Native can certify on weaker evidence than web. |
| No audio-only/camera-off policy | Product decision | The app needs a clear rule for "heard but not seen" and camera-off users. |
| Evidence source not stored canonically | Observability gap | Support cannot reliably answer what exact evidence promoted a date. |
| No remote user/track evidence ledger | Observability/security gap | Harder to prove the media was the partner, not merely some remote provider object. |
| Mostly static tests | Test gap | Static regex/contracts cannot prove Daily runtime behavior. |
| No fresh production two-user run | Acceptance gap | The full golden path remains unproven. |
| Analytics `VIDEO_DATE_REMOTE_SEEN` can mean noncanonical presence | Observability naming gap | Support may confuse analytics presence with DB canonical remote-seen. |

## 21 Minimal Fix Plan

1. Decide the product threshold.

   Pick one canonical definition:

   - resilient media encounter: active surface + fresh bilateral heartbeat/stable co-presence + allowlisted media signal
   - strict visible media: both users must prove decoded/rendered remote video frames

2. If strict visible media is required, narrow promotion-critical evidence.

   Keep `loadeddata` and `remote_track_mounted` as diagnostics, but require `request_video_frame_callback` or an equivalent verified first-frame event for promotion. Add a native renderer-level first-frame proof before enforcing parity.

3. Persist evidence details.

   Add a canonical evidence ledger or columns for observer user, observed user, provider room/session, call instance, track id when available, evidence source, evidence strength, first_seen_at, last_seen_at, and promotion contribution.

4. Tighten promotion gate to match the chosen threshold.

   If bilateral remote-seen is required, remove or demote the heartbeat-only certification branch from `video_date_stable_bilateral_media_gate_v1`. If heartbeat certification is intentionally allowed, document it as the real product rule.

5. Add runtime validation.

   Build a disposable two-user production matrix covering web-web, web-native, native-web, native-native, reconnect, duplicate tab/device, hidden tab, camera off, and audio-only paths. Finish each successful run through `date_feedback`.

6. Add support queries/dashboards.

   Provide an operator view that clearly separates Daily joined, active co-presence, remote media observed, stable media certified, date promoted, survey opened, and feedback persisted.

## 22 Open Questions

1. Should "Remote media observed" mean "remote video track/media pipeline exists" or "a decoded remote video frame was actually rendered"?

2. Should `loadeddata` remain promotion-capable, or only diagnostic?

3. Should native `remote_track_mounted` remain promotion-capable before a renderer-level first-frame signal exists?

4. Should bilateral owner heartbeat plus stable co-presence be allowed to promote without bilateral `remote_seen_at`?

5. What is the intended behavior when one participant has camera off but audio works?

6. Should audio-only encounters ever be survey-eligible/date-eligible?

7. Should the canonical evidence record include observed remote user id and track id?

8. Should analytics labels that currently say `VIDEO_DATE_REMOTE_SEEN` be renamed when they only mean provider participant presence?

9. What exact support query should be considered authoritative for answering "why did this session promote"?

10. Which browser/native-device matrix is required before this stage can be considered production-proven?

## Bottom Line

Current code and linked cloud state do make `mark_video_date_remote_seen` materially stricter than Daily presence: canonical DB remote-seen requires an allowlisted media/render source plus current provider-session and heartbeat proof.

The unresolved risk is semantic, not just mechanical. The current system can still treat weaker media signals, especially native `remote_track_mounted` and the stable heartbeat promotion branch, as enough for date promotion. If the intended product promise is "both users actually saw remote video frames," this stage is not fully implemented or proven yet.
