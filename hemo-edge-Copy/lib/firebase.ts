// FILE: lib/firebase.ts
// Uses the Firebase JS SDK — compatible with Expo Go (managed workflow).
// If you switch to a bare/custom dev client, swap to @react-native-firebase.

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore, serverTimestamp, Timestamp } from 'firebase/firestore';

// ─── Read config from Expo public env vars ────────────────────────────────────
const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// ─── Guard against double-init (hot reload safe) ─────────────────────────────
const firebaseApp: FirebaseApp = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApp();

const auth: Auth = getAuth(firebaseApp);
const db: Firestore = getFirestore(firebaseApp);

// ─────────────────────────────────────────────────────────────────────────────
//  Compliance utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a dual-timestamp object for HIPAA-compliant audit entries.
 * - isoString: human-readable ISO 8601 for application-layer queries
 * - server:    Firestore serverTimestamp() for tamper-evident ordering
 *
 * Never rely solely on client-side timestamps for audit records — a
 * compromised client can forge them. The serverTimestamp() is authoritative.
 */
export function getAuditTimestamps(): {
  isoString: string;
  server: ReturnType<typeof serverTimestamp>;
} {
  return {
    isoString: new Date().toISOString(),
    server:    serverTimestamp(),
  };
}

/**
 * Converts a Firestore Timestamp to an ISO string safely.
 * Falls back gracefully if the field hasn't resolved from serverTimestamp yet.
 */
export function timestampToISO(ts: Timestamp | null | undefined): string {
  if (!ts) return new Date().toISOString();
  try { return ts.toDate().toISOString(); }
  catch { return new Date().toISOString(); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Firestore Security Rule annotations (for reference — enforced server-side)
// ─────────────────────────────────────────────────────────────────────────────
//
//  Recommended Firestore rules for HIPAA/GDPR compliance:
//
//  rules_version = '2';
//  service cloud.firestore {
//    match /databases/{database}/documents {
//
//      // Audit logs: write-only for authenticated users, no reads from client
//      match /audit_logs/{logId} {
//        allow create: if request.auth != null;
//        allow read, update, delete: if false; // server-side only via Admin SDK
//      }
//
//      // Scans: users can only access their own; doctors via server-side functions
//      match /scans/{uid}/results/{resultId} {
//        allow read, write: if request.auth.uid == uid;
//      }
//
//      // GDPR erasure queue: patient writes own request, admin processes
//      match /gdpr_erasure_requests/{reqId} {
//        allow create: if request.auth != null && request.resource.data.uid == request.auth.uid;
//        allow read, update, delete: if false;
//      }
//    }
//  }

export { firebaseApp, auth, db };