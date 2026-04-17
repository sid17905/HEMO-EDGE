// FILE: app/_layout.tsx
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/use-auth';
import { AuthProvider } from '@/contexts/auth-context';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { user, role, isLoading } = useAuth();
  const segments = useSegments();

  // ── Auth guard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === 'login' || segments[0] === 'modal';

    if (!user && !inAuthGroup) {
      // Not logged in — redirect to login
      router.replace('/login');
    } else if (user && inAuthGroup) {
      // Already logged in — go to main tabs
      router.replace('/(tabs)');
    }
  }, [user, isLoading, segments]);

  // ── Loading splash ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f7f9fb' }}>
        <ActivityIndicator color="#00478d" size="large" />
      </View>
    );
  }

  return (
    <AuthProvider value={{ user, role, isLoading }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          {/* Auth screen */}
          <Stack.Screen name="login"  options={{ headerShown: false }} />

          {/* Legacy modal screen (kept for compatibility) */}
          <Stack.Screen name="modal"  options={{ headerShown: false }} />

          {/* Main tab navigator */}
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

          {/* Full-screen result screen */}
          <Stack.Screen name="result" options={{ headerShown: false }} />

          {/* Full-screen analysis detail */}
          <Stack.Screen name="analysis-detail" options={{ headerShown: false }} />
        </Stack>

        <StatusBar style="auto" />
      </ThemeProvider>
    </AuthProvider>
  );
}
