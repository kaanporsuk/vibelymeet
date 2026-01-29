import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

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
  const { isAuthenticated, isLoading, session } = useAuth();
  const location = useLocation();
  const [profileStatus, setProfileStatus] = useState<'loading' | 'complete' | 'incomplete'>('loading');

  // Server-side admin role verification - queries database directly via RLS
  const { data: isServerVerifiedAdmin, isLoading: isAdminCheckLoading } = useQuery({
    queryKey: ['verify-admin-role', session?.user?.id],
    queryFn: async () => {
      if (!session?.user?.id) return false;
      
      // This query will only succeed if the user has the admin role
      // RLS policy on user_roles ensures users can only see their own roles
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .eq('role', 'admin')
        .maybeSingle();
      
      if (error) {
        console.error('Admin verification error:', error);
        return false;
      }
      
      return !!data;
    },
    enabled: !!session?.user?.id && requireAdmin,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    retry: false,
  });

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

  // Show loading state while checking auth, profile, or admin status
  const isCheckingAdmin = requireAdmin && isAdminCheckLoading;
  if (isLoading || (requireOnboarding && profileStatus === 'loading' && isAuthenticated) || isCheckingAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  // Server-side verified admin check - cannot be bypassed via client-side manipulation
  if (requireAdmin && !isServerVerifiedAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  // Redirect to onboarding if profile is incomplete
  if (requireOnboarding && profileStatus === 'incomplete') {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
