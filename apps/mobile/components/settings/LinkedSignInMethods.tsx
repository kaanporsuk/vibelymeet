/**
 * LinkedSignInMethods.tsx (Native / React Native)
 *
 * Displays currently linked sign-in providers (Google, Apple, Email, Phone)
 * and allows users to link additional providers to prevent account fragmentation.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Platform,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIdentityLinking, type ProviderType } from '../../hooks/useIdentityLinking';
import { withAlpha } from '@/lib/colorUtils';

interface LinkedSignInMethodsProps {
  theme: any;
}

interface ProviderInfo {
  id: ProviderType;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  isAvailable: boolean;
}

const AVAILABLE_PROVIDERS: ProviderInfo[] = [
  { id: 'google', label: 'Google', icon: 'logo-google', isAvailable: true },
  { id: 'apple', label: 'Apple', icon: 'logo-apple', isAvailable: Platform.OS === 'ios' },
];

export function LinkedSignInMethods({ theme }: LinkedSignInMethodsProps) {
  const {
    identities,
    isLoading,
    error,
    isLinking,
    linkingProvider,
    fetchIdentities,
    linkProvider,
    isProviderLinked,
  } = useIdentityLinking();

  const [displayError, setDisplayError] = useState<string | null>(null);

  // Update display error when linking error occurs
  useEffect(() => {
    if (error) {
      setDisplayError(error);
      const timer = setTimeout(() => setDisplayError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleLinkProvider = async (provider: ProviderType) => {
    setDisplayError(null);

    if (isProviderLinked(provider)) {
      setDisplayError(`${provider} is already linked to your account.`);
      return;
    }

    try {
      await linkProvider(provider);
      // Refetch identities after successful linking
      setTimeout(() => {
        fetchIdentities();
      }, 1000);
    } catch (err) {
      const message = err instanceof Error ? err.message : `Failed to link ${provider}`;
      setDisplayError(message);
    }
  };

  const availableProviders = AVAILABLE_PROVIDERS.filter(p => p.isAvailable);

  return (
    <View style={{ marginVertical: 16 }}>
      <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>LINKED SIGN-IN METHODS</Text>

      <View
        style={[
          styles.containerCard,
          {
            backgroundColor: theme.surfaceSubtle,
            borderColor: theme.border,
          },
        ]}
      >
        {isLoading ? (
          <View style={styles.centerLoader}>
            <ActivityIndicator size="small" color={theme.tint} />
          </View>
        ) : (
          <>
            <View style={styles.descriptionBox}>
              <Text style={[styles.descriptionText, { color: theme.mutedForeground }]}>
                Link Google or Apple to this account to prevent sign-in fragmentation.
              </Text>
            </View>

            {availableProviders.map((provider, idx) => {
              const isLinked = isProviderLinked(provider.id);
              const isCurrentlyLinking = isLinking && linkingProvider === provider.id;

              return (
                <View key={provider.id}>
                  <Pressable
                    style={[
                      styles.providerRow,
                      {
                        backgroundColor: theme.surface,
                        borderBottomColor: idx < availableProviders.length - 1 ? theme.border : 'transparent',
                      },
                    ]}
                    onPress={() => !isLinked && !isCurrentlyLinking && handleLinkProvider(provider.id)}
                    disabled={isLinked || isCurrentlyLinking}
                  >
                    <View style={styles.providerLeft}>
                      <Ionicons
                        name={provider.icon}
                        size={20}
                        color={isLinked ? theme.success : theme.tint}
                        style={{ marginRight: 12 }}
                      />
                      <Text style={[styles.providerLabel, { color: theme.text }]}>{provider.label}</Text>
                    </View>

                    {isCurrentlyLinking ? (
                      <ActivityIndicator size="small" color={theme.tint} />
                    ) : isLinked ? (
                      <View style={styles.linkedBadge}>
                        <Ionicons name="checkmark-circle" size={18} color={theme.success} />
                        <Text style={[styles.linkedText, { color: theme.success }]}>Linked</Text>
                      </View>
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                    )}
                  </Pressable>
                </View>
              );
            })}

            {displayError && (
              <View
                style={[
                  styles.errorBox,
                  {
                    backgroundColor: withAlpha(theme.danger, 0.1),
                    borderColor: withAlpha(theme.danger, 0.3),
                  },
                ]}
              >
                <Ionicons name="alert-circle" size={16} color={theme.danger} style={{ marginRight: 8 }} />
                <Text style={[styles.errorText, { color: theme.danger }]}>{displayError}</Text>
              </View>
            )}

            <View style={[styles.noteBox, { backgroundColor: withAlpha(theme.tint, 0.08) }]}>
              <Text style={[styles.noteText, { color: theme.mutedForeground }]}>
                Note: Unlinking is not supported. You'll need to delete and recreate your account to remove a sign-in method.
              </Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.2,
    paddingLeft: 4,
    marginBottom: 12,
  },
  containerCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden' as const,
  },
  centerLoader: {
    height: 60,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  descriptionBox: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
  descriptionText: {
    fontSize: 13,
    lineHeight: 18,
  },
  providerRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  providerLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  providerLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  linkedBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  linkedText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  errorBox: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  errorText: {
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  noteBox: {
    marginHorizontal: 16,
    marginBottom: 12,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  noteText: {
    fontSize: 11,
    lineHeight: 15,
  },
});
