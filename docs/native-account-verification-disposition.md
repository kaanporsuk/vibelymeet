# Native account / verification disposition (Sprint 2 + Sprint 3)

Repo-truth decisions for delete-account, phone verification, and email verification.

---

## 1. Delete account

**Web behavior:** Settings → Delete Account → modal → `useDeleteAccount` → `delete-account` Edge Function (reason optional) → success → signOut, clear cache, navigate to `/`. Backend: pending deletion record; grace period; Stripe/subscription cleanup.

**Native (Sprint 3):** Implemented. Settings → "Delete My Account" → destructive confirmation Alert → call `delete-account` EF (body `{ reason: null }`) → on success signOut + `router.replace('/(auth)/sign-in')`; on failure show error Alert. Same backend contract as web.

**Decision: Native flow implemented for launch.** No web handoff required.

---

## 2. Phone verification

**Web behavior:** Profile/Settings → Phone verification modal → `PhoneVerification` → `phone-verify` EF (send OTP, check OTP) → Twilio Verify; profile `phone_verified` updated by EF.

**Native current state:** Profile mentions "Email, photo, and phone verification available on web." No native phone verification UI.

**Final launch recommendation (Sprint 3): Non-blocker. Keep web handoff for launch.**

- **Rationale:** Not required for App Store/Play approval. Simultaneous iOS/Android launch is not blocked. Native implementation would add phone input, OTP UI, `phone-verify` EF calls, and profile refetch. Web flow is sufficient for v1; users can verify via web if needed.
- **When to implement natively:** When product prioritizes in-app phone verification (e.g. conversion or trust signals).

---

## 3. Email verification

**Web behavior:** Supabase Auth "Confirm email" plus optional in-app `EmailVerificationFlow` → `email-verification` EF (send OTP, verify OTP) → profile `email_verified` updated.

**Native current state:** No dedicated email verification screen; auth flows rely on Supabase email confirmation link.

**Final launch recommendation (Sprint 3): Non-blocker. Keep web handoff for launch.**

- **Rationale:** Supabase Auth email confirmation (link in email) works without in-app OTP. No store requirement for in-app email OTP. Native parity would require send/verify UI and `email-verification` EF. Web handoff is sufficient for v1.
- **When to implement natively:** When product prioritizes in-app email verification flow.

---

## Summary

| Flow              | Native v1 launch        | Backend contract       | Note |
|-------------------|-------------------------|------------------------|------|
| Delete account    | **Implemented (Sprint 3)** | `delete-account` EF    | Confirmation → EF → signOut → auth. |
| Phone verification| **Web handoff** (non-blocker) | `phone-verify` EF   | Keep for launch; implement natively when prioritized. |
| Email verification| **Web handoff** (non-blocker) | `email-verification` EF | Keep for launch; Supabase Auth link sufficient. |

**Final launch recommendation:** Phone and email verification are **non-blockers**; neither is a hard blocker for simultaneous iOS/Android launch. Keep web handoff for both. Delete account is implemented natively. No backend or EF changes required.
