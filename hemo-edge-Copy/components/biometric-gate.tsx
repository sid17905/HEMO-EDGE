// FILE: components/biometric-gate.tsx
// Phase 5 — Pillar C: wraps any PHI screen with a biometric lock overlay.
// Usage:
//   <BiometricGate scanId="abc" onUnlocked={() => setUnlocked(true)}>
//     {unlockedContent}
//   </BiometricGate>
//
// The gate checks UserPreferences.biometricEnabled on mount. If false it
// renders children immediately. If true it challenges the user. On success
// it writes an audit log and renders children. On failure it renders the
// locked overlay with a Retry button.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { useAuthContext } from '@/contexts/auth-context';
import {
  authenticateWithBiometric,
  getBiometricType,
  isBiometricAvailable,
  BiometricAuthError,
} from '@/hooks/use-biometric-auth';
import {
  getUserPreferences,
  writeAuditLog,
  getSecureTimestamp,
} from '@/lib/firestore-service';

// ─────────────────────────────────────────────────────────────────────────────
//  Lock icon (react-native-svg)
// ─────────────────────────────────────────────────────────────────────────────

function LockIcon({ size = 48, color = '#ffffff' }: { size?: number; color?: string }): React.ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="11" width="18" height="11" rx="2" stroke={color} strokeWidth="1.8" />
      <Path
        d="M7 11V7a5 5 0 0 1 10 0v4"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <Circle cx="12" cy="16" r="1.5" fill={color} />
    </Svg>
  );
}

function FingerprintIcon({ size = 32, color = '#ffffff' }: { size?: number; color?: string }): React.ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 10a2 2 0 0 0-2 2c0 1.5.5 3 1.5 4.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <Path d="M9 8.5A5 5 0 0 1 17 12c0 2-.4 4-1.2 5.7" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <Path d="M6.5 7.3A8 8 0 0 1 20 12c0 2.5-.6 5-1.7 7" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <Path d="M3.5 6.5A11 11 0 0 1 23 12c0 3-.8 6-2.3 8.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Gate states
// ─────────────────────────────────────────────────────────────────────────────

type GateState =
  | 'checking'    // reading UserPreferences
  | 'prompting'   // biometric OS dialog active
  | 'unlocked'    // auth succeeded or biometric disabled
  | 'locked'      // auth failed — show overlay
  | 'lockout'     // hardware locked — show special message
  | 'unavailable' // no biometric hardware/enrollment — bypass gate

// ─────────────────────────────────────────────────────────────────────────────
//  Props
// ─────────────────────────────────────────────────────────────────────────────

interface BiometricGateProps {
  /** The scan ID — used to scope the audit log entry */
  scanId?:    string;
  /** Prompt string shown in the OS biometric dialog */
  reason?:    string;
  children:   React.ReactNode;
}

// ─────────────────────────────────────────────────────────────────────────────
//  BiometricGate
// ─────────────────────────────────────────────────────────────────────────────

