// FILE: app/(tabs)/history.tsx
// Phase 3 + Enhancement: HIPAA/GDPR compliance + search + sparklines + date grouping + pagination
import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Alert, ActivityIndicator, TextInput, Modal,
  Animated, Switch, Dimensions,
} from 'react-native';
import { Svg as SvgView, Polyline, Circle } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Microscope, User, Link, ShieldCheck, Download,
  Trash2, AlertTriangle, FileSearch, Lock, ChevronRight,
  Search, X, Calendar, TrendingUp, TrendingDown, Minus,
  ChevronDown,
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
  primaryLight:  '#e8f0fb',
  background:    '#f7f9fb',
  surface:       '#ffffff',
  text:          '#191c1e',
  textSecondary: '#424752',
  border:        '#e0e3e5',
  error:         '#ba1a1a',
  errorLight:    '#ffdad6',
  warning:       '#7d5700',
  warningLight:  '#ffefd6',
  success:       '#006d3a',
  successLight:  '#dcfce7',
};

const PAGE_SIZE = 10;

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────
function riskColors(risk: string) {
  if (risk === 'critical' || risk === 'high') return { bg: THEME.errorLight,   text: THEME.error };
  if (risk === 'moderate')                    return { bg: THEME.warningLight,  text: THEME.warning };
  return                                             { bg: THEME.successLight,  text: THEME.success };
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function groupByDate(scans: StoredScanResult[]): Array<{ title: string; data: StoredScanResult[] }> {
  const today     = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

  const groups: Record<string, StoredScanResult[]> = {};
  for (const scan of scans) {
    const d = new Date(scan.analyzedOn); d.setHours(0,0,0,0);
    let label: string;
    if (d.getTime() === today.getTime())     label = 'Today';
    else if (d.getTime() === yesterday.getTime()) label = 'Yesterday';
    else label = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    if (!groups[label]) groups[label] = [];
    groups[label].push(scan);
  }
  return Object.entries(groups).map(([title, data]) => ({ title, data }));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Inline sparkline: tiny SVG trend line for WBC / RBC / Platelets
// ─────────────────────────────────────────────────────────────────────────────
type SparkPoint = { value: number; label: string };

function Sparkline({ points, color = '#3b82f6', w = 64, h = 28 }: {
  points: SparkPoint[]; color?: string; w?: number; h?: number;
}) {
  if (!points || points.length < 2) return null;
  const values = points.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const xStep = w / (points.length - 1);

  const coords = points.map((p, i) => {
    const x = i * xStep;
    const y = h - ((p.value - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });
  const last = points[points.length - 1];
  const trend = values[values.length - 1] - values[0];

  return (
    <View style={{ width: w, height: h + 14 }}>
      <SvgView width={w} height={h}>
        <Polyline
          points={coords.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Circle
          cx={coords[coords.length - 1].split(',')[0]}
          cy={coords[coords.length - 1].split(',')[1]}
          r="2.5"
          fill={color}
        />
      </SvgView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 }}>
        {trend > 0
          ? <TrendingUp size={9} color={THEME.warning} />
          : trend < 0
          ? <TrendingDown size={9} color={THEME.error} />
          : <Minus size={9} color={THEME.textSecondary} />}
        <Text style={{ fontSize: 9, fontWeight: '700', color: color }}>{last.value.toFixed(1)}</Text>
      </View>
    </View>
  );
}

// Extract WBC/RBC/PLT from a scan for sparkline display
function extractMarkers(scan: StoredScanResult): { wbc: number; rbc: number; plt: number } | null {
  try {
    const m = (scan as any).markers;
    if (!m) return null;
    return {
      wbc: parseFloat(m.wbc ?? m.WBC ?? 0),
      rbc: parseFloat(m.rbc ?? m.RBC ?? 0),
      plt: parseFloat(m.platelets ?? m.PLT ?? 0),
    };
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SparklineRow — shown inside each ScanCard for blood marker mini-trends
// ─────────────────────────────────────────────────────────────────────────────
function SparklineRow({ scan, allScans }: { scan: StoredScanResult; allScans: StoredScanResult[] }) {
  // Build a 5-point history from the most recent scans (same patient) 
  const history = useMemo(() => {
    return allScans
      .filter(s => s.patientId === scan.patientId || (s as any).userId === (scan as any).userId)
      .slice(0, 5)
      .reverse();
  }, [allScans, scan]);

  if (history.length < 2) return null;

  const wbcPoints: SparkPoint[] = history.map(s => ({ value: extractMarkers(s)?.wbc ?? 0, label: '' })).filter(p => p.value > 0);
  const rbcPoints: SparkPoint[] = history.map(s => ({ value: extractMarkers(s)?.rbc ?? 0, label: '' })).filter(p => p.value > 0);
  const pltPoints: SparkPoint[] = history.map(s => ({ value: extractMarkers(s)?.plt ?? 0, label: '' })).filter(p => p.value > 0);

  if (!wbcPoints.length && !rbcPoints.length) return null;

  return (
    <View style={sparkStyles.row}>
      {wbcPoints.length >= 2 && (
        <View style={sparkStyles.item}>
          <Text style={sparkStyles.label}>WBC</Text>
          <Sparkline points={wbcPoints} color="#3b82f6" />
        </View>
      )}
      {rbcPoints.length >= 2 && (
        <View style={sparkStyles.item}>
          <Text style={sparkStyles.label}>RBC</Text>
          <Sparkline points={rbcPoints} color="#ef4444" />
        </View>
      )}
      {pltPoints.length >= 2 && (
        <View style={sparkStyles.item}>
          <Text style={sparkStyles.label}>PLT</Text>
          <Sparkline points={pltPoints} color="#8b5cf6" />
        </View>
      )}
    </View>
  );
}

const sparkStyles = StyleSheet.create({
  row:   { flexDirection: 'row', gap: 16, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f0f1f3' },
  item:  { alignItems: 'flex-start', gap: 2 },
  label: { fontSize: 9, fontWeight: '800', color: THEME.textSecondary, letterSpacing: 0.5 },
});

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
//  BlastProbabilityBar — mini blast probability indicator on each card
// ─────────────────────────────────────────────────────────────────────────────
function BlastProbabilityBar({ probability }: { probability?: number }) {
  if (probability === undefined || probability === null) return null;
  const pct = Math.round(probability * 100);
  const color = probability >= 0.7 ? THEME.error : probability >= 0.4 ? THEME.warning : THEME.success;
  return (
    <View style={blastStyles.wrap}>
      <Text style={blastStyles.label}>Blast Prob.</Text>
      <View style={blastStyles.track}>
        <View style={[blastStyles.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[blastStyles.value, { color }]}>{pct}%</Text>
    </View>
  );
}

const blastStyles = StyleSheet.create({
  wrap:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  label: { fontSize: 9, fontWeight: '700', color: THEME.textSecondary, width: 56 },
  track: { flex: 1, height: 4, backgroundColor: '#e0e3e5', borderRadius: 2, overflow: 'hidden' },
  fill:  { height: 4, borderRadius: 2 },
  value: { fontSize: 10, fontWeight: '800', width: 28, textAlign: 'right' },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Scan card
// ─────────────────────────────────────────────────────────────────────────────
function ScanCard({
  scan, onPress, onDelete, role, allScans,
}: {
  scan: StoredScanResult;
  onPress: () => void;
  onDelete: () => void;
  role: 'doctor' | 'patient';
  allScans: StoredScanResult[];
}) {
  const rc = riskColors(scan.overallRisk);
  const blastProb = (scan as any).blastProbability as number | undefined;
  const isCritical = scan.overallRisk === 'critical' || scan.overallRisk === 'high';

  return (
    <TouchableOpacity
      style={[styles.card, isCritical && styles.cardCritical]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Top row */}
      <View style={styles.cardTopRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardCaseId}>{scan.caseId}</Text>
          <Text style={styles.cardTime}>{formatTime(scan.analyzedOn)}</Text>
        </View>
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

      {/* Meta */}
      <Text style={styles.cardMeta}>
        {[scan.specimenType, scan.scanMode].filter(Boolean).join(' · ')}
      </Text>

      {/* Blast probability bar */}
      <BlastProbabilityBar probability={blastProb} />

      {/* Compliance pill */}
      <View style={{ marginTop: 4 }}>
        <CompliancePill scan={scan} />
      </View>

      {/* Summary */}
      {scan.summary ? (
        <Text style={styles.cardSummary} numberOfLines={2} ellipsizeMode="tail">{scan.summary}</Text>
      ) : null}

      {/* Sparklines — shows 5-point trend for WBC/RBC/PLT */}
      <SparklineRow scan={scan} allScans={allScans} />

      {/* Footer */}
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
//  Date section header
// ─────────────────────────────────────────────────────────────────────────────
function DateHeader({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.dateHeader}>
      <View style={styles.dateHeaderLine} />
      <View style={styles.dateHeaderPill}>
        <Calendar size={10} color={THEME.textSecondary} />
        <Text style={styles.dateHeaderText}>{title}</Text>
        <View style={styles.dateHeaderCount}><Text style={styles.dateHeaderCountText}>{count}</Text></View>
      </View>
      <View style={styles.dateHeaderLine} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Summary stats bar — shown at top of scan list
// ─────────────────────────────────────────────────────────────────────────────
function SummaryBar({ scans }: { scans: StoredScanResult[] }) {
  const critical = scans.filter(s => s.overallRisk === 'critical' || s.overallRisk === 'high').length;
  const moderate = scans.filter(s => s.overallRisk === 'moderate').length;
  const normal   = scans.filter(s => s.overallRisk === 'low').length;

  return (
    <View style={sumStyles.wrap}>
      <View style={sumStyles.item}>
        <Text style={[sumStyles.value, { color: THEME.error }]}>{critical}</Text>
        <Text style={sumStyles.label}>Critical</Text>
      </View>
      <View style={sumStyles.divider} />
      <View style={sumStyles.item}>
        <Text style={[sumStyles.value, { color: THEME.warning }]}>{moderate}</Text>
        <Text style={sumStyles.label}>Moderate</Text>
      </View>
      <View style={sumStyles.divider} />
      <View style={sumStyles.item}>
        <Text style={[sumStyles.value, { color: THEME.success }]}>{normal}</Text>
        <Text style={sumStyles.label}>Normal</Text>
      </View>
      <View style={sumStyles.divider} />
      <View style={sumStyles.item}>
        <Text style={[sumStyles.value, { color: THEME.primary }]}>{scans.length}</Text>
        <Text style={sumStyles.label}>Total</Text>
      </View>
    </View>
  );
}

const sumStyles = StyleSheet.create({
  wrap:    { flexDirection: 'row', backgroundColor: THEME.surface, borderRadius: 14, padding: 12, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  item:    { flex: 1, alignItems: 'center', gap: 2 },
  value:   { fontSize: 20, fontWeight: '900' },
  label:   { fontSize: 9, fontWeight: '700', color: THEME.textSecondary, letterSpacing: 0.5 },
  divider: { width: 1, backgroundColor: THEME.border, marginHorizontal: 4 },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Load more button
// ─────────────────────────────────────────────────────────────────────────────
function LoadMoreButton({ onPress, visible }: { onPress: () => void; visible: boolean }) {
  if (!visible) return null;
  return (
    <TouchableOpacity style={loadStyles.btn} onPress={onPress}>
      <ChevronDown size={16} color={THEME.primary} />
      <Text style={loadStyles.text}>Load more records</Text>
    </TouchableOpacity>
  );
}

const loadStyles = StyleSheet.create({
  btn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, backgroundColor: THEME.surface, borderRadius: 14, marginBottom: 12, borderWidth: 1, borderColor: THEME.border },
  text: { fontSize: 13, fontWeight: '700', color: THEME.primary },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Flat list items — combines groups + cards for a single FlatList
// ─────────────────────────────────────────────────────────────────────────────
type ListItem =
  | { type: 'header'; title: string; count: number }
  | { type: 'card';   scan: StoredScanResult };

function buildListItems(groups: Array<{ title: string; data: StoredScanResult[] }>): ListItem[] {
  const out: ListItem[] = [];
  for (const g of groups) {
    out.push({ type: 'header', title: g.title, count: g.data.length });
    for (const s of g.data) out.push({ type: 'card', scan: s });
  }
  return out;
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
  const [search,      setSearch]      = useState('');
  const [page,        setPage]        = useState(1);

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      const [scanList, patientList] = await Promise.all([
        getScanHistory(user.uid),
        role === 'doctor' ? getPatientList(user.uid) : Promise.resolve([]),
      ]);
      setScans(scanList);
      setPatients(patientList);
      setPage(1); // reset pagination on refresh
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

  // Filter + search + paginate
  const filteredScans = useMemo(() => {
    let result = scans.filter(s => {
      if (filter === 'critical') return s.overallRisk === 'critical' || s.overallRisk === 'high';
      if (filter === 'routine')  return s.overallRisk === 'low' || s.overallRisk === 'moderate';
      return true;
    });
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        s.caseId?.toLowerCase().includes(q) ||
        s.specimenType?.toLowerCase().includes(q) ||
        s.patientName?.toLowerCase().includes(q) ||
        s.summary?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [scans, filter, search]);

  const paginatedScans = useMemo(() => filteredScans.slice(0, page * PAGE_SIZE), [filteredScans, page]);
  const hasMore = paginatedScans.length < filteredScans.length;

  const groups     = useMemo(() => groupByDate(paginatedScans), [paginatedScans]);
  const listItems  = useMemo(() => buildListItems(groups), [groups]);

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
      Alert.alert('Export Ready', `Your export contains ${bundle.scans.length} scans and ${bundle.auditTrail.length} audit entries.`);
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
              Alert.alert('Request submitted', 'We will process your erasure request within 30 days.');
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
    Alert.alert('Export prepared', `${exportData.length} scans ${piiScrubbed ? '(PHI anonymised)' : '(full PHI — handle with care)'} ready.`);
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
      {/* ── Header ── */}
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

        {/* Search bar */}
        <View style={styles.searchBar}>
          <Search size={16} color={THEME.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by case ID, type, patient…"
            placeholderTextColor="#9ca3af"
            value={search}
            onChangeText={t => { setSearch(t); setPage(1); }}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={14} color={THEME.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter tabs */}
        <View style={styles.filterRow}>
          {(['all', 'critical', 'routine'] as const).map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.filterTab, filter === f && styles.filterTabActive]}
              onPress={() => { setFilter(f); setPage(1); }}
            >
              <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
                {f === 'all' ? `All (${scans.length})` : f === 'critical' ? '⚠ Critical' : 'Routine'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Flat list ── */}
      <FlatList
        data={listItems}
        keyExtractor={(item, i) => item.type === 'header' ? `hdr-${item.title}` : `card-${item.scan.id}-${i}`}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={THEME.primary} />}
        ListHeaderComponent={
          filteredScans.length > 0
            ? <SummaryBar scans={filteredScans} />
            : null
        }
        renderItem={({ item }) => {
          if (item.type === 'header') {
            return <DateHeader title={item.title} count={item.count} />;
          }
          return (
            <ScanCard
              scan={item.scan}
              onPress={() => handleCardPress(item.scan)}
              onDelete={() => handleDeleteScan(item.scan)}
              role={role as 'doctor' | 'patient'}
              allScans={scans}
            />
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Microscope color="#e0e3e5" size={64} />
            <Text style={styles.emptyTitle}>
              {search ? 'No results found' : 'No scans found'}
            </Text>
            <Text style={styles.emptyDesc}>
              {search
                ? `No records matching "${search}". Try a different search term.`
                : filter !== 'all'
                ? 'Try changing the filter above.'
                : 'Upload a blood report to get started.'}
            </Text>
          </View>
        }
        ListFooterComponent={
          <>
            <LoadMoreButton onPress={() => setPage(p => p + 1)} visible={hasMore} />

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
            <Text style={styles.modalDesc}>Enter the patients registered email address.</Text>
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

  // Search
  searchBar:   { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#eceef0', borderRadius: 14, paddingHorizontal: 14, height: 44 },
  searchInput: { flex: 1, fontSize: 14, color: THEME.text, fontWeight: '500' },

  // HIPAA Banner
  hipaaBanner:    { flexDirection: 'row', backgroundColor: ComplianceColors.hipaaBlueLight, borderRadius: 12, padding: 10, alignItems: 'flex-start', borderWidth: 1, borderColor: ComplianceColors.hipaaBlueBorder, gap: 8 },
  hipaaIconWrap:  { width: 28, height: 28, borderRadius: 14, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  hipaaTextWrap:  { flex: 1 },
  hipaaTitle:     { fontSize: 12, fontWeight: '800', color: ComplianceColors.hipaaBlue, marginBottom: 2 },
  hipaaBody:      { fontSize: 11, color: ComplianceColors.hipaaBlue, lineHeight: 15, opacity: 0.8 },
  hipaaClose:     { padding: 2 },
  hipaaCloseText: { fontSize: 12, color: ComplianceColors.hipaaBlue, fontWeight: '700', opacity: 0.6 },

  // Filter tabs
  filterRow:           { flexDirection: 'row', gap: 8 },
  filterTab:           { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#eceef0' },
  filterTabActive:     { backgroundColor: THEME.primary },
  filterTabText:       { fontSize: 12, fontWeight: '600', color: THEME.textSecondary },
  filterTabTextActive: { color: '#ffffff', fontWeight: '700' },

  // Date section header
  dateHeader:          { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 8 },
  dateHeaderLine:      { flex: 1, height: 1, backgroundColor: THEME.border },
  dateHeaderPill:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#eceef0', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  dateHeaderText:      { fontSize: 10, fontWeight: '700', color: THEME.textSecondary },
  dateHeaderCount:     { backgroundColor: THEME.primary, borderRadius: 99, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  dateHeaderCountText: { fontSize: 9, fontWeight: '800', color: '#fff' },

  // Card
  card:          { backgroundColor: THEME.surface, borderRadius: 20, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3, gap: 4 },
  cardCritical:  { borderLeftWidth: 3, borderLeftColor: THEME.error },
  cardTopRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 },
  cardCaseId:    { fontSize: 13, fontWeight: '700', color: THEME.primary },
  cardTime:      { fontSize: 11, color: THEME.textSecondary, marginTop: 1 },
  riskBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  riskBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  cardMeta:      { fontSize: 12, color: THEME.textSecondary },
  cardSummary:   { fontSize: 13, color: THEME.textSecondary, lineHeight: 18, marginTop: 4 },
  cardFooter:    { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#f0f1f3' },
  cardFooterText:{ fontSize: 11, fontWeight: '600', color: THEME.textSecondary },
  deleteBtn:     { padding: 3 },

  compliancePill:     { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  compliancePillText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },

  // Empty state
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: THEME.text },
  emptyDesc:  { fontSize: 14, color: THEME.textSecondary, textAlign: 'center', paddingHorizontal: 16 },

  // Doctor section
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

  // GDPR panel
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

  // PII scrub modal
  scrubToggleRow:  { backgroundColor: '#f7f9fb', borderRadius: 14, padding: 12, gap: 10 },
  scrubToggleInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  scrubIconWrap:   { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  scrubToggleLabel:{ fontSize: 13, fontWeight: '700', color: THEME.text, marginBottom: 3 },
  scrubToggleDesc: { fontSize: 11, color: THEME.textSecondary, lineHeight: 15 },
  scrubWarning:    { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: ComplianceColors.gdprRedLight, borderRadius: 10, padding: 10 },
  scrubWarningText:{ fontSize: 11, color: ComplianceColors.gdprRed, lineHeight: 15, flex: 1 },

  // Modals
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