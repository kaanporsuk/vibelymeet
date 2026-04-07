import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Crown, Loader2, ArrowLeft, Sparkles, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSubscription } from '@/hooks/useSubscription';
import { format } from 'date-fns';
import { trackEvent } from '@/lib/analytics';
import { readPremiumEntryFromSearchParams } from '@shared/premiumFunnel';
import {
  getPremiumDefaultHero,
  getPremiumEntryNudge,
  getPremiumTierMarketingBullets,
} from '@shared/premiumPageMarketing';
import { cn } from '@/lib/utils';

const Premium = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { subscription, isPremium, isLoading, startCheckout } = useSubscription();
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'annual'>('annual');
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const funnel = useMemo(
    () => readPremiumEntryFromSearchParams((k) => searchParams.get(k)),
    [searchParams],
  );

  const entryNudge = useMemo(() => getPremiumEntryNudge(funnel.entry_surface), [funnel.entry_surface]);
  const defaultHero = useMemo(() => getPremiumDefaultHero(), []);
  const featureBullets = useMemo(() => getPremiumTierMarketingBullets(), []);

  useEffect(() => {
    trackEvent('premium_page_viewed', {
      ...funnel,
      platform: 'web',
    });
  }, [funnel]);

  const handlePlanToggle = (plan: 'monthly' | 'annual') => {
    setSelectedPlan(plan);
    trackEvent('premium_plan_toggled', { plan });
  };

  const handleCheckout = async () => {
    trackEvent('checkout_started', { plan: selectedPlan });
    setCheckoutLoading(true);
    const result = await startCheckout(selectedPlan);
    if (!result.success) {
      setCheckoutLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--neon-violet))]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-[hsl(var(--neon-violet))] opacity-10 blur-[150px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-[hsl(var(--neon-pink))] opacity-8 blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-xl mx-auto px-6 py-10 md:py-12 space-y-8">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm">Back</span>
        </button>

        {entryNudge ? (
          <div
            role="status"
            className={cn(
              'rounded-2xl border px-4 py-3 text-left space-y-1.5',
              entryNudge.variant === 'caution'
                ? 'border-amber-500/40 bg-amber-500/10'
                : 'border-[hsl(var(--neon-violet)/0.35)] bg-card/70 backdrop-blur-sm',
            )}
          >
            <p className="text-sm font-semibold text-foreground">{entryNudge.title}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{entryNudge.body}</p>
          </div>
        ) : null}

        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[hsl(var(--neon-violet))] to-[hsl(var(--neon-pink))] flex items-center justify-center shadow-lg shadow-[hsl(var(--neon-violet)/0.25)]">
              <Crown className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold font-['Space_Grotesk'] text-foreground tracking-tight">
            {defaultHero.title}
          </h1>
          <p className="text-muted-foreground text-base md:text-lg max-w-md mx-auto leading-relaxed">
            {defaultHero.subtitle}
          </p>
        </div>

        {isPremium ? (
          <div className="rounded-3xl border border-[hsl(var(--neon-violet)/0.3)] bg-card/80 backdrop-blur-xl p-8 text-center space-y-4">
            <div className="flex justify-center">
              <Sparkles className="w-10 h-10 text-[hsl(var(--neon-violet))]" />
            </div>
            <h2 className="text-2xl font-bold font-['Space_Grotesk'] text-foreground">
              You&apos;re already Premium 🎉
            </h2>
            <div className="space-y-1 text-muted-foreground">
              <p className="capitalize">
                Plan: <span className="text-foreground font-medium">{subscription.plan}</span>
              </p>
              {subscription.current_period_end && (
                <p>
                  Renews:{' '}
                  <span className="text-foreground font-medium">
                    {format(new Date(subscription.current_period_end), 'MMMM d, yyyy')}
                  </span>
                </p>
              )}
            </div>
            <Button
              onClick={() => navigate('/')}
              variant="outline"
              className="mt-4 rounded-2xl border-border"
            >
              Go Home
            </Button>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-[hsl(var(--neon-violet))] shrink-0 mt-0.5" />
              <div className="text-left space-y-1">
                <p className="text-sm font-medium text-foreground">Simple billing</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Cancel anytime. You keep Free access if you stop. Charges are handled securely at checkout —
                  we don&apos;t store your card on this screen.
                </p>
              </div>
            </div>

            <div className="flex justify-center">
              <div className="inline-flex items-center bg-muted rounded-full p-1 gap-1 w-full max-w-sm">
                <button
                  type="button"
                  onClick={() => handlePlanToggle('monthly')}
                  className={cn(
                    'flex-1 px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-300',
                    selectedPlan === 'monthly'
                      ? 'bg-card text-foreground shadow-md'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => handlePlanToggle('annual')}
                  className={cn(
                    'relative flex-1 px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-300',
                    selectedPlan === 'annual'
                      ? 'bg-card text-foreground shadow-md'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Annual
                  <span className="absolute -top-2.5 -right-1 bg-[hsl(var(--neon-pink))] text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                    Best value
                  </span>
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-[hsl(var(--neon-violet)/0.4)] bg-card/80 backdrop-blur-xl p-6 md:p-8 space-y-6 shadow-[0_0_40px_hsl(var(--neon-violet)/0.08)]">
              <div className="text-center space-y-1">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {selectedPlan === 'annual' ? 'Annual plan' : 'Monthly plan'}
                </p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-5xl font-bold font-['Space_Grotesk'] text-foreground transition-all duration-300">
                    €{selectedPlan === 'monthly' ? '14.99' : '12.49'}
                  </span>
                  <span className="text-muted-foreground text-lg">/month</span>
                </div>
                {selectedPlan === 'annual' && (
                  <p className="text-sm text-muted-foreground">€149.90 billed once per year</p>
                )}
                {selectedPlan === 'monthly' && (
                  <p className="text-sm text-muted-foreground">Billed every month — switch to annual anytime</p>
                )}
              </div>

              <div>
                <p className="text-sm font-semibold text-foreground mb-3">Included with Premium</p>
                <ul className="space-y-3">
                  {featureBullets.map((line) => (
                    <li key={line} className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-[hsl(var(--neon-violet)/0.15)] flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check className="w-3.5 h-3.5 text-[hsl(var(--neon-violet))]" />
                      </div>
                      <span className="text-sm text-foreground leading-snug">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Button
                onClick={handleCheckout}
                disabled={checkoutLoading}
                className="w-full py-6 text-lg font-semibold rounded-2xl bg-gradient-to-r from-[hsl(var(--neon-violet))] to-[hsl(var(--neon-pink))] hover:opacity-90 transition-opacity text-primary-foreground disabled:opacity-50"
              >
                {checkoutLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                ) : (
                  'Continue to secure checkout'
                )}
              </Button>

              <p className="text-center text-xs text-muted-foreground leading-relaxed">
                By continuing you agree to our terms and recurring billing for the plan you select. You can cancel
                from your account settings or billing portal.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Premium;
