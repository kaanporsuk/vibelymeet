type UserMetadata = Record<string, unknown> | null | undefined;

function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstWord(value: string | null): string | null {
  if (!value) return null;
  const [first] = value.split(/\s+/);
  return trimToNull(first);
}

export function pickAuthMetadataFirstName(userMetadata: UserMetadata): string | null {
  const metadata = userMetadata ?? {};

  const givenName = firstWord(trimToNull(metadata.given_name));
  if (givenName) return givenName;

  const name = firstWord(trimToNull(metadata.name));
  if (name) return name;

  const fullName = firstWord(trimToNull(metadata.full_name));
  if (fullName) return fullName;

  return null;
}

export function pickOnboardingNamePrefill(input: {
  currentName: string | null | undefined;
  profileName: string | null | undefined;
  userMetadata: UserMetadata;
}): string | null {
  const currentName = trimToNull(input.currentName);
  if (currentName) return currentName;

  const profileName = trimToNull(input.profileName);
  if (profileName) return profileName;

  return pickAuthMetadataFirstName(input.userMetadata);
}
