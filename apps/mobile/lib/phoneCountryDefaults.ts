export type PhoneCountryDefault = {
  dialCode: string;
  countryName: string;
};

export const FALLBACK_PHONE_COUNTRY: PhoneCountryDefault = {
  dialCode: '+1',
  countryName: 'United States',
};

const REGION_PHONE_DEFAULTS: Record<string, PhoneCountryDefault> = {
  US: { dialCode: '+1', countryName: 'United States' },
  CA: { dialCode: '+1', countryName: 'Canada' },
  GB: { dialCode: '+44', countryName: 'United Kingdom' },
  UK: { dialCode: '+44', countryName: 'United Kingdom' },
  DE: { dialCode: '+49', countryName: 'Germany' },
  FR: { dialCode: '+33', countryName: 'France' },
  PL: { dialCode: '+48', countryName: 'Poland' },
  ES: { dialCode: '+34', countryName: 'Spain' },
  IN: { dialCode: '+91', countryName: 'India' },
  TR: { dialCode: '+90', countryName: 'Türkiye' },
};

export function getPhoneCountryDefaultForRegion(region?: string | null): PhoneCountryDefault {
  const normalized = (region ?? '').toUpperCase();
  return REGION_PHONE_DEFAULTS[normalized] ?? FALLBACK_PHONE_COUNTRY;
}
