import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

const SubscriptionSuccess = () => {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate('/');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      {/* Glow backdrop */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-[hsl(var(--neon-violet))] opacity-15 blur-[120px]" />
        <div className="absolute bottom-1/4 left-1/3 w-[300px] h-[300px] rounded-full bg-[hsl(var(--neon-pink))] opacity-10 blur-[100px]" />
      </div>

      <div className="relative z-10 text-center max-w-md mx-auto space-y-8">
        {/* Animated checkmark */}
        <div className="flex justify-center">
          <div className="relative">
            <div className="w-24 h-24 rounded-full bg-[hsl(var(--neon-violet)/0.15)] flex items-center justify-center border border-[hsl(var(--neon-violet)/0.3)] animate-pulse">
              <CheckCircle className="w-12 h-12 text-[hsl(var(--neon-violet))]" />
            </div>
            <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-[hsl(var(--neon-pink))] animate-bounce" />
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-3xl font-bold font-['Space_Grotesk'] text-foreground">
            You're now Vibely Premium ✨
          </h1>
          <p className="text-muted-foreground text-lg">
            Unlimited matches, exclusive events, and priority lobbies await.
          </p>
        </div>

        <Button
          onClick={() => navigate('/')}
          className="w-full py-6 text-lg font-semibold rounded-2xl bg-gradient-to-r from-[hsl(var(--neon-violet))] to-[hsl(var(--neon-pink))] hover:opacity-90 transition-opacity text-primary-foreground"
        >
          Start Exploring
        </Button>

        <p className="text-sm text-muted-foreground">
          Redirecting in {countdown}s…
        </p>
      </div>
    </div>
  );
};

export default SubscriptionSuccess;
