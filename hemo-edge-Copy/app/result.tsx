// FILE: app/result.tsx
import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Animated, BackHandler, Dimensions,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import {
  Settings, CheckCircle, ArrowRight, RefreshCw,
  AlertTriangle, Activity, Pill, ClipboardList,
} from 'lucide-react-native';
import Svg, {
  Rect as SvgRect,
  Text as SvgText,
  G as SvgG,
} from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BloodReportAnalysis, RiskLevel } from '../hooks/blood-report-types';
import type { CellDetection } from '../hooks/use-ml-service';
import { saveScanResult } from '../lib/firestore-service';
import { useAuthContext } from '../contexts/auth-context';

const { width } = Dimensions.get('window');
const IMG_SIZE  = Math.min(width - 48, 340);

const THEME = {
  primary:       '#00478d',
  secondary:     '#4f5f7b',
  background:    '#f7f9fb',
  surface:       '#ffffff',
  text:          '#191c1e',
  textSecondary: '#424752',
  success:       '#006d3a',
  warning:       '#7d5700',
  error:         '#ba1a1a',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function riskColor(risk: RiskLevel | string) {
  if (risk === 'critical') return THEME.error;
  if (risk === 'high')     return THEME.error;
  if (risk === 'moderate') return THEME.warning;
  return THEME.success;
}

function riskBadge(risk: RiskLevel | string) {
  if (risk === 'critical') return { bg: '#ffdad6', text: THEME.error,   label: 'CRITICAL' };
  if (risk === 'high')     return { bg: '#ffdad6', text: THEME.error,   label: 'HIGH RISK' };
  if (risk === 'moderate') return { bg: '#ffefd6', text: THEME.warning, label: 'MODERATE RISK' };
  return { bg: '#dcfce7', text: '#15803d', label: 'LOW RISK' };
}

function urgencyLabel(urgency: string) {
  if (urgency === 'emergency') return 'EMERGENCY — Seek care immediately';
  if (urgency === 'urgent')    return 'URGENT — See a doctor today';
  if (urgency === 'soon')      return 'FOLLOW UP — See a doctor soon';
  return 'ROUTINE — No immediate action needed';
}

function likelihoodColor(l: string) {
  if (l === 'highly likely') return THEME.error;
  if (l === 'probable')      return THEME.warning;
  return THEME.primary;
}

// Colour for a cell bounding box based on blast probability
function cellBoxColor(prob: number): string {
  if (prob > 0.75) return '#ff3b30';   // red    — high blast
  if (prob > 0.5)  return '#ff9500';   // orange — abnormal
  if (prob > 0.3)  return '#ffcc00';   // yellow — borderline
  return '#34c759';                     // green  — normal
}

// ─── XAI Overlay ─────────────────────────────────────────────────────────────
// Renders per-cell bounding boxes as an SVG layer on top of the slide image.
// The viewBox is 100×100 matching the normalised coordinates from CellDetection.
function XAIOverlay({ cells }: { cells: CellDetection[] }) {
  return (
    <Svg
      style={StyleSheet.absoluteFillObject}
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
    >
      {cells.map(c => {
        const color  = cellBoxColor(c.blastProbability);
        const label  = c.isAbnormal
          ? `${c.cellType} ${(c.blastProbability * 100).toFixed(0)}%`
          : c.cellType;
        return (
          <SvgG key={c.id}>
            {/* Bounding box */}
            <SvgRect
              x={c.x} y={c.y} width={c.w} height={c.h}
              fill="none"
              stroke={color}
              strokeWidth={c.isAbnormal ? 0.7 : 0.4}
              strokeDasharray={c.isAbnormal ? undefined : '1,0.8'}
              opacity={c.isAbnormal ? 1 : 0.65}
            />
            {/* Label — only for abnormal cells to keep the overlay readable */}
            {c.isAbnormal && (
              <>
                <SvgRect
                  x={c.x} y={c.y - 4.5}
                  width={label.length * 1.55 + 1} height={4.5}
                  fill={color} opacity={0.85} rx={0.6}
                />
                <SvgText
                  x={c.x + 0.5} y={c.y - 0.8}
                  fontSize={2.8} fill="#ffffff"
                  fontWeight="bold"
                >
                  {label}
                </SvgText>
              </>
            )}
          </SvgG>
        );
      })}
    </Svg>
  );
}

// ─── Blast Probability Meter ──────────────────────────────────────────────────
function BlastMeter({ probability, margin }: { probability: number; margin: number }) {
  const pct        = Math.min(Math.max(probability * 100, 0), 100);
  const isHigh     = probability > 0.5;
  const meterColor = probability > 0.7 ? THEME.error
    : probability > 0.5 ? '#ff9500'
    : probability > 0.3 ? '#ffcc00'
    : THEME.success;

  return (
    <View style={styles.blastMeterCard}>
      <View style={styles.blastMeterHeader}>
        <Text style={styles.blastMeterTitle}>Blast Probability</Text>
        <View style={[styles.blastMeterBadge, { backgroundColor: meterColor + '22' }]}>
          <Text style={[styles.blastMeterBadgeText, { color: meterColor }]}>
            {pct.toFixed(1)}%
          </Text>
        </View>
      </View>

      {/* Track */}
      <View style={styles.blastTrack}>
        {/* Threshold marker at 50% */}
        <View style={[styles.blastThresholdMark, { left: '50%' }]} />
        {/* Fill */}
        <View style={[styles.blastFill, { width: `${pct}%` as any, backgroundColor: meterColor }]} />
      </View>

      <View style={styles.blastMeterFooter}>
        <Text style={styles.blastMeterSub}>0%</Text>
        <Text style={[styles.blastMeterSub, { color: THEME.textSecondary }]}>
          Decision boundary ·  Margin: {(margin * 100).toFixed(1)}%
        </Text>
        <Text style={styles.blastMeterSub}>100%</Text>
      </View>

      {isHigh && (
        <View style={styles.blastWarningRow}>
          <AlertTriangle color={THEME.error} size={12} />
          <Text style={styles.blastWarningText}>
            Score exceeds 50% threshold — blast cell morphology detected
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── XAI Legend ──────────────────────────────────────────────────────────────
function XAILegend() {
  const items = [
    { color: '#ff3b30', label: 'Blast >75%' },
    { color: '#ff9500', label: 'Abnormal >50%' },
    { color: '#ffcc00', label: 'Borderline' },
    { color: '#34c759', label: 'Normal' },
  ];
  return (
    <View style={styles.legendRow}>
      {items.map(it => (
        <View key={it.label} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: it.color }]} />
          <Text style={styles.legendText}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ResultScreen() {
  const { user } = useAuthContext();

  const params = useLocalSearchParams<{
    groqReport?:        string;
    caseId?:            string;
    imageUri?:          string;
    fileName?:          string;
    analyzedOn?:        string;
    processingLatency?: string;
    specimenType?:      string;
    scanMode?:          string;
    source?:            string;
    // XAI params
    blastProbability?:  string;
    confidenceMargin?:  string;
    blastCellPercent?:  string;
    cellDetections?:    string;
  }>();

  // ── Hardware back button ───────────────────────────────────────────────────
  useFocusEffect(
    React.useCallback(() => {
      const onBack = () => {
        router.replace('/(tabs)');
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, []),
  );

  // ── Parse Groq report ──────────────────────────────────────────────────────
  let groq: BloodReportAnalysis | null = null;
  if (params.groqReport) {
    try {
      groq = JSON.parse(params.groqReport) as BloodReportAnalysis;
    } catch {
      console.warn('ResultScreen: failed to parse groqReport param');
    }
  }

  // ── Derived display values ─────────────────────────────────────────────────
  const caseId     = groq?.analysisId ?? params.caseId ?? `HE-${Math.floor(10000 + Math.random() * 90000)}`;
  const risk       = groq?.overallRisk  ?? 'low';
  const urgency    = groq?.urgency      ?? 'routine';
  const summary    = groq?.summary      ?? 'Analysis complete.';
  const conditions = groq?.predictedConditions ?? [];
  const recs       = groq?.recommendations    ?? [];
  const markers    = groq?.markers            ?? [];
  const abnormal   = markers.filter(m => m.status !== 'normal');

  const analyzedOn = params.analyzedOn
    ? new Date(params.analyzedOn).toLocaleString()
    : new Date().toLocaleString();
  const imageUri   = params.imageUri ?? 'https://picsum.photos/seed/cells/800/800';
  const badge      = riskBadge(risk);

  // ── XAI derived values ─────────────────────────────────────────────────────
  const blastProbability  = parseFloat(params.blastProbability  ?? '0');
  const confidenceMargin  = parseFloat(params.confidenceMargin  ?? '0');
  const blastCellPercent  = parseFloat(params.blastCellPercent  ?? '0');
  let   cellDetections: CellDetection[] = [];
  try {
    if (params.cellDetections) {
      cellDetections = JSON.parse(params.cellDetections) as CellDetection[];
    }
  } catch {
    cellDetections = [];
  }
  const xaiAvailable = cellDetections.length > 0;
  const abnormalCells = cellDetections.filter(c => c.isAbnormal);

  // ── Saved banner animation ─────────────────────────────────────────────────
  const bannerOpacity = useRef(new Animated.Value(0)).current;

  const showSavedBanner = () => {
    Animated.sequence([
      Animated.timing(bannerOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(bannerOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  };

  // ── Auto-save ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!groq || !user) return;

    const doSave = async () => {
      try {
        const payload = {
          caseId:              groq!.analysisId    ?? caseId,
          analyzedOn:          groq!.analyzedOn    ?? new Date().toISOString(),
          specimenType:        params.specimenType ?? '',
          scanMode:            params.scanMode     ?? '',
          overallRisk:         groq!.overallRisk   ?? 'low',
          urgency:             groq!.urgency       ?? 'routine',
          summary:             groq!.summary       ?? '',
          predictedConditions: groq!.predictedConditions ?? [],
          markers:             groq!.markers             ?? [],
          recommendations:     groq!.recommendations     ?? [],
          ...(params.imageUri ? { imageUri: params.imageUri } : {}),
        };

        await saveScanResult(user.uid, payload);
        showSavedBanner();
      } catch (e) {
        console.error('HEMO-EDGE: save failed', e);
      }
    };

    doSave();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const handleBack = () => {
    const source = params.source ?? 'scan';
    if (source === 'scanner') {
      router.replace('/(tabs)/scanner');
    } else {
      router.replace('/(tabs)/scan');
    }
  };

  const handleViewDetails = () => {
    router.push({
      pathname: '/analysis-detail',
      params: {
        groqReport:        params.groqReport ?? '',
        caseId,
        imageUri,
        analyzedOn:        params.analyzedOn        ?? new Date().toISOString(),
        processingLatency: params.processingLatency ?? '—',
        specimenType:      params.specimenType      ?? '—',
        scanMode:          params.scanMode          ?? '—',
        // Forward XAI params to analysis-detail
        blastProbability:  params.blastProbability  ?? '0',
        confidenceMargin:  params.confidenceMargin  ?? '0',
        blastCellPercent:  params.blastCellPercent  ?? '0',
        cellDetections:    params.cellDetections     ?? '[]',
      },
    });
  };

  return (
    <SafeAreaView style={styles.container}>

      {/* ── Saved banner ───────────────────────────────────────────────────── */}
      <Animated.View style={[styles.savedBanner, { opacity: bannerOpacity }]}>
        <CheckCircle color="#ffffff" size={14} />
        <Text style={styles.savedBannerText}>Saved to your records</Text>
      </Animated.View>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={handleBack}>
          <RefreshCw color={THEME.primary} size={24} />
        </TouchableOpacity>
        <Text style={styles.brandText}>HEMO-EDGE</Text>
        <TouchableOpacity style={styles.iconButton}>
          <Settings color={THEME.textSecondary} size={24} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Hero image with XAI overlay ────────────────────────────────── */}
        <View style={styles.visualSection}>
          <View style={[styles.imageContainer, { width: IMG_SIZE, height: IMG_SIZE }]}>
            {/* Slide image */}
            <Image source={{ uri: imageUri }} style={styles.cellsImg} resizeMode="cover" />

            {/* XAI bounding-box overlay */}
            {xaiAvailable && <XAIOverlay cells={cellDetections} />}

            {/* Corner brackets (diagnostic scan aesthetic) */}
            <View style={[styles.corner, styles.topLeft]}    />
            <View style={[styles.corner, styles.topRight]}   />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]}/>

            {/* XAI stats badge bottom-left */}
            {xaiAvailable && (
              <View style={styles.xaiBadge}>
                <Text style={styles.xaiBadgeText}>
                  {abnormalCells.length} / {cellDetections.length} flagged
                </Text>
              </View>
            )}

            {/* Fallback icon for low/no risk when no XAI available */}
            {!xaiAvailable && (
              <View style={styles.fallbackOverlay}>
                <View style={styles.circleOuter}>
                  <View style={styles.circleInner}>
                    {risk === 'critical' || risk === 'high' ? (
                      <AlertTriangle color={THEME.error}   size={64} strokeWidth={2.5} />
                    ) : (
                      <CheckCircle   color={THEME.primary} size={64} strokeWidth={2.5} />
                    )}
                  </View>
                </View>
              </View>
            )}
          </View>

          {/* Legend below image */}
          {xaiAvailable && <XAILegend />}
        </View>

        {/* ── Blast probability meter ────────────────────────────────────── */}
        {xaiAvailable && (
          <BlastMeter probability={blastProbability} margin={confidenceMargin} />
        )}

        {/* ── Risk badge + title ─────────────────────────────────────────── */}
        <View style={styles.textSection}>
          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text>
          </View>

          <Text style={styles.title}>Analysis Complete</Text>
          <Text style={styles.caseIdText}>Case: #{caseId}</Text>

          {/* Urgency row */}
          <View style={[styles.diagnosisRow, { borderLeftColor: riskColor(risk) }]}>
            <Text style={[styles.diagnosisText, { color: riskColor(risk) }]}>
              {urgencyLabel(urgency)}
            </Text>
            <Text style={styles.diagnosisDetail}>{summary}</Text>
          </View>

          {/* Progress bar */}
          <View style={styles.progressSection}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>ANALYSIS COMPLETE</Text>
              <Text style={styles.progressPercent}>100%</Text>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { backgroundColor: riskColor(risk) }]} />
            </View>
            <View style={styles.stepsRow}>
              <Step label="EXTRACTION"     />
              <Step label="CLASSIFICATION" />
              <Step label="AI REPORT"      />
            </View>
          </View>

          {/* ── Predicted conditions ──────────────────────────────────────── */}
          {conditions.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Activity color={THEME.primary} size={16} />
                <Text style={styles.sectionTitle}>Predicted Conditions</Text>
              </View>
              {conditions.map((c, i) => (
                <View key={i} style={styles.conditionCard}>
                  <View style={styles.conditionTop}>
                    <Text style={styles.conditionName}>{c.condition}</Text>
                    <View style={[
                      styles.likelihoodBadge,
                      { backgroundColor: likelihoodColor(c.likelihood) + '20' },
                    ]}>
                      <Text style={[
                        styles.likelihoodText,
                        { color: likelihoodColor(c.likelihood) },
                      ]}>
                        {c.likelihood.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.conditionExplanation}>{c.explanation}</Text>
                  {c.icdCode && (
                    <Text style={styles.icdCode}>ICD: {c.icdCode}</Text>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* ── Abnormal markers ──────────────────────────────────────────── */}
          {abnormal.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <ClipboardList color={THEME.primary} size={16} />
                <Text style={styles.sectionTitle}>
                  Abnormal Markers ({abnormal.length})
                </Text>
              </View>
              {abnormal.map((m, i) => (
                <View key={i} style={styles.markerRow}>
                  <View style={styles.markerLeft}>
                    <Text style={styles.markerName}>{m.name}</Text>
                    <Text style={styles.markerRange}>Ref: {m.referenceRange} {m.unit}</Text>
                  </View>
                  <View style={styles.markerRight}>
                    <Text style={[
                      styles.markerValue,
                      { color: m.status === 'high' ? THEME.error : THEME.warning },
                    ]}>
                      {m.value} {m.unit}
                    </Text>
                    <Text style={[
                      styles.markerStatus,
                      { color: m.status === 'high' ? THEME.error : THEME.warning },
                    ]}>
                      {m.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* ── Recommendations ───────────────────────────────────────────── */}
          {recs.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Pill color={THEME.primary} size={16} />
                <Text style={styles.sectionTitle}>Recommendations</Text>
              </View>
              {recs.map((r, i) => (
                <View key={i} style={styles.recRow}>
                  <View style={styles.recBullet}>
                    <Text style={styles.recBulletText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.recText}>{r}</Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Disclaimer ────────────────────────────────────────────────── */}
          {groq?.disclaimer && (
            <View style={styles.disclaimerBox}>
              <Text style={styles.disclaimerText}>{groq.disclaimer}</Text>
            </View>
          )}

          {/* ── Actions ───────────────────────────────────────────────────── */}
          <TouchableOpacity style={styles.primaryButton} onPress={handleViewDetails}>
            <Text style={styles.primaryButtonText}>View Full Analysis</Text>
            <ArrowRight color="#ffffff" size={20} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.replace('/(tabs)/scan')}
          >
            <Text style={styles.secondaryButtonText}>Scan Another Sample</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Step({ label }: { label: string }) {
  return (
    <View style={styles.step}>
      <CheckCircle color={THEME.primary} size={14} />
      <Text style={styles.stepText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.background },
  scroll:    { padding: 24, paddingBottom: 48 },

  // ── Saved banner
  savedBanner: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100,
    backgroundColor: '#006d3a', paddingVertical: 10, paddingHorizontal: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  savedBannerText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },

  header: {
    height: 64, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 24,
  },
  brandText: { fontSize: 20, fontWeight: '900', color: THEME.primary, letterSpacing: -1 },
  iconButton:{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  // ── Visual / hero
  visualSection:  { alignItems: 'center', marginBottom: 16, gap: 10 },
  imageContainer: {
    borderRadius: 28, overflow: 'hidden',
    backgroundColor: '#0d1117',
    shadowColor: '#000', shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12, shadowRadius: 24, elevation: 6,
    position: 'relative',
  },
  cellsImg: { width: '100%', height: '100%' },

  // Corner brackets
  corner:      { position: 'absolute', width: 28, height: 28, borderColor: '#00478daa' },
  topLeft:     { top: 16, left: 16,   borderTopWidth: 2,    borderLeftWidth: 2,    borderTopLeftRadius: 6     },
  topRight:    { top: 16, right: 16,  borderTopWidth: 2,    borderRightWidth: 2,   borderTopRightRadius: 6    },
  bottomLeft:  { bottom: 16, left: 16,   borderBottomWidth: 2, borderLeftWidth: 2,    borderBottomLeftRadius: 6  },
  bottomRight: { bottom: 16, right: 16,  borderBottomWidth: 2, borderRightWidth: 2,   borderBottomRightRadius: 6 },

  // XAI stats badge
  xaiBadge: {
    position: 'absolute', bottom: 12, left: 12,
    backgroundColor: '#00000099', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6,
  },
  xaiBadgeText: { color: '#ffffff', fontSize: 9, fontWeight: '800', letterSpacing: 1 },

  // Fallback (no XAI)
  fallbackOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  circleOuter: {
    width: '70%', aspectRatio: 1, borderRadius: 999,
    borderWidth: 4, borderColor: '#00478d33',
    alignItems: 'center', justifyContent: 'center',
  },
  circleInner: {
    width: '75%', aspectRatio: 1, borderRadius: 999,
    backgroundColor: '#00478d0d', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#00478d1a',
  },

  // XAI Legend
  legendRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:  { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, fontWeight: '600', color: THEME.textSecondary },

  // ── Blast Probability Meter
  blastMeterCard: {
    backgroundColor: THEME.surface, borderRadius: 16, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2,
    gap: 8,
  },
  blastMeterHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  blastMeterTitle:     { fontSize: 13, fontWeight: '800', color: THEME.text },
  blastMeterBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  blastMeterBadgeText: { fontSize: 13, fontWeight: '800' },
  blastTrack: {
    height: 10, backgroundColor: '#eceef0', borderRadius: 5,
    overflow: 'visible', position: 'relative',
  },
  blastFill:          { height: '100%', borderRadius: 5 },
  blastThresholdMark: {
    position: 'absolute', top: -3, width: 2, height: 16,
    backgroundColor: '#00478d55', borderRadius: 1,
  },
  blastMeterFooter:  { flexDirection: 'row', justifyContent: 'space-between' },
  blastMeterSub:     { fontSize: 9, color: THEME.textSecondary, fontWeight: '600' },
  blastWarningRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  blastWarningText:  { fontSize: 11, color: THEME.error, fontWeight: '600', flex: 1 },

  // ── Text / info section
  textSection: { gap: 8 },
  badge:       { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 99, alignSelf: 'flex-start', marginBottom: 8 },
  badgeText:   { fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  title:       { fontSize: 36, fontWeight: '800', color: THEME.text, letterSpacing: -1 },
  caseIdText:  { fontSize: 12, fontWeight: '600', color: THEME.primary, letterSpacing: 1.5, marginBottom: 4 },

  diagnosisRow:    { borderLeftWidth: 3, paddingLeft: 12, marginVertical: 8, gap: 2 },
  diagnosisText:   { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  diagnosisDetail: { fontSize: 14, color: THEME.textSecondary, lineHeight: 20 },

  progressSection: { gap: 12, marginTop: 8, marginBottom: 16 },
  progressHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  progressLabel:   { fontSize: 12, fontWeight: '600', color: '#00478d99', letterSpacing: 1 },
  progressPercent: { fontSize: 22, fontWeight: '800', color: THEME.primary },
  progressBar:     { height: 10, backgroundColor: '#eceef0', borderRadius: 5, overflow: 'hidden' },
  progressFill:    { height: '100%', width: '100%' },
  stepsRow:        { flexDirection: 'row', gap: 16 },
  step:            { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepText:        { fontSize: 10, fontWeight: '700', color: THEME.primary, letterSpacing: 1 },

  section: {
    backgroundColor: THEME.surface, borderRadius: 20, padding: 16,
    marginBottom: 12, gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04, shadowRadius: 12, elevation: 2,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  sectionTitle:  { fontSize: 14, fontWeight: '800', color: THEME.text, letterSpacing: 0.5 },

  conditionCard:        { backgroundColor: '#f7f9fb', borderRadius: 12, padding: 12, gap: 6, borderLeftWidth: 3, borderLeftColor: THEME.primary },
  conditionTop:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  conditionName:        { flex: 1, fontSize: 14, fontWeight: '700', color: THEME.text },
  likelihoodBadge:      { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  likelihoodText:       { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  conditionExplanation: { fontSize: 13, color: THEME.textSecondary, lineHeight: 18 },
  icdCode:              { fontSize: 11, color: THEME.primary, fontWeight: '600' },

  markerRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f2f4' },
  markerLeft:   { flex: 1 },
  markerRight:  { alignItems: 'flex-end' },
  markerName:   { fontSize: 13, fontWeight: '700', color: THEME.text },
  markerRange:  { fontSize: 11, color: THEME.textSecondary, marginTop: 2 },
  markerValue:  { fontSize: 15, fontWeight: '800' },
  markerStatus: { fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 2 },

  recRow:        { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  recBullet:     { width: 22, height: 22, borderRadius: 11, backgroundColor: THEME.primary, alignItems: 'center', justifyContent: 'center', marginTop: 1, flexShrink: 0 },
  recBulletText: { fontSize: 10, fontWeight: '900', color: '#fff' },
  recText:       { flex: 1, fontSize: 13, color: THEME.textSecondary, lineHeight: 19 },

  disclaimerBox:  { backgroundColor: '#fff8e1', borderRadius: 12, padding: 12, borderLeftWidth: 3, borderLeftColor: '#f59e0b', marginBottom: 8 },
  disclaimerText: { fontSize: 11, color: '#78350f', lineHeight: 17 },

  primaryButton:      { backgroundColor: THEME.primary, height: 64, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 8, shadowColor: THEME.primary, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 20 },
  primaryButtonText:  { fontSize: 18, fontWeight: '700', color: '#ffffff' },
  secondaryButton:    { height: 52, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: THEME.primary, marginTop: 8 },
  secondaryButtonText:{ fontSize: 16, fontWeight: '700', color: THEME.primary },
});