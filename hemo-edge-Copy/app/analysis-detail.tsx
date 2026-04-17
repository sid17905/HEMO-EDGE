// FILE: app/analysis-detail.tsx
import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Share, Alert, Dimensions,
} from 'react-native';
import {
  ChevronLeft, FileText, Microscope, CheckCircle, AlertTriangle,
  Info, Share2, Download, Layers, Zap,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import Svg2, {
  Circle as SvgCircle,
  Ellipse as SvgEllipse,
  Rect as SvgRect,
  Path as SvgPath,
  Defs as SvgDefs,
  RadialGradient as SvgRG,
  LinearGradient as SvgLG,
  Stop as SvgStop,
  G as SvgG,
  Text as SvgText,
} from 'react-native-svg';
import type {
  BloodReportAnalysis,
  BloodMarker,
  PredictedCondition,
} from '../hooks/blood-report-types';
import type { CellDetection } from '../hooks/use-ml-service';

// ─────────────────────────────────────────────────────────────────────────────
//  Theme
// ─────────────────────────────────────────────────────────────────────────────
const THEME = {
  primary:        '#00478d',
  background:     '#f7f9fb',
  surface:        '#ffffff',
  text:           '#191c1e',
  textSecondary:  '#424752',
  error:          '#ba1a1a',
  errorBg:        '#ffdad6',
  warning:        '#7d5700',
  warningBg:      '#ffefd6',
  success:        '#006d3a',
  successBg:      '#dcfce7',
  amber:          '#78350f',
  amberBg:        '#fff8e1',
  amberBorder:    '#f59e0b',
};

const { width } = Dimensions.get('window');
const IMG_W = width - 48;
const IMG_H = (IMG_W * 9) / 16;

// ─────────────────────────────────────────────────────────────────────────────
//  Param types
// ─────────────────────────────────────────────────────────────────────────────
type AnalysisDetailParams = {
  groqReport?:        string;
  caseId?:            string;
  imageUri?:          string;
  analyzedOn?:        string;
  processingLatency?: string;
  specimenType?:      string;
  scanMode?:          string;
  // XAI params forwarded from result.tsx
  blastProbability?:  string;
  confidenceMargin?:  string;
  blastCellPercent?:  string;
  cellDetections?:    string;
};

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────
function seededRand(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return () => {
    h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) | 0;
    h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) | 0;
    return (h >>> 0) / 0xffffffff;
  };
}

// Fallback cell generator used only when no real cellDetections are available
function generateFallbackCells(caseId: string, count = 14, risk: string) {
  const rand = seededRand(caseId);
  const n = Math.min(Math.max(count, 8), 22);
  return Array.from({ length: n }, (_, i) => ({
    cx: 8 + rand() * 84,
    cy: 8 + rand() * 84,
    r: 4 + rand() * 5,
    isRBC: rand() > 0.25,
    isAbnormal: risk === 'critical' ? rand() > 0.45 : risk === 'high' ? rand() > 0.6 : rand() > 0.8,
    id: i,
    blastProbability: risk === 'critical' ? 0.6 + rand() * 0.35 : rand() * 0.4,
  }));
}

function cellBoxColor(prob: number): string {
  if (prob > 0.75) return '#ff3b30';
  if (prob > 0.5)  return '#ff9500';
  if (prob > 0.3)  return '#ffcc00';
  return '#34c759';
}

function markerStatusColor(status: BloodMarker['status']) {
  if (status === 'high')       return { text: THEME.error,   bg: THEME.errorBg };
  if (status === 'low')        return { text: THEME.error,   bg: THEME.errorBg };
  if (status === 'borderline') return { text: THEME.warning, bg: THEME.warningBg };
  return { text: THEME.success, bg: THEME.successBg };
}

function likelihoodColor(l: string) {
  if (l === 'highly likely') return { text: THEME.error,   bg: THEME.errorBg };
  if (l === 'probable')      return { text: THEME.warning, bg: THEME.warningBg };
  return { text: THEME.primary, bg: '#e8f0fb' };
}

function riskBadgeColors(risk: string) {
  if (risk === 'critical' || risk === 'high') return { text: THEME.error,   bg: THEME.errorBg };
  if (risk === 'moderate')                    return { text: THEME.warning, bg: THEME.warningBg };
  return { text: THEME.success, bg: THEME.successBg };
}

