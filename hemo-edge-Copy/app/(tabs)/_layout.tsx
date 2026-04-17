// FILE: app/(tabs)/_layout.tsx
// Phase 5 — Pillar A: LogoutButton in header
// Phase 5 — Pillar B: settings tab
// Phase 5 — Pillar D: offline banner wired to useOfflineQueue
// Phase 5 — Pillar E: messages tab
// Phase 5 — Pillar G: admin tab
// Phase 5 — Pillar H: all UI strings replaced with t() calls
import { Tabs, Redirect } from 'expo-router';
import React, { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, StyleSheet, Platform, ActivityIndicator } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { LogoutButton } from '@/components/logout-button';
import { SwitchAccountModal } from '@/components/switch-account-modal';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthContext } from '@/contexts/auth-context';
import { useOfflineQueue } from '@/hooks/use-offline-queue';
import { useTranslation } from '@/lib/i18n';

// ─────────────────────────────────────────────────────────────────────────────
//  Offline banner
// ─────────────────────────────────────────────────────────────────────────────

interface OfflineBannerProps {
  visible: boolean;
}

function OfflineBanner({ visible }: OfflineBannerProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (!visible) return null;
  return (
    <View
      style={styles.offlineBanner}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <Ionicons name="cloud-offline-outline" size={14} color="#7d4e00" style={{ marginRight: 6 }} />
      <Text style={styles.offlineBannerText}>
        {t('offline.banner')}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tab layout
// ─────────────────────────────────────────────────────────────────────────────

export default function TabLayout(): React.ReactElement {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const { user, role, isLoading, cachedAccounts } = useAuthContext() as ReturnType<
    typeof useAuthContext
  > & { cachedAccounts?: import('@/hooks/use-auth').CachedAccount[] };

  // ── Phase 5 Pillar D: real offline detection ──────────────────────────────
  const { isOnline } = useOfflineQueue(user?.uid ?? '');

  // ── Account switcher sheet state ──────────────────────────────────────────
  const [showSwitchModal, setShowSwitchModal] = useState(false);

  // ── Auth guards ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00478d" />
      </View>
    );
  }
  if (!user) {
    return <Redirect href="/login" />;
  }

  const isDoctor = role === 'doctor';
  const isAdmin  = role === 'admin';

  // ── Shared header right: LogoutButton ─────────────────────────────────────
  const headerRight = (): React.ReactElement => (
    <LogoutButton size={22} color="#e53935" />
  );

  return (
    <>
      {/* Offline banner sits above the Tabs navigator */}
      <OfflineBanner visible={!isOnline} />

      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
          headerShown:           true,
          headerRight,
          headerStyle:           styles.header,
          headerTitleStyle:      styles.headerTitle,
          tabBarButton:          HapticTab,
          tabBarStyle:           styles.tabBar,
          tabBarLabelStyle:      styles.tabBarLabel,
        }}
      >
        {/* ── Home / Dashboard ───────────────────────────────────────────── */}
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabs.home'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home" size={size} color={color} />
            ),
          }}
        />

        {/* ── Live Blood Sample Scan ─────────────────────────────────────── */}
        <Tabs.Screen
          name="scan"
          options={{
            title: t('tabs.scan'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="scan-circle-outline" size={size} color={color} />
            ),
          }}
        />

        {/* ── Document / Lab Report Upload ──────────────────────────────── */}
        <Tabs.Screen
          name="scanner"
          options={{
            title: t('tabs.upload'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="document-text-outline" size={size} color={color} />
            ),
          }}
        />

        {/* ── Patient Roster (doctors only) ─────────────────────────────── */}
        <Tabs.Screen
          name="patients"
          options={{
            title:  t('tabs.patients'),
            href:   isDoctor ? undefined : null,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="people" size={size} color={color} />
            ),
          }}
        />

        {/* ── Diagnostic History ────────────────────────────────────────── */}
        <Tabs.Screen
          name="explore"
          options={{
            title: isDoctor ? t('tabs.historyDoctor') : t('tabs.historyPatient'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="time-outline" size={size} color={color} />
            ),
          }}
        />

        {/* ── Messages (Phase 5 Pillar E) ───────────────────────────────── */}
        <Tabs.Screen
          name="messages"
          options={{
            title: t('tabs.messages'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="chatbubble-ellipses-outline" size={size} color={color} />
            ),
          }}
        />

        {/* ── Settings (Phase 5 Pillar B) ───────────────────────────────── */}
        <Tabs.Screen
          name="settings"
          options={{
            title: t('tabs.settings'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings-outline" size={size} color={color} />
            ),
          }}
        />

        {/* ── Admin Dashboard (Phase 5 Pillar G — admin only) ──────────── */}
        <Tabs.Screen
          name="admin"
          options={{
            title: t('tabs.admin'),
            href:  isAdmin ? undefined : null,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="shield-checkmark-outline" size={size} color={color} />
            ),
          }}
        />
      </Tabs>

      {/* Account switcher modal (opened from Settings screen in Pillar B) */}
      <SwitchAccountModal
        visible={showSwitchModal}
        cachedAccounts={cachedAccounts ?? []}
        currentUid={user.uid}
        onClose={() => setShowSwitchModal(false)}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles (unchanged from Pillar G)
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  loadingContainer: {
    flex:            1,
    justifyContent:  'center',
    alignItems:      'center',
    backgroundColor: '#f7f9fb',
  },
  header: {
    backgroundColor: '#ffffff',
    shadowColor:     '#000',
    shadowOpacity:   0.06,
    shadowRadius:    4,
    shadowOffset:    { width: 0, height: 2 },
    elevation:       3,
  },
  headerTitle: {
    fontSize:   16,
    fontWeight: '700',
    color:      '#1a2535',
  },
  tabBar: {
    backgroundColor: '#ffffff',
    borderTopColor:  '#e0e3e5',
    borderTopWidth:  1,
    height:          64,
    paddingBottom:   8,
  },
  tabBarLabel: {
    fontSize:      10,
    fontWeight:    '700',
    letterSpacing: 0.5,
  },
  offlineBanner: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    backgroundColor:   '#fff3cd',
    borderBottomWidth: 1,
    borderBottomColor: '#ffc107',
    paddingVertical:   8,
    paddingHorizontal: 16,
    paddingTop:        Platform.OS === 'ios' ? 8 : 8,
  },
  offlineBannerText: {
    fontSize:   13,
    fontWeight: '600',
    color:      '#7d4e00',
  },
});
