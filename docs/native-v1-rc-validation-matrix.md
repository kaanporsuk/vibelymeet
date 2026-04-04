# Native v1 RC Validation Matrix

Date: 2026-04-04
Status: Operator-ready (implementation complete -> runtime proof)
Scope baseline:
- Sprint 1A foundation merged
- Sprint 2 events core closed
- Sprint 3 matches/chat/date closure completed at audit level
- Shared backend is canonical (no separate mobile backend)

Out of scope for RC sign-off (deferred):
- v1.1+ surfaces not in the core path matrix below
- cosmetic polish-only items
- broader cleanup/refactor work that does not affect release-critical runtime behavior

Legend:
- Severity: P0 (release blocker), P1 (must-fix before RC sign-off), P2 (fix soon, can continue focused validation)
- Likely owner surface: Native UI, Shared adapter, Backend contract, Provider config
- Validation mode: Device-required, Device+console, Code-inferred

## A. Auth and Session

| ID | Feature area | Screen/path | Preconditions | Operator action | Expected result | Failure signals | Severity | Likely owner surface | Validation mode |
|---|---|---|---|---|---|---|---|---|---|
| AUTH-1 | Sign in | /(auth)/sign-in | Existing verified account; app freshly launched | Sign in with valid credentials | Session created, app routes through root gate to tabs | Stuck on sign-in, auth loop, generic error with valid creds | P0 | Backend contract or Native UI | Device-required |
| AUTH-2 | Sign up | /(auth)/sign-up | New email not in use | Complete sign-up flow | Account created, session established, onboarding gate evaluated | Account created but cannot proceed, duplicate-session errors | P0 | Backend contract | Device-required |
| AUTH-3 | Reset password request | /(auth)/reset-password | Existing account email | Submit reset email and follow prompt | Success state shown with no crash; deep link arrives by email | No confirmation state, hard error, broken deep link entry later | P1 | Provider config or Native UI | Device+console |
| AUTH-4 | Onboarding redirect truth | /(onboarding) via root gate | User profile marked complete/incomplete in backend | Sign in with one complete and one incomplete account | Complete profile bypasses onboarding; incomplete profile enters onboarding | Wrong routing for profile state | P0 | Shared adapter / Backend contract | Device-required |
| AUTH-5 | Logout cleanup | /settings/account (or sign-out entry) | Logged-in user, notifications previously granted | Trigger sign out and relaunch app | Session cleared, protected routes blocked, auth shown; no stale chat/events data | User still appears logged in, stale data visible, push identity not cleared expectation | P0 | Native UI / Provider config | Device+console |

## B. Notifications (OneSignal)

| ID | Feature area | Screen/path | Preconditions | Operator action | Expected result | Failure signals | Severity | Likely owner surface | Validation mode |
|---|---|---|---|---|---|---|---|---|---|
| NOTIF-1 | OneSignal init/binding | App launch + authenticated session | OneSignal App ID configured in native env | Launch app, sign in, monitor debug logs | OneSignal initializes once; user identity binding attempted after auth | Init errors, repeated re-init loops, missing identity binding | P0 | Provider config / Native UI | Device+console |
| NOTIF-2 | Permission prompt behavior | Initial app usage and notifications surface | Fresh install with notification permission undecided | Trigger app path that requests notifications | Prompt shown once at correct time; denied/granted branches handled without crash | Prompt never appears when expected, repeats excessively, crash on deny | P1 | Native UI | Device-required |
| NOTIF-3 | External user identity sync | Auth lifecycle | Signed-in user with stable user id | Sign in -> sign out -> sign in as second user | Push identity aligns to active account; no cross-account leakage | User A receives User B notifications, stale player/external id state | P0 | Provider config / Shared adapter | Device+console |
| NOTIF-4 | Device-vs-code inference boundary | N/A checklist item | Codebase already audited for write path | Verify inferred checks are marked inferred, not treated as runtime proof | RC report clearly separates inferred correctness from observed delivery behavior | Team marks code inference as end-to-end delivery proof | P1 | Process ownership | Code-inferred |

Notification evidence policy:
- Must be checked on device: permission UX, real prompt behavior, foreground/background delivery behavior, cross-account identity behavior.
- Can be inferred from code only: call sites and write-path intent (not provider delivery guarantee).

## C. Events Core

