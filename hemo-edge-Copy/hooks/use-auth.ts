// FILE: hooks/use-auth.ts
// Phase 5 — Pillar A: signOut with audit log, switchAccount, admin role from custom claim
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  signInWithCustomToken,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../lib/firebase';
import { writeAuditLog, getSecureTimestamp } from '../lib/firestore-service';
import type { UserRole } from '../contexts/auth-context';

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CachedAccount {
  uid:       string;
  email:     string;
  fullName:  string;
  role:      UserRole;
  photoURL?: string;
}

export interface UseAuthReturn {
  user:           FirebaseUser | null;
  role:           UserRole | null;
  isLoading:      boolean;
  error:          string | null;
  login:          (email: string, password: string) => Promise<void>;
  register:       (email: string, password: string, role: 'doctor' | 'patient', fullName: string) => Promise<void>;
  logout:         () => Promise<void>;
  signOut:        () => Promise<void>;
  switchAccount:  (customToken: string) => Promise<void>;
  cachedAccounts: CachedAccount[];
}

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

const CACHED_ACCOUNTS_KEY = 'hemo_edge_cached_accounts';

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch role from Firestore /users doc.
 * Phase 5: also checks Firebase custom claim for 'admin' role.
 */
async function fetchRole(fbUser: FirebaseUser): Promise<UserRole | null> {
  try {
    // Check custom claim first (admin role is claim-only, not in /users doc)
    const idTokenResult = await fbUser.getIdTokenResult();
    if (idTokenResult.claims['role'] === 'admin') return 'admin';

    const snap = await getDoc(doc(db, 'users', fbUser.uid));
    if (!snap.exists()) return null;
    return (snap.data()?.role as UserRole) ?? null;
  } catch (err) {
    console.error('HEMO-EDGE: fetchRole failed ->', err);
    return null;
  }
}

async function loadCachedAccounts(): Promise<CachedAccount[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHED_ACCOUNTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CachedAccount[];
  } catch {
    return [];
  }
}

async function upsertCachedAccount(account: CachedAccount): Promise<void> {
  try {
    const existing = await loadCachedAccounts();
    const filtered = existing.filter((a) => a.uid !== account.uid);
    await AsyncStorage.setItem(
      CACHED_ACCOUNTS_KEY,
      JSON.stringify([account, ...filtered].slice(0, 5)), // keep max 5
    );
  } catch (err) {
    console.error('HEMO-EDGE: upsertCachedAccount failed ->', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useAuth(): UseAuthReturn {
  const [user,           setUser]           = useState<FirebaseUser | null>(null);
  const [role,           setRole]           = useState<UserRole | null>(null);
  const [isLoading,      setIsLoading]      = useState(true);
  const [error,          setError]          = useState<string | null>(null);
  const [cachedAccounts, setCachedAccounts] = useState<CachedAccount[]>([]);
  const mounted = useRef(true);

  // ── Load cached accounts from AsyncStorage on mount ──────────────────────
  useEffect(() => {
    loadCachedAccounts().then((accounts) => {
      if (mounted.current) setCachedAccounts(accounts);
    });
  }, []);

  // ── Single auth state listener ────────────────────────────────────────────
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!mounted.current) return;
      if (firebaseUser) {
        const r = await fetchRole(firebaseUser);
        if (!mounted.current) return;
        setUser(firebaseUser);
        setRole(r);
        console.log('HEMO-EDGE: auth state uid=', firebaseUser.uid, 'role=', r);

        // Upsert into cached accounts for account switcher
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid)).catch(() => null);
        if (snap?.exists()) {
          const data = snap.data();
          await upsertCachedAccount({
            uid:      firebaseUser.uid,
            email:    firebaseUser.email ?? '',
            fullName: data?.fullName ?? '',
            role:     r ?? 'patient',
            photoURL: firebaseUser.photoURL ?? undefined,
          });
          const updated = await loadCachedAccounts();
          if (mounted.current) setCachedAccounts(updated);
        }
      } else {
        if (mounted.current) { setUser(null); setRole(null); }
      }
      if (mounted.current) setIsLoading(false);
    });
    return () => { mounted.current = false; unsubscribe(); };
  }, []);

  // ── login ─────────────────────────────────────────────────────────────────
  const login = useCallback(async (email: string, password: string): Promise<void> => {
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (mounted.current) setError(msg);
      throw err;
    }
  }, []);

  // ── register ──────────────────────────────────────────────────────────────
  const register = useCallback(async (
    email: string,
    password: string,
    newRole: 'doctor' | 'patient',
    fullName: string,
  ): Promise<void> => {
    setError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await setDoc(doc(db, 'users', cred.user.uid), {
        uid:       cred.user.uid,
        email:     email.trim(),
        fullName:  fullName.trim(),
        role:      newRole,
        createdAt: await getSecureTimestamp(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (mounted.current) setError(msg);
      throw err;
    }
  }, []);

  // ── logout (internal — does not write audit log; used by signOut below) ───
  const logout = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      await firebaseSignOut(auth);
      // onAuthStateChanged fires null → clears user/role automatically
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (mounted.current) setError(msg);
      throw err;
    }
  }, []);

  // ── signOut (Phase 5: explicit sign-out with audit log + redirect) ────────
  const signOut = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const actorId   = auth.currentUser?.uid ?? 'unknown';
      const actorRole = role ?? 'patient';

      // Write audit log BEFORE signing out (user context still valid)
      await writeAuditLog({
        action:       'user_logout',
        actorUid:     actorId,
        actorRole:    (actorRole ?? 'patient') as 'doctor' | 'patient' | 'admin',
        resourceType: 'auth',
        resourceId:   actorId,
      });

      await firebaseSignOut(auth);

      // Hard redirect to login — clears all in-memory state
      router.replace('/login');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (mounted.current) setError(msg);
      throw err;
    }
  }, [role]);

  // ── switchAccount (Phase 5: re-auth with custom token) ───────────────────
  const switchAccount = useCallback(async (customToken: string): Promise<void> => {
    setError(null);
    const previousUid = auth.currentUser?.uid ?? 'unknown';
    try {
      // Audit log the switch from the outgoing account
      await writeAuditLog({
        action:       'account_switch',
        actorUid:     previousUid,
        actorRole:    (role ?? 'patient') as 'doctor' | 'patient' | 'admin',
        resourceType: 'auth',
        resourceId:   previousUid,
      });

      await signInWithCustomToken(auth, customToken);
      // onAuthStateChanged fires automatically — updates user/role
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (mounted.current) setError(msg);
      throw err;
    }
  }, [role]);

  return {
    user,
    role,
    isLoading,
    error,
    login,
    register,
    logout,
    signOut,
    switchAccount,
    cachedAccounts,
  };
}