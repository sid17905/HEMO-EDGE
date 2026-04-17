// FILE: contexts/auth-context.tsx
import React, { createContext, useContext } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';

// ─────────────────────────────────────────────────────────────────────────────
//  Context type — now includes actions so any child can call login/logout
// ─────────────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  user:      FirebaseUser | null;
  role:      'doctor' | 'patient' | null;
  isLoading: boolean;
  error:     string | null;
  login:     (email: string, password: string) => Promise<void>;
  register:  (email: string, password: string, role: 'doctor' | 'patient', fullName: string) => Promise<void>;
  logout:    () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user:      null,
  role:      null,
  isLoading: true,
  error:     null,
  login:     async () => {},
  register:  async () => {},
  logout:    async () => {},
});

// ─────────────────────────────────────────────────────────────────────────────
//  Provider — value is injected from the root layout (which owns useAuth())
// ─────────────────────────────────────────────────────────────────────────────

export function AuthProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: AuthContextValue;
}) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Consumer hook
// ─────────────────────────────────────────────────────────────────────────────

export function useAuthContext(): AuthContextValue {
  return useContext(AuthContext);
}

export { AuthContext };