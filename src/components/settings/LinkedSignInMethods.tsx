/**
 * LinkedSignInMethods.tsx (Web)
 *
 * Displays currently linked sign-in providers (Google, Apple, Email, Phone)
 * and allows users to link additional providers to prevent account fragmentation.
 */

import { useEffect, useState } from 'react';
import { useIdentityLinking, type ProviderType } from '@/hooks/useIdentityLinking';
import { Button } from '@/components/ui/button';
import { Loader2, Check, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

interface ProviderInfo {
  id: ProviderType;
  label: string;
  isAvailable: boolean;
}

const AVAILABLE_PROVIDERS: ProviderInfo[] = [
  { id: 'google', label: 'Google', isAvailable: true },
  { id: 'apple', label: 'Apple', isAvailable: true },
];

export function LinkedSignInMethods() {
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

  if (isLoading) {
    return (
      <div className="space-y-2 rounded-xl bg-secondary/30 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider">Linked sign-in methods</p>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl bg-secondary/30 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider">Linked sign-in methods</p>
        <p className="text-xs text-muted-foreground mt-1">
          Link Google or Apple to this account to prevent sign-in fragmentation.
        </p>
      </div>

      <div className="space-y-2">
        {AVAILABLE_PROVIDERS.map(provider => {
          const isLinked = isProviderLinked(provider.id);
          const isCurrentlyLinking = isLinking && linkingProvider === provider.id;

          return (
            <motion.div
              key={provider.id}
              layout
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 hover:bg-secondary/70 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="capitalize text-sm font-medium">{provider.label}</div>
              </div>

              <AnimatePresence mode="wait">
                {isLinked ? (
                  <motion.div
                    key="linked"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-1 text-xs font-medium text-green-500"
                  >
                    <Check className="w-4 h-4" />
                    <span>Linked</span>
                  </motion.div>
                ) : (
                  <motion.button
                    key="link-button"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    onClick={() => handleLinkProvider(provider.id)}
                    disabled={isCurrentlyLinking}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-gradient-to-r from-neon-cyan via-gradient-pink to-gradient-purple hover:opacity-90 disabled:opacity-50 transition-opacity text-white"
                  >
                    {isCurrentlyLinking ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Linking...</span>
                      </>
                    ) : (
                      <span>Link {provider.label}</span>
                    )}
                  </motion.button>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {displayError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/25"
          >
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-destructive" />
            <p className="text-xs text-destructive">{displayError}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-xs text-muted-foreground mt-2">
        Note: Unlinking is not supported. If you need to remove a sign-in method, you'll need to delete and recreate your account.
      </p>
    </div>
  );
}
