// FILE: hooks/use-auth.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

export interface UseAuthReturn {
  user:      FirebaseUser | null;
  role:      'doctor' | 'patient' | null;
  isLoading: boolean;
  error:     string | null;
  login:     (email: string, password: string) => Promise<void>;
  register:  (email: string, password: string, role: 'doctor' | 'patient', fullName: string) => Promise<void>;
  logout:    () => Promise<void>;
}

async function fetchRole(uid: string): Promise<'doctor' | 'patient' | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    return (snap.data()?.role as 'doctor' | 'patient') ?? null;
  } catch (err) {
    console.error('HEMO-EDGE: fetchRole failed ->', err);
    return null;
  }
}

export function useAuth(): UseAuthReturn {
  const [user,      setUser]      = useState<FirebaseUser | null>(null);
  const [role,      setRole]      = useState<'doctor' | 'patient' | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const mounted = useRef(true);

  // Single listener — runs ONCE. Source of truth for user + role.
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!mounted.current) return;
      if (firebaseUser) {
        const r = await fetchRole(firebaseUser.uid);
        if (mounted.current) {
          setUser(firebaseUser);
          setRole(r);
          console.log('HEMO-EDGE: auth state uid=', firebaseUser.uid, 'role=', r);
        }
      } else {
        if (mounted.current) { setUser(null); setRole(null); }
      }
      if (mounted.current) setIsLoading(false);
    });
    return () => { mounted.current = false; unsubscribe(); };
  }, []); // ← empty — never re-subscribes

  // login: just calls Firebase. onAuthStateChanged sets state.
  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (mounted.current) setError(msg);
      throw err;
    }
  }, []);

  // register: create user + write profile, then onAuthStateChanged takes over.
  const register = useCallback(async (
    email: string, password: string,
    newRole: 'doctor' | 'patient', fullName: string,
  ) => {
    setError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await setDoc(doc(db, 'users', cred.user.uid), {
        uid:       cred.user.uid,
        email:     email.trim(),
        fullName:  fullName.trim(),
        role:      newRole,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (mounted.current) setError(msg);
      throw err;
    }
  }, []);

  // logout: signOut fires onAuthStateChanged(null) automatically.
  const logout = useCallback(async () => {
    setError(null);
    try {
      await signOut(auth);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (mounted.current) setError(msg);
      throw err;
    }
  }, []);

  return { user, role, isLoading, error, login, register, logout };
}