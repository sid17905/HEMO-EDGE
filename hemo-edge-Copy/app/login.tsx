// FILE: app/login.tsx
import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Animated,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Microscope, Eye, EyeOff } from 'lucide-react-native';
import { useAuth } from '../hooks/use-auth';

// ─────────────────────────────────────────────────────────────────────────────
//  Theme
// ─────────────────────────────────────────────────────────────────────────────
const THEME = {
  primary:       '#00478d',
  background:    '#f7f9fb',
  surface:       '#ffffff',
  text:          '#191c1e',
  textSecondary: '#424752',
  error:         '#ba1a1a',
  errorBg:       '#fef2f2',
  border:        '#e0e3e5',
  inputBg:       '#f2f4f6',
};

type Tab = 'signin' | 'register';
type Role = 'doctor' | 'patient';

// ─────────────────────────────────────────────────────────────────────────────
//  Screen
// ─────────────────────────────────────────────────────────────────────────────
export default function LoginScreen() {
  const { login, register, isLoading, error } = useAuth();

  const [activeTab,    setActiveTab]    = useState<Tab>('signin');
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [fullName,     setFullName]     = useState('');
  const [role,         setRole]         = useState<Role>('doctor');
  const [showPassword, setShowPassword] = useState(false);
  const [localError,   setLocalError]   = useState('');

  // Animated tab indicator
  const tabAnim = useRef(new Animated.Value(0)).current;

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    setLocalError('');
    Animated.timing(tabAnim, {
      toValue: tab === 'signin' ? 0 : 1,
      duration: 220,
      useNativeDriver: false,
    }).start();
  };

  const indicatorLeft = tabAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '50%'],
  });

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setLocalError('');
    if (!email.trim() || !password.trim()) {
      setLocalError('Email and password are required.');
      return;
    }
    if (activeTab === 'register' && !fullName.trim()) {
      setLocalError('Full name is required.');
      return;
    }

    try {
      if (activeTab === 'signin') {
        await login(email, password);
      } else {
        await register(email, password, role, fullName);
      }
      router.replace('/(tabs)');
    } catch (err) {
      // error already set in useAuth — shown via `error` from hook
    }
  };

  const displayError = localError || error;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Brand ──────────────────────────────────────────────────────── */}
          <View style={styles.brandBlock}>
            <Microscope color={THEME.primary} size={48} strokeWidth={2} />
            <Text style={styles.brandName}>HEMO-EDGE</Text>
            <Text style={styles.brandTagline}>AI-Powered Haematology Diagnostics</Text>
          </View>

          {/* ── Tab row ────────────────────────────────────────────────────── */}
          <View style={styles.tabRow}>
            <Animated.View style={[styles.tabIndicator, { left: indicatorLeft }]} />
            <TouchableOpacity
              style={styles.tabBtn}
              onPress={() => switchTab('signin')}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, activeTab === 'signin' && styles.tabTextActive]}>
                Sign In
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tabBtn}
              onPress={() => switchTab('register')}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, activeTab === 'register' && styles.tabTextActive]}>
                Register
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── Form card ──────────────────────────────────────────────────── */}
          <View style={styles.formCard}>

            {/* Register-only: Full name */}
            {activeTab === 'register' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>FULL NAME</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Dr. Jane Doe"
                  placeholderTextColor="#9ca3af"
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                />
              </View>
            )}

            {/* Email */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>EMAIL</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="#9ca3af"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
            </View>

            {/* Password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  placeholder="••••••••"
                  placeholderTextColor="#9ca3af"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword(v => !v)}
                >
                  {showPassword
                    ? <EyeOff color={THEME.textSecondary} size={20} />
                    : <Eye    color={THEME.textSecondary} size={20} />
                  }
                </TouchableOpacity>
              </View>
            </View>

            {/* Register-only: Role toggle */}
            {activeTab === 'register' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>ROLE</Text>
                <View style={styles.roleRow}>
                  {(['doctor', 'patient'] as Role[]).map(r => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.rolePill, role === r && styles.rolePillActive]}
                      onPress={() => setRole(r)}
                    >
                      <Text style={[styles.rolePillText, role === r && styles.rolePillTextActive]}>
                        {r.charAt(0).toUpperCase() + r.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Error box */}
            {!!displayError && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{displayError}</Text>
              </View>
            )}

            {/* Submit */}
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleSubmit}
              disabled={isLoading}
              activeOpacity={0.85}
            >
              {isLoading
                ? <ActivityIndicator color="#ffffff" />
                : <Text style={styles.primaryBtnText}>
                    {activeTab === 'signin' ? 'Sign In' : 'Create Account'}
                  </Text>
              }
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: THEME.background },
  kav:          { flex: 1 },
  scrollContent:{ padding: 24, paddingBottom: 48, justifyContent: 'center', flexGrow: 1 },

  // Brand
  brandBlock:   { alignItems: 'center', marginBottom: 36, gap: 8 },
  brandName:    { fontSize: 32, fontWeight: '900', color: THEME.primary, letterSpacing: -1 },
  brandTagline: { fontSize: 14, color: THEME.textSecondary, fontWeight: '500' },

  // Tabs
  tabRow: {
    flexDirection: 'row', backgroundColor: THEME.inputBg,
    borderRadius: 16, padding: 4, marginBottom: 24, position: 'relative', overflow: 'hidden',
  },
  tabIndicator: {
    position: 'absolute', top: 4, bottom: 4, width: '50%',
    backgroundColor: THEME.primary, borderRadius: 12,
  },
  tabBtn:          { flex: 1, paddingVertical: 12, alignItems: 'center', zIndex: 1 },
  tabText:         { fontSize: 14, fontWeight: '600', color: THEME.textSecondary },
  tabTextActive:   { color: '#ffffff', fontWeight: '700' },

  // Form card
  formCard: {
    backgroundColor: THEME.surface, borderRadius: 24, padding: 24,
    gap: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05, shadowRadius: 20, elevation: 4,
  },
  fieldGroup:   { gap: 6 },
  fieldLabel:   { fontSize: 10, fontWeight: '700', color: THEME.textSecondary, letterSpacing: 1.5 },
  input: {
    height: 52, borderRadius: 12, borderWidth: 1, borderColor: THEME.border,
    backgroundColor: THEME.surface, paddingHorizontal: 16,
    fontSize: 15, color: THEME.text, flex: 1,
  },
  passwordRow:  { flexDirection: 'row', alignItems: 'center' },
  passwordInput:{ marginRight: -52 /* overlap eye btn */ },
  eyeBtn:       { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },

  // Role toggle
  roleRow:           { flexDirection: 'row', gap: 12 },
  rolePill:          { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: THEME.inputBg },
  rolePillActive:    { backgroundColor: THEME.primary },
  rolePillText:      { fontSize: 14, fontWeight: '600', color: THEME.textSecondary },
  rolePillTextActive:{ color: '#ffffff', fontWeight: '700' },

  // Error
  errorBox:  {
    backgroundColor: THEME.errorBg, borderRadius: 12, padding: 12,
    borderLeftWidth: 3, borderLeftColor: THEME.error,
  },
  errorText: { fontSize: 13, color: THEME.error, lineHeight: 18 },

  // Primary button
  primaryBtn: {
    height: 56, borderRadius: 16, backgroundColor: THEME.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: THEME.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 4,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: '#ffffff' },
});
