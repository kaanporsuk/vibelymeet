import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';

const SubscriptionCancel = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      {/* Subtle glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full bg-[hsl(var(--neon-violet))] opacity-8 blur-[120px]" />
      </div>

      <div className="relative z-10 text-center max-w-md mx-auto space-y-8">
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
            <Heart className="w-10 h-10 text-muted-foreground" />
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-3xl font-bold font-['Space_Grotesk'] text-foreground">
            No worries — come back anytime
          </h1>
          <p className="text-muted-foreground text-lg">
            Your free account is still active.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Button
            onClick={() => navigate('/premium')}
            className="w-full py-6 text-lg font-semibold rounded-2xl bg-gradient-to-r from-[hsl(var(--neon-violet))] to-[hsl(var(--neon-pink))] hover:opacity-90 transition-opacity text-primary-foreground"
          >
            Try Again
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate('/')}
            className="w-full py-6 text-lg font-semibold rounded-2xl border-border text-foreground hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Go Home
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionCancel;
