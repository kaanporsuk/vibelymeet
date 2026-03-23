import ProfileStudio from './ProfileStudio';
import LegacyProfileScreen from './index.legacy';

/**
 * Profile tab entry: thin switch only — no hooks here.
 * Implementations live in ProfileStudio (default) and index.legacy (rollback).
 */
const USE_PROFILE_STUDIO = true;

export default function ProfileTabScreen() {
  if (USE_PROFILE_STUDIO) return <ProfileStudio />;
  return <LegacyProfileScreen />;
}
