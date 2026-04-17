// FILE: contexts/auth-context.tsx
// Phase 5 — Pillar A: signOut, admin role added, account switch support
import React, { createContext, useContext } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';

// ─────────────────────────────────────────────────────────────────────────────
//  Context type
//  Phase 5: role now includes 'admin' (read from custom claim, never issued here)
//           signOut() added — clears local state, cancels listeners, redirects
// ─────────────────────────────────────────────────────────────────────────────

export type UserRole = 'doctor' | 'patient' | 'admin';

interface AuthContextValue {
  user:         FirebaseUser | null;
  role:         UserRole | null;
  isLoading:    boolean;
  error:        string | null;
  login:        (email: string, password: string) => Promise<void>;
  register:     (email: string, password: string, role: 'doctor' | 'patient', fullName: string) => Promise<void>;
  logout:       () => Promise<void>;
  /** Phase 5: alias of logout — explicit sign-out intent, triggers audit log */
  signOut:      () => Promise<void>;
  /** Phase 5: re-authenticate with a cached account token */
  switchAccount: (customToken: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user:          null,
  role:          null,
  isLoading:     true,
  error:         null,
  login:         async () => {},
  register:      async () => {},
  logout:        async () => {},
  signOut:       async () => {},
  switchAccount: async () => {},
});

// ─────────────────────────────────────────────────────────────────────────────
//  Provider — value injected from root layout which owns useAuth()
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
export type { AuthContextValue };