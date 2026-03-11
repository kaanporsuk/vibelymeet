#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PARITY="$REPO_ROOT/scripts/check_migration_parity.sh"

echo "# Vibely rebuild rehearsal checklist (read-only)"
echo
echo "This script does NOT execute rebuild actions. It prints the operator checklist and highlights migration parity state."
echo
echo "## 0) Preconditions"
echo "- You have access to required provider dashboards (Supabase/Stripe/Bunny/Daily/Resend/Twilio/OneSignal)."
echo "- You have a local .env.cursor.local (gitignored) with SUPABASE_DB_URL for read-only parity inspection."
echo
echo "## 1) Migration parity (must be clean before any db push/pull/repair)"
if [ -x "$PARITY" ]; then
  "$PARITY" || true
else
  echo "Missing $PARITY (run from repo root after pulling latest)."
fi

echo
echo "## 2) Env/secrets readiness (do not print secret values)"
echo "Frontend Vite vars:"
echo "- VITE_SUPABASE_URL"
echo "- VITE_SUPABASE_PUBLISHABLE_KEY"
echo "- VITE_BUNNY_STREAM_CDN_HOSTNAME"
echo "- VITE_BUNNY_CDN_HOSTNAME"
echo "- VITE_POSTHOG_API_KEY"
echo
echo "Edge Function secrets (must exist in Supabase project):"
echo "- SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY"
echo "- BUNNY_STORAGE_ZONE, BUNNY_STORAGE_API_KEY, BUNNY_CDN_HOSTNAME"
echo "- BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_API_KEY, BUNNY_STREAM_CDN_HOSTNAME"
echo "- DAILY_API_KEY, DAILY_DOMAIN"
echo "- STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_MONTHLY_PRICE_ID, STRIPE_ANNUAL_PRICE_ID"
echo "- RESEND_API_KEY"
echo "- TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID"
echo "- ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY"
echo "- CRON_SECRET, UNSUB_HMAC_SECRET, PUSH_WEBHOOK_SECRET, BUNNY_VIDEO_WEBHOOK_TOKEN"
echo
echo "## 3) Edge Function deployment readiness"
echo "- Confirm all expected functions exist in project and match verify_jwt posture in supabase/config.toml."
echo "- Spot-check hardened public endpoints: stripe-webhook, push-webhook, video-webhook, email-drip, unsubscribe, generate-daily-drops, request-account-deletion."
echo "- Spot-check JWT-at-gateway endpoints used by app: daily-room, forward-geocode, create-checkout-session, etc."
echo
echo "## 4) Storage/provider checks"
echo "Supabase storage buckets in use:"
echo "- chat-videos (anon read policy for playback must exist)"
echo "- proof-selfies"
echo
echo "Bunny checks:"
echo "- Bunny Storage uploads work (voice + chat video)."
echo "- Bunny Stream webhook URL includes ?token=... and updates profile video status."
echo
echo "Stripe checks:"
echo "- Checkout + portal create sessions succeed; webhook delivers and settles state."
echo
echo "Daily checks:"
echo "- daily-room works with verify_jwt=true; unload cleanup uses fetch keepalive."
echo
echo "## 5) Smoke test flows"
echo "- New Bunny-hosted chat video send/play"
echo "- Old Supabase-hosted chat video play"
echo "- Unsubscribe link"
echo "- Admin geocode + create event"
echo "- Daily video date start/end/tab close"
