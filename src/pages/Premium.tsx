import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Crown, Loader2, ArrowLeft, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSubscription } from '@/hooks/useSubscription';
import { format } from 'date-fns';
import { trackEvent } from '@/lib/analytics';

const features = [
  'See who vibed you',
  'Browse events in any city',
  'Access Premium-tier events',
  'Premium badge on your profile',
];

const Premium = () => {
  const navigate = useNavigate();
  const { subscription, isPremium, isLoading, startCheckout } = useSubscription();
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'annual'>('annual');
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  useEffect(() => {
    trackEvent('premium_page_viewed');
  }, []);

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
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-[hsl(var(--neon-violet))] opacity-10 blur-[150px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-[hsl(var(--neon-pink))] opacity-8 blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-lg mx-auto px-6 py-12 space-y-10">
        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm">Back</span>
        </button>

        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[hsl(var(--neon-violet))] to-[hsl(var(--neon-pink))] flex items-center justify-center">
              <Crown className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold font-['Space_Grotesk'] text-foreground">
            Unlock Your Full Vibe
          </h1>
          <p className="text-muted-foreground text-lg">
            Meet people worth meeting — in real life.
          </p>
        </div>

        {/* Already Premium */}
        {isPremium ? (
          <div className="rounded-3xl border border-[hsl(var(--neon-violet)/0.3)] bg-card/80 backdrop-blur-xl p-8 text-center space-y-4">
            <div className="flex justify-center">
              <Sparkles className="w-10 h-10 text-[hsl(var(--neon-violet))]" />
            </div>
            <h2 className="text-2xl font-bold font-['Space_Grotesk'] text-foreground">
              You're already Premium 🎉
            </h2>
            <div className="space-y-1 text-muted-foreground">
              <p className="capitalize">
                Plan: <span className="text-foreground font-medium">{subscription.plan}</span>
              </p>
              {subscription.current_period_end && (
                <p>
                  Renews: <span className="text-foreground font-medium">
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
            {/* Plan toggle */}
            <div className="flex justify-center">
              <div className="inline-flex items-center bg-muted rounded-full p-1 gap-1">
                <button
                  onClick={() => handlePlanToggle('monthly')}
                  className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
                    selectedPlan === 'monthly'
                      ? 'bg-card text-foreground shadow-lg'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => handlePlanToggle('annual')}
                  className={`relative px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
                    selectedPlan === 'annual'
                      ? 'bg-card text-foreground shadow-lg'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Annual
                  <span className="absolute -top-3 -right-3 bg-[hsl(var(--neon-pink))] text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                    2 months free
                  </span>
                </button>
              </div>
            </div>

            {/* Pricing card */}
            <div className="rounded-3xl border border-[hsl(var(--neon-violet)/0.4)] bg-card/80 backdrop-blur-xl p-8 space-y-6 shadow-[0_0_40px_hsl(var(--neon-violet)/0.1)]">
              {/* Price */}
              <div className="text-center space-y-1">
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-5xl font-bold font-['Space_Grotesk'] text-foreground transition-all duration-300">
                    €{selectedPlan === 'monthly' ? '14.99' : '12.49'}
                  </span>
                  <span className="text-muted-foreground text-lg">/month</span>
                </div>
                {selectedPlan === 'annual' && (
                  <p className="text-sm text-muted-foreground">
                    €149.90 billed annually
                  </p>
                )}
              </div>

              {/* Features */}
              <div className="space-y-4 py-2">
                {features.map((feature) => (
                  <div key={feature} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-[hsl(var(--neon-violet)/0.15)] flex items-center justify-center flex-shrink-0">
                      <Check className="w-4 h-4 text-[hsl(var(--neon-violet))]" />
                    </div>
                    <span className="text-foreground">{feature}</span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <Button
                onClick={handleCheckout}
                disabled={checkoutLoading}
                className="w-full py-6 text-lg font-semibold rounded-2xl bg-gradient-to-r from-[hsl(var(--neon-violet))] to-[hsl(var(--neon-pink))] hover:opacity-90 transition-opacity text-primary-foreground disabled:opacity-50"
              >
                {checkoutLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  'Get Premium'
                )}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                Cancel anytime. No hidden fees.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Premium;
