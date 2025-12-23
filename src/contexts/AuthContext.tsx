import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface User {
  id: string;
  name: string;
  phone: string;
  avatarUrl: string;
  isPaused: boolean;
  pauseUntil: Date | null;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (phone: string) => Promise<void>;
  verifyOtp: (otp: string) => Promise<boolean>;
  loginWithGoogle: () => Promise<void>;
  loginWithApple: () => Promise<void>;
  logout: () => void;
  pauseAccount: (duration: 'day' | 'week' | 'indefinite') => void;
  resumeAccount: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const MOCK_USER: User = {
  id: 'user-1',
  name: 'Alex',
  phone: '+1 (555) 123-4567',
  avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400',
  isPaused: false,
  pauseUntil: null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check localStorage for existing auth
    const storedAuth = localStorage.getItem('vibely_auth');
    if (storedAuth) {
      try {
        const parsed = JSON.parse(storedAuth);
        setUser(parsed.user);
      } catch {
        localStorage.removeItem('vibely_auth');
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (phone: string): Promise<void> => {
    // Mock API call - simulate sending OTP
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // OTP sent successfully (mocked)
  };

  const verifyOtp = async (otp: string): Promise<boolean> => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // Mock: any 4-digit OTP starting with 1 is valid
    if (otp.length === 4 && otp.startsWith('1')) {
      setUser(MOCK_USER);
      localStorage.setItem('vibely_auth', JSON.stringify({ user: MOCK_USER }));
      return true;
    }
    return false;
  };

  const loginWithGoogle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setUser(MOCK_USER);
    localStorage.setItem('vibely_auth', JSON.stringify({ user: MOCK_USER }));
  };

  const loginWithApple = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setUser(MOCK_USER);
    localStorage.setItem('vibely_auth', JSON.stringify({ user: MOCK_USER }));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('vibely_auth');
  };

  const pauseAccount = (duration: 'day' | 'week' | 'indefinite') => {
    if (!user) return;
    
    let pauseUntil: Date | null = null;
    const now = new Date();
    
    switch (duration) {
      case 'day':
        pauseUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        break;
      case 'week':
        pauseUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      case 'indefinite':
        pauseUntil = null;
        break;
    }
    
    const updatedUser = { ...user, isPaused: true, pauseUntil };
    setUser(updatedUser);
    localStorage.setItem('vibely_auth', JSON.stringify({ user: updatedUser }));
  };

  const resumeAccount = () => {
    if (!user) return;
    const updatedUser = { ...user, isPaused: false, pauseUntil: null };
    setUser(updatedUser);
    localStorage.setItem('vibely_auth', JSON.stringify({ user: updatedUser }));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        verifyOtp,
        loginWithGoogle,
        loginWithApple,
        logout,
        pauseAccount,
        resumeAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
