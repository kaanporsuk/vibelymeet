# Chat Calls Global Smoke Checklist

Date: 2026-04-14
Branch: `fix/chat-calls-global-lifecycle-hardening`

Use real browser/device runtime where applicable. Run each lane twice: once for `voice`, once for `video`.

## Web -> Web

### Voice
- [ ] Answer: caller starts from chat thread, callee answers, both connect, active UI persists outside the thread, end clears both sides.
- [ ] Decline: callee declines, caller ringing UI clears, backend row ends as `declined`.
- [ ] Missed: let 30 seconds expire with no answer, both sides clear, backend row ends as `missed`.
- [ ] Caller navigates away: caller leaves the thread while ringing or active, call UI remains controlled globally and terminal state still reconciles.
- [ ] Callee not in thread: callee is elsewhere in app, incoming overlay still appears and answer/decline works.
- [ ] Remote leave: after connect, one side leaves and the other side reconciles to end promptly.
- [ ] App open but not in thread: both users stay in app on non-chat routes and call state still behaves correctly.
- [ ] Cold start / reopen observations: reopen browser during ringing and record whether incoming ringing is recovered correctly.

### Video
- [ ] Answer: caller starts from chat thread, callee answers, both connect, local/remote media render, end clears both sides.
- [ ] Decline: callee declines, caller ringing UI clears, backend row ends as `declined`.
- [ ] Missed: let 30 seconds expire with no answer, both sides clear, backend row ends as `missed`.
- [ ] Caller navigates away: caller leaves the thread while ringing or active, global call UI remains usable.
- [ ] Callee not in thread: callee is elsewhere in app, incoming overlay still appears and answer/decline works.
- [ ] Remote leave: after connect, one side leaves and the other side reconciles to end promptly.
- [ ] App open but not in thread: both users stay in app on non-chat routes and call state still behaves correctly.
- [ ] Cold start / reopen observations: reopen browser during ringing and record whether incoming ringing is recovered correctly.

## Web -> Native

### Voice
- [ ] Answer: web caller starts, native callee answers, both connect and clear correctly on end.
- [ ] Decline: native callee declines, web caller clears, backend row ends as `declined`.
- [ ] Missed: let 30 seconds expire with no answer, both sides clear, backend row ends as `missed`.
- [ ] Caller navigates away: web caller leaves the thread while ringing or active, global call UI remains usable.
- [ ] Callee not in thread: native callee is on another screen, incoming overlay still appears and answer/decline works.
- [ ] Remote leave: after connect, one side leaves and the other side reconciles to end promptly.
- [ ] App open but not in thread: both users stay in app on non-chat routes and call state still behaves correctly.
- [ ] Cold start / reopen observations: reopen the native app during ringing and record whether incoming ringing is recovered correctly.

### Video
- [ ] Answer: web caller starts, native callee answers, local/remote media render on both sides, end clears both sides.
- [ ] Decline: native callee declines, web caller clears, backend row ends as `declined`.
- [ ] Missed: let 30 seconds expire with no answer, both sides clear, backend row ends as `missed`.
- [ ] Caller navigates away: web caller leaves the thread while ringing or active, global call UI remains usable.
- [ ] Callee not in thread: native callee is on another screen, incoming overlay still appears and answer/decline works.
- [ ] Remote leave: after connect, one side leaves and the other side reconciles to end promptly.
- [ ] App open but not in thread: both users stay in app on non-chat routes and call state still behaves correctly.
- [ ] Cold start / reopen observations: reopen the native app during ringing and record whether incoming ringing is recovered correctly.

## Native -> Web

### Voice
- [ ] Answer: native caller starts, web callee answers, both connect and clear correctly on end.
- [ ] Decline: web callee declines, native caller clears, backend row ends as `declined`.
- [ ] Missed: let 30 seconds expire with no answer, both sides clear, backend row ends as `missed`.
- [ ] Caller navigates away: native caller leaves the thread while ringing or active, global call UI remains usable.
- [ ] Callee not in thread: web callee is on another route, incoming overlay still appears and answer/decline works.
- [ ] Remote leave: after connect, one side leaves and the other side reconciles to end promptly.
- [ ] App open but not in thread: both users stay in app on non-chat routes and call state still behaves correctly.
- [ ] Cold start / reopen observations: reopen the browser during ringing and record whether incoming ringing is recovered correctly.

### Video
- [ ] Answer: native caller starts, web callee answers, local/remote media render on both sides, end clears both sides.
- [ ] Decline: web callee declines, native caller clears, backend row ends as `declined`.
- [ ] Missed: let 30 seconds expire with no answer, both sides clear, backend row ends as `missed`.
- [ ] Caller navigates away: native caller leaves the thread while ringing or active, global call UI remains usable.
- [ ] Callee not in thread: web callee is on another route, incoming overlay still appears and answer/decline works.
- [ ] Remote leave: after connect, one side leaves and the other side reconciles to end promptly.
- [ ] App open but not in thread: both users stay in app on non-chat routes and call state still behaves correctly.
- [ ] Cold start / reopen observations: reopen the browser during ringing and record whether incoming ringing is recovered correctly.

## Native -> Native

### Voice
- [ ] Answer: caller starts on one device, callee answers on another, both connect and clear correctly on end.
- [ ] Decline: callee declines, caller clears, backend row ends as `declined`.
- [ ] Missed: let 30 seconds expire with no answer, both sides clear, backend row ends as `missed`.
- [ ] Caller navigates away: caller leaves the thread while ringing or active, global call UI remains usable.
- [ ] Callee not in thread: callee is on another screen, incoming overlay still appears and answer/decline works.
- [ ] Remote leave: after connect, one side leaves and the other side reconciles to end promptly.
- [ ] App open but not in thread: both users stay in app on non-chat routes and call state still behaves correctly.
- [ ] Cold start / reopen observations: reopen the app during ringing and record whether incoming ringing is recovered correctly.

### Video
- [ ] Answer: caller starts on one device, callee answers on another, local/remote media render on both sides, end clears both sides.
- [ ] Decline: callee declines, caller clears, backend row ends as `declined`.
- [ ] Missed: let 30 seconds expire with no answer, both sides clear, backend row ends as `missed`.
- [ ] Caller navigates away: caller leaves the thread while ringing or active, global call UI remains usable.
- [ ] Callee not in thread: callee is on another screen, incoming overlay still appears and answer/decline works.
- [ ] Remote leave: after connect, one side leaves and the other side reconciles to end promptly.
- [ ] App open but not in thread: both users stay in app on non-chat routes and call state still behaves correctly.
- [ ] Cold start / reopen observations: reopen the app during ringing and record whether incoming ringing is recovered correctly.
