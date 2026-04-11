import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

// ─── Simple auth state (replace with your real auth logic / AsyncStorage) ───
let _isLoggedIn = false;
export function setLoggedIn(val: boolean) { _isLoggedIn = val; }
export function getLoggedIn() { return _isLoggedIn; }

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      // TODO: replace with AsyncStorage.getItem('token') or your real auth check
      setAuthChecked(true);
    };
    checkAuth();
  }, []);

  // Don't render navigation until auth is determined (prevents flash)
  if (!authChecked) return null;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        {/* Login / modal screen — shown when not logged in */}
        <Stack.Screen name="modal" options={{ headerShown: false }} />

        {/* Main tab navigator */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

        {/* Full-screen result screen — pushed on top of tabs */}
        <Stack.Screen name="result" options={{ headerShown: false }} />

        {/* Full-screen analysis detail — pushed from history */}
        <Stack.Screen name="analysis-detail" options={{ headerShown: false }} />
      </Stack>

      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
