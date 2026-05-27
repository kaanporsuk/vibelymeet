#!/usr/bin/env bash
set -euo pipefail

npm run test:auth-redirect-contract
npx tsx shared/authErrorCopy.test.ts
npx tsx shared/matching/resendEmailProviderOperationalQa.test.ts
npx tsx shared/matching/twilioPhoneVerificationQa.test.ts
npx tsx shared/profile/profileDirectPrivacyContracts.test.ts
npx tsx shared/profile/profileWritePrivilegeContracts.test.ts
npx tsx shared/matching/paymentEmailPhoneTrustSystemsClosure.test.ts
npx tsx shared/authRefreshPolicy.test.ts
npx tsx shared/accountDeletionReauthContracts.test.ts
