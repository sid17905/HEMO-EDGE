import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useBloodReportAnalysis } from '@/hooks/use-blood-report-analysis';
import type { BloodReportAnalysis } from '@/hooks/blood-report-types';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
      }}
    >
      {/* Home / Dashboard tab */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="house.fill" color={color} />
          ),
        }}
      />

      {/* Blood Sample Scan tab */}
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="camera.metering.spot" color={color} />
          ),
        }}
      />

      {/* Document / Lab Report Scanner tab */}
      <Tabs.Screen
        name="scanner"
        options={{
          title: 'Upload',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="doc.text.viewfinder" color={color} />
          ),
        }}
      />

      {/* History tab */}
      <Tabs.Screen
        name="explore"
        options={{
          title: 'History',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="clock.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
