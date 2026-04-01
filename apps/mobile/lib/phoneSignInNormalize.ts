/**
 * E.164 normalization for native phone sign-in (Supabase signInWithOtp).
 * Aligns with PhoneVerificationFlow: strip non-digits, strip leading national zeros.
 */
export function normalizeNationalDigits(rawInput: string): string {
  return rawInput.replace(/\D/g, '').replace(/^0+/, '');
}

export function buildPhoneE164(countryDialCode: string, phoneInput: string): string {
  const national = normalizeNationalDigits(phoneInput);
  const cc = countryDialCode.startsWith('+') ? countryDialCode : `+${countryDialCode}`;
  return `${cc}${national}`;
}

/**
 * ITU-T E.164: max 15 digits total (country + national). Reject +0… / malformed.
 */
export function isPlausibleE164DigitCount(e164: string): boolean {
  if (!/^\+\d+$/.test(e164)) return false;
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return false;
  if (digits[0] === '0') return false;
  return true;
}

/**
 * Same practical bounds as PhoneVerificationFlow (+ string length includes '+').
 */
export function isValidSignInPhone(countryDialCode: string, phoneInput: string): {
  e164: string;
  nationalDigits: string;
  valid: boolean;
} {
  const nationalDigits = normalizeNationalDigits(phoneInput);
  const e164 = buildPhoneE164(countryDialCode, phoneInput);
  if (nationalDigits.length < 4) return { e164, nationalDigits, valid: false };
  if (e164.length < 10 || e164.length > 16) return { e164, nationalDigits, valid: false };
  if (!isPlausibleE164DigitCount(e164)) return { e164, nationalDigits, valid: false };
  return { e164, nationalDigits, valid: true };
}
