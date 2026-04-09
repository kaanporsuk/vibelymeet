/**
 * Regression checks for the shared Supabase auth-return URL contract
 * (`supabase/functions/_shared/authRedirect.ts`) used by web and native.
 *
 * Run: npm run test:auth-redirect-contract
 */
import assert from "node:assert/strict";
import {
  hasPasswordRecoveryIntent,
  parseSupabaseAuthReturnUrl,
} from "../supabase/functions/_shared/authRedirect.ts";

/**
 * Classifies a URL the same way the web entry path does before session exchange:
 * recovery return URLs resolve to ready vs invalid; ordinary auth returns stay none.
 */
function classifyRecoveryReturnUrl(url: string): "none" | "ready" | "invalid" {
  const parsed = parseSupabaseAuthReturnUrl(url);
  if (!parsed.isValidUrl || !parsed.hasAuthPayload) return "none";
  if (!hasPasswordRecoveryIntent(parsed.type, [parsed.pathname])) return "none";
  if (parsed.authError) return "invalid";
  return "ready";
}

const ORIGIN = "https://vibelymeet.com";

// Valid implicit recovery session (hash tokens + explicit recovery type)
const VALID_RECOVERY_HASH = `${ORIGIN}/reset-password#access_token=at&refresh_token=rt&type=recovery`;

// Same path but server-side error surfaced by Supabase on the redirect
const INVALID_RECOVERY_HASH = `${ORIGIN}/reset-password#error=access_denied&error_description=expired&type=recovery`;

// Typical OAuth / magic-link PKCE return — not a password recovery flow
const NORMAL_AUTH_PKCE = `${ORIGIN}/auth?code=pkce-exchange-code-123`;

// No tokens, no code, no error — nothing to classify as an auth return
const EMPTY_RESET_PAGE = `${ORIGIN}/reset-password`;

function main() {
  assert.equal(
    classifyRecoveryReturnUrl(VALID_RECOVERY_HASH),
    "ready",
    "valid recovery return should classify as ready",
  );

  assert.equal(
    classifyRecoveryReturnUrl(INVALID_RECOVERY_HASH),
    "invalid",
    "recovery URL carrying an auth error should classify as invalid",
  );

  assert.equal(
    classifyRecoveryReturnUrl(NORMAL_AUTH_PKCE),
    "none",
    "normal auth PKCE return must not be treated as recovery",
  );

  assert.equal(
    classifyRecoveryReturnUrl(EMPTY_RESET_PAGE),
    "none",
    "reset-password page without auth payload should be none",
  );

  assert.equal(classifyRecoveryReturnUrl(""), "none", "empty URL should be none");

  const malformed = parseSupabaseAuthReturnUrl("not-a-url");
  assert.equal(malformed.isValidUrl, false);
  assert.equal(classifyRecoveryReturnUrl("not-a-url"), "none");

  console.log("auth-redirect-contract: all assertions passed");
}

main();
