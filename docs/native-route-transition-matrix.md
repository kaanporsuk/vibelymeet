# Native Route Transition Matrix (Sprint 1 Lock)

Date: 2026-04-04
Scope: structural navigation contracts for auth, onboarding, tabs, lobby/chat/ready/date/settings.

## Shell routes
- Entry gate: / (app/index.tsx)
  - no session -> /(auth)/sign-in
  - session + onboarding incomplete -> /(onboarding)
  - session + onboarding complete -> /(tabs)

- Auth group: /(auth)
  - /(auth)/sign-in
  - /(auth)/sign-up
  - /(auth)/reset-password

- Main tabs: /(tabs)
  - /(tabs)/index
  - /(tabs)/events/*
  - /(tabs)/matches/*
  - /(tabs)/profile/*

- Full-screen non-tab flows
  - /event/[eventId]/lobby
  - /chat/[id]
  - /ready/[id]
  - /date/[id]
  - /settings/*

## Locked transition rules
1. Auth success always returns through root gate (/) or replaces to /(tabs) only after session validity is confirmed.
2. Onboarding completion must refresh onboarding truth and route to /(tabs) or /(tabs)/events.
3. Event path progression:
   - /(tabs)/events -> /(tabs)/events/[id] -> /event/[eventId]/lobby -> /ready/[id] -> /date/[id]
4. Ready Gate terminal transitions:
   - both ready -> /date/[id]
   - forfeit/expired -> /event/[eventId]/lobby when event context exists, else /(tabs)
5. Date terminal transitions:
   - end -> post-date survey surface -> /event/[eventId]/lobby when event context exists, else /(tabs)/events
6. Settings is stack-based under /settings and should not own domain transitions for queue/date/match lifecycle.

## Guardrails
- No direct client-owned writes for queue/date/match lifecycle.
- Route handlers can trigger backend-owned transition contracts only.
- Deferred routes/features remain out of Sprint 1 implementation scope.
