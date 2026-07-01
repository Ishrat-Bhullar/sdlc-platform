import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { backendLogin, backendRegister, backendMe, backendLogout } from './api';

type AuthUser = { id: string | number; email?: string | null; full_name?: string; role?: string };

interface AuthContextValue {
  session: null;
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

useEffect(() => {
    backendMe<AuthUser>()
      .then((data) => setUser(data as AuthUser))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const data = await backendLogin<AuthUser>({ email, password });
      setUser(data as AuthUser);
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Authentication failed' };
    }
  };

  const signUp = async (email: string, password: string) => {
    try {
      const newUser = await backendRegister<AuthUser>({ email, password });
      await backendLogin<AuthUser>({ email, password });
      setUser(newUser as AuthUser);
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Registration failed' };
    }
  };

  const signOut = async () => {
    try {
      await backendLogout();
    } catch {
      // Local auth state must still be cleared if the server session already expired.
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ session: null, user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