export function BiometricGate({
  scanId   = 'unknown',
  reason   = 'Verify your identity to view patient data',
  children,
}: BiometricGateProps): React.ReactElement {
  const { user, role } = useAuthContext();
  const [gateState,  setGateState]  = useState<GateState>('checking');
  const [biometricType, setBiometricType] = useState<string>('biometric');
  const [errorMessage,  setErrorMessage]  = useState<string>('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Attempt auth ─────────────────────────────────────────────────────────
  const attemptAuth = useCallback(async (): Promise<void> => {
    if (!user?.uid) { setGateState('unlocked'); return; }

    setGateState('checking');

    try {
      // 1. Check if biometric is enabled in UserPreferences
      const prefs = await getUserPreferences(user.uid);
      if (!prefs.biometricEnabled) {
        if (mountedRef.current) setGateState('unlocked');
        return;
      }

      // 2. Check hardware availability
      const available = await isBiometricAvailable();
      if (!available) {
        if (mountedRef.current) setGateState('unavailable');
        return;
      }

      // 3. Get biometric type for UI label
      const type = await getBiometricType();
      if (mountedRef.current) {
        setBiometricType(
          type === 'faceid'      ? 'Face ID' :
          type === 'fingerprint' ? 'Fingerprint' :
          type === 'iris'        ? 'Iris Scan' : 'Biometric',
        );
      }

      // 4. Prompt
      if (mountedRef.current) setGateState('prompting');
      await authenticateWithBiometric(reason);

      // 5. Success — write audit log
      await writeAuditLog({
        action:       'biometric_auth_success',
        actorId:      user.uid,
        actorRole:    role ?? 'patient',
        resourceType: 'scan',
        resourceId:   scanId,
        metadata:     { biometricType: type, timestamp: await getSecureTimestamp() },
      });

      if (mountedRef.current) setGateState('unlocked');

    } catch (err) {
      if (!mountedRef.current) return;

      if (err instanceof BiometricAuthError) {
        // Write failure audit log
        await writeAuditLog({
          action:       'biometric_auth_failed',
          actorId:      user?.uid ?? 'unknown',
          actorRole:    role ?? 'patient',
          resourceType: 'scan',
          resourceId:   scanId,
          metadata:     { reason: err.code, timestamp: await getSecureTimestamp() },
        }).catch(() => {}); // don't block UI on audit failure

        if (err.code === 'lockout') {
          setErrorMessage('Too many failed attempts. Please use your device passcode.');
          setGateState('lockout');
        } else if (err.code === 'unavailable') {
          setGateState('unavailable');
        } else {
          setErrorMessage(
            err.code === 'cancelled'
              ? 'Authentication was cancelled. Tap Retry to try again.'
              : 'Authentication failed. Please try again.',
          );
          setGateState('locked');
        }
      } else {
        setErrorMessage('An unexpected error occurred. Please try again.');
        setGateState('locked');
        console.error('HEMO-EDGE: BiometricGate unexpected error ->', err);
      }
    }
  }, [user?.uid, role, scanId, reason]);

  // ── Trigger on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    attemptAuth();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────────────
  //  Render: pass-through when unlocked / unavailable
  // ─────────────────────────────────────────────────────────────────────────

  if (gateState === 'unlocked' || gateState === 'unavailable') {
    return <>{children}</>;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Render: checking / prompting spinner
  // ─────────────────────────────────────────────────────────────────────────

  if (gateState === 'checking' || gateState === 'prompting') {
    return (
      <View style={styles.overlay}>
        <View style={styles.card}>
          <LockIcon size={48} color="#00478d" />
          <ActivityIndicator size="large" color="#00478d" style={{ marginTop: 20 }} />
          <Text style={styles.promptTitle}>
            {gateState === 'checking' ? 'Checking security…' : `Waiting for ${biometricType}…`}
          </Text>
          <Text style={styles.promptSubtitle}>
            Hemo-Edge protects patient data with biometric verification.
          </Text>
        </View>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Render: locked overlay (failed / cancelled / lockout)
  // ─────────────────────────────────────────────────────────────────────────

  const isLockout = gateState === 'lockout';

  return (
    <View style={styles.overlay}>
      {/* Blurred background hint — children rendered but covered */}
      <View style={styles.blurHint} pointerEvents="none">
        {children}
      </View>

      {/* Frosted glass card */}
      <View style={[styles.card, styles.cardLocked]}>
        <View style={styles.lockIconWrapper}>
          <LockIcon size={44} color="#ffffff" />
        </View>

        <Text style={styles.lockedTitle}>
          {isLockout ? 'Biometric Locked' : 'Authentication Required'}
        </Text>
        <Text style={styles.lockedSubtitle}>{errorMessage}</Text>

        {!isLockout && (
          <Pressable
            onPress={attemptAuth}
            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Retry ${biometricType} authentication`}
          >
            <FingerprintIcon size={18} color="#ffffff" />
            <Text style={styles.retryButtonText}>Retry {biometricType}</Text>
          </Pressable>
        )}

        {isLockout && (
          <View style={styles.lockoutInfo}>
            <Text style={styles.lockoutText}>
              Use your device passcode to unlock, then return to this screen.
            </Text>
          </View>
        )}

        <Text style={styles.phiNotice}>
          🔒 PHI content is protected by HIPAA/GDPR policy
        </Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex:           1,
    backgroundColor: '#0a1628',
    justifyContent: 'center',
    alignItems:     'center',
  },
  blurHint: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.08,   // ghost hint of content behind the lock
  },
  card: {
    width:           '84%',
    maxWidth:        360,
    backgroundColor: '#ffffff',
    borderRadius:    20,
    padding:         28,
    alignItems:      'center',
    gap:             12,
    // iOS shadow
    shadowColor:   '#000',
    shadowOpacity: 0.18,
    shadowRadius:  16,
    shadowOffset:  { width: 0, height: 6 },
    elevation:     10,
  },
  cardLocked: {
    backgroundColor: '#0e2044',
  },
  lockIconWrapper: {
    width:           80,
    height:          80,
    borderRadius:    40,
    backgroundColor: '#e53935',
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    4,
  },

  // ── Checking / prompting ─────────────────────────────────────────────────
  promptTitle: {
    fontSize:   17,
    fontWeight: '700',
    color:      '#1a2535',
    textAlign:  'center',
  },
  promptSubtitle: {
    fontSize:  13,
    color:     '#7a8694',
    textAlign: 'center',
    lineHeight: 18,
  },

  // ── Locked ───────────────────────────────────────────────────────────────
  lockedTitle: {
    fontSize:   18,
    fontWeight: '800',
    color:      '#ffffff',
    textAlign:  'center',
  },
  lockedSubtitle: {
    fontSize:  13,
    color:     '#90a4c0',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 4,
  },
  retryButton: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    backgroundColor:   '#00478d',
    paddingHorizontal: 24,
    paddingVertical:   13,
    borderRadius:      12,
    marginTop:         4,
  },
  retryButtonPressed: {
    opacity: 0.75,
  },
  retryButtonText: {
    fontSize:   15,
    fontWeight: '700',
    color:      '#ffffff',
  },
  lockoutInfo: {
    backgroundColor: '#ffffff14',
    borderRadius:    10,
    padding:         14,
    marginTop:       4,
  },
  lockoutText: {
    fontSize:  13,
    color:     '#b0c4de',
    textAlign: 'center',
    lineHeight: 18,
  },
  phiNotice: {
    fontSize:  11,
    color:     '#4a6080',
    textAlign: 'center',
    marginTop: 8,
  },
});
