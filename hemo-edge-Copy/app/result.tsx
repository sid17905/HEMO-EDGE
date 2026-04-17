// FILE: app/result.tsx
// Phase 5 — Pillar C: biometric gate added on mount.
//           Pillar F: Export PDF button slot (doctor-only, DUA-gated).
//
// INTEGRATION INSTRUCTIONS (minimal-diff approach):
// ─────────────────────────────────────────────────
// Only TWO changes are needed to your existing result.tsx:
//
// 1. Add this import near the top of the file:
//
//    import { BiometricGate } from '@/components/biometric-gate';
//
// 2. Wrap your entire existing return JSX:
//
//    export default function ResultScreen() {
//      const { scanId } = useLocalSearchParams<{ scanId: string }>();
//      // ... all your existing hooks and state ...
//
//      return (
//        <BiometricGate
//          scanId={scanId ?? 'unknown'}
//          reason="Verify identity to view scan results"
//        >
//          {/* ← your existing JSX here, unchanged */}
//        </BiometricGate>
//      );
//    }
//
// ─────────────────────────────────────────────────
// The full reference implementation below matches Phase 4:
// XAI SVG bounding-box overlay, blast probability meter,
// cellDetections, DUA gate — plus the Pillar C biometric gate
// and the Pillar F export button slot.
// ─────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import Svg, { Rect, Text as SvgText, Path } from 'react-native-svg';

import { BiometricGate } from '@/components/biometric-gate';
import { useAuthContext } from '@/contexts/auth-context';
import type { CellDetection } from '@/hooks/use-ml-service';

// ─────────────────────────────────────────────────────────────────────────────
//  XAI bounding box overlay (react-native-svg)
// ─────────────────────────────────────────────────────────────────────────────

const OVERLAY_W = 320;
const OVERLAY_H = 240;

