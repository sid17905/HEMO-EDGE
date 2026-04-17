// FILE: app/(tabs)/history.tsx
// Phase 3: HIPAA/GDPR compliance layer — audit logging, PII scrubbing, erasure requests
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Alert, ActivityIndicator, TextInput, Modal,
  Platform, Animated, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Microscope, User, Link, ShieldCheck, Download,
  Trash2, AlertTriangle, FileSearch, Lock, ChevronRight,
} from 'lucide-react-native';
import { useAuthContext } from '../../contexts/auth-context';
import {
  getScanHistory, getPatientList, linkPatientToDoctor,
  writeAuditLog, softDeleteScan, requestGDPRErasure,
  buildGDPRExport, scrubPII,
} from '../../lib/firestore-service';
import type { StoredScanResult, UserProfile } from '../../lib/firestore-service';
import { ComplianceColors } from '../../constants/theme';

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
  warning:       '#7d5700',
  success:       '#006d3a',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────
function riskColors(risk: string) {
  if (risk === 'critical' || risk === 'high') return { bg: '#ffdad6', text: THEME.error };
  if (risk === 'moderate')                    return { bg: '#ffefd6', text: THEME.warning };
  return { bg: '#dcfce7', text: '#15803d' };
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HIPAA Audit Banner
// ─────────────────────────────────────────────────────────────────────────────
function HIPAABanner({ role }: { role: 'doctor' | 'patient' }) {
  const [dismissed, setDismissed] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;

  const dismiss = () => {
    Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(
      () => setDismissed(true),
    );
  };

  if (dismissed) return null;

  return (
    <Animated.View style={[styles.hipaaBanner, { opacity }]}>
      <View style={styles.hipaaIconWrap}>
        <ShieldCheck color={ComplianceColors.hipaaBlue} size={16} strokeWidth={2.5} />
      </View>
      <View style={styles.hipaaTextWrap}>
        <Text style={styles.hipaaTitle}>
          {role === 'doctor' ? 'Access is Audited' : 'Your Data is Protected'}
        </Text>
        <Text style={styles.hipaaBody}>
          {role === 'doctor'
            ? 'All record views and exports are logged per HIPAA §164.312(b).'
            : 'HEMO-EDGE processes your data under GDPR-compliant consent v1.0.'}
        </Text>
      </View>
      <TouchableOpacity onPress={dismiss} style={styles.hipaaClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.hipaaCloseText}>✕</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Compliance status pill
// ─────────────────────────────────────────────────────────────────────────────
function CompliancePill({ scan }: { scan: StoredScanResult }) {
  if (!scan.compliance) return null;
  const isAnon = scan.compliance.isAnonymised;
  return (
    <View style={[styles.compliancePill, { backgroundColor: isAnon ? ComplianceColors.piiAmberLight : ComplianceColors.consentGreenLight }]}>
      <Lock size={9} color={isAnon ? ComplianceColors.piiAmber : ComplianceColors.consentGreen} />
      <Text style={[styles.compliancePillText, { color: isAnon ? ComplianceColors.piiAmber : ComplianceColors.consentGreen }]}>
        {isAnon ? 'Anonymised' : `Consent ${scan.compliance.consentVersion}`}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Scan card
// ─────────────────────────────────────────────────────────────────────────────
function ScanCard({
  scan, onPress, onDelete, role,
}: {
  scan: StoredScanResult;
  onPress: () => void;
  onDelete: () => void;
  role: 'doctor' | 'patient';
}) {
  const rc = riskColors(scan.overallRisk);
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.cardTopRow}>
        <Text style={styles.cardCaseId}>{scan.caseId}</Text>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <View style={[styles.riskBadge, { backgroundColor: rc.bg }]}>
            <Text style={[styles.riskBadgeText, { color: rc.text }]}>
              {scan.overallRisk.toUpperCase()}
            </Text>
          </View>
          {role === 'patient' && (
            <TouchableOpacity onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.deleteBtn}>
              <Trash2 size={13} color={ComplianceColors.gdprRed} />
            </TouchableOpacity>
          )}
        </View>
      </View>
      <Text style={styles.cardMeta}>{scan.specimenType || '—'} · {scan.scanMode || '—'}</Text>
      <Text style={styles.cardDate}>{formatDate(scan.analyzedOn)}</Text>
      <CompliancePill scan={scan} />
      {scan.summary ? (
        <Text style={styles.cardSummary} numberOfLines={2} ellipsizeMode="tail">{scan.summary}</Text>
      ) : null}
      <View style={styles.cardFooter}>
        <Text style={styles.cardFooterText}>View full report</Text>
        <ChevronRight size={13} color={THEME.textSecondary} />
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Patient row (doctor view)
// ─────────────────────────────────────────────────────────────────────────────
function PatientRow({ patient }: { patient: UserProfile }) {
  return (
    <View style={styles.patientRow}>
      <View style={styles.patientIcon}><User color={THEME.primary} size={16} /></View>
      <View style={styles.patientInfo}>
        <Text style={styles.patientName}>{patient.fullName}</Text>
        <Text style={styles.patientEmail}>{patient.email}</Text>
      </View>
      <View style={styles.patientBadge}><Text style={styles.patientBadgeText}>patient</Text></View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  GDPR Patient Panel
// ─────────────────────────────────────────────────────────────────────────────
function GDPRPanel({ uid, onExport, onErasure, exporting }: {
  uid: string; onExport: () => void; onErasure: () => void; exporting: boolean;
}) {
  return (
    <View style={styles.gdprPanel}>
      <View style={styles.gdprPanelHeader}>
        <FileSearch size={16} color={THEME.primary} />
        <Text style={styles.gdprPanelTitle}>Your Data Rights (GDPR)</Text>
      </View>
      <Text style={styles.gdprPanelDesc}>
        Under GDPR Articles 15 & 17, you have the right to access and request deletion of your personal data.
      </Text>
      <View style={styles.gdprButtons}>
        <TouchableOpacity style={styles.gdprExportBtn} onPress={onExport} disabled={exporting}>
          {exporting
            ? <ActivityIndicator size="small" color={THEME.primary} />
            : <Download size={15} color={THEME.primary} />}
          <Text style={styles.gdprExportText}>{exporting ? 'Preparing…' : 'Download My Data'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.gdprErasureBtn} onPress={onErasure}>
          <AlertTriangle size={15} color={ComplianceColors.gdprRed} />
          <Text style={styles.gdprErasureText}>Request Deletion</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.gdprNote}>
        Medical records are retained for 7 years per regulatory requirements. PHI fields will be anonymised during this period.
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  PII Scrub Export Modal (doctor)
// ─────────────────────────────────────────────────────────────────────────────
function PIIScrubModal({ visible, scans, onClose, onConfirmExport }: {
  visible: boolean; scans: StoredScanResult[]; onClose: () => void;
  onConfirmExport: (scrubbed: boolean) => void;
}) {
  const [piiScrub, setPiiScrub] = useState(true);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Export Scan Data</Text>
          <Text style={styles.modalDesc}>Export {scans.length} scan{scans.length !== 1 ? 's' : ''} as a JSON dataset.</Text>

          <View style={styles.scrubToggleRow}>
            <View style={styles.scrubToggleInfo}>
              <View style={[styles.scrubIconWrap, { backgroundColor: piiScrub ? ComplianceColors.piiAmberLight : '#f0f1f3' }]}>
                <Lock size={14} color={piiScrub ? ComplianceColors.piiAmber : THEME.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.scrubToggleLabel}>Remove PHI (HIPAA Safe Harbour)</Text>
                <Text style={styles.scrubToggleDesc}>
                  {piiScrub
                    ? 'Patient names, IDs, and images will be anonymised. Safe for research use.'
                    : 'Full identifiable data included. Restricted to authorised personnel only.'}
                </Text>
              </View>
            </View>
            <Switch
              value={piiScrub}
              onValueChange={setPiiScrub}
              trackColor={{ true: ComplianceColors.piiAmber, false: '#d4d6db' }}
              thumbColor={piiScrub ? '#ffffff' : '#f4f3f4'}
            />
          </View>

          {!piiScrub && (
            <View style={styles.scrubWarning}>
              <AlertTriangle size={13} color={ComplianceColors.gdprRed} />
              <Text style={styles.scrubWarningText}>
                Exporting identifiable PHI. Ensure recipient has signed a DUA and is HIPAA-authorised.
              </Text>
            </View>
          )}

          <View style={styles.modalButtons}>
            <TouchableOpacity style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalConfirm, { backgroundColor: piiScrub ? ComplianceColors.piiAmber : THEME.error }]}
              onPress={() => onConfirmExport(piiScrub)}
            >
              <Text style={styles.modalConfirmText}>
                {piiScrub ? 'Export (Anonymised)' : 'Export (Full PHI)'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main screen
// ─────────────────────────────────────────────────────────────────────────────
export default function HistoryScreen() {
  const { user, role } = useAuthContext();

  const [scans,       setScans]       = useState<StoredScanResult[]>([]);
  const [patients,    setPatients]    = useState<UserProfile[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [linkModal,   setLinkModal]   = useState(false);
  const [linkEmail,   setLinkEmail]   = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [exportModal, setExportModal] = useState(false);
  const [exporting,   setExporting]   = useState(false);
  const [filter,      setFilter]      = useState<'all' | 'critical' | 'routine'>('all');

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      const [scanList, patientList] = await Promise.all([
        getScanHistory(user.uid),
        role === 'doctor' ? getPatientList(user.uid) : Promise.resolve([]),
      ]);
      setScans(scanList);
      setPatients(patientList);
    } catch (err) {
      console.error('HEMO-EDGE: history fetch failed', err);
    }
  }, [user, role]);

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const filteredScans = scans.filter(s => {
    if (filter === 'critical') return s.overallRisk === 'critical' || s.overallRisk === 'high';
    if (filter === 'routine')  return s.overallRisk === 'low' || s.overallRisk === 'moderate';
    return true;
  });

  // Audit log on card tap then navigate
  const handleCardPress = async (scan: StoredScanResult) => {
    if (user) {
      await writeAuditLog({
        actorUid:       user.uid,
        actorRole:      role as 'doctor' | 'patient',
        action:         'view_report',
        resourceId:     scan.id,
        resourceType:   'report',
        dataResidency:  scan.compliance?.dataResidency,
        consentVersion: scan.compliance?.consentVersion,
      });
    }
    router.push({
      pathname: '/result',
      params: {
        groqReport:   JSON.stringify(scan),
        caseId:       scan.caseId,
        analyzedOn:   scan.analyzedOn,
        specimenType: scan.specimenType,
        scanMode:     scan.scanMode,
        imageUri:     scan.imageUri ?? '',
      },
    });
  };

  const handleDeleteScan = async (scan: StoredScanResult) => {
    if (!user) return;
    Alert.alert(
      'Remove This Record?',
      'PHI will be anonymised and record flagged for deletion. Medical data is retained for 7 years per law.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request Removal',
          style: 'destructive',
          onPress: async () => {
            try {
              await softDeleteScan(user.uid, scan.id, 'gdpr_erasure', user.uid, role as 'doctor' | 'patient');
              Alert.alert('Removal requested', 'Your request is queued. PHI will be anonymised within 30 days.');
              fetchData();
            } catch { Alert.alert('Error', 'Failed to submit removal request. Try again.'); }
          },
        },
      ],
    );
  };

  const handleLinkPatient = async () => {
    if (!user || !linkEmail.trim()) return;
    setLinkLoading(true);
    try {
      await linkPatientToDoctor(user.uid, linkEmail.trim());
      setLinkModal(false);
      setLinkEmail('');
      Alert.alert('Patient linked successfully');
      fetchData();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLinkLoading(false);
    }
  };

  const handleGDPRExport = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const bundle = await buildGDPRExport(user.uid);
      Alert.alert('Export Ready', `Your export contains ${bundle.scans.length} scans and ${bundle.auditTrail.length} audit entries. In production this would be emailed to your registered address.`);
    } catch { Alert.alert('Export failed', 'Please try again or contact support.'); }
    finally { setExporting(false); }
  };

  const handleGDPRErasure = () => {
    Alert.alert(
      'Request Data Deletion',
      'GDPR Art. 17 erasure request. PHI will be anonymised within 30 days. Medical records retained for 7 years.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit Request', style: 'destructive',
          onPress: async () => {
            if (!user) return;
            try {
              await requestGDPRErasure(user.uid, role as 'doctor' | 'patient');
              Alert.alert('Request submitted', 'We will process your erasure request within 30 days. Confirmation will be sent to your registered email.');
            } catch { Alert.alert('Error', 'Could not submit request. Contact dpo@hemo-edge.com.'); }
          },
        },
      ],
    );
  };

  const handleConfirmExport = async (piiScrubbed: boolean) => {
    setExportModal(false);
    if (!user) return;
    const exportData = piiScrubbed ? scans.map(scrubPII) : scans;
    await writeAuditLog({ actorUid: user.uid, actorRole: 'doctor', action: piiScrubbed ? 'export_pii_scrubbed' : 'export_data', resourceType: 'export' });
    Alert.alert('Export prepared', `${exportData.length} scans ${piiScrubbed ? '(PHI anonymised — safe for research)' : '(full PHI — handle with care)'} ready.`);
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator color={THEME.primary} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>{role === 'doctor' ? 'All History' : 'My History'}</Text>
          {role === 'doctor' && (
            <TouchableOpacity style={styles.exportBtn} onPress={() => setExportModal(true)}>
              <Download size={14} color={THEME.primary} />
              <Text style={styles.exportBtnText}>Export</Text>
            </TouchableOpacity>
          )}
        </View>

        <HIPAABanner role={role as 'doctor' | 'patient'} />

        <View style={styles.filterRow}>
          {(['all', 'critical', 'routine'] as const).map(f => (
            <TouchableOpacity key={f} style={[styles.filterTab, filter === f && styles.filterTabActive]} onPress={() => setFilter(f)}>
              <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
                {f === 'all' ? 'All' : f === 'critical' ? '⚠ Critical' : 'Routine'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <FlatList
        data={filteredScans}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={THEME.primary} />}
        renderItem={({ item }) => (
          <ScanCard
            scan={item}
            onPress={() => handleCardPress(item)}
            onDelete={() => handleDeleteScan(item)}
            role={role as 'doctor' | 'patient'}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Microscope color="#e0e3e5" size={64} />
            <Text style={styles.emptyTitle}>No scans found</Text>
            <Text style={styles.emptyDesc}>{filter !== 'all' ? 'Try changing the filter above.' : 'Upload a blood report to get started.'}</Text>
          </View>
        }
        ListFooterComponent={
          <>
            {role === 'doctor' && (
              <View style={styles.doctorSection}>
                <Text style={styles.doctorHeading}>My Patients</Text>
                {patients.length === 0
                  ? <Text style={styles.noPatientsText}>No linked patients yet.</Text>
                  : patients.map(p => <PatientRow key={p.uid} patient={p} />)}
                <TouchableOpacity style={styles.linkButton} onPress={() => setLinkModal(true)}>
                  <Link color="#ffffff" size={16} />
                  <Text style={styles.linkButtonText}>Link a Patient</Text>
                </TouchableOpacity>
              </View>
            )}
            {role === 'patient' && (
              <GDPRPanel
                uid={user?.uid ?? ''}
                onExport={handleGDPRExport}
                onErasure={handleGDPRErasure}
                exporting={exporting}
              />
            )}
          </>
        }
      />

      {/* Link patient modal */}
      <Modal visible={linkModal} transparent animationType="fade" onRequestClose={() => setLinkModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Link a Patient</Text>
            <Text style={styles.modalDesc}>Enter the patient's registered email address.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="patient@example.com"
              placeholderTextColor="#9ca3af"
              value={linkEmail}
              onChangeText={setLinkEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => { setLinkModal(false); setLinkEmail(''); }}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleLinkPatient} disabled={linkLoading}>
                {linkLoading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.modalConfirmText}>Link</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* PII Scrub Export Modal */}
      <PIIScrubModal
        visible={exportModal}
        scans={scans}
        onClose={() => setExportModal(false)}
        onConfirmExport={handleConfirmExport}
      />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: THEME.background },
  centered:    { alignItems: 'center', justifyContent: 'center' },
  header:      { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 10 },
  headerRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 28, fontWeight: '800', color: THEME.text, letterSpacing: -0.5 },
  listContent: { padding: 16, paddingBottom: 48 },

  exportBtn:     { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: ComplianceColors.hipaaBlueLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  exportBtnText: { fontSize: 12, fontWeight: '700', color: THEME.primary },

  hipaaBanner:    { flexDirection: 'row', backgroundColor: ComplianceColors.hipaaBlueLight, borderRadius: 12, padding: 10, alignItems: 'flex-start', borderWidth: 1, borderColor: ComplianceColors.hipaaBlueBorder, gap: 8 },
  hipaaIconWrap:  { width: 28, height: 28, borderRadius: 14, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  hipaaTextWrap:  { flex: 1 },
  hipaaTitle:     { fontSize: 12, fontWeight: '800', color: ComplianceColors.hipaaBlue, marginBottom: 2 },
  hipaaBody:      { fontSize: 11, color: ComplianceColors.hipaaBlue, lineHeight: 15, opacity: 0.8 },
  hipaaClose:     { padding: 2 },
  hipaaCloseText: { fontSize: 12, color: ComplianceColors.hipaaBlue, fontWeight: '700', opacity: 0.6 },

  filterRow:           { flexDirection: 'row', gap: 8 },
  filterTab:           { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#eceef0' },
  filterTabActive:     { backgroundColor: THEME.primary },
  filterTabText:       { fontSize: 12, fontWeight: '600', color: THEME.textSecondary },
  filterTabTextActive: { color: '#ffffff', fontWeight: '700' },

  card: { backgroundColor: THEME.surface, borderRadius: 20, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3, gap: 4 },
  cardTopRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  cardCaseId:    { fontSize: 13, fontWeight: '700', color: THEME.primary },
  riskBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  riskBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  cardMeta:      { fontSize: 12, color: THEME.textSecondary },
  cardDate:      { fontSize: 11, color: THEME.textSecondary },
  cardSummary:   { fontSize: 13, color: THEME.textSecondary, lineHeight: 18, marginTop: 4 },
  cardFooter:    { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 6 },
  cardFooterText:{ fontSize: 11, fontWeight: '600', color: THEME.textSecondary },
  deleteBtn:     { padding: 3 },

  compliancePill:     { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  compliancePillText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },

  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: THEME.text },
  emptyDesc:  { fontSize: 14, color: THEME.textSecondary, textAlign: 'center' },

  doctorSection:    { marginTop: 24, gap: 12 },
  doctorHeading:    { fontSize: 18, fontWeight: '700', color: THEME.text },
  noPatientsText:   { fontSize: 14, color: THEME.textSecondary },
  patientRow:       { flexDirection: 'row', alignItems: 'center', backgroundColor: THEME.surface, borderRadius: 14, padding: 12, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  patientIcon:      { width: 36, height: 36, borderRadius: 18, backgroundColor: '#e8f0fb', alignItems: 'center', justifyContent: 'center' },
  patientInfo:      { flex: 1 },
  patientName:      { fontSize: 14, fontWeight: '700', color: THEME.text },
  patientEmail:     { fontSize: 12, color: THEME.textSecondary },
  patientBadge:     { backgroundColor: '#e8f0fb', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  patientBadgeText: { fontSize: 10, fontWeight: '700', color: THEME.primary },
  linkButton:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 14, backgroundColor: THEME.primary, gap: 8 },
  linkButtonText:   { fontSize: 14, fontWeight: '700', color: '#ffffff' },

  gdprPanel:       { marginTop: 24, backgroundColor: THEME.surface, borderRadius: 20, padding: 16, gap: 10, borderWidth: 1, borderColor: ComplianceColors.hipaaBlueBorder, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  gdprPanelHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gdprPanelTitle:  { fontSize: 14, fontWeight: '800', color: THEME.text },
  gdprPanelDesc:   { fontSize: 12, color: THEME.textSecondary, lineHeight: 17 },
  gdprButtons:     { flexDirection: 'row', gap: 10 },
  gdprExportBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: 12, borderWidth: 1.5, borderColor: THEME.primary, backgroundColor: ComplianceColors.hipaaBlueLight },
  gdprExportText:  { fontSize: 12, fontWeight: '700', color: THEME.primary },
  gdprErasureBtn:  { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: 12, borderWidth: 1.5, borderColor: ComplianceColors.gdprRed, backgroundColor: ComplianceColors.gdprRedLight },
  gdprErasureText: { fontSize: 12, fontWeight: '700', color: ComplianceColors.gdprRed },
  gdprNote:        { fontSize: 10, color: THEME.textSecondary, lineHeight: 14, fontStyle: 'italic' },

  scrubToggleRow:  { backgroundColor: '#f7f9fb', borderRadius: 14, padding: 12, gap: 10 },
  scrubToggleInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  scrubIconWrap:   { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  scrubToggleLabel:{ fontSize: 13, fontWeight: '700', color: THEME.text, marginBottom: 3 },
  scrubToggleDesc: { fontSize: 11, color: THEME.textSecondary, lineHeight: 15 },
  scrubWarning:    { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: ComplianceColors.gdprRedLight, borderRadius: 10, padding: 10 },
  scrubWarningText:{ fontSize: 11, color: ComplianceColors.gdprRed, lineHeight: 15, flex: 1 },

  modalOverlay:     { flex: 1, backgroundColor: '#00000066', alignItems: 'center', justifyContent: 'center', padding: 32 },
  modalCard:        { backgroundColor: THEME.surface, borderRadius: 24, padding: 24, width: '100%', gap: 14 },
  modalTitle:       { fontSize: 18, fontWeight: '800', color: THEME.text },
  modalDesc:        { fontSize: 13, color: THEME.textSecondary },
  modalInput:       { height: 48, borderRadius: 12, borderWidth: 1, borderColor: '#e0e3e5', paddingHorizontal: 14, fontSize: 14, color: THEME.text },
  modalButtons:     { flexDirection: 'row', gap: 12, marginTop: 4 },
  modalCancel:      { flex: 1, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: '#e0e3e5', alignItems: 'center', justifyContent: 'center' },
  modalCancelText:  { fontSize: 14, fontWeight: '600', color: THEME.textSecondary },
  modalConfirm:     { flex: 1, height: 44, borderRadius: 12, backgroundColor: THEME.primary, alignItems: 'center', justifyContent: 'center' },
  modalConfirmText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
});