/**
 * LinkedSignInMethods.tsx (Web)
 *
 * Shows all Vibely sign-in methods and lets the user link or (where supported) unlink them.
 *
 * METHOD SEMANTICS
 * ────────────────
 * Google / Apple  → OAuth linking via Supabase linkIdentity() redirect.
 * Email password  → Two explicit cases:
 *   • User has session email (OAuth/email user) → "Add password" via updateUser({ password }).
 *     No email change; no confirmation email; effective immediately.
 *   • No session email (phone-only user) → "Add email" via updateUser({ email }).
 *     Sends confirmation link; email identity active after confirmation.
 * Phone           → OTP-only. updateUser({ phone }) + verifyOtp({ type: 'phone_change' }).
 *                   There is no phone+password sign-in mode in Vibely.
 *
 * REMOVAL
 * ───────
 * Unlink is shown only when canUnlinkProvider() is true (2+ identities linked).
 * The last remaining identity can never be removed.
 */

import { useEffect, useRef, useState } from 'react';
import { useIdentityLinking, type ProviderType } from '@/hooks/useIdentityLinking';
import { Button } from '@/components/ui/button';
import { Loader2, Check, AlertCircle, Mail, Phone, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ---------- types ----------

type AddEmailMode = null | 'add_password' | 'add_email' | 'email_pending';
type AddPhoneStep = null | 'phone' | 'otp';

// ---------- provider meta ----------

const PROVIDERS: { id: ProviderType; label: string }[] = [
  { id: 'google', label: 'Google' },
  { id: 'apple', label: 'Apple' },
  { id: 'email', label: 'Email & password' },
  { id: 'phone', label: 'Phone (SMS code)' },
];

// ---------- icons ----------

function ProviderIcon({ id }: { id: ProviderType }) {
  if (id === 'email') return <Mail className="w-4 h-4" />;
  if (id === 'phone') return <Phone className="w-4 h-4" />;
  if (id === 'google') {
    return (
      <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
    );
  }
  // apple
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  );
}

// ---------- component ----------

