// FILE: hooks/use-biometric-auth.ts
// Phase 5 — Pillar C: biometric authentication hook
// Uses expo-local-authentication. Throws typed BiometricAuthError on failure.
import * as LocalAuthentication from 'expo-local-authentication';

// ─────────────────────────────────────────────────────────────────────────────
//  Typed error
// ─────────────────────────────────────────────────────────────────────────────

export type BiometricErrorCode =
  | 'unavailable'   // device has no biometric hardware or none enrolled
  | 'cancelled'     // user pressed Cancel / dismissed the prompt
  | 'failed'        // authentication attempt failed (wrong finger / face)
  | 'lockout';      // too many failed attempts — hardware locked

export class BiometricAuthError extends Error {
  readonly code: BiometricErrorCode;

  constructor(code: BiometricErrorCode, message?: string) {
    super(message ?? `Biometric auth error: ${code}`);
    this.name = 'BiometricAuthError';
    this.code = code;
    // Restore prototype chain for instanceof checks across transpilation targets
    Object.setPrototypeOf(this, BiometricAuthError.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  isBiometricAvailable
//  Returns true when the device has biometric hardware AND at least one
//  biometric credential (finger / face / iris) is enrolled.
// ─────────────────────────────────────────────────────────────────────────────

export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    if (!compatible) return false;
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return enrolled;
  } catch (err) {
    console.error('HEMO-EDGE: isBiometricAvailable check failed ->', err);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  getBiometricType
//  Returns the strongest biometric type available on the device.
// ─────────────────────────────────────────────────────────────────────────────

export async function getBiometricType(): Promise<'fingerprint' | 'faceid' | 'iris' | 'none'> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return 'faceid';
    }
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      return 'iris';
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return 'fingerprint';
    }
    return 'none';
  } catch (err) {
    console.error('HEMO-EDGE: getBiometricType failed ->', err);
    return 'none';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  authenticateWithBiometric
//  Returns true on success.
//  Throws BiometricAuthError on every failure path — never returns false.
//
//  reason: the prompt string shown to the user by the OS (e.g. "Verify to
//          view patient scan results")
// ─────────────────────────────────────────────────────────────────────────────

export async function authenticateWithBiometric(reason: string): Promise<boolean> {
  const available = await isBiometricAvailable();
  if (!available) {
    throw new BiometricAuthError(
      'unavailable',
      'No biometric hardware found or no credentials enrolled.',
    );
  }

  let result: LocalAuthentication.LocalAuthenticationResult;
  try {
    result = await LocalAuthentication.authenticateAsync({
      promptMessage:          reason,
      cancelLabel:            'Cancel',
      disableDeviceFallback:  false,   // allow PIN/pattern fallback
      fallbackLabel:          'Use Passcode',
    });
  } catch (err) {
    // Unexpected OS-level error
    throw new BiometricAuthError('failed', String(err));
  }

  if (result.success) return true;

  // Map expo-local-authentication error strings to our typed codes
  const warning = (result as { warning?: string }).warning ?? '';
  const errorStr = !result.success
    ? ((result as { error?: string }).error ?? '')
    : '';

  if (
    errorStr === 'user_cancel' ||
    errorStr === 'system_cancel' ||
    errorStr === 'app_cancel'
  ) {
    throw new BiometricAuthError('cancelled', 'Authentication was cancelled.');
  }

  if (
    errorStr === 'lockout' ||
    errorStr === 'lockout_permanent' ||
    warning.includes('lockout')
  ) {
    throw new BiometricAuthError(
      'lockout',
      'Too many failed attempts. Biometric authentication is temporarily locked.',
    );
  }

  throw new BiometricAuthError('failed', `Authentication failed: ${errorStr || warning}`);
}