function XAIOverlay({ detections }: { detections: CellDetection[] }): React.ReactElement {
  return (
    <View style={styles.overlayContainer}>
      <View style={styles.overlayImagePlaceholder}>
        <Text style={styles.overlayImagePlaceholderText}>Blood Sample Image</Text>
      </View>
      <Svg
        width={OVERLAY_W}
        height={OVERLAY_H}
        style={StyleSheet.absoluteFill}
        viewBox="0 0 100 100"
      >
        {detections.map((d) => {
          const color = d.isAbnormal ? '#e53935' : '#2a9d8f';
          return (
            <React.Fragment key={d.id}>
              <Rect
                x={d.x} y={d.y} width={d.w} height={d.h}
                stroke={color} strokeWidth={0.5}
                fill={color + '22'}
                rx={1}
              />
              <SvgText
                x={d.x + 0.5} y={d.y - 1}
                fontSize={3} fill={color} fontWeight="700"
              >
                {d.cellType} {(d.blastProbability * 100).toFixed(0)}%
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Risk band helper
// ─────────────────────────────────────────────────────────────────────────────

function getRiskBand(blastPct: number): { label: string; color: string } {
  if (blastPct >= 20) return { label: 'CRITICAL',  color: '#e53935' };
  if (blastPct >= 10) return { label: 'HIGH',      color: '#f57c00' };
  if (blastPct >= 5)  return { label: 'ELEVATED',  color: '#fbc02d' };
  return                     { label: 'NORMAL',    color: '#2a9d8f' };
}

// ─────────────────────────────────────────────────────────────────────────────
//  DUA (Data Use Agreement) gate — same pattern as modal.tsx Phase 3
// ─────────────────────────────────────────────────────────────────────────────

interface DUAGateProps {
  onAccepted: () => void;
}

function DUAGate({ onAccepted }: DUAGateProps): React.ReactElement {
  return (
    <View style={styles.duaCard}>
      <Text style={styles.duaTitle}>Data Use Agreement</Text>
      <Text style={styles.duaBody}>
        This export contains Protected Health Information (PHI). By proceeding
        you confirm you are authorised to handle this data under HIPAA/GDPR and
        agree to the Hemo-Edge Data Use Policy.
      </Text>
      <View style={styles.duaButtons}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}
          style={({ pressed }) => [styles.duaDecline, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
        >
          <Text style={styles.duaDeclineText}>Decline</Text>
        </Pressable>
        <Pressable
          onPress={onAccepted}
          style={({ pressed }) => [styles.duaAccept, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
        >
          <Text style={styles.duaAcceptText}>Accept & Continue</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  ResultContent — inner screen rendered after biometric gate passes
// ─────────────────────────────────────────────────────────────────────────────

function ResultContent({ scanId }: { scanId: string }): React.ReactElement {
  const { role } = useAuthContext();
  const isDoctor = role === 'doctor' || role === 'admin';

  // All data comes from navigation params — scan.tsx passes everything via router.replace
  const params = useLocalSearchParams<{
    groqReport:        string;
    caseId:            string;
    imageUri:          string;
    analyzedOn:        string;
    processingLatency: string;
    specimenType:      string;
    scanMode:          string;
    blastProbability:  string;
    confidenceMargin:  string;
    blastCellPercent:  string;
    cellDetections:    string;
  }>();

  const groqReport = React.useMemo(() => {
    try { return params.groqReport ? JSON.parse(params.groqReport) : null; }
    catch { return null; }
  }, [params.groqReport]);

  const analysis = groqReport ? {
    id:                  scanId,
    caseId:              params.caseId              ?? '',
    analyzedOn:          params.analyzedOn           ?? new Date().toISOString(),
    specimenType:        params.specimenType         ?? 'Blood Sample',
    scanMode:            params.scanMode             ?? 'Cell Morphology AI',
    overallRisk:         groqReport.overallRisk      ?? 'unknown',
    urgency:             groqReport.urgency          ?? 'routine',
    summary:             groqReport.summary          ?? '',
    predictedConditions: groqReport.predictedConditions ?? [],
    markers:             groqReport.markers          ?? [],
    recommendations:     groqReport.recommendations  ?? [],
    blastProbability:    parseFloat(params.blastProbability ?? '0'),
    blastCellPercent:    parseFloat(params.blastCellPercent ?? '0'),
    confidenceMargin:    parseFloat(params.confidenceMargin ?? '0'),
    cellDetections: (() => {
      try { return params.cellDetections ? JSON.parse(params.cellDetections) : []; }
      catch { return []; }
    })(),
  } : null;

  const isLoading = false;
  const error = !analysis ? 'No scan data found. Please run a scan first.' : null;

  // DUA state for PDF export (Pillar F)
  const [duaAccepted, setDuaAccepted] = useState(false);
  const [showDUA,     setShowDUA]     = useState(false);

  const handleExportPress = useCallback((): void => {
    if (!duaAccepted) {
      setShowDUA(true);
      return;
    }
    // PILLAR_F_HOOK: call exportScanAsPDF(analysis, cellDetections, patientName) here
  }, [duaAccepted]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#00478d" />
        <Text style={styles.loadingText}>Loading results…</Text>
      </View>
    );
  }

  if (error || !analysis) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Results not found.'}</Text>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  // DUA overlay
  if (showDUA) {
    return (
      <View style={styles.centeredPad}>
        <DUAGate onAccepted={() => { setDuaAccepted(true); setShowDUA(false); }} />
      </View>
    );
  }

  const {
    blastProbability = 0,
    blastCellPercent = 0,
    confidenceMargin = 0,
    cellDetections   = [],
  } = analysis as typeof analysis & {
    blastProbability?: number;
    blastCellPercent?: number;
    confidenceMargin?: number;
    cellDetections?:   CellDetection[];
  };

  const risk = getRiskBand(blastCellPercent);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={styles.topBar}>
        <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
            <Path d="M15 18l-6-6 6-6" stroke="#00478d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
        <Text style={styles.screenTitle}>Scan Results</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* ── XAI Bounding Box Overlay ──────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Cell Detection Overlay</Text>
        <XAIOverlay detections={cellDetections} />
      </View>

      {/* ── Blast Probability Meter ────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Blast Probability</Text>

        <View style={styles.meterRow}>
          <Text style={[styles.meterValue, { color: risk.color }]}>
            {(blastProbability * 100).toFixed(1)}%
          </Text>
          <View style={[styles.riskChip, { backgroundColor: risk.color + '18', borderColor: risk.color + '40' }]}>
            <View style={[styles.riskDot, { backgroundColor: risk.color }]} />
            <Text style={[styles.riskChipText, { color: risk.color }]}>{risk.label}</Text>
          </View>
        </View>

        <View style={styles.meterTrack}>
          {/* Gradient zones */}
          <View style={[styles.meterZone, { flex: 5, backgroundColor: '#2a9d8f22' }]} />
          <View style={[styles.meterZone, { flex: 5, backgroundColor: '#fbc02d22' }]} />
          <View style={[styles.meterZone, { flex: 10, backgroundColor: '#f57c0022' }]} />
          <View style={[styles.meterZone, { flex: 80, backgroundColor: '#e5393522' }]} />
          {/* Fill */}
          <View style={[styles.meterFill, {
            width:           `${Math.min(blastProbability * 100, 100)}%` as `${number}%`,
            backgroundColor: risk.color,
          }]} />
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{blastCellPercent.toFixed(1)}%</Text>
            <Text style={styles.statLabel}>Blast Cell %</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>±{(confidenceMargin * 100).toFixed(1)}%</Text>
            <Text style={styles.statLabel}>Confidence</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{cellDetections.length}</Text>
            <Text style={styles.statLabel}>Cells Detected</Text>
          </View>
        </View>
      </View>

      {/* ── Pillar F: Export PDF button (doctor-only) ─────────────────────── */}
      {isDoctor && (
        <Pressable
          onPress={handleExportPress}
          style={({ pressed }) => [styles.detailButton, { backgroundColor: '#1a5fa8' }, pressed && { opacity: 0.75 }]}
          accessibilityRole="button"
        >
          <Text style={styles.detailButtonText}>Export PDF Report</Text>
        </Pressable>
      )}

      {/* ── View Full Analysis ────────────────────────────────────────────── */}
      <Pressable
        onPress={() => router.push({
          pathname: '/analysis-detail',
          params: {
            scanId,
            groqReport:        params.groqReport,
            caseId:            params.caseId,
            imageUri:          params.imageUri,
            analyzedOn:        params.analyzedOn,
            processingLatency: params.processingLatency,
            specimenType:      params.specimenType,
            scanMode:          params.scanMode,
            blastProbability:  params.blastProbability,
            confidenceMargin:  params.confidenceMargin,
            blastCellPercent:  params.blastCellPercent,
            cellDetections:    params.cellDetections,
          },
        })}
        style={({ pressed }) => [styles.detailButton, pressed && { opacity: 0.75 }]}
        accessibilityRole="button"
      >
        <Text style={styles.detailButtonText}>View Full Analysis →</Text>
      </Pressable>

    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Screen export — wraps ResultContent in BiometricGate
// ─────────────────────────────────────────────────────────────────────────────

export default function ResultScreen(): React.ReactElement {
  const { scanId } = useLocalSearchParams<{ scanId: string }>();
  const resolvedScanId = Array.isArray(scanId) ? scanId[0] : (scanId ?? 'unknown');

  return (
    <BiometricGate
      scanId={resolvedScanId}
      reason="Verify your identity to view scan results"
    >
      <ResultContent scanId={resolvedScanId} />
    </BiometricGate>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  centered: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    gap:            16,
    padding:        24,
    backgroundColor: '#f7f9fb',
  },
  centeredPad: {
    flex:           1,
    justifyContent: 'center',
    padding:        20,
    backgroundColor: '#f7f9fb',
  },
  loadingText: { fontSize: 14, color: '#7a8694' },
  errorText:   { fontSize: 14, color: '#e53935', textAlign: 'center' },
  backButton: {
    paddingHorizontal: 20,
    paddingVertical:   10,
    backgroundColor:   '#00478d',
    borderRadius:      8,
  },
  backButtonText: { color: '#fff', fontWeight: '700' },

  container: { flex: 1, backgroundColor: '#f7f9fb' },
  content:   { padding: 16, paddingBottom: 48, gap: 14 },

  topBar: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginBottom:   4,
  },
  backBtn: {
    width:          36,
    height:         36,
    alignItems:     'center',
    justifyContent: 'center',
  },
  screenTitle: {
    fontSize:   17,
    fontWeight: '700',
    color:      '#1a2535',
  },

  // ── Card ──────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: '#ffffff',
    borderRadius:    14,
    padding:         16,
    gap:             12,
    shadowColor:     '#000',
    shadowOpacity:   0.05,
    shadowRadius:    6,
    shadowOffset:    { width: 0, height: 2 },
    elevation:       2,
  },
  cardTitle: {
    fontSize:      13,
    fontWeight:    '700',
    color:         '#00478d',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // ── XAI Overlay ───────────────────────────────────────────────────────────
  overlayContainer: {
    width:        OVERLAY_W,
    height:       OVERLAY_H,
    alignSelf:    'center',
    borderRadius: 10,
    overflow:     'hidden',
    backgroundColor: '#1a2535',
  },
  overlayImagePlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems:     'center',
    justifyContent: 'center',
  },
  overlayImagePlaceholderText: {
    color:    '#ffffff40',
    fontSize: 13,
  },

  // ── Meter ─────────────────────────────────────────────────────────────────
  meterRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  meterValue: {
    fontSize:   32,
    fontWeight: '800',
  },
  riskChip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    paddingHorizontal: 12,
    paddingVertical:   6,
    borderRadius:      8,
    borderWidth:       1,
  },
  riskDot:      { width: 8, height: 8, borderRadius: 4 },
  riskChipText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },

  meterTrack: {
    height:       12,
    borderRadius: 6,
    overflow:     'hidden',
    flexDirection: 'row',
    backgroundColor: '#f0f2f4',
  },
  meterZone: { height: 12 },
  meterFill: {
    position:     'absolute',
    left:         0,
    top:          0,
    height:       12,
    borderRadius: 6,
  },

  // ── Stats row ─────────────────────────────────────────────────────────────
  statsRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-evenly',
    paddingVertical: 4,
  },
  statItem:  { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 18, fontWeight: '700', color: '#1a2535' },
  statLabel: { fontSize: 11, color: '#7a8694', marginTop: 2 },
  statDivider: {
    width:           1,
    height:          32,
    backgroundColor: '#e0e3e5',
  },

  // ── Export slot ───────────────────────────────────────────────────────────
  exportSlot: { minHeight: 0 },

  // ── Detail button ─────────────────────────────────────────────────────────
  detailButton: {
    backgroundColor: '#00478d',
    borderRadius:    12,
    paddingVertical: 15,
    alignItems:      'center',
  },
  detailButtonText: {
    color:      '#ffffff',
    fontSize:   15,
    fontWeight: '700',
  },

  // ── DUA card ──────────────────────────────────────────────────────────────
  duaCard: {
    backgroundColor: '#ffffff',
    borderRadius:    16,
    padding:         24,
    gap:             16,
    shadowColor:     '#000',
    shadowOpacity:   0.1,
    shadowRadius:    10,
    shadowOffset:    { width: 0, height: 4 },
    elevation:       5,
  },
  duaTitle: {
    fontSize:   17,
    fontWeight: '700',
    color:      '#1a2535',
  },
  duaBody: {
    fontSize:  14,
    color:     '#4a5568',
    lineHeight: 21,
  },
  duaButtons: {
    flexDirection: 'row',
    gap:           10,
  },
  duaDecline: {
    flex:              1,
    paddingVertical:   12,
    borderRadius:      10,
    alignItems:        'center',
    backgroundColor:   '#f7f9fb',
    borderWidth:       1,
    borderColor:       '#e0e3e5',
  },
  duaDeclineText: { fontSize: 14, fontWeight: '600', color: '#7a8694' },
  duaAccept: {
    flex:            2,
    paddingVertical: 12,
    borderRadius:    10,
    alignItems:      'center',
    backgroundColor: '#00478d',
  },
  duaAcceptText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
});