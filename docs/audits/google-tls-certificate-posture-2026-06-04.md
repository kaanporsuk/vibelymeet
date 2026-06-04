# Google TLS certificate posture - 2026-06-04

## Trigger

Google Cloud sent an action-advised notice for the Q2 2026 shift of many Google service TLS endpoints from RSA leaf certificates to ECDSA leaf certificates. The risk applies when a client pins Google certificates, pins intermediate/root CAs, or uses a custom/limited trust store that does not track Google Trust Services roots.

Official references:

- Google intermediate CA change notice: https://developers.google.com/public-key-infrastructure/updates/august2025-intermediate-update
- Google Trust Services connecting guidance: https://pki.goog/faq/#connecting-to-google

## Decision

No application code, native config, Supabase Edge Function code, or public API/type changes are required in this repo.

Do not add Google Trust Services root certificates, intermediate certificates, leaf certificates, public key hashes, or certificate pins to the app. The correct posture is to keep using the platform/runtime trust stores and avoid hardcoded Google CA assumptions.

## Codebase evidence

Scope inspected: active repo at `/Users/kaanporsuk/Documents/Vibely/Git/vibelymeet`. Local archives under the parent workspace are historical and not treated as shipping source.

Findings:

- No tracked custom CA bundles or trust-store assets were found (`.pem`, `.crt`, `.cer`, `.der`, `.jks`, `.p12`, `.pfx`, `.keystore`).
- No tracked runtime source/config contains native certificate pinning hooks such as `NSPinnedDomains`, TrustKit, Android `network_security_config`, OkHttp `CertificatePinner`, or React Native SSL-pinning packages.
- No tracked runtime source/config contains custom CA override hooks such as `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`, `Deno.createHttpClient`, or Deno `caCerts`.
- Google-facing app usage is managed through Supabase OAuth redirects, Google-hosted web fonts, Expo Google font packages, and Android speech-service package names.
- The `geocode` and `forward-geocode` Supabase Edge Functions call Nominatim/OpenStreetMap, not Google APIs.

Repeat the static repo guard with:

```bash
npm run test:google-tls-posture
```

## Operator follow-up

Codebase closure is complete. The remaining checks are environment/operations owned:

- Confirm Vercel, Supabase Edge Functions, GitHub Actions, EAS builds, and any self-hosted jobs do not set custom CA/trust-store env vars or mount custom CA bundles.
- Confirm there are no separate backend repos, Java services, custom Linux images, IoT/embedded clients, or old mobile apps tied to the same Google Cloud/Firebase project that maintain their own trust stores.
- Run Google OAuth smoke on web and mobile before and after June 15, 2026.
- Monitor Sentry, Supabase, and Vercel logs after June 15, 2026 for TLS/certificate validation failures on Google OAuth or Google-hosted assets.

## Acceptance criteria

- `npm run test:google-tls-posture` passes.
- Web Google sign-in/linking works.
- Mobile Google OAuth through Expo WebBrowser works.
- Ops confirms no custom trust stores exist outside this repo for clients connected to the same Google Cloud/Firebase project.
