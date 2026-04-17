// FILE: app/(tabs)/_layout.tsx
import { Tabs, Redirect } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthContext } from '@/contexts/auth-context';
import { ActivityIndicator, View } from 'react-native';

// ─────────────────────────────────────────────────────────────────────────────
//  RBAC-aware Tab Layout
//  - Doctors  → Home | Scan | Upload | Patients | History
//  - Patients → Home | Scan | Upload | History
//  - Not authed → redirect to login
// ─────────────────────────────────────────────────────────────────────────────

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { user, role, isLoading } = useAuthContext();

  // Still resolving Firebase auth state — show nothing to avoid flicker
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f7f9fb' }}>
        <ActivityIndicator size="large" color="#00478d" />
      </View>
    );
  }

  // Not authenticated — hard redirect to login
  if (!user) {
    return <Redirect href="/login" />;
  }

  const isDoctor = role === 'doctor';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#e0e3e5',
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 8,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.5,
        },
      }}
    >
      {/* ── Home / Dashboard ─────────────────────────────────────────────── */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="house.fill" color={color} />
          ),
        }}
      />

      {/* ── Live Blood Sample Scan ────────────────────────────────────────── */}
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="camera.metering.spot" color={color} />
          ),
        }}
      />

      {/* ── Document / Lab Report Upload ──────────────────────────────────── */}
      <Tabs.Screen
        name="scanner"
        options={{
          title: 'Upload',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="doc.text.viewfinder" color={color} />
          ),
        }}
      />

      {/* ── Patient Roster (doctors only) ─────────────────────────────────── */}
      <Tabs.Screen
        name="patients"
        options={{
          title: 'Patients',
          href: isDoctor ? undefined : null, // null = hidden from tab bar
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="person.2.fill" color={color} />
          ),
        }}
      />

      {/* ── Diagnostic History ────────────────────────────────────────────── */}
      <Tabs.Screen
        name="explore"
        options={{
          title: isDoctor ? 'All History' : 'My History',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="clock.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}