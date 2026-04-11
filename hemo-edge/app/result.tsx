import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Settings, CheckCircle, ArrowRight, RefreshCw,
  AlertTriangle, Activity, Pill, ClipboardList,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BloodReportAnalysis, RiskLevel } from '../hooks/blood-report-types';

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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ResultScreen() {
  const params = useLocalSearchParams<{
    groqReport?:        string;
    caseId?:            string;
    imageUri?:          string;
    fileName?:          string;
    analyzedOn?:        string;
    processingLatency?: string;
    specimenType?:      string;
    scanMode?:          string;
  }>();

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
  const caseId     = groq?.analysisId   ?? params.caseId   ?? 'HE-XXXXX';
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

  const handleViewDetails = () => {
    router.push({
      pathname: '/analysis-detail',
      params: {
        groqReport:        params.groqReport ?? '',
        caseId,
        imageUri,
        analyzedOn:        params.analyzedOn ?? new Date().toISOString(),
        processingLatency: params.processingLatency ?? '—',
        specimenType:      params.specimenType      ?? '—',
        scanMode:          params.scanMode           ?? '—',
      },
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <RefreshCw color={THEME.primary} size={24} />
        </TouchableOpacity>
        <Text style={styles.brandText}>HEMO-EDGE</Text>
        <TouchableOpacity style={styles.iconButton}>
          <Settings color={THEME.textSecondary} size={24} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero image ─────────────────────────────────────────────────── */}
        <View style={styles.visualSection}>
          <View style={styles.imageContainer}>
            <Image source={{ uri: imageUri }} style={styles.cellsImg} />
            <View style={styles.overlay}>
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
            <View style={[styles.corner, styles.topLeft]}    />
            <View style={[styles.corner, styles.topRight]}   />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]}/>
          </View>
        </View>

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
            onPress={() => router.push('/(tabs)/scan')}
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
  container:    { flex: 1, backgroundColor: THEME.background },
  scroll:       { padding: 24, paddingBottom: 48 },

  header: {
    height: 64, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 24,
  },
  brandText: { fontSize: 20, fontWeight: '900', color: THEME.primary, letterSpacing: -1 },
  iconButton: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  visualSection: { alignItems: 'center', marginBottom: 24 },
  imageContainer: {
    width: '100%', maxWidth: 340, aspectRatio: 1, borderRadius: 40,
    backgroundColor: '#ffffff', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.06, shadowRadius: 40, elevation: 4,
  },
  cellsImg:    { width: '100%', height: '100%', opacity: 0.3 },
  overlay:     { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
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
  corner:      { position: 'absolute', width: 32, height: 32, borderColor: '#00478d66' },
  topLeft:     { top: 24, left: 24,    borderTopWidth: 2,    borderLeftWidth: 2,    borderTopLeftRadius: 8     },
  topRight:    { top: 24, right: 24,   borderTopWidth: 2,    borderRightWidth: 2,   borderTopRightRadius: 8    },
  bottomLeft:  { bottom: 24, left: 24, borderBottomWidth: 2, borderLeftWidth: 2,    borderBottomLeftRadius: 8  },
  bottomRight: { bottom: 24, right: 24,borderBottomWidth: 2, borderRightWidth: 2,   borderBottomRightRadius: 8 },

  textSection: { gap: 8 },

  badge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 99, alignSelf: 'flex-start', marginBottom: 8 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 2 },

  title:      { fontSize: 36, fontWeight: '800', color: THEME.text, letterSpacing: -1 },
  caseIdText: { fontSize: 12, fontWeight: '600', color: THEME.primary, letterSpacing: 1.5, marginBottom: 4 },

  diagnosisRow:   { borderLeftWidth: 3, paddingLeft: 12, marginVertical: 8, gap: 2 },
  diagnosisText:  { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  diagnosisDetail:{ fontSize: 14, color: THEME.textSecondary, lineHeight: 20 },

  progressSection: { gap: 12, marginTop: 8, marginBottom: 16 },
  progressHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  progressLabel:   { fontSize: 12, fontWeight: '600', color: '#00478d99', letterSpacing: 1 },
  progressPercent: { fontSize: 22, fontWeight: '800', color: THEME.primary },
  progressBar:     { height: 10, backgroundColor: '#eceef0', borderRadius: 5, overflow: 'hidden' },
  progressFill:    { height: '100%', width: '100%' },
  stepsRow:        { flexDirection: 'row', gap: 16 },
  step:            { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepText:        { fontSize: 10, fontWeight: '700', color: THEME.primary, letterSpacing: 1 },

  // ── Sections ────────────────────────────────────────────────────────────────
  section: {
    backgroundColor: THEME.surface, borderRadius: 20, padding: 16,
    marginBottom: 12, gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04, shadowRadius: 12, elevation: 2,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  sectionTitle:  { fontSize: 14, fontWeight: '800', color: THEME.text, letterSpacing: 0.5 },

  // ── Conditions ──────────────────────────────────────────────────────────────
  conditionCard: {
    backgroundColor: '#f7f9fb', borderRadius: 12, padding: 12, gap: 6,
    borderLeftWidth: 3, borderLeftColor: THEME.primary,
  },
  conditionTop:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  conditionName: { flex: 1, fontSize: 14, fontWeight: '700', color: THEME.text },
  likelihoodBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  likelihoodText:  { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  conditionExplanation: { fontSize: 13, color: THEME.textSecondary, lineHeight: 18 },
  icdCode: { fontSize: 11, color: THEME.primary, fontWeight: '600' },

  // ── Markers ─────────────────────────────────────────────────────────────────
  markerRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#f0f2f4',
  },
  markerLeft:   { flex: 1 },
  markerRight:  { alignItems: 'flex-end' },
  markerName:   { fontSize: 13, fontWeight: '700', color: THEME.text },
  markerRange:  { fontSize: 11, color: THEME.textSecondary, marginTop: 2 },
  markerValue:  { fontSize: 15, fontWeight: '800' },
  markerStatus: { fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 2 },

  // ── Recommendations ─────────────────────────────────────────────────────────
  recRow:        { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  recBullet:     {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: THEME.primary, alignItems: 'center', justifyContent: 'center',
    marginTop: 1, flexShrink: 0,
  },
  recBulletText: { fontSize: 10, fontWeight: '900', color: '#fff' },
  recText:       { flex: 1, fontSize: 13, color: THEME.textSecondary, lineHeight: 19 },

  // ── Disclaimer ──────────────────────────────────────────────────────────────
  disclaimerBox: {
    backgroundColor: '#fff8e1', borderRadius: 12, padding: 12,
    borderLeftWidth: 3, borderLeftColor: '#f59e0b', marginBottom: 8,
  },
  disclaimerText: { fontSize: 11, color: '#78350f', lineHeight: 17 },

  // ── Buttons ─────────────────────────────────────────────────────────────────
  primaryButton: {
    backgroundColor: THEME.primary, height: 64, borderRadius: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, marginTop: 8,
    shadowColor: THEME.primary, shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2, shadowRadius: 20,
  },
  primaryButtonText:   { fontSize: 18, fontWeight: '700', color: '#ffffff' },
  secondaryButton:     {
    height: 52, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: THEME.primary, marginTop: 8,
  },
  secondaryButtonText: { fontSize: 16, fontWeight: '700', color: THEME.primary },
});