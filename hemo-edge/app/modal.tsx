import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { User, Lock, Eye, Fingerprint, ScanFace, ClipboardPlus } from 'lucide-react-native';
import { setLoggedIn } from './_layout';
import { SafeAreaView } from 'react-native-safe-area-context';

const THEME = {
  primary: '#00478d',
  secondary: '#4f5f7b',
  background: '#f7f9fb',
  surface: '#ffffff',
  text: '#191c1e',
  textSecondary: '#424752',
  border: '#e0e3e5',
  inputBg: '#eceef0',
};

export default function LoginScreen() {
  const [role, setRole] = useState<'doctor' | 'patient'>('doctor');
  const [showPassword, setShowPassword] = useState(false);
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = () => {
    if (!id.trim() || !password.trim()) {
      setError('Please enter your Medical ID and password.');
      return;
    }
    setError('');
    setLoggedIn(true);
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <ClipboardPlus color={THEME.primary} size={40} strokeWidth={2.5} />
            <Text style={styles.logoText}>HEMO-EDGE</Text>
          </View>
          <Text style={styles.subtitle}>The Clinical Vanguard</Text>
        </View>

        <View style={styles.card}>
          {/* Role toggle */}
          <View style={styles.roleToggle}>
            <TouchableOpacity
              style={[styles.roleButton, role === 'doctor' && styles.roleButtonActive]}
              onPress={() => setRole('doctor')}
            >
              <Text style={[styles.roleButtonText, role === 'doctor' && styles.roleButtonTextActive]}>
                Doctor
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.roleButton, role === 'patient' && styles.roleButtonActive]}
              onPress={() => setRole('patient')}
            >
              <Text style={[styles.roleButtonText, role === 'patient' && styles.roleButtonTextActive]}>
                Patient
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.form}>
            {/* Medical ID */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>MEDICAL ID / EMAIL</Text>
              <View style={styles.inputWrapper}>
                <User color={THEME.textSecondary} size={20} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g. DR-8829-X"
                  placeholderTextColor="#727783"
                  value={id}
                  onChangeText={setId}
                  autoCapitalize="none"
                />
              </View>
            </View>

            {/* Password */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>PASSWORD</Text>
              <View style={styles.inputWrapper}>
                <Lock color={THEME.textSecondary} size={20} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  secureTextEntry={!showPassword}
                  placeholderTextColor="#727783"
                  value={password}
                  onChangeText={setPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Eye color={THEME.textSecondary} size={20} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Error message */}
            {!!error && <Text style={styles.errorText}>{error}</Text>}

            {/* Login button */}
            <TouchableOpacity style={styles.primaryButton} onPress={handleLogin}>
              <Text style={styles.primaryButtonText}>Authorize Access</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.forgotButton}>
              <Text style={styles.forgotText}>Forgot Credentials?</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.separator}>
            <View style={styles.line} />
            <Text style={styles.separatorText}>SECURE VERIFICATION</Text>
            <View style={styles.line} />
          </View>

          <View style={styles.biometricRow}>
            <TouchableOpacity style={styles.biometricButton}>
              <Fingerprint color={THEME.primary} size={24} />
              <Text style={styles.biometricText}>Touch ID</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.biometricButton}>
              <ScanFace color={THEME.primary} size={24} />
              <Text style={styles.biometricText}>Face ID</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            By entering this platform, you agree to the{'\n'}
            <Text style={styles.link}>HIPAA Compliance Standards</Text> and{' '}
            <Text style={styles.link}>Clinical Privacy Terms</Text>.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.background },
  content: { flex: 1, padding: 24, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 32 },
  logoContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  logoText: { fontSize: 28, fontWeight: '900', color: THEME.primary, marginLeft: 8, letterSpacing: -1 },
  subtitle: { fontSize: 18, fontWeight: '600', color: THEME.textSecondary },
  card: {
    backgroundColor: THEME.surface, borderRadius: 24, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05, shadowRadius: 20, elevation: 5,
  },
  roleToggle: {
    flexDirection: 'row', backgroundColor: THEME.inputBg,
    borderRadius: 16, padding: 4, marginBottom: 24,
  },
  roleButton: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 12 },
  roleButtonActive: { backgroundColor: THEME.primary },
  roleButtonText: { fontSize: 14, fontWeight: '600', color: THEME.secondary },
  roleButtonTextActive: { color: '#ffffff', fontWeight: '700' },
  form: { gap: 20 },
  inputGroup: { gap: 8 },
  label: { fontSize: 10, fontWeight: '700', color: THEME.textSecondary, letterSpacing: 1.5, paddingLeft: 4 },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: THEME.inputBg, borderRadius: 16, paddingHorizontal: 16, height: 56,
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, color: THEME.text, fontWeight: '500' },
  errorText: { fontSize: 13, color: '#ba1a1a', fontWeight: '600', paddingLeft: 4 },
  primaryButton: {
    backgroundColor: THEME.primary, height: 56, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
    shadowColor: THEME.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8,
  },
  primaryButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  forgotButton: { alignItems: 'center' },
  forgotText: { fontSize: 14, fontWeight: '600', color: THEME.secondary },
  separator: { flexDirection: 'row', alignItems: 'center', marginVertical: 24, gap: 12 },
  line: { flex: 1, height: 1, backgroundColor: '#eceef0' },
  separatorText: { fontSize: 10, fontWeight: '800', color: '#727783', letterSpacing: -0.5 },
  biometricRow: { flexDirection: 'row', gap: 12 },
  biometricButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: THEME.inputBg, height: 56, borderRadius: 16, gap: 8,
  },
  biometricText: { fontSize: 12, fontWeight: '700', color: THEME.text },
  footer: { marginTop: 32, alignItems: 'center' },
  footerText: { fontSize: 12, color: THEME.textSecondary, textAlign: 'center', lineHeight: 18 },
  link: { fontWeight: '700', color: THEME.primary, textDecorationLine: 'underline' },
});
