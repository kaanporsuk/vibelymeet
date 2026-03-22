export const EVENT_LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'pl', label: 'Polski', flag: '🇵🇱' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'pt', label: 'Português', flag: '🇵🇹' },
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱' },
  { code: 'tr', label: 'Türkçe', flag: '🇹🇷' },
  { code: 'sv', label: 'Svenska', flag: '🇸🇪' },
  { code: 'da', label: 'Dansk', flag: '🇩🇰' },
  { code: 'no', label: 'Norsk', flag: '🇳🇴' },
  { code: 'fi', label: 'Suomi', flag: '🇫🇮' },
  { code: 'el', label: 'Ελληνικά', flag: '🇬🇷' },
  { code: 'cs', label: 'Čeština', flag: '🇨🇿' },
  { code: 'ro', label: 'Română', flag: '🇷🇴' },
  { code: 'hu', label: 'Magyar', flag: '🇭🇺' },
  { code: 'uk', label: 'Українська', flag: '🇺🇦' },
  { code: 'hr', label: 'Hrvatski', flag: '🇭🇷' },
  { code: 'bg', label: 'Български', flag: '🇧🇬' },
  { code: 'sr', label: 'Srpski', flag: '🇷🇸' },
  { code: 'sk', label: 'Slovenčina', flag: '🇸🇰' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
] as const;

export type EventLanguageCode = typeof EVENT_LANGUAGES[number]['code'];

export function getLanguageLabel(code: string | null | undefined): { label: string; flag: string } | null {
  if (!code) return null;
  const lang = EVENT_LANGUAGES.find(l => l.code === code);
  return lang ? { label: lang.label, flag: lang.flag } : null;
}