| ID | Feature area | Screen/path | Preconditions | Operator action | Expected result | Failure signals | Severity | Likely owner surface | Validation mode |
|---|---|---|---|---|---|---|---|---|---|
| EVT-1 | Events list render/filter | /(tabs)/events/index | Account with discoverable events | Open events tab, apply search/filter if available | List loads with truthful cards; no blank flicker regressions | Empty list despite known events; render crash | P1 | Native UI / Shared adapter | Device-required |
| EVT-2 | Event details truth | /(tabs)/events/[id] | Existing event with known registration state | Open event details for registered and unregistered states | CTA/status reflects backend registration truth after load | Wrong CTA (register vs admitted), state flicker never resolves | P0 | Shared adapter / Backend contract | Device-required |
| EVT-3 | Free registration | /(tabs)/events/[id] | Event with free seat availability | Register and return to details/lobby path | Registration succeeds and state updates correctly | Success toast but no seat/admission truth update | P0 | Backend contract | Device-required |
| EVT-4 | Paid registration success truth | /event-payment-success -> event details | Paid event, payment test path available | Complete paid registration path and return | Final state reflects payment/registration success with truthful messaging | Paid success but still shown unregistered or blocked | P0 | Backend contract / Provider config | Device+console |
| EVT-5 | Lobby entry guards | /event/[eventId]/lobby | Registered and unregistered accounts | Attempt lobby entry from both states | Registered user enters; ineligible user receives truthful guard | Ineligible user can enter, or eligible user blocked | P0 | Backend contract / Native UI | Device-required |
| EVT-6 | Deck/swipe behavior | /event/[eventId]/lobby | Event with available deck cards | Swipe left/right through deck and observe queue/match outcomes | Deck advances without repeats/regressions; outcomes reflected | Duplicate cards, non-advancing deck, wrong outcome handling | P1 | Shared adapter / Native UI | Device-required |
| EVT-7 | Ready Gate transitions | /ready/[id] and lobby overlay path | Active ready gate session | Execute ready, snooze, timeout, skip/forfeit paths | Terminal routes align to transition matrix and event context fallback | Wrong route exit, race-caused mis-route, timeout misfire | P0 | Backend contract / Native UI | Device-required |
| EVT-8 | Date handoff | /ready/[id] -> /date/[id] | Both participants ready in session | Confirm both-ready transition | User enters date session path without orphan state | Both-ready but no date entry, duplicate/looping routes | P0 | Backend contract | Device-required |

## D. Matches, Chat, and Date

| ID | Feature area | Screen/path | Preconditions | Operator action | Expected result | Failure signals | Severity | Likely owner surface | Validation mode |
|---|---|---|---|---|---|---|---|---|---|
| MCD-1 | Matches list truth | /(tabs)/matches/index | Account with active + archived/new matches | Open list, verify tabs/search/sort/new vibes | Conversations/new vibes reflect expected state without hidden regressions | Missing rows, wrong archived visibility, stale unread states | P1 | Native UI / Shared adapter | Device-required |
| MCD-2 | Chat thread send path | /chat/[id] | Existing match pair | Send text message and observe delivery/read updates | Send uses server-owned path and thread updates accordingly | Message appears local-only, never hydrates, error loop | P0 | Shared adapter / Backend contract | Device+console |
| MCD-3 | Media outbox basic truth | /chat/[id] | Camera/mic/library permissions available | Send photo, voice, and short video where available | Outbox transitions are truthful; retries/failures are visible and recoverable | Silent drops, stuck pending forever, wrong failure labeling | P0 | Native UI / Shared adapter | Device-required |
| MCD-4 | Video date handshake | /date/[id] | Valid date session and permissions granted | Join date and complete handshake window | Handshake state/timer behave correctly; transition or exit truthfully | Handshake hangs, wrong timeout behavior, call object instability | P0 | Backend contract / Provider config | Device+console |
| MCD-5 | Reconnect grace | /date/[id] reconnect path | Two devices or controlled disconnect scenario | Disconnect one side briefly then reconnect | Reconnect grace UI and state follow canonical server actions | No grace window, premature end, stale disconnected overlay | P0 | Backend contract / Provider config | Device+console |
| MCD-6 | Survey return path | Post-date survey in /date/[id] | Completed/ended date session | Submit verdict and observe route return | Return path follows event-context-first fallback truth | Wrong destination, stuck survey state, duplicate submissions | P1 | Native UI / Backend contract | Device-required |

## E. Profile and Settings Baseline

| ID | Feature area | Screen/path | Preconditions | Operator action | Expected result | Failure signals | Severity | Likely owner surface | Validation mode |
|---|---|---|---|---|---|---|---|---|---|
| PROF-1 | Profile load/edit basics | /(tabs)/profile and edit flows | Logged-in account with editable fields | Load profile and edit core fields | Save succeeds and persisted values reload correctly | Save appears successful but data reverts or errors | P1 | Native UI / Backend contract | Device-required |
| PROF-2 | Settings navigation | /settings/* | Logged-in user | Traverse all primary settings entries | Navigation is stable with no dead routes or crashes | Dead links, route mismatch, crash on entry | P1 | Native UI | Device-required |
| PROF-3 | Pause/resume baseline (if available) | /settings/account | Pause/resume feature enabled in build | Trigger pause/resume actions | State reflects backend truth and account state transitions | Action returns success but state mismatched | P1 | Backend contract / Native UI | Device+console |
| PROF-4 | RevenueCat identity/login baseline | Purchase/premium related surface | RevenueCat configured; signed-in user | Open premium-related surfaces and inspect identity wiring behavior | SDK identifies current user and surfaces expected offering state baseline | No offerings due to identity/config mismatch; cross-account leakage | P0 | Provider config | Device+console |

## RC Exit Rules

Release candidate can be called runtime-proven only when:
1. All P0 items are PASS on at least one iOS and one Android device path (or explicitly waived by product owner with rationale).
2. No unresolved backend/provider misconfiguration remains for canonical flows.
3. Failures are triaged to owner surface and converted into actionable follow-up tickets.
4. Notification and video-call checks are based on runtime evidence, not code inference alone.

## Pass/Fail Recording Template

Use this row template in operator logs:

- ID:
- Device/OS:
- Build identifier:
- Result: PASS | FAIL | BLOCKED
- Evidence: screenshot/video/log paths
- Observed behavior:
- Expected behavior:
- Suspected owner surface:
- Follow-up ticket/link:
