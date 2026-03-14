# Native account / verification disposition (Sprint 2)

Repo-truth decisions for delete-account, phone verification, and email verification. No code changes to these flows in Sprint 2; document only.

---

## 1. Delete account

**Web behavior:** Settings → Delete Account → modal → `useDeleteAccount` → `delete-account` Edge Function (reason optional) → success → signOut, clear cache, navigate to `/`. Backend: pending deletion record; grace period; Stripe/subscription cleanup.

**Native current state:** Settings → "Delete account" → Alert: "Account deletion is available on web. Open vibelymeet.com…" (no EF call).

**Decision: Keep web handoff for launch.**

- **Rationale:** Backend contract is identical; native could call `delete-account` EF then signOut and clear local state. Implementing native adds: confirmation UI, reason capture (optional), error handling, and testing surface. For v1 launch, App Store allows linking to web for account deletion; risk is low if the link is clear and the web flow works.
- **Implementation plan when promoted:** Add native "Delete account" in settings that either (a) opens `https://vibelymeet.com/delete-account` in browser (current), or (b) calls `delete-account` EF with optional reason, then signs out and navigates to auth. Option (b) is a small, safe addition when product prioritizes it.

---

## 2. Phone verification

**Web behavior:** Profile/Settings → Phone verification modal → `PhoneVerification` → `phone-verify` EF (send OTP, check OTP) → Twilio Verify; profile `phone_verified` updated by EF.

**Native current state:** Profile mentions "Email, photo, and phone verification available on web." No native phone verification UI.

**Decision: Keep web handoff for launch.**

- **Rationale:** Phone verification is not a hard blocker for store approval. Native would require: phone input, OTP input, same `phone-verify` EF contract, and profile refetch. Deferring keeps Sprint 2 scope bounded; web flow remains valid for users who need to verify.
- **Implementation plan when promoted:** Add a "Verify phone" row in settings or profile that opens web or, when native is prioritized, a modal that calls `phone-verify` send/check and updates local profile state.

---

## 3. Email verification

**Web behavior:** Supabase Auth "Confirm email" plus optional in-app `EmailVerificationFlow` → `email-verification` EF (send OTP, verify OTP) → profile `email_verified` updated.

**Native current state:** No dedicated email verification screen; auth flows rely on Supabase email confirmation link.

**Decision: Keep web handoff for launch.**

- **Rationale:** Supabase Auth email confirmation works out of the box; in-app OTP email verification is an extra layer. Native parity would require send/verify UI and `email-verification` EF. Defer to reduce scope; no store requirement for in-app email OTP.
- **Implementation plan when promoted:** Optional "Verify email" in settings that opens web or calls `email-verification` send/verify when product prioritizes it.

---

## Summary

| Flow              | Native v1 launch     | Backend contract  | When to implement natively      |
|-------------------|----------------------|-------------------|----------------------------------|
| Delete account    | Web handoff (link)   | `delete-account`  | When product wants in-app flow   |
| Phone verification| Web handoff          | `phone-verify`    | When product wants in-app flow   |
| Email verification| Web handoff / Auth   | `email-verification` | When product wants in-app OTP |

No backend or EF changes required for these dispositions. Native settings already point users to web where appropriate.