export function LinkedSignInMethods() {
  const {
    identities,
    isLoading,
    error,
    isLinking,
    linkingProvider,
    hasGoogle,
    hasApple,
    hasEmail,
    hasPhone,
    canUnlinkProvider,
    sessionEmail,
    fetchIdentities,
    linkProvider,
    unlinkProvider,
    addPasswordToAccount,
    linkNewEmail,
    linkPhone,
    verifyPhoneLink,
    cancelPhoneLink,
  } = useIdentityLinking();

  const [displayError, setDisplayError] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState<ProviderType | null>(null);

  // Email form state
  const [emailMode, setEmailMode] = useState<AddEmailMode>(null);
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);

  // Phone form state
  const [phoneStep, setPhoneStep] = useState<AddPhoneStep>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);
  const linkedPhoneRef = useRef('');

  // Surface hook errors
  useEffect(() => {
    if (error) {
      setDisplayError(error);
      const t = setTimeout(() => setDisplayError(null), 6000);
      return () => clearTimeout(t);
    }
  }, [error]);

  const showError = (msg: string) => {
    setDisplayError(msg);
    setTimeout(() => setDisplayError(null), 6000);
  };

  // ─── OAuth ───────────────────────────────────────────────────────────────

  const handleLinkOAuth = async (provider: ProviderType) => {
    setDisplayError(null);
    await linkProvider(provider);
    setTimeout(fetchIdentities, 1000);
  };

  const handleUnlink = async (provider: ProviderType) => {
    setConfirmUnlink(null);
    try {
      await unlinkProvider(provider);
    } catch (err) {
      showError(err instanceof Error ? err.message : `Failed to unlink ${provider}.`);
    }
  };

  // ─── Email ───────────────────────────────────────────────────────────────

  // Determine which email flow to show
  const openEmailFlow = () => {
    // Case A: account already has email — just add password
    if (sessionEmail) {
      setEmailMode('add_password');
    } else {
      // Case B: no email on account yet
      setEmailMode('add_email');
    }
    setDisplayError(null);
  };

  const handleAddPassword = async () => {
    if (passwordInput.length < 8) {
      showError('Password must be at least 8 characters.');
      return;
    }
    setEmailBusy(true);
    setDisplayError(null);
    try {
      await addPasswordToAccount(passwordInput);
      setEmailMode(null);
      setPasswordInput('');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to set password.');
    } finally {
      setEmailBusy(false);
    }
  };

  const handleAddEmail = async () => {
    if (!emailInput.trim()) return;
    setEmailBusy(true);
    setDisplayError(null);
    try {
      await linkNewEmail(emailInput.trim());
      setEmailMode('email_pending');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to add email.');
      setEmailMode(null);
    } finally {
      setEmailBusy(false);
    }
  };

  const resetEmail = () => {
    setEmailMode(null);
    setEmailInput('');
    setPasswordInput('');
    setDisplayError(null);
  };

  // ─── Phone ───────────────────────────────────────────────────────────────

  const handleSendPhoneOtp = async () => {
    const trimmed = phoneInput.trim();
    if (!/^\+\d{7,15}$/.test(trimmed)) {
      showError('Enter a phone number in international format, e.g. +447911123456');
      return;
    }
    setPhoneBusy(true);
    setDisplayError(null);
    try {
      await linkPhone(trimmed);
      linkedPhoneRef.current = trimmed;
      setPhoneStep('otp');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to send code.');
      setPhoneStep(null);
    } finally {
      setPhoneBusy(false);
    }
  };

  const handleVerifyPhone = async () => {
    setPhoneBusy(true);
    setDisplayError(null);
    try {
      await verifyPhoneLink(linkedPhoneRef.current, otpInput.trim());
      setPhoneStep(null);
      setPhoneInput('');
      setOtpInput('');
      linkedPhoneRef.current = '';
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Verification failed. Check your code.');
    } finally {
      setPhoneBusy(false);
    }
  };

  const resetPhone = () => {
    cancelPhoneLink();
    setPhoneStep(null);
    setPhoneInput('');
    setOtpInput('');
    linkedPhoneRef.current = '';
    setDisplayError(null);
  };

  // ─── render ──────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-2 rounded-xl bg-secondary/30 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider">Sign-in methods</p>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const isLinkedMap: Record<ProviderType, boolean> = {
    google: hasGoogle,
    apple: hasApple,
    email: hasEmail,
    phone: hasPhone,
  };

  return (
    <div className="space-y-3 rounded-xl bg-secondary/30 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider">Sign-in methods</p>
        <p className="text-xs text-muted-foreground mt-1">
          Link multiple methods so you can always reach your account.
        </p>
      </div>

      <div className="space-y-2">
        {PROVIDERS.map(provider => {
          const isLinked = isLinkedMap[provider.id];
          const isBusy = isLinking && linkingProvider === provider.id;
          const identity = identities.find(i => i.provider === provider.id);
          const canUnlink = canUnlinkProvider(provider.id);

          return (
            <motion.div
              key={provider.id}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
              className="rounded-lg bg-secondary/50 overflow-hidden"
            >
              {/* Provider row */}
              <div className="flex items-center justify-between px-3 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-muted-foreground">
                    <ProviderIcon id={provider.id} />
                  </span>
                  <div>
                    <p className="text-sm font-medium">{provider.label}</p>
                    {isLinked && identity?.identity_data?.email && (
                      <p className="text-xs text-muted-foreground">{identity.identity_data.email}</p>
                    )}
                    {isLinked && identity?.identity_data?.phone && (
                      <p className="text-xs text-muted-foreground">{identity.identity_data.phone}</p>
                    )}
                    {provider.id === 'email' && !isLinked && sessionEmail && (
                      <p className="text-xs text-muted-foreground">
                        {sessionEmail} — no password set
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Unlink button — shown only when canUnlink and identity is linked */}
                  {isLinked && canUnlink && !isBusy && (
                    <button
                      onClick={() => setConfirmUnlink(provider.id)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title={`Unlink ${provider.label}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <AnimatePresence mode="wait">
                    {isBusy ? (
                      <motion.div key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      </motion.div>
                    ) : isLinked ? (
                      <motion.span
                        key="linked"
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        className="inline-flex items-center gap-1 text-xs font-medium text-green-500"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Linked
                      </motion.span>
                    ) : provider.id === 'google' || provider.id === 'apple' ? (
                      <motion.button
                        key="link-oauth"
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        onClick={() => handleLinkOAuth(provider.id)}
                        className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md bg-gradient-to-r from-neon-cyan via-gradient-pink to-gradient-purple text-white hover:opacity-90 transition-opacity"
                      >
                        Link {provider.label}
                      </motion.button>
                    ) : provider.id === 'email' ? (
                      <motion.button
                        key="add-email"
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        onClick={() => emailMode ? resetEmail() : openEmailFlow()}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-secondary hover:bg-secondary/80 transition-colors"
                      >
                        {sessionEmail ? 'Add password' : 'Add email'}
                        {emailMode !== null
                          ? <ChevronUp className="w-3 h-3" />
                          : <ChevronDown className="w-3 h-3" />}
                      </motion.button>
                    ) : (
                      <motion.button
                        key="add-phone"
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        onClick={() => phoneStep ? resetPhone() : setPhoneStep('phone')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-secondary hover:bg-secondary/80 transition-colors"
                      >
                        Add SMS
                        {phoneStep !== null
                          ? <ChevronUp className="w-3 h-3" />
                          : <ChevronDown className="w-3 h-3" />}
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Email: Case A — add password (account already has email) */}
              <AnimatePresence>
                {provider.id === 'email' && !isLinked && emailMode === 'add_password' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/30">
                      <p className="text-xs text-muted-foreground">
                        Set a password so you can also sign in with{' '}
                        <strong>{sessionEmail}</strong> and a password.
                        No email confirmation needed.
                      </p>
                      <input
                        type="password"
                        placeholder="New password (min 8 characters)"
                        value={passwordInput}
                        onChange={e => setPasswordInput(e.target.value)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        autoComplete="new-password"
                      />
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          onClick={handleAddPassword}
                          disabled={passwordInput.length < 8 || emailBusy}
                          className="flex-1"
                        >
                          {emailBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Set password'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={resetEmail} disabled={emailBusy}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Email: Case B — add new email address */}
                {provider.id === 'email' && !isLinked && emailMode === 'add_email' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/30">
                      <p className="text-xs text-muted-foreground">
                        Add an email address. A confirmation link will be sent — click it to
                        activate email sign-in. You can set a password afterwards.
                      </p>
                      <input
                        type="email"
                        placeholder="Email address"
                        value={emailInput}
                        onChange={e => setEmailInput(e.target.value)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        autoComplete="email"
                      />
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          onClick={handleAddEmail}
                          disabled={!emailInput.trim() || emailBusy}
                          className="flex-1"
                        >
                          {emailBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Send confirmation'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={resetEmail} disabled={emailBusy}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Email: pending confirmation */}
                {provider.id === 'email' && !isLinked && emailMode === 'email_pending' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3 pt-1 border-t border-border/30">
                      <p className="text-xs font-medium text-green-500">Check your inbox</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Confirmation sent to <strong>{emailInput}</strong>. Click the link to
                        activate email sign-in.
                      </p>
                      <button onClick={resetEmail} className="mt-2 text-xs text-muted-foreground underline">
                        Dismiss
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* Phone: enter number */}
                {provider.id === 'phone' && !isLinked && phoneStep === 'phone' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/30">
                      <p className="text-xs text-muted-foreground">
                        Enter your number in international format (e.g. +447911123456).
                        You'll receive a one-time SMS code. Phone sign-in is code-only — no password.
                      </p>
                      <input
                        type="tel"
                        placeholder="+447911123456"
                        value={phoneInput}
                        onChange={e => setPhoneInput(e.target.value)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        autoComplete="tel"
                      />
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" onClick={handleSendPhoneOtp} disabled={!phoneInput.trim() || phoneBusy} className="flex-1">
                          {phoneBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Send code'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={resetPhone} disabled={phoneBusy}>Cancel</Button>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Phone: enter OTP */}
                {provider.id === 'phone' && !isLinked && phoneStep === 'otp' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/30">
                      <p className="text-xs text-muted-foreground">
                        Enter the code sent to <strong>{linkedPhoneRef.current}</strong>.
                      </p>
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="6-digit code"
                        value={otpInput}
                        onChange={e => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm tracking-widest focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" onClick={handleVerifyPhone} disabled={otpInput.length < 4 || phoneBusy} className="flex-1">
                          {phoneBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Verify'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={resetPhone} disabled={phoneBusy}>Cancel</Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Unlink confirmation */}
      <AnimatePresence>
        {confirmUnlink && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-3 rounded-lg bg-destructive/10 border border-destructive/25 space-y-2"
          >
            <p className="text-xs font-medium text-destructive">
              Remove {PROVIDERS.find(p => p.id === confirmUnlink)?.label} sign-in?
            </p>
            <p className="text-xs text-muted-foreground">
              You will no longer be able to sign in with this method.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={() => handleUnlink(confirmUnlink)} className="flex-1">
                Remove
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmUnlink(null)}>
                Keep it
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error display */}
      <AnimatePresence>
        {displayError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/25"
          >
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">{displayError}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-xs text-muted-foreground">
        You can remove a sign-in method as long as at least one other remains.
      </p>
    </div>
  );
}
