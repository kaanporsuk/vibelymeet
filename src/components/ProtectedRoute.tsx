import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
  requireOnboarding?: boolean;
}

export function ProtectedRoute({ 
  children, 
  requireAdmin = false,
  requireOnboarding = true 
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, isAdmin, session } = useAuth();
  const location = useLocation();
  const [profileStatus, setProfileStatus] = useState<'loading' | 'complete' | 'incomplete'>('loading');

  useEffect(() => {
    const checkProfile = async () => {
      if (!session?.user) {
        setProfileStatus('loading');
        return;
      }

      // Skip profile check if we're already on the onboarding page
      if (location.pathname === '/onboarding') {
        setProfileStatus('complete');
        return;
      }

      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('gender, photos')
          .eq('id', session.user.id)
          .maybeSingle();

        const photosCount = (profile?.photos as string[] | null)?.length ?? 0;
        const needsOnboarding = !profile || 
          !profile.gender || 
          profile.gender === 'prefer_not_to_say' || 
          photosCount < 1;

        setProfileStatus(needsOnboarding ? 'incomplete' : 'complete');
      } catch {
        setProfileStatus('complete'); // Fail open to avoid blocking
      }
    };

    if (isAuthenticated && requireOnboarding) {
      checkProfile();
    } else if (!requireOnboarding) {
      setProfileStatus('complete');
    }
  }, [session?.user, isAuthenticated, requireOnboarding, location.pathname]);

  if (isLoading || (requireOnboarding && profileStatus === 'loading' && isAuthenticated)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  // Redirect to onboarding if profile is incomplete
  if (requireOnboarding && profileStatus === 'incomplete') {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
