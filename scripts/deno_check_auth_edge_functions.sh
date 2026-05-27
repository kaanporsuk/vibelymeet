#!/usr/bin/env bash
set -euo pipefail

if ! command -v deno >/dev/null 2>&1; then
  echo "deno is required for auth Edge Function checks" >&2
  exit 1
fi

functions=(
  "supabase/functions/email-verification/index.ts"
  "supabase/functions/phone-verify/index.ts"
  "supabase/functions/delete-account/index.ts"
  "supabase/functions/request-account-deletion/index.ts"
  "supabase/functions/sync-revenuecat-subscriber/index.ts"
  "supabase/functions/revenuecat-webhook/index.ts"
  "supabase/functions/stripe-webhook/index.ts"
  "supabase/functions/push-webhook/index.ts"
  "supabase/functions/send-email/index.ts"
  "supabase/functions/create-credits-checkout/index.ts"
  "supabase/functions/get-chat-media-url/index.ts"
  "supabase/functions/video-date-daily-webhook/index.ts"
)

deno check --no-lock "${functions[@]}"
