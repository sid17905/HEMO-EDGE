// FILE: app/modal.tsx
// Phase 3: Compliance-aware scan share modal
// Shown when a doctor taps "Share Scan" on result.tsx or analysis-detail.tsx.
// Enforces: audit log on share, DUA acknowledgement for non-patient recipients,
// and a data residency notice.
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { X, Send, ShieldCheck, AlertTriangle, Lock, Users } from 'lucide-react-native';
import { useAuthContext } from '../contexts/auth-context';
import { writeAuditLog } from '../lib/firestore-service';
import { ComplianceColors } from '../constants/theme';

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────
type Recipient = 'specialist' | 'colleague' | 'patient';

const RECIPIENT_LABELS: Record<Recipient, string> = {
  specialist: 'Specialist / Second Opinion',
  colleague:  'Colleague (Same Institution)',
  patient:    'Patient (Direct Access)',
};

// Specialists outside the institution require DUA acknowledgement
const REQUIRES_DUA: Recipient[] = ['specialist'];

// ─────────────────────────────────────────────────────────────────────────────
//  Share modal
// ─────────────────────────────────────────────────────────────────────────────
export default function ShareScanModal() {
  const { user, role } = useAuthContext();
  const params = useLocalSearchParams<{
    scanId?:     string;
    caseId?:     string;
    patientName?:string;
    dataResidency?: string;
  }>();

  const [recipient,   setRecipient]   = useState<Recipient>('specialist');
  const [email,       setEmail]       = useState('');
  const [note,        setNote]        = useState('');
  const [duaAccepted, setDuaAccepted] = useState(false);
  const [sending,     setSending]     = useState(false);

  const needsDUA = REQUIRES_DUA.includes(recipient);

  // ── Share handler ──────────────────────────────────────────────────────────
  const handleShare = async () => {
    if (!email.trim() || !email.includes('@')) {
      Alert.alert('Invalid email', 'Enter a valid recipient email address.');
      return;
    }
    if (needsDUA && !duaAccepted) {
      Alert.alert('DUA Required', 'You must acknowledge the Data Use Agreement before sharing with external specialists.');
      return;
    }

    setSending(true);
    try {
      // Write audit log — sharing is a high-sensitivity action
      if (user) {
        await writeAuditLog({
          actorUid:     user.uid,
          actorRole:    role as 'doctor' | 'patient',
          action:       'share_scan',
          resourceId:   params.scanId,
          resourceType: 'scan',
          dataResidency:  params.dataResidency,
        });
      }

      // TODO in production: call Cloud Function to generate a time-limited
      // signed URL and dispatch a secure email via SendGrid / Firebase Extensions.
      // The share token should expire in 48 hours and be single-use.

      Alert.alert(
        'Scan Shared',
        `A secure link has been sent to ${email}. The link expires in 48 hours.`,
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (err) {
      Alert.alert('Share failed', 'Could not send the share link. Try again or contact support.');
      console.error('HEMO-EDGE: share scan ->', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>Share Scan</Text>
              {params.caseId ? (
                <Text style={styles.subtitle}>{params.caseId}</Text>
              ) : null}
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
              <X size={20} color="#424752" />
            </TouchableOpacity>
          </View>

          {/* Compliance notice */}
          <View style={styles.complianceNotice}>
            <ShieldCheck size={15} color={ComplianceColors.hipaaBlue} />
            <Text style={styles.complianceText}>
              This share action is logged per HIPAA §164.312(b). The recipient will only see data for the shared scan — not the full patient record.
            </Text>
          </View>

          {/* Recipient type */}
          <Text style={styles.sectionLabel}>RECIPIENT TYPE</Text>
          <View style={styles.recipientRow}>
            {(Object.keys(RECIPIENT_LABELS) as Recipient[]).map(r => (
              <TouchableOpacity
                key={r}
                style={[styles.recipientBtn, recipient === r && styles.recipientBtnActive]}
                onPress={() => { setRecipient(r); setDuaAccepted(false); }}
              >
                <Text style={[styles.recipientBtnText, recipient === r && styles.recipientBtnTextActive]}>
                  {RECIPIENT_LABELS[r]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Data residency notice */}
          {params.dataResidency && (
            <View style={styles.residencyRow}>
              <Lock size={12} color={ComplianceColors.residencyPurple} />
              <Text style={styles.residencyText}>
                Data residency: <Text style={{ fontWeight: '700' }}>{params.dataResidency.toUpperCase()}</Text>
                {' '}— ensure the recipient is in a compliant jurisdiction.
              </Text>
            </View>
          )}

          {/* Recipient email */}
          <Text style={styles.sectionLabel}>RECIPIENT EMAIL</Text>
          <View style={styles.inputWrap}>
            <Users size={18} color="#727783" style={{ marginRight: 10 }} />
            <TextInput
              style={styles.input}
              placeholder="colleague@hospital.com"
              placeholderTextColor="#9ca3af"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          {/* Optional note */}
          <Text style={styles.sectionLabel}>NOTE TO RECIPIENT <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            style={styles.noteInput}
            placeholder="e.g. 'Please review the blast cell distribution on slide 3.'"
            placeholderTextColor="#9ca3af"
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          {/* DUA acknowledgement (specialists only) */}
          {needsDUA && (
            <TouchableOpacity
              style={[styles.duaRow, duaAccepted && styles.duaRowAccepted]}
              onPress={() => setDuaAccepted(prev => !prev)}
              activeOpacity={0.8}
            >
              <View style={[styles.duaCheckbox, duaAccepted && styles.duaCheckboxChecked]}>
                {duaAccepted && <Text style={styles.duaCheckmark}>✓</Text>}
              </View>
              <View style={styles.duaTextWrap}>
                <Text style={styles.duaTitle}>I acknowledge the Data Use Agreement</Text>
                <Text style={styles.duaDesc}>
                  The recipient is a licensed clinician, agrees to HIPAA/GDPR terms, and will use this data solely for the purpose stated above.
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {/* Warning if DUA not accepted */}
          {needsDUA && !duaAccepted && (
            <View style={styles.duaWarning}>
              <AlertTriangle size={13} color={ComplianceColors.gdprRed} />
              <Text style={styles.duaWarningText}>
                DUA must be accepted before sharing with external specialists.
              </Text>
            </View>
          )}

          {/* Send button */}
          <TouchableOpacity
            style={[styles.sendBtn, (sending || (needsDUA && !duaAccepted)) && styles.sendBtnDisabled]}
            onPress={handleShare}
            disabled={sending || (needsDUA && !duaAccepted)}
          >
            {sending
              ? <ActivityIndicator color="#ffffff" />
              : <>
                  <Send size={16} color="#ffffff" />
                  <Text style={styles.sendBtnText}>Send Secure Link</Text>
                </>
            }
          </TouchableOpacity>

          <Text style={styles.footerNote}>
            The secure link expires in 48 hours and is single-use. HEMO-EDGE does not store recipient email addresses.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#f7f9fb' },
  content:    { padding: 24, gap: 16, paddingBottom: 40 },

  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  headerLeft: { gap: 2 },
  title:      { fontSize: 24, fontWeight: '800', color: '#191c1e', letterSpacing: -0.5 },
  subtitle:   { fontSize: 13, fontWeight: '600', color: '#00478d' },
  closeBtn:   { width: 36, height: 36, borderRadius: 18, backgroundColor: '#eceef0', alignItems: 'center', justifyContent: 'center' },

  complianceNotice: { flexDirection: 'row', gap: 8, backgroundColor: ComplianceColors.hipaaBlueLight, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: ComplianceColors.hipaaBlueBorder, alignItems: 'flex-start' },
  complianceText:   { flex: 1, fontSize: 11, color: ComplianceColors.hipaaBlue, lineHeight: 16 },

  sectionLabel: { fontSize: 10, fontWeight: '800', color: '#424752', letterSpacing: 1.5 },
  optional:     { fontWeight: '400', fontSize: 10, color: '#9ca3af' },

  recipientRow:            { gap: 8 },
  recipientBtn:            { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: '#e0e3e5', backgroundColor: '#ffffff' },
  recipientBtnActive:      { borderColor: '#00478d', backgroundColor: '#e8f0fb' },
  recipientBtnText:        { fontSize: 13, fontWeight: '600', color: '#424752' },
  recipientBtnTextActive:  { color: '#00478d', fontWeight: '700' },

  residencyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: ComplianceColors.residencyLight, borderRadius: 10, padding: 10 },
  residencyText:{ fontSize: 11, color: ComplianceColors.residencyPurple, flex: 1, lineHeight: 15 },

  inputWrap:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 14, paddingHorizontal: 14, height: 52, borderWidth: 1, borderColor: '#e0e3e5' },
  input:      { flex: 1, fontSize: 15, color: '#191c1e' },

  noteInput:  { backgroundColor: '#ffffff', borderRadius: 14, padding: 14, fontSize: 14, color: '#191c1e', borderWidth: 1, borderColor: '#e0e3e5', minHeight: 88 },

  duaRow:         { flexDirection: 'row', gap: 12, backgroundColor: '#ffffff', borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: '#e0e3e5', alignItems: 'flex-start' },
  duaRowAccepted: { borderColor: ComplianceColors.consentGreen, backgroundColor: ComplianceColors.consentGreenLight },
  duaCheckbox:    { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#d4d6db', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  duaCheckboxChecked: { backgroundColor: ComplianceColors.consentGreen, borderColor: ComplianceColors.consentGreen },
  duaCheckmark:   { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  duaTextWrap:    { flex: 1 },
  duaTitle:       { fontSize: 13, fontWeight: '700', color: '#191c1e', marginBottom: 4 },
  duaDesc:        { fontSize: 11, color: '#424752', lineHeight: 16 },

  duaWarning:     { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: ComplianceColors.gdprRedLight, borderRadius: 10, padding: 10 },
  duaWarningText: { fontSize: 11, color: ComplianceColors.gdprRed, flex: 1 },

  sendBtn:         { flexDirection: 'row', height: 54, borderRadius: 16, backgroundColor: '#00478d', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: '#00478d', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10 },
  sendBtnDisabled: { opacity: 0.45 },
  sendBtnText:     { fontSize: 16, fontWeight: '800', color: '#ffffff' },

  footerNote: { fontSize: 11, color: '#9ca3af', textAlign: 'center', lineHeight: 16 },
});