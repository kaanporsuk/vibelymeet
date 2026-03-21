/**
 * Lifestyle display + options — parity with web `src/components/LifestyleDetails.tsx`.
 */
export type LifestyleOption = { value: string; label: string; emoji: string };

export type LifestyleCategory = {
  id: string;
  label: string;
  options: LifestyleOption[];
};

/** Same ids + values + labels + emoji as web `lifestyleItems`. */
export const LIFESTYLE_ITEMS: LifestyleCategory[] = [
  {
    id: 'drinking',
    label: 'Drinking',
    options: [
      { value: 'never', label: 'Never', emoji: '🚫' },
      { value: 'sometimes', label: 'Socially', emoji: '🍸' },
      { value: 'often', label: 'Regularly', emoji: '🍷' },
    ],
  },
  {
    id: 'smoking',
    label: 'Smoking',
    options: [
      { value: 'never', label: 'Never', emoji: '🚭' },
      { value: 'sometimes', label: 'Sometimes', emoji: '🌬️' },
      { value: 'often', label: 'Regularly', emoji: '🚬' },
    ],
  },
  {
    id: 'exercise',
    label: 'Exercise',
    options: [
      { value: 'never', label: 'Never', emoji: '🛋️' },
      { value: 'sometimes', label: 'Sometimes', emoji: '🚶' },
      { value: 'often', label: 'Active', emoji: '💪' },
    ],
  },
  {
    id: 'diet',
    label: 'Diet',
    options: [
      { value: 'omnivore', label: 'Omnivore', emoji: '🍖' },
      { value: 'vegetarian', label: 'Vegetarian', emoji: '🥗' },
      { value: 'vegan', label: 'Vegan', emoji: '🌱' },
      { value: 'other', label: 'Other', emoji: '🍽️' },
      { value: 'halal', label: 'Halal', emoji: '☪️' },
      { value: 'kosher', label: 'Kosher', emoji: '✡️' },
      { value: 'no-preference', label: 'No preference', emoji: '🍽️' },
    ],
  },
  {
    id: 'pets',
    label: 'Pets',
    options: [
      { value: 'none', label: 'None', emoji: '🚫' },
      { value: 'dog', label: 'Dog', emoji: '🐕' },
      { value: 'cat', label: 'Cat', emoji: '🐱' },
      { value: 'other', label: 'Other', emoji: '🐾' },
      { value: 'both', label: 'Both', emoji: '🐕' },
    ],
  },
  {
    id: 'children',
    label: 'Children',
    options: [
      { value: 'have', label: 'Have kids', emoji: '👨‍👧' },
      { value: 'want', label: 'Want someday', emoji: '🍼' },
      { value: 'dont-want', label: "Don't want", emoji: '🚫' },
      { value: 'not-sure', label: 'Not sure', emoji: '🤔' },
    ],
  },
];

/** Map legacy native / DB values to canonical web option values. */
export function normalizeLifestyleValue(categoryId: string, stored: string): string {
  const s = stored.trim();
  const aliases: Record<string, Record<string, string>> = {
    drinking: { socially: 'sometimes', regularly: 'often' },
    smoking: { socially: 'sometimes', regularly: 'often' },
    exercise: { daily: 'often' },
    diet: { 'no-preference': 'omnivore' },
  };
  return aliases[categoryId]?.[s] ?? s;
}

export type LifestyleChip = { id: string; emoji: string; label: string };

export function getLifestyleDisplayChips(values: Record<string, string> | null | undefined): LifestyleChip[] {
  if (!values) return [];
  const out: LifestyleChip[] = [];
  for (const item of LIFESTYLE_ITEMS) {
    const raw = values[item.id];
    if (raw == null || String(raw).trim() === '') continue;
    const norm = normalizeLifestyleValue(item.id, String(raw));
    let option = item.options.find((o) => o.value === norm);
    if (!option) option = item.options.find((o) => o.value === raw);
    if (option) {
      out.push({ id: item.id, emoji: option.emoji, label: option.label });
    } else {
      out.push({ id: item.id, emoji: '✨', label: String(raw) });
    }
  }
  return out;
}
