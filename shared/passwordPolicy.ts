export const PASSWORD_MIN_LENGTH = 12;

const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "qwerty",
  "qwerty123",
  "qwerty12345",
  "123456789012",
  "1234567890",
  "111111111111",
  "000000000000",
  "iloveyou",
  "letmein",
  "adminadmin",
  "welcome123",
  "monkey123",
  "dragon123",
  "vibely123",
  "vibelymeet",
]);

const WEAK_SUBSTRINGS = [
  "password",
  "qwerty",
  "asdf",
  "zxcv",
  "123456",
  "654321",
  "111111",
  "000000",
  "letmein",
  "welcome",
  "iloveyou",
  "vibely",
];

export type PasswordPolicyResult = {
  valid: boolean;
  message: string | null;
};

function characterClassCount(password: string): number {
  return [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
}

function hasLowVariety(password: string): boolean {
  return new Set(password.toLowerCase()).size <= 4;
}

function looksLikeRepeatedPattern(password: string): boolean {
  return /^(.{1,4})\1+$/i.test(password);
}

export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  const value = password.trim();
  const lower = value.toLowerCase();

  if (value.length < PASSWORD_MIN_LENGTH) {
    return {
      valid: false,
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }

  if (COMMON_PASSWORDS.has(lower) || WEAK_SUBSTRINGS.some((part) => lower.includes(part))) {
    return {
      valid: false,
      message: "Choose a less common password.",
    };
  }

  if (hasLowVariety(value) || looksLikeRepeatedPattern(value)) {
    return {
      valid: false,
      message: "Use a stronger password with more variety.",
    };
  }

  const classes = characterClassCount(value);
  const longPassphrase = value.length >= 20 && /[a-z]/i.test(value);
  if (classes < 3 && !longPassphrase) {
    return {
      valid: false,
      message: "Use a stronger password with at least three character types.",
    };
  }

  return { valid: true, message: null };
}

export function passwordPolicyMessage(): string {
  return `Use at least ${PASSWORD_MIN_LENGTH} characters and avoid common passwords.`;
}