function buildShareText(groq: BloodReportAnalysis, params: AnalysisDetailParams): string {
  const lines: string[] = [
    'HEMO-EDGE — Blood Report Analysis',
    '══════════════════════════════════',
    `Case ID: ${groq.analysisId}`,
    `Date: ${groq.analyzedOn ? new Date(groq.analyzedOn).toLocaleString() : '—'}`,
    `Overall Risk: ${groq.overallRisk.toUpperCase()}`,
    `Urgency: ${groq.urgency}`,
    '',
    'SUMMARY',
    groq.summary,
    '',
  ];

  if (groq.predictedConditions.length > 0) {
    lines.push('PREDICTED CONDITIONS');
    groq.predictedConditions.forEach(c => {
      lines.push(`• ${c.condition} (${c.likelihood})`);
      lines.push(`  ${c.explanation}`);
      if (c.icdCode) lines.push(`  ICD: ${c.icdCode}`);
    });
    lines.push('');
  }

  if (groq.markers.length > 0) {
    lines.push('BLOOD MARKERS');
    groq.markers.forEach(m => {
      lines.push(`• ${m.name}: ${m.value} ${m.unit} [Ref: ${m.referenceRange}] — ${m.status.toUpperCase()}`);
    });
    lines.push('');
  }

  if (groq.recommendations.length > 0) {
    lines.push('RECOMMENDATIONS');
    groq.recommendations.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
    lines.push('');
  }

  lines.push('DISCLAIMER');
  lines.push(groq.disclaimer);

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Microscopy SVG — driven by real cellDetections when available, or
//  falls back to the seeded random visualisation for backwards compatibility.
// ─────────────────────────────────────────────────────────────────────────────
function MicroscopyView({
  cells,
  w, h,
  risk,
  realDetections,
}: {
  cells: ReturnType<typeof generateFallbackCells>;
  w: number;
  h: number;
  risk: string;
  realDetections?: CellDetection[];
}) {
  const hasReal = realDetections && realDetections.length > 0;

  if (hasReal) {
    // ── Real XAI bounding-box visualisation ────────────────────────────────
    return (
      <Svg2 width={w} height={h} viewBox="0 0 100 100" style={{ borderRadius: 16 }}>
        <SvgDefs>
          <SvgRG id="bg2" cx="50%" cy="50%" r="60%">
            <SvgStop offset="0%"   stopColor="#1a1f2e" />
            <SvgStop offset="70%"  stopColor="#0d1117" />
            <SvgStop offset="100%" stopColor="#060a0f" />
          </SvgRG>
          <SvgRG id="vignette2" cx="50%" cy="40%" r="55%">
            <SvgStop offset="0%"   stopColor="#ffffff" stopOpacity="0.07" />
            <SvgStop offset="100%" stopColor="#000000" stopOpacity="0.5" />
          </SvgRG>
        </SvgDefs>
        {/* Dark background */}
        <SvgRect x="0" y="0" width="100" height="100" fill="url(#bg2)" />

        {/* Noise dots */}
        {Array.from({ length: 30 }).map((_, i) => {
          const r2 = seededRand(`xainoise${i}`);
          return (
            <SvgCircle key={`n${i}`}
              cx={r2() * 100} cy={r2() * 100}
              r={0.15 + r2() * 0.25}
              fill="#8060a8" opacity={0.12 + r2() * 0.15}
            />
          );
        })}

        {/* Real bounding-box cells */}
        {realDetections.map(c => {
          const color = cellBoxColor(c.blastProbability);
          const cx    = c.x + c.w / 2;
          const cy    = c.y + c.h / 2;
          const rx    = c.w / 2;
          const ry    = c.h / 2;
          const label = `${(c.blastProbability * 100).toFixed(0)}%`;

          return (
            <SvgG key={c.id}>
              {/* Cell body */}
              <SvgEllipse cx={cx} cy={cy} rx={rx} ry={ry}
                fill={c.isAbnormal ? '#ff3b3033' : '#e0606033'}
                stroke={color}
                strokeWidth={c.isAbnormal ? 0.6 : 0.3}
                strokeDasharray={c.isAbnormal ? undefined : '1,0.6'}
                opacity={c.isAbnormal ? 1 : 0.6}
              />
              {/* Bounding rectangle for abnormal cells */}
              {c.isAbnormal && (
                <SvgRect
                  x={c.x} y={c.y} width={c.w} height={c.h}
                  fill="none" stroke={color} strokeWidth={0.5}
                  opacity={0.7}
                />
              )}
              {/* Probability label for abnormal cells */}
              {c.isAbnormal && (
                <>
                  <SvgRect
                    x={cx - label.length * 0.9} y={cy - ry - 5}
                    width={label.length * 1.8 + 1} height={4}
                    fill={color} opacity={0.85} rx={0.5}
                  />
                  <SvgText
                    x={cx - label.length * 0.9 + 0.5}
                    y={cy - ry - 2}
                    fontSize={2.8} fill="#ffffff" fontWeight="bold"
                  >
                    {label}
                  </SvgText>
                </>
              )}
            </SvgG>
          );
        })}

        <SvgRect x="0" y="0" width="100" height="100" fill="url(#vignette2)" />
      </Svg2>
    );
  }

  // ── Fallback: original seeded visualisation ───────────────────────────────
  return (
    <Svg2 width={w} height={h} viewBox="0 0 100 100" style={{ borderRadius: 16 }}>
      <SvgDefs>
        <SvgRG id="bg" cx="50%" cy="50%" r="60%">
          <SvgStop offset="0%"   stopColor="#1a1f2e" />
          <SvgStop offset="70%"  stopColor="#0d1117" />
          <SvgStop offset="100%" stopColor="#060a0f" />
        </SvgRG>
        <SvgRG id="rbc" cx="40%" cy="35%" r="70%">
          <SvgStop offset="0%"   stopColor="#f5a0a0" stopOpacity="0.95" />
          <SvgStop offset="55%"  stopColor="#e06060" stopOpacity="0.85" />
          <SvgStop offset="100%" stopColor="#b03040" stopOpacity="0.7" />
        </SvgRG>
        <SvgRG id="rbcDip" cx="50%" cy="50%" r="45%">
          <SvgStop offset="0%"   stopColor="#0d1117" stopOpacity="0.7" />
          <SvgStop offset="100%" stopColor="#0d1117" stopOpacity="0" />
        </SvgRG>
        <SvgRG id="wbc" cx="40%" cy="35%" r="70%">
          <SvgStop offset="0%"   stopColor="#a0b8f5" stopOpacity="0.95" />
          <SvgStop offset="60%"  stopColor="#6080d8" stopOpacity="0.85" />
          <SvgStop offset="100%" stopColor="#3050a0" stopOpacity="0.7" />
        </SvgRG>
        <SvgRG id="abCell" cx="40%" cy="35%" r="70%">
          <SvgStop offset="0%"   stopColor="#ffb060" stopOpacity="1" />
          <SvgStop offset="55%"  stopColor="#ff6030" stopOpacity="0.95" />
          <SvgStop offset="100%" stopColor="#cc2010" stopOpacity="0.85" />
        </SvgRG>
        <SvgRG id="vignette" cx="50%" cy="40%" r="55%">
          <SvgStop offset="0%"   stopColor="#ffffff" stopOpacity="0.07" />
          <SvgStop offset="100%" stopColor="#000000" stopOpacity="0.5" />
        </SvgRG>
      </SvgDefs>
      <SvgRect x="0" y="0" width="100" height="100" fill="url(#bg)" />
      {Array.from({ length: 40 }).map((_, i) => {
        const r2 = seededRand(`noise${i}`);
        return (
          <SvgCircle key={`n${i}`} cx={r2() * 100} cy={r2() * 100}
            r={0.15 + r2() * 0.25} fill="#8060a8" opacity={0.15 + r2() * 0.2} />
        );
      })}
      {cells.map(c => (
        <SvgG key={c.id}>
          <SvgEllipse cx={c.cx} cy={c.cy} rx={c.r}
            ry={c.r * (0.85 + seededRand(`ry${c.id}`)() * 0.3)}
            fill={c.isAbnormal ? 'url(#abCell)' : c.isRBC ? 'url(#rbc)' : 'url(#wbc)'} />
          {c.isRBC && !c.isAbnormal && (
            <SvgEllipse cx={c.cx} cy={c.cy} rx={c.r * 0.45} ry={c.r * 0.3} fill="url(#rbcDip)" />
          )}
          {!c.isRBC && !c.isAbnormal && (
            <SvgEllipse cx={c.cx} cy={c.cy} rx={c.r * 0.45} ry={c.r * 0.45} fill="#203080" opacity={0.7} />
          )}
        </SvgG>
      ))}
      <SvgRect x="0" y="0" width="100" height="100" fill="url(#vignette)" />
    </Svg2>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Blast Probability Panel
// ─────────────────────────────────────────────────────────────────────────────
function BlastPanel({
  probability, margin, blastCellPercent, totalCells, abnormalCount,
}: {
  probability: number;
  margin: number;
  blastCellPercent: number;
  totalCells: number;
  abnormalCount: number;
}) {
  const pct        = Math.min(Math.max(probability * 100, 0), 100);
  const isHigh     = probability > 0.5;
  const meterColor = probability > 0.7 ? THEME.error
    : probability > 0.5 ? '#ff9500'
    : probability > 0.3 ? THEME.amberBorder
    : THEME.success;

  return (
    <View style={styles.card}>
      <SectionHeader
        icon={<Zap color={meterColor} size={18} />}
        title="Explainable AI — Blast Analysis"
      />

      {/* Score row */}
      <View style={styles.blastScoreRow}>
        <View style={styles.blastScoreBox}>
          <Text style={[styles.blastScoreBig, { color: meterColor }]}>
            {pct.toFixed(1)}%
          </Text>
          <Text style={styles.blastScoreLabel}>Blast Probability</Text>
        </View>
        <View style={styles.blastScoreBox}>
          <Text style={[styles.blastScoreBig, { color: THEME.primary }]}>
            {(margin * 100).toFixed(1)}%
          </Text>
          <Text style={styles.blastScoreLabel}>Confidence Margin</Text>
        </View>
        <View style={styles.blastScoreBox}>
          <Text style={[styles.blastScoreBig, { color: THEME.textSecondary }]}>
            {blastCellPercent.toFixed(1)}%
          </Text>
          <Text style={styles.blastScoreLabel}>Blast Cell %</Text>
        </View>
      </View>

      {/* Meter track */}
      <View style={styles.blastTrack}>
        <View style={[styles.blastFill, { width: `${pct}%` as any, backgroundColor: meterColor }]} />
        {/* 50% threshold line */}
        <View style={styles.blastThreshold} />
      </View>
      <View style={styles.blastTrackLabels}>
        <Text style={styles.blastTrackLabel}>Normal  ←</Text>
        <Text style={styles.blastTrackLabelCenter}>50% threshold</Text>
        <Text style={styles.blastTrackLabel}>→  Blast</Text>
      </View>

      {/* Cell counts */}
      <View style={styles.blastCellRow}>
        <View style={styles.blastCellPill}>
          <Text style={styles.blastCellNum}>{totalCells}</Text>
          <Text style={styles.blastCellLbl}>Cells Detected</Text>
        </View>
        <View style={[styles.blastCellPill, abnormalCount > 0 && { backgroundColor: THEME.errorBg }]}>
          <Text style={[styles.blastCellNum, abnormalCount > 0 && { color: THEME.error }]}>
            {abnormalCount}
          </Text>
          <Text style={[styles.blastCellLbl, abnormalCount > 0 && { color: THEME.error }]}>
            Flagged Abnormal
          </Text>
        </View>
      </View>

      {/* Clinical note */}
      {isHigh && (
        <View style={styles.blastAlert}>
          <AlertTriangle color={THEME.error} size={14} />
          <Text style={styles.blastAlertText}>
            Score exceeds the 0.5 decision boundary. A cell at 0.92 blast probability is
            clinically very different from one at 0.51 — correlate with morphology and CBC.
          </Text>
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Per-Cell XAI Table
// ─────────────────────────────────────────────────────────────────────────────
function CellXAITable({ detections }: { detections: CellDetection[] }) {
  // Sort: abnormal first, then by descending blast probability
  const sorted = [...detections].sort((a, b) => {
    if (a.isAbnormal !== b.isAbnormal) return a.isAbnormal ? -1 : 1;
    return b.blastProbability - a.blastProbability;
  });

  return (
    <View style={styles.card}>
      <SectionHeader
        icon={<Microscope color={THEME.primary} size={18} />}
        title={`Per-Cell XAI (${detections.length} cells)`}
      />

      {/* Table header */}
      <View style={styles.xaiTableHeader}>
        <Text style={[styles.xaiHeaderCell, { flex: 0.5 }]}>#</Text>
        <Text style={[styles.xaiHeaderCell, { flex: 1.5 }]}>TYPE</Text>
        <Text style={[styles.xaiHeaderCell, { flex: 2, textAlign: 'right' }]}>BLAST PROB</Text>
        <Text style={[styles.xaiHeaderCell, { flex: 1.5, textAlign: 'right' }]}>STATUS</Text>
      </View>

      {sorted.map((c, i) => {
        const color = cellBoxColor(c.blastProbability);
        const pct   = (c.blastProbability * 100).toFixed(1);
        return (
          <View key={c.id} style={[styles.xaiTableRow, i % 2 === 1 && styles.xaiTableRowAlt]}>
            <Text style={[styles.xaiCell, { flex: 0.5, color: THEME.textSecondary }]}>{c.id + 1}</Text>
            <Text style={[styles.xaiCell, { flex: 1.5, fontWeight: '600', color: THEME.text }]}>
              {c.cellType}
            </Text>
            <View style={[styles.xaiProbBar, { flex: 2, alignItems: 'flex-end' }]}>
              {/* Mini bar + number */}
              <View style={styles.xaiProbBarInner}>
                <View style={[styles.xaiProbFill, {
                  width: `${Math.min(c.blastProbability * 100, 100)}%` as any,
                  backgroundColor: color + '55',
                }]} />
              </View>
              <Text style={[styles.xaiProbText, { color }]}>{pct}%</Text>
            </View>
            <View style={[styles.xaiStatusPill, { flex: 1.5, alignItems: 'flex-end' }]}>
              <View style={[styles.xaiStatusPillInner, {
                backgroundColor: c.isAbnormal ? THEME.errorBg : THEME.successBg,
              }]}>
                <Text style={[styles.xaiStatusText, {
                  color: c.isAbnormal ? THEME.error : THEME.success,
                }]}>
                  {c.isAbnormal ? 'BLAST' : 'NORMAL'}
                </Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main screen
// ─────────────────────────────────────────────────────────────────────────────
export default function AnalysisDetailScreen() {
  const params = useLocalSearchParams<AnalysisDetailParams>();

  // ── Parse groqReport ──────────────────────────────────────────────────────
  let groq: BloodReportAnalysis | null = null;
  try {
    if (params.groqReport) groq = JSON.parse(params.groqReport) as BloodReportAnalysis;
  } catch { /* safe fallback */ }

  // ── Parse XAI params ──────────────────────────────────────────────────────
  const blastProbability = parseFloat(params.blastProbability ?? '0');
  const confidenceMargin = parseFloat(params.confidenceMargin ?? '0');
  const blastCellPercent = parseFloat(params.blastCellPercent ?? '0');
  let cellDetections: CellDetection[] = [];
  try {
    if (params.cellDetections) cellDetections = JSON.parse(params.cellDetections) as CellDetection[];
  } catch { cellDetections = []; }
  const hasXAI = cellDetections.length > 0;
  const abnormalCells = cellDetections.filter(c => c.isAbnormal);

  // ── Meta values ───────────────────────────────────────────────────────────
  const caseId    = groq?.analysisId  ?? params.caseId            ?? 'HE-00000';
  const risk      = groq?.overallRisk ?? 'low';
  const urgency   = groq?.urgency     ?? 'routine';
  const summary   = groq?.summary     ?? '';
  const analyzedOnRaw = params.analyzedOn ?? groq?.analyzedOn ?? '';
  const analyzedOnDisplay = analyzedOnRaw
    ? new Date(analyzedOnRaw).toLocaleString()
    : new Date().toLocaleString();
  const latency       = params.processingLatency ?? '—';
  const specimenType  = params.specimenType ?? '—';
  const scanMode      = params.scanMode     ?? '—';
  const modelUsed     = groq?.modelUsed     ?? '—';
  const disclaimer    = groq?.disclaimer    ?? '';

  const markers    = groq?.markers            ?? [];
  const conditions = groq?.predictedConditions ?? [];
  const recs       = groq?.recommendations    ?? [];

  const riskColors = riskBadgeColors(risk);

  // ── SVG visualisation — prefer real detections, fallback to seeded ────────
  const fallbackCells = useMemo(
    () => generateFallbackCells(caseId, 14, risk),
    [caseId, risk],
  );
  const abnormalFallbackCount = fallbackCells.filter(c => c.isAbnormal).length;
  const visibleAbnormalCount  = hasXAI ? abnormalCells.length : abnormalFallbackCount;

  // ── Share ─────────────────────────────────────────────────────────────────
  const handleShare = async () => {
    if (!groq) { Alert.alert('Nothing to share', 'No analysis data available.'); return; }
    try {
      await Share.share({ message: buildShareText(groq, params) });
    } catch {
      Alert.alert('Error', 'Could not open share sheet.');
    }
  };

  const handleDownloadPdf = () => {
    Alert.alert('Coming soon', 'PDF export will be available in a future update.');
  };

  // ── Fallback if no groq data ──────────────────────────────────────────────
  if (!groq) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ChevronLeft color={THEME.text} size={24} />
          </TouchableOpacity>
          <View style={styles.brand}>
            <FileText color={THEME.primary} size={20} />
            <Text style={styles.brandText}>HEMO-EDGE</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.errorState}>
          <AlertTriangle color={THEME.error} size={48} />
          <Text style={styles.errorStateTitle}>No Analysis Data</Text>
          <Text style={styles.errorStateDesc}>
            Could not parse the report. Please go back and try again.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft color={THEME.text} size={24} />
        </TouchableOpacity>
        <View style={styles.brand}>
          <FileText color={THEME.primary} size={20} />
          <Text style={styles.brandText}>HEMO-EDGE</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── Title ────────────────────────────────────────────────────────── */}
        <View style={styles.titleSection}>
          <Text style={styles.caseId}>CASE ID: #{caseId}</Text>
          <Text style={styles.title}>Full Analysis</Text>
          <View style={[styles.riskPill, { backgroundColor: riskColors.bg }]}>
            <Text style={[styles.riskPillText, { color: riskColors.text }]}>
              {risk.toUpperCase()} RISK
            </Text>
          </View>
        </View>

        {/* ── Summary ──────────────────────────────────────────────────────── */}
        <View style={styles.card}>
          <SectionHeader icon={<Info color={THEME.primary} size={18} />} title="Summary" />
          <Text style={styles.summaryText}>{summary}</Text>
          <View style={styles.urgencyRow}>
            <Text style={styles.urgencyLabel}>URGENCY</Text>
            <Text style={[styles.urgencyValue, {
              color: urgency === 'emergency' || urgency === 'urgent'
                ? THEME.error
                : urgency === 'soon'
                ? THEME.warning
                : THEME.success,
            }]}>
              {urgency.toUpperCase()}
            </Text>
          </View>
        </View>

        {/* ── Microscopy preview (real XAI or fallback) ────────────────────── */}
        <View style={styles.visualCard}>
          <SectionHeader icon={<Microscope color={THEME.primary} size={18} />} title="Visual Overview" />
          <Text style={styles.visualSub}>
            {hasXAI
              ? `${visibleAbnormalCount} flagged · ${cellDetections.length} total · XAI bounding boxes`
              : `${visibleAbnormalCount} flagged cells · AI-rendered`}
          </Text>
          <View style={[styles.svgContainer, { width: IMG_W, height: IMG_H }]}>
            <MicroscopyView
              cells={fallbackCells}
              w={IMG_W} h={IMG_H} risk={risk}
              realDetections={hasXAI ? cellDetections : undefined}
            />
            <View style={styles.imgBadge}>
              <Text style={styles.imgBadgeText}>
                {hasXAI ? 'XAI · REAL DETECTIONS' : 'SIMULATED · AI RENDER'}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Blast Probability Panel ──────────────────────────────────────── */}
        {hasXAI && (
          <BlastPanel
            probability={blastProbability}
            margin={confidenceMargin}
            blastCellPercent={blastCellPercent}
            totalCells={cellDetections.length}
            abnormalCount={abnormalCells.length}
          />
        )}

        {/* ── Markers table ────────────────────────────────────────────────── */}
        {markers.length > 0 && (
          <View style={styles.card}>
            <SectionHeader icon={<Layers color={THEME.primary} size={18} />} title={`Blood Markers (${markers.length})`} />
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, { flex: 2 }]}>MARKER</Text>
              <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>VALUE</Text>
              <Text style={[styles.tableHeaderCell, { flex: 1.4, textAlign: 'right' }]}>REF RANGE</Text>
              <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>STATUS</Text>
            </View>
            {markers.map((m, i) => {
              const sc = markerStatusColor(m.status);
              return (
                <View key={i} style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}>
                  <Text style={[styles.tableCell, { flex: 2, fontWeight: '600', color: THEME.text }]} numberOfLines={2}>
                    {m.name}
                  </Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'right', color: THEME.text }]}>
                    {m.value} {m.unit}
                  </Text>
                  <Text style={[styles.tableCell, { flex: 1.4, textAlign: 'right', color: THEME.textSecondary, fontSize: 11 }]}>
                    {m.referenceRange}
                  </Text>
                  <View style={[styles.statusPill, { flex: 1, alignItems: 'flex-end' }]}>
                    <View style={[styles.statusPillInner, { backgroundColor: sc.bg }]}>
                      <Text style={[styles.statusPillText, { color: sc.text }]}>
                        {m.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Per-Cell XAI Table ───────────────────────────────────────────── */}
        {hasXAI && <CellXAITable detections={cellDetections} />}

        {/* ── Predicted conditions ─────────────────────────────────────────── */}
        {conditions.length > 0 && (
          <View style={styles.card}>
            <SectionHeader
              icon={<AlertTriangle color={THEME.primary} size={18} />}
              title="Predicted Conditions"
            />
            {conditions.map((c, i) => {
              const lc = likelihoodColor(c.likelihood);
              return (
                <View key={i} style={styles.conditionCard}>
                  <View style={styles.conditionTop}>
                    <Text style={styles.conditionName}>{c.condition}</Text>
                    <View style={[styles.likelihoodBadge, { backgroundColor: lc.bg }]}>
                      <Text style={[styles.likelihoodText, { color: lc.text }]}>
                        {c.likelihood.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.conditionExplanation}>{c.explanation}</Text>
                  {c.icdCode && (
                    <Text style={styles.icdCode}>ICD-10: {c.icdCode}</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* ── Recommendations ──────────────────────────────────────────────── */}
        {recs.length > 0 && (
          <View style={styles.card}>
            <SectionHeader
              icon={<CheckCircle color={THEME.primary} size={18} />}
              title="Recommendations"
            />
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

        {/* ── Meta row ─────────────────────────────────────────────────────── */}
        <View style={styles.metaCard}>
          <Text style={styles.metaTitle}>Report Metadata</Text>
          <View style={styles.metaGrid}>
            <MetaItem label="CASE ID"    value={caseId} />
            <MetaItem label="ANALYZED ON" value={analyzedOnDisplay} />
            <MetaItem label="LATENCY"    value={latency} />
            <MetaItem label="SPECIMEN"   value={specimenType !== '—' ? specimenType : (groq?.markers.length ? 'Blood Report' : '—')} />
            <MetaItem label="SCAN MODE"  value={scanMode} />
            <MetaItem label="MODEL"      value={modelUsed} />
            {hasXAI && (
              <MetaItem label="XAI CELLS" value={`${cellDetections.length} detected`} />
            )}
            {hasXAI && (
              <MetaItem label="BLAST PROB" value={`${(blastProbability * 100).toFixed(1)}%`} />
            )}
          </View>
        </View>

        {/* ── Disclaimer ───────────────────────────────────────────────────── */}
        {disclaimer.length > 0 && (
          <View style={styles.disclaimerBox}>
            <Info color={THEME.amberBorder} size={16} style={{ marginBottom: 6 }} />
            <Text style={styles.disclaimerText}>{disclaimer}</Text>
          </View>
        )}

        {/* ── Action buttons ───────────────────────────────────────────────── */}
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
            <Share2 color="#ffffff" size={18} />
            <Text style={styles.actionButtonText}>Share Report</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionButton, styles.actionButtonOutline]} onPress={handleDownloadPdf}>
            <Download color={THEME.primary} size={18} />
            <Text style={[styles.actionButtonText, { color: THEME.primary }]}>Download PDF</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────────────────────
function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      {icon}
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: THEME.background },
  header:        { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, backgroundColor: '#ffffffcc' },
  backButton:    { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  brand:         { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandText:     { fontSize: 18, fontWeight: '900', color: THEME.primary, letterSpacing: -0.5 },
  scrollContent: { padding: 16, paddingBottom: 48 },

  // ── Title
  titleSection:  { paddingVertical: 20, paddingHorizontal: 4, gap: 8 },
  caseId:        { fontSize: 12, fontWeight: '600', color: THEME.primary, letterSpacing: 2 },
  title:         { fontSize: 32, fontWeight: '800', color: THEME.text, letterSpacing: -1 },
  riskPill:      { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 99 },
  riskPillText:  { fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },

  // ── Cards
  card: {
    backgroundColor: THEME.surface, borderRadius: 20, padding: 20, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2,
    gap: 12,
  },
  visualCard: {
    backgroundColor: THEME.surface, borderRadius: 20, padding: 20, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2,
    gap: 8,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle:  { fontSize: 15, fontWeight: '800', color: THEME.text },

  // ── Summary
  summaryText:   { fontSize: 14, color: THEME.textSecondary, lineHeight: 22 },
  urgencyRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f0f2f4' },
  urgencyLabel:  { fontSize: 11, fontWeight: '700', color: THEME.textSecondary, letterSpacing: 1 },
  urgencyValue:  { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },

  // ── Visual
  visualSub:    { fontSize: 12, color: THEME.textSecondary },
  svgContainer: { borderRadius: 16, overflow: 'hidden', position: 'relative' },
  imgBadge:     { position: 'absolute', top: 10, left: 10, backgroundColor: '#00000066', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  imgBadgeText: { color: '#ffffff', fontSize: 8, fontWeight: '800', letterSpacing: 1.2 },

  // ── Blast Panel
  blastScoreRow:     { flexDirection: 'row', justifyContent: 'space-between' },
  blastScoreBox:     { flex: 1, alignItems: 'center', gap: 2 },
  blastScoreBig:     { fontSize: 22, fontWeight: '900' },
  blastScoreLabel:   { fontSize: 9, fontWeight: '700', color: THEME.textSecondary, letterSpacing: 0.8, textAlign: 'center' },
  blastTrack:        { height: 10, backgroundColor: '#eceef0', borderRadius: 5, overflow: 'visible', position: 'relative' },
  blastFill:         { height: '100%', borderRadius: 5 },
  blastThreshold:    { position: 'absolute', left: '50%', top: -3, width: 2, height: 16, backgroundColor: '#00478d55', borderRadius: 1 },
  blastTrackLabels:  { flexDirection: 'row', justifyContent: 'space-between' },
  blastTrackLabel:   { fontSize: 9, color: THEME.textSecondary, fontWeight: '600' },
  blastTrackLabelCenter: { fontSize: 9, color: THEME.primary, fontWeight: '700' },
  blastCellRow:      { flexDirection: 'row', gap: 10 },
  blastCellPill:     { flex: 1, backgroundColor: '#f7f9fb', borderRadius: 10, padding: 10, alignItems: 'center', gap: 2 },
  blastCellNum:      { fontSize: 20, fontWeight: '900', color: THEME.text },
  blastCellLbl:      { fontSize: 9, fontWeight: '700', color: THEME.textSecondary, letterSpacing: 0.5 },
  blastAlert:        { flexDirection: 'row', gap: 8, backgroundColor: THEME.errorBg, borderRadius: 10, padding: 10, alignItems: 'flex-start' },
  blastAlertText:    { flex: 1, fontSize: 11, color: THEME.error, lineHeight: 16 },

  // ── Per-Cell XAI Table
  xaiTableHeader:   { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#eceef0' },
  xaiHeaderCell:    { fontSize: 9, fontWeight: '800', color: THEME.textSecondary, letterSpacing: 0.8 },
  xaiTableRow:      { flexDirection: 'row', paddingVertical: 8, alignItems: 'center' },
  xaiTableRowAlt:   { backgroundColor: '#f7f9fb', borderRadius: 8 },
  xaiCell:          { fontSize: 12 },
  xaiProbBar:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  xaiProbBarInner:  { flex: 1, height: 6, backgroundColor: '#eceef0', borderRadius: 3, overflow: 'hidden' },
  xaiProbFill:      { height: '100%', borderRadius: 3 },
  xaiProbText:      { fontSize: 11, fontWeight: '800', minWidth: 36, textAlign: 'right' },
  xaiStatusPill:    { flexDirection: 'row' },
  xaiStatusPillInner:{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  xaiStatusText:    { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },

  // ── Markers table
  tableHeader:     { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#eceef0' },
  tableHeaderCell: { fontSize: 9, fontWeight: '800', color: THEME.textSecondary, letterSpacing: 0.8 },
  tableRow:        { flexDirection: 'row', paddingVertical: 10, alignItems: 'center' },
  tableRowAlt:     { backgroundColor: '#f7f9fb', borderRadius: 8 },
  tableCell:       { fontSize: 12, color: THEME.textSecondary },
  statusPill:      { flexDirection: 'row' },
  statusPillInner: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  statusPillText:  { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },

  // ── Conditions
  conditionCard:        { backgroundColor: '#f7f9fb', borderRadius: 12, padding: 14, gap: 6, borderLeftWidth: 3, borderLeftColor: THEME.primary, marginBottom: 4 },
  conditionTop:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  conditionName:        { flex: 1, fontSize: 14, fontWeight: '700', color: THEME.text },
  likelihoodBadge:      { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  likelihoodText:       { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  conditionExplanation: { fontSize: 13, color: THEME.textSecondary, lineHeight: 19 },
  icdCode:              { fontSize: 11, color: THEME.primary, fontWeight: '600' },

  // ── Recommendations
  recRow:        { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  recBullet:     { width: 22, height: 22, borderRadius: 11, backgroundColor: THEME.primary, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  recBulletText: { fontSize: 10, fontWeight: '900', color: '#fff' },
  recText:       { flex: 1, fontSize: 13, color: THEME.textSecondary, lineHeight: 19 },

  // ── Meta
  metaCard:  { backgroundColor: '#f2f4f6', borderRadius: 20, padding: 20, marginBottom: 16 },
  metaTitle: { fontSize: 15, fontWeight: '800', color: THEME.text, marginBottom: 14 },
  metaGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  metaItem:  { width: '45%', gap: 2 },
  metaLabel: { fontSize: 9, fontWeight: '700', color: THEME.textSecondary, letterSpacing: 1.5 },
  metaValue: { fontSize: 13, fontWeight: '700', color: THEME.text },

  // ── Disclaimer
  disclaimerBox: {
    backgroundColor: THEME.amberBg, borderRadius: 14, padding: 16,
    borderLeftWidth: 3, borderLeftColor: THEME.amberBorder,
    marginBottom: 20, gap: 4,
  },
  disclaimerText: { fontSize: 12, color: THEME.amber, lineHeight: 18 },

  // ── Actions
  actionsRow:          { flexDirection: 'row', gap: 12, marginBottom: 16 },
  actionButton:        { flex: 1, height: 52, borderRadius: 16, backgroundColor: THEME.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionButtonOutline: { backgroundColor: 'transparent', borderWidth: 2, borderColor: THEME.primary },
  actionButtonText:    { fontSize: 14, fontWeight: '700', color: '#ffffff' },

  // ── Error state
  errorState:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  errorStateTitle: { fontSize: 20, fontWeight: '700', color: THEME.text },
  errorStateDesc:  { fontSize: 14, color: THEME.textSecondary, textAlign: 'center', lineHeight: 20 },
});