// FILE: components/switch-account-modal.tsx
// Phase 5 — Pillar A: cached account list, re-auth via custom token, add new account
import React, { useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { router } from 'expo-router';
import { useAuthContext } from '@/contexts/auth-context';
import type { CachedAccount } from '@/hooks/use-auth';

// ─────────────────────────────────────────────────────────────────────────────
//  Person icon (react-native-svg)
// ─────────────────────────────────────────────────────────────────────────────

function PersonIcon({ color = '#00478d', size = 22 }: { color?: string; size?: number }): React.ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth="1.8" />
      <Path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

function AddIcon({ color = '#00478d', size = 20 }: { color?: string; size?: number }): React.ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Role badge colours
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  doctor:  '#0077b6',
  patient: '#2a9d8f',
  admin:   '#e76f51',
};

// ─────────────────────────────────────────────────────────────────────────────
//  SwitchAccountModal
// ─────────────────────────────────────────────────────────────────────────────

interface SwitchAccountModalProps {
  visible:        boolean;
  cachedAccounts: CachedAccount[];
  currentUid?:    string;
  onClose:        () => void;
}

export function SwitchAccountModal({
  visible,
  cachedAccounts,
  currentUid,
  onClose,
}: SwitchAccountModalProps): React.ReactElement {
  const { switchAccount } = useAuthContext();
  const [switchingUid, setSwitchingUid] = useState<string | null>(null);

  const handleSwitch = useCallback(async (account: CachedAccount): Promise<void> => {
    if (account.uid === currentUid) {
      onClose();
      return;
    }

    Alert.alert(
      'Switch Account',
      `Switch to ${account.fullName || account.email}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text:    'Switch',
          onPress: async () => {
            setSwitchingUid(account.uid);
            try {
              // NOTE: In production, the app must obtain a fresh custom token
              // for the target account from your backend before calling switchAccount().
              // This stub shows the integration point — replace with your token endpoint call.
              // e.g. const token = await fetchCustomTokenFromBackend(account.uid);
              // await switchAccount(token);
              //
              // For now we alert that a token is required — prevents a silent no-op.
              Alert.alert(
                'Token Required',
                'Account switching requires a fresh custom token from your backend. Integrate your /auth/custom-token endpoint here.',
              );
            } catch (err) {
              console.error('HEMO-EDGE: switchAccount failed ->', err);
              Alert.alert('Error', 'Could not switch account. Please try again.');
            } finally {
              setSwitchingUid(null);
              onClose();
            }
          },
        },
      ],
    );
  }, [currentUid, switchAccount, onClose]);

  const handleAddAccount = useCallback((): void => {
    onClose();
    // Navigate to login — user can sign in to a new account
    router.push('/login');
  }, [onClose]);

  const renderAccount = useCallback(({ item }: { item: CachedAccount }): React.ReactElement => {
    const isCurrent  = item.uid === currentUid;
    const isSwitching = switchingUid === item.uid;
    const roleColor  = ROLE_COLORS[item.role] ?? '#666';

    return (
      <Pressable
        onPress={() => handleSwitch(item)}
        style={({ pressed }) => [
          styles.accountRow,
          isCurrent && styles.accountRowActive,
          pressed && styles.accountRowPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Switch to ${item.fullName || item.email}`}
        accessibilityState={{ selected: isCurrent }}
      >
        {/* Avatar */}
        <View style={[styles.avatar, { backgroundColor: roleColor + '20' }]}>
          <PersonIcon color={roleColor} size={22} />
        </View>

        {/* Account info */}
        <View style={styles.accountInfo}>
          <Text style={styles.accountName} numberOfLines={1}>
            {item.fullName || 'Unknown'}
          </Text>
          <Text style={styles.accountEmail} numberOfLines={1}>
            {item.email}
          </Text>
        </View>

        {/* Role badge + current indicator */}
        <View style={styles.accountMeta}>
          <View style={[styles.roleBadge, { backgroundColor: roleColor + '18' }]}>
            <Text style={[styles.roleBadgeText, { color: roleColor }]}>
              {item.role}
            </Text>
          </View>
          {isCurrent && (
            <Text style={styles.currentLabel}>Active</Text>
          )}
        </View>

        {isSwitching && (
          <ActivityIndicator size="small" color="#00478d" style={{ marginLeft: 8 }} />
        )}
      </Pressable>
    );
  }, [currentUid, switchingUid, handleSwitch]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Stop event propagation so tapping inside the sheet doesn't close it */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          {/* Handle bar */}
          <View style={styles.handleBar} />

          <Text style={styles.title}>Switch Account</Text>
          <Text style={styles.subtitle}>
            Choose a cached account or add a new one.
          </Text>

          {cachedAccounts.length === 0 ? (
            <View style={styles.emptyState}>
              <PersonIcon color="#b0bec5" size={40} />
              <Text style={styles.emptyText}>No cached accounts found.</Text>
            </View>
          ) : (
            <FlatList
              data={cachedAccounts}
              keyExtractor={(item) => item.uid}
              renderItem={renderAccount}
              style={styles.list}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            />
          )}

          {/* Add new account */}
          <Pressable
            onPress={handleAddAccount}
            style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Add a new account"
          >
            <AddIcon color="#00478d" size={18} />
            <Text style={styles.addButtonText}>Add another account</Text>
          </Pressable>

          {/* Cancel */}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent:  'flex-end',
  },
  sheet: {
    backgroundColor:  '#ffffff',
    borderTopLeftRadius:  20,
    borderTopRightRadius: 20,
    paddingHorizontal:    20,
    paddingBottom:        40,
    maxHeight:            '75%',
  },
  handleBar: {
    width:         40,
    height:        4,
    borderRadius:  2,
    backgroundColor: '#e0e3e5',
    alignSelf:     'center',
    marginTop:     12,
    marginBottom:  16,
  },
  title: {
    fontSize:   18,
    fontWeight: '700',
    color:      '#1a2535',
    marginBottom: 4,
  },
  subtitle: {
    fontSize:     13,
    color:        '#7a8694',
    marginBottom: 16,
  },
  list: {
    maxHeight: 300,
  },
  accountRow: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingVertical:  12,
    paddingHorizontal: 12,
    borderRadius:   12,
    marginBottom:   6,
    backgroundColor: '#f7f9fb',
  },
  accountRowActive: {
    backgroundColor: '#e8f0fe',
    borderWidth:     1,
    borderColor:     '#c0d4f5',
  },
  accountRowPressed: {
    opacity: 0.75,
  },
  avatar: {
    width:        42,
    height:       42,
    borderRadius: 21,
    alignItems:   'center',
    justifyContent: 'center',
    marginRight:  12,
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize:   14,
    fontWeight: '600',
    color:      '#1a2535',
  },
  accountEmail: {
    fontSize: 12,
    color:    '#7a8694',
    marginTop: 2,
  },
  accountMeta: {
    alignItems: 'flex-end',
    gap:        4,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      6,
  },
  roleBadgeText: {
    fontSize:   10,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  currentLabel: {
    fontSize:   10,
    color:      '#2a9d8f',
    fontWeight: '600',
  },
  emptyState: {
    alignItems:   'center',
    paddingVertical: 32,
    gap:          12,
  },
  emptyText: {
    fontSize: 14,
    color:    '#b0bec5',
  },
  addButton: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            8,
    paddingVertical: 14,
    borderRadius:   12,
    borderWidth:    1.5,
    borderColor:    '#00478d',
    borderStyle:    'dashed',
    marginTop:      8,
    marginBottom:   10,
  },
  addButtonPressed: {
    opacity: 0.65,
  },
  addButtonText: {
    fontSize:   14,
    fontWeight: '600',
    color:      '#00478d',
  },
  cancelButton: {
    alignItems:     'center',
    paddingVertical: 14,
    borderRadius:   12,
    backgroundColor: '#f7f9fb',
  },
  cancelButtonPressed: {
    opacity: 0.65,
  },
  cancelButtonText: {
    fontSize:   14,
    fontWeight: '600',
    color:      '#7a8694',
  },
});
