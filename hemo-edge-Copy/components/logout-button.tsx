// FILE: components/logout-button.tsx
// Phase 5 — Pillar A: confirmation alert, audit log on sign-out
import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import Svg, { Path, Rect, Line } from 'react-native-svg';
import { useAuthContext } from '@/contexts/auth-context';

// ─────────────────────────────────────────────────────────────────────────────
//  Exit / door SVG icon  (react-native-svg, no third-party icon lib)
// ─────────────────────────────────────────────────────────────────────────────

interface DoorExitIconProps {
  size:  number;
  color: string;
}

function DoorExitIcon({ size, color }: DoorExitIconProps): React.ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Door frame */}
      <Rect x="3" y="2" width="10" height="20" rx="1" stroke={color} strokeWidth="1.8" />
      {/* Door knob */}
      <Rect x="10.5" y="11" width="2" height="2" rx="1" fill={color} />
      {/* Arrow pointing right (exit direction) */}
      <Line x1="15" y1="12" x2="21" y2="12" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <Path d="M18.5 9L21.5 12L18.5 15" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  LogoutButton
// ─────────────────────────────────────────────────────────────────────────────

interface LogoutButtonProps {
  /** Icon size — defaults to 24 */
  size?:  number;
  /** Icon colour — defaults to #e53935 (warning red) */
  color?: string;
}

export function LogoutButton({
  size  = 24,
  color = '#e53935',
}: LogoutButtonProps): React.ReactElement {
  const { signOut } = useAuthContext();
  const [isSigning, setIsSigning] = useState(false);

  const handlePress = (): void => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out of Hemo-Edge?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text:    'Sign Out',
          style:   'destructive',
          onPress: async () => {
            setIsSigning(true);
            try {
              await signOut();
              // router.replace('/login') is called inside signOut()
            } catch (err) {
              console.error('HEMO-EDGE: LogoutButton signOut failed ->', err);
              Alert.alert('Error', 'Sign-out failed. Please try again.');
            } finally {
              setIsSigning(false);
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  if (isSigning) {
    return (
      <ActivityIndicator
        size="small"
        color={color}
        style={styles.container}
        accessibilityLabel="Signing out…"
      />
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      accessibilityLabel="Sign out"
      accessibilityRole="button"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <DoorExitIcon size={size} color={color} />
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    padding:      6,
    borderRadius: 8,
    marginRight:  4,
  },
  pressed: {
    opacity: 0.55,
  },
});
