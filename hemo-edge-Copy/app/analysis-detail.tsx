// FILE: app/analysis-detail.tsx
// Phase 2: XAI bounding-box overlay, per-cell confidence badges, blast panel.
// Phase 4 Pillar A:
//   - Blast Probability radial gauge (react-native-svg)
//   - Real cellDetections fully wired (no more seeded fallback for XAI data)
//   - Longitudinal Trend Charts: WBC / RBC / blastCellPercent over last 10 scans
//     loaded from Firestore via getPatientScanHistory
// Phase 5 Pillar C: Biometric gate on mount (reads UserPreferences.biometricEnabled)
// Phase 5 Pillar F: Export PDF button (doctor only, DUA gate)
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Share, Alert, Dimensions, ActivityIndicator,
} from 'react-native';
import {
  ChevronLeft, FileText, Microscope, CheckCircle, AlertTriangle,
  Info, Share2, Download, Layers, Zap, TrendingUp, Lock,
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
} from '../hooks/blood-report-types';
import type { CellDetection } from '../hooks/use-ml-service';
import {
  getPatientScanHistory,
  getUserPreferences,
  writeAuditLog,
} from '../lib/firestore-service';
import type { StoredScanResult } from '../lib/firestore-service';

// ── Phase 5 Pillar C ──────────────────────────────────────────────────────────
import { useAuthContext } from '../contexts/auth-context';
import { authenticateWithBiometric } from '../hooks/use-biometric-auth';

// ── Phase 5 Pillar F ──────────────────────────────────────────────────────────
import { usePdfExport } from '../hooks/use-pdf-export';

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
  blastProbability?:  string;
  confidenceMargin?:  string;
  blastCellPercent?:  string;
  cellDetections?:    string;
  patientId?:         string;
  // Pillar F: pass patientName and scanId so PDF export has full context
  patientName?:       string;
  scanId?:            string;
};

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers (unchanged from Phase 4)
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
//  Microscopy SVG (unchanged from Phase 4)
// ─────────────────────────────────────────────────────────────────────────────
function MicroscopyView({
  cells, w, h, risk, realDetections,
}: {
  cells: ReturnType<typeof generateFallbackCells>;
  w: number; h: number; risk: string;
  realDetections?: CellDetection[];
}) {
  const hasReal = realDetections && realDetections.length > 0;

  if (hasReal) {
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
        <SvgRect x="0" y="0" width="100" height="100" fill="url(#bg2)" />
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
        {realDetections.map(c => {
          const color = cellBoxColor(c.blastProbability);
          const cx    = c.x + c.w / 2;
          const cy    = c.y + c.h / 2;
          const rx    = c.w / 2;
          const ry    = c.h / 2;
          const label = `${(c.blastProbability * 100).toFixed(0)}%`;
          return (
            <SvgG key={c.id}>
              <SvgEllipse cx={cx} cy={cy} rx={rx} ry={ry}
                fill={c.isAbnormal ? '#ff3b3033' : '#e0606033'}
                stroke={color}
                strokeWidth={c.isAbnormal ? 0.6 : 0.3}
                strokeDasharray={c.isAbnormal ? undefined : '1,0.6'}
                opacity={c.isAbnormal ? 1 : 0.6}
              />
              {c.isAbnormal && (
                <SvgRect x={c.x} y={c.y} width={c.w} height={c.h}
                  fill="none" stroke={color} strokeWidth={0.5} opacity={0.7}
                />
              )}
              {c.isAbnormal && (
                <>
                  <SvgRect
                    x={cx - label.length * 0.9} y={cy - ry - 5}
                    width={label.length * 1.8 + 1} height={4}
                    fill={color} opacity={0.85} rx={0.5}
                  />
                  <SvgText
                    x={cx - label.length * 0.9 + 0.5} y={cy - ry - 2}
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
//  Blast Probability Radial Gauge (Phase 4 Pillar A — unchanged)
// ─────────────────────────────────────────────────────────────────────────────

const GAUGE_SIZE    = 160;
const GAUGE_CX      = GAUGE_SIZE / 2;
const GAUGE_CY      = GAUGE_SIZE / 2 + 8;
const GAUGE_R       = 58;
const STROKE_W      = 14;
const ARC_START_DEG = 160;
const ARC_END_DEG   = 380;
const ARC_TOTAL_DEG = ARC_END_DEG - ARC_START_DEG;

function degToXY(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start    = degToXY(cx, cy, r, startDeg);
  const end      = degToXY(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function RadialGauge({ probability, margin }: { probability: number; margin: number }) {
  const pct       = Math.min(Math.max(probability, 0), 1);
  const filledDeg = pct * ARC_TOTAL_DEG;
  const needleDeg = ARC_START_DEG + filledDeg;
  const gaugeColor = probability > 0.8 ? '#ff3b30'
    : probability > 0.6 ? '#ff6b00'
    : probability > 0.3 ? '#f59e0b'
    : '#34c759';
  const bandColors = ['#34c75933', '#f59e0b33', '#ff6b0033', '#ff3b3033'];
  const bandEdges  = [0, 0.3, 0.6, 0.8, 1.0];
  const needleTip  = degToXY(GAUGE_CX, GAUGE_CY, GAUGE_R - STROKE_W / 2 - 2, needleDeg);

  return (
    <View style={styles.gaugeWrap}>
      <Svg2 width={GAUGE_SIZE} height={GAUGE_SIZE * 0.75} viewBox={`0 0 ${GAUGE_SIZE} ${GAUGE_SIZE * 0.75}`}>
        {bandColors.map((color, i) => {
          const sDeg = ARC_START_DEG + bandEdges[i] * ARC_TOTAL_DEG;
          const eDeg = ARC_START_DEG + bandEdges[i + 1] * ARC_TOTAL_DEG;
          return (
            <SvgPath key={`band${i}`}
              d={arcPath(GAUGE_CX, GAUGE_CY, GAUGE_R, sDeg, eDeg)}
              stroke={color.replace('33', '')} strokeWidth={STROKE_W}
              strokeLinecap="butt" fill="none" opacity={0.18}
            />
          );
        })}
        <SvgPath d={arcPath(GAUGE_CX, GAUGE_CY, GAUGE_R, ARC_START_DEG, ARC_END_DEG)}
          stroke="#e0e3e5" strokeWidth={STROKE_W} strokeLinecap="round" fill="none" />
        {pct > 0 && (
          <SvgPath d={arcPath(GAUGE_CX, GAUGE_CY, GAUGE_R, ARC_START_DEG, ARC_START_DEG + filledDeg)}
            stroke={gaugeColor} strokeWidth={STROKE_W} strokeLinecap="round" fill="none" />
        )}
        <SvgCircle cx={needleTip.x} cy={needleTip.y} r={5} fill={gaugeColor} />
        <SvgCircle cx={GAUGE_CX} cy={GAUGE_CY} r={4} fill={gaugeColor} opacity={0.4} />
        <SvgText x={GAUGE_CX} y={GAUGE_CY - 2} textAnchor="middle"
          fontSize={18} fontWeight="bold" fill={gaugeColor}>
          {`${(pct * 100).toFixed(1)}%`}
        </SvgText>
        <SvgText x={GAUGE_CX} y={GAUGE_CY + 13} textAnchor="middle" fontSize={7} fill="#424752">
          Blast Probability
        </SvgText>
        {[0, 0.3, 0.6, 0.8, 1.0].map((v, i) => {
          const labelDeg = ARC_START_DEG + v * ARC_TOTAL_DEG;
          const lp = degToXY(GAUGE_CX, GAUGE_CY, GAUGE_R + 12, labelDeg);
          return (
            <SvgText key={`label${i}`} x={lp.x} y={lp.y} textAnchor="middle"
              fontSize={5.5} fill="#9ca3af">
              {`${v * 100 | 0}%`}
            </SvgText>
          );
        })}
      </Svg2>
      <View style={[styles.gaugePill, { backgroundColor: gaugeColor + '22' }]}>
        <Text style={[styles.gaugePillText, { color: gaugeColor }]}>
          ±{(margin * 100).toFixed(1)}% confidence
        </Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  BlastPanel, CellXAITable, LongitudinalCharts — all unchanged from Phase 4
//  (Omitted here for brevity — carry forward from your Phase 4 source file)
// ─────────────────────────────────────────────────────────────────────────────

function BlastPanel({ probability, margin, blastCellPercent, totalCells, abnormalCount }: {
  probability: number; margin: number;
  blastCellPercent: number; totalCells: number; abnormalCount: number;
}) {
  const isHigh     = probability > 0.5;
  const meterColor = probability > 0.7 ? THEME.error
    : probability > 0.5 ? '#ff9500'
    : probability > 0.3 ? THEME.amberBorder
    : THEME.success;
  return (
    <View style={styles.card}>
      <SectionHeader icon={<Zap color={meterColor} size={18} />} title="Explainable AI — Blast Analysis" />
      <View style={{ alignItems: 'center' }}>
        <RadialGauge probability={probability} margin={margin} />
      </View>
      <View style={styles.blastScoreRow}>
        <View style={styles.blastScoreBox}>
          <Text style={[styles.blastScoreBig, { color: THEME.primary }]}>{blastCellPercent.toFixed(1)}%</Text>
          <Text style={styles.blastScoreLabel}>Blast Cell %</Text>
        </View>
        <View style={styles.blastScoreBox}>
          <Text style={[styles.blastScoreBig, { color: THEME.text }]}>{totalCells}</Text>
          <Text style={styles.blastScoreLabel}>Cells Detected</Text>
        </View>
        <View style={[styles.blastScoreBox, abnormalCount > 0 && { backgroundColor: THEME.errorBg, borderRadius: 10 }]}>
          <Text style={[styles.blastScoreBig, abnormalCount > 0 && { color: THEME.error }]}>{abnormalCount}</Text>
          <Text style={[styles.blastScoreLabel, abnormalCount > 0 && { color: THEME.error }]}>Flagged Blast</Text>
        </View>
      </View>
      {isHigh && (
        <View style={styles.blastAlert}>
          <AlertTriangle color={THEME.error} size={14} />
          <Text style={styles.blastAlertText}>
            Score exceeds the 0.5 decision boundary. Correlate with morphology and CBC differential.
          </Text>
        </View>
      )}
    </View>
  );
}

function CellXAITable({ detections }: { detections: CellDetection[] }) {
  const sorted = [...detections].sort((a, b) => {
    if (a.isAbnormal !== b.isAbnormal) return a.isAbnormal ? -1 : 1;
    return b.blastProbability - a.blastProbability;
  });
  return (
    <View style={styles.card}>
      <SectionHeader icon={<Microscope color={THEME.primary} size={18} />} title={`Per-Cell XAI (${detections.length} cells)`} />
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
            <Text style={[styles.xaiCell, { flex: 0.5, color: THEME.textSecondary }]}>{i + 1}</Text>
            <Text style={[styles.xaiCell, { flex: 1.5, fontWeight: '600', color: THEME.text }]}>{c.cellType}</Text>
            <View style={[styles.xaiProbBar, { flex: 2, alignItems: 'flex-end' }]}>
              <View style={styles.xaiProbBarInner}>
                <View style={[styles.xaiProbFill, {
                  width: `${Math.min(c.blastProbability * 100, 100)}%` as unknown as number,
                  backgroundColor: color + '55',
                }]} />
              </View>
              <Text style={[styles.xaiProbText, { color }]}>{pct}%</Text>
            </View>
            <View style={[styles.xaiStatusPill, { flex: 1.5, alignItems: 'flex-end' }]}>
              <View style={[styles.xaiStatusPillInner, { backgroundColor: c.isAbnormal ? THEME.errorBg : THEME.successBg }]}>
                <Text style={[styles.xaiStatusText, { color: c.isAbnormal ? THEME.error : THEME.success }]}>
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

const CHART_W     = width - 48 - 32;
const CHART_H     = 70;
const CHART_PAD_X = 8;
const CHART_PAD_Y = 8;

interface TrendPoint { label: string; value: number; }

function MiniLineChart({ points, color, unit, refMin, refMax }: {
  points: TrendPoint[]; color: string; unit: string; refMin?: number; refMax?: number;
}) {
  if (points.length < 2) {
    return (
      <View style={[styles.chartPlaceholder, { height: CHART_H }]}>
        <Text style={styles.chartPlaceholderText}>Not enough data</Text>
      </View>
    );
  }
  const values = points.map(p => p.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range  = maxVal - minVal || 1;
  const plotW  = CHART_W - CHART_PAD_X * 2;
  const plotH  = CHART_H - CHART_PAD_Y * 2;
  const toX    = (i: number) => CHART_PAD_X + (i / (points.length - 1)) * plotW;
  const toY    = (v: number) => CHART_PAD_Y + (1 - (v - minVal) / range) * plotH;
  const fillPath = [
    `M ${toX(0).toFixed(1)},${toY(points[0].value).toFixed(1)}`,
    ...points.slice(1).map((p, i) => `L ${toX(i + 1).toFixed(1)},${toY(p.value).toFixed(1)}`),
    `L ${toX(points.length - 1).toFixed(1)},${(CHART_H - CHART_PAD_Y).toFixed(1)}`,
    `L ${toX(0).toFixed(1)},${(CHART_H - CHART_PAD_Y).toFixed(1)}`, 'Z',
  ].join(' ');
  return (
    <Svg2 width={CHART_W} height={CHART_H}>
      <SvgDefs>
        <SvgLG id={`grad_${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <SvgStop offset="0%"   stopColor={color} stopOpacity="0.25" />
          <SvgStop offset="100%" stopColor={color} stopOpacity="0.02" />
        </SvgLG>
      </SvgDefs>
      {refMin !== undefined && refMax !== undefined && (
        <SvgRect x={CHART_PAD_X} y={toY(Math.min(refMax, maxVal + range * 0.1))}
          width={plotW} height={Math.abs(toY(refMin) - toY(refMax))}
          fill="#00478d" opacity={0.06} />
      )}
      <SvgPath d={fillPath} fill={`url(#grad_${color.replace('#', '')})`} />
      {points.length > 1 && (
        <SvgPath
          d={[`M ${toX(0).toFixed(1)},${toY(points[0].value).toFixed(1)}`,
            ...points.slice(1).map((p, i) => `L ${toX(i + 1).toFixed(1)},${toY(p.value).toFixed(1)}`),
          ].join(' ')}
          stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none"
        />
      )}
      {points.map((p, i) => (
        <SvgCircle key={i} cx={toX(i)} cy={toY(p.value)} r={3}
          fill={THEME.surface} stroke={color} strokeWidth={1.5} />
      ))}
      {points.map((p, i) => (
        <SvgText key={`lbl${i}`} x={toX(i)} y={CHART_H - 1}
          textAnchor="middle" fontSize={5.5} fill="#9ca3af">
          {p.label}
        </SvgText>
      ))}
    </Svg2>
  );
}

function LongitudinalCharts({ patientId }: { patientId: string }) {
  const [loading, setLoading] = useState(true);
  const [series,  setSeries]  = useState<{ wbc: TrendPoint[]; rbc: TrendPoint[]; blastPct: TrendPoint[] } | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const scans = await getPatientScanHistory(patientId, 10);
        if (cancelled) return;
        const shortDate = (iso: string) => {
          try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
          catch { return iso.slice(0, 5); }
        };
        setSeries({
          wbc:      scans.filter(s => s.wbc      !== undefined).map(s => ({ label: shortDate(s.analyzedOn), value: s.wbc! })),
          rbc:      scans.filter(s => s.rbc      !== undefined).map(s => ({ label: shortDate(s.analyzedOn), value: s.rbc! })),
          blastPct: scans.filter(s => s.blastCellPercent !== undefined).map(s => ({ label: shortDate(s.analyzedOn), value: s.blastCellPercent! })),
        });
      } catch {
        if (!cancelled) setError('Could not load trend data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [patientId]);

  if (loading) return <View style={[styles.card, { alignItems: 'center', paddingVertical: 32 }]}><ActivityIndicator color={THEME.primary} /></View>;
  if (error || !series) return <View style={[styles.card, { alignItems: 'center', paddingVertical: 24 }]}><Text style={{ color: THEME.textSecondary, fontSize: 13 }}>{error ?? 'No trend data.'}</Text></View>;

  const hasAny = series.wbc.length >= 2 || series.rbc.length >= 2 || series.blastPct.length >= 2;
  if (!hasAny) return (
    <View style={[styles.card, { gap: 4 }]}>
      <SectionHeader icon={<TrendingUp color={THEME.primary} size={18} />} title="Longitudinal Trends" />
      <Text style={{ color: THEME.textSecondary, fontSize: 13, marginTop: 4 }}>Need at least 2 scans to display trend charts.</Text>
    </View>
  );

  return (
    <View style={styles.card}>
      <SectionHeader icon={<TrendingUp color={THEME.primary} size={18} />} title="Longitudinal Trends" />
      <Text style={styles.trendSubtitle}>Last {Math.max(series.wbc.length, series.rbc.length, series.blastPct.length)} scans</Text>
      {series.wbc.length >= 2 && (
        <View style={styles.trendSection}>
          <View style={styles.trendLabelRow}><View style={[styles.trendDot, { backgroundColor: '#3b82f6' }]} /><Text style={styles.trendLabel}>WBC  <Text style={styles.trendUnit}>×10³/μL</Text></Text></View>
          <MiniLineChart points={series.wbc} color="#3b82f6" unit="×10³/μL" refMin={4.5} refMax={11.0} />
        </View>
      )}
      {series.rbc.length >= 2 && (
        <View style={styles.trendSection}>
          <View style={styles.trendLabelRow}><View style={[styles.trendDot, { backgroundColor: '#ef4444' }]} /><Text style={styles.trendLabel}>RBC  <Text style={styles.trendUnit}>×10⁶/μL</Text></Text></View>
          <MiniLineChart points={series.rbc} color="#ef4444" unit="×10⁶/μL" refMin={4.2} refMax={5.8} />
        </View>
      )}
      {series.blastPct.length >= 2 && (
        <View style={styles.trendSection}>
          <View style={styles.trendLabelRow}><View style={[styles.trendDot, { backgroundColor: '#f59e0b' }]} /><Text style={styles.trendLabel}>Blast Cell %  <Text style={styles.trendUnit}>%</Text></Text></View>
          <MiniLineChart points={series.blastPct} color="#f59e0b" unit="%" refMin={0} refMax={5} />
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-components (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <View style={styles.sectionHeader}>{icon}<Text style={styles.sectionTitle}>{title}</Text></View>
  );
}
function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaItem}><Text style={styles.metaLabel}>{label}</Text><Text style={styles.metaValue}>{value}</Text></View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Biometric lock overlay (Phase 5 Pillar C)
// ─────────────────────────────────────────────────────────────────────────────
function BiometricLockOverlay({ onRetry }: { onRetry: () => void }): React.ReactElement {
  return (
    <View style={styles.bioLockOverlay}>
      <Lock color={THEME.primary} size={48} />
      <Text style={styles.bioLockTitle}>Authentication Required</Text>
      <Text style={styles.bioLockDesc}>
        Biometric authentication is required to view this report.
      </Text>
      <TouchableOpacity style={styles.bioLockBtn} onPress={onRetry}>
        <Text style={styles.bioLockBtnText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main screen
// ─────────────────────────────────────────────────────────────────────────────
export default function AnalysisDetailScreen() {
  const params = useLocalSearchParams<AnalysisDetailParams>();
  const { user, role } = useAuthContext();

  // ── Phase 5 Pillar C: biometric gate ────────────────────────────────────
  const [bioLocked,   setBioLocked]   = useState(false);
  const [bioChecked,  setBioChecked]  = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const prefs = await getUserPreferences(user.uid);
        if (cancelled) return;
        if (prefs.biometricEnabled) {
          const passed = await authenticateWithBiometric('Authenticate to view scan report');
          if (cancelled) return;
          if (passed) {
            await writeAuditLog({
              actorUid: user.uid, actorRole: (role ?? 'patient') as 'doctor' | 'patient',
              action: 'view_scan', resourceType: 'scan', resourceId: params.scanId ?? params.caseId ?? '',
            });
            setBioLocked(false);
          } else {
            setBioLocked(true);
          }
        }
      } catch {
        // If biometric check errors, default to locked for safety
        if (!cancelled) setBioLocked(true);
      } finally {
        if (!cancelled) setBioChecked(true);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const handleBioRetry = useCallback(async () => {
    if (!user) return;
    try {
      const passed = await authenticateWithBiometric('Authenticate to view scan report');
      if (passed) {
        await writeAuditLog({
          actorUid: user.uid, actorRole: (role ?? 'patient') as 'doctor' | 'patient',
          action: 'view_scan', resourceType: 'scan', resourceId: params.scanId ?? params.caseId ?? '',
        });
        setBioLocked(false);
      }
    } catch { /* keep locked */ }
  }, [user, role, params.scanId, params.caseId]);

  // ── Phase 5 Pillar F: PDF export state ──────────────────────────────────
  const { isExporting, exportScanAsPDF } = usePdfExport();
  const [duaAccepted, setDuaAccepted]   = useState(false);
  const isDoctor = role === 'doctor';

  // ── Parse params ─────────────────────────────────────────────────────────
  let groq: BloodReportAnalysis | null = null;
  try {
    if (params.groqReport) groq = JSON.parse(params.groqReport) as BloodReportAnalysis;
  } catch { /* safe fallback */ }

  const blastProbability = parseFloat(params.blastProbability ?? '0');
  const confidenceMargin = parseFloat(params.confidenceMargin ?? '0');
  const blastCellPercent = parseFloat(params.blastCellPercent ?? '0');

  const cellDetections = useMemo<CellDetection[]>(() => {
    try {
      if (params.cellDetections) return JSON.parse(params.cellDetections) as CellDetection[];
    } catch { /* fall through */ }
    return [];
  }, [params.cellDetections]);

  const hasXAI            = cellDetections.length > 0;
  const abnormalCells     = cellDetections.filter(c => c.isAbnormal);
  const caseId            = groq?.analysisId  ?? params.caseId            ?? 'HE-00000';
  const risk              = groq?.overallRisk ?? 'low';
  const urgency           = groq?.urgency     ?? 'routine';
  const summary           = groq?.summary     ?? '';
  const analyzedOnRaw     = params.analyzedOn ?? groq?.analyzedOn ?? '';
  const analyzedOnDisplay = analyzedOnRaw ? new Date(analyzedOnRaw).toLocaleString() : new Date().toLocaleString();
  const latency           = params.processingLatency ?? '—';
  const specimenType      = params.specimenType ?? '—';
  const scanMode          = params.scanMode     ?? '—';
  const modelUsed         = groq?.modelUsed     ?? '—';
  const disclaimer        = groq?.disclaimer    ?? '';
  const patientId         = params.patientId;
  const patientName       = params.patientName  ?? '';
  const scanId            = params.scanId       ?? params.caseId ?? '';

  const markers    = useMemo(() => groq?.markers            ?? [], [groq]);
  const conditions = useMemo(() => groq?.predictedConditions ?? [], [groq]);
  const recs       = useMemo(() => groq?.recommendations    ?? [], [groq]);
  const riskColors = riskBadgeColors(risk);

  const fallbackCells         = useMemo(() => generateFallbackCells(caseId, 14, risk), [caseId, risk]);
  const abnormalFallbackCount = fallbackCells.filter(c => c.isAbnormal).length;
  const visibleAbnormalCount  = hasXAI ? abnormalCells.length : abnormalFallbackCount;

  const handleShare = async () => {
    if (!groq) { Alert.alert('Nothing to share', 'No analysis data available.'); return; }
    try { await Share.share({ message: buildShareText(groq, params) }); }
    catch { Alert.alert('Error', 'Could not open share sheet.'); }
  };

  // ── Phase 5 Pillar F: PDF export with DUA gate ───────────────────────────
  // runExport defined first so handleExportPDF can reference it in deps
  const runExport = useCallback(async () => {
    if (!user || !groq) return;

    // Build a minimal StoredScanResult from what we have in params
    const scanForExport: StoredScanResult = {
      id:                  scanId,
      caseId,
      analyzedOn:          analyzedOnRaw || new Date().toISOString(),
      specimenType:        specimenType !== '—' ? specimenType : 'Blood Sample',
      scanMode:            scanMode !== '—' ? scanMode : 'Lab Report',
      overallRisk:         risk,
      urgency,
      summary,
      predictedConditions: conditions,
      markers,
      recommendations:     recs,
      imageUri:            params.imageUri,
      patientId:           patientId,
      patientName,
      blastProbability,
      blastCellPercent,
    };

    try {
      await exportScanAsPDF(
        scanForExport,
        cellDetections,
        patientName || 'Unknown Patient',
        user.uid,
        'doctor',
        true,
      );
    } catch {
      Alert.alert('Export Failed', 'Could not generate the PDF report. Please try again.');
    }
  }, [user, groq, scanId, caseId, analyzedOnRaw, specimenType, scanMode, risk, urgency,
      summary, conditions, markers, recs, params.imageUri, patientId, patientName,
      blastProbability, blastCellPercent, cellDetections, exportScanAsPDF]);

  const handleExportPDF = useCallback(async () => {
    if (!isDoctor) return;

    if (!duaAccepted) {
      Alert.alert(
        'Data Use Agreement',
        'By exporting this report you confirm:\n\n' +
        '• You are an authorised clinician\n' +
        '• The export is for clinical use only\n' +
        '• You will handle the PDF per your institution\'s data governance policy\n' +
        '• HEMO-EDGE is not liable for misuse of exported PHI',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'I Accept — Export PDF',
            style: 'default',
            onPress: async () => {
              setDuaAccepted(true);
              await runExport();
            },
          },
        ],
      );
      return;
    }

    await runExport();
  }, [isDoctor, duaAccepted, runExport]);

  // ── Error state ──────────────────────────────────────────────────────────
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
          <Text style={styles.errorStateDesc}>Could not parse the report. Please go back and try again.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Biometric lock overlay ─────────────────────────────────────────────
  // Show overlay on top of the screen (not unmounting), blurring PHI content
  if (bioChecked && bioLocked) {
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
        <BiometricLockOverlay onRetry={handleBioRetry} />
      </SafeAreaView>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────
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

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── Title ───────────────────────────────────────────────────────── */}
        <View style={styles.titleSection}>
          <Text style={styles.caseId}>CASE ID: #{caseId}</Text>
          <Text style={styles.title}>Full Analysis</Text>
          <View style={[styles.riskPill, { backgroundColor: riskColors.bg }]}>
            <Text style={[styles.riskPillText, { color: riskColors.text }]}>{risk.toUpperCase()} RISK</Text>
          </View>
        </View>

        {/* ── Summary ─────────────────────────────────────────────────────── */}
        <View style={styles.card}>
          <SectionHeader icon={<Info color={THEME.primary} size={18} />} title="Summary" />
          <Text style={styles.summaryText}>{summary}</Text>
          <View style={styles.urgencyRow}>
            <Text style={styles.urgencyLabel}>URGENCY</Text>
            <Text style={[styles.urgencyValue, {
              color: urgency === 'emergency' || urgency === 'urgent' ? THEME.error
                : urgency === 'soon' ? THEME.warning : THEME.success,
            }]}>
              {urgency.toUpperCase()}
            </Text>
          </View>
        </View>

        {/* ── Microscopy preview ───────────────────────────────────────────── */}
        <View style={styles.visualCard}>
          <SectionHeader icon={<Microscope color={THEME.primary} size={18} />} title="Visual Overview" />
          <Text style={styles.visualSub}>
            {hasXAI
              ? `${visibleAbnormalCount} flagged · ${cellDetections.length} total · XAI bounding boxes`
              : `${visibleAbnormalCount} flagged cells · AI-rendered`}
          </Text>
          <View style={[styles.svgContainer, { width: IMG_W, height: IMG_H }]}>
            <MicroscopyView
              cells={fallbackCells} w={IMG_W} h={IMG_H} risk={risk}
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
            probability={blastProbability} margin={confidenceMargin}
            blastCellPercent={blastCellPercent}
            totalCells={cellDetections.length} abnormalCount={abnormalCells.length}
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
                  <Text style={[styles.tableCell, { flex: 2, fontWeight: '600', color: THEME.text }]} numberOfLines={2}>{m.name}</Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'right', color: THEME.text }]}>{m.value} {m.unit}</Text>
                  <Text style={[styles.tableCell, { flex: 1.4, textAlign: 'right', color: THEME.textSecondary, fontSize: 11 }]}>{m.referenceRange}</Text>
                  <View style={[styles.statusPill, { flex: 1, alignItems: 'flex-end' }]}>
                    <View style={[styles.statusPillInner, { backgroundColor: sc.bg }]}>
                      <Text style={[styles.statusPillText, { color: sc.text }]}>{m.status.toUpperCase()}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Per-Cell XAI Table ───────────────────────────────────────────── */}
        {hasXAI && <CellXAITable detections={cellDetections} />}

        {/* ── Longitudinal Trend Charts ────────────────────────────────────── */}
        {patientId && <LongitudinalCharts patientId={patientId} />}

        {/* ── Predicted conditions ─────────────────────────────────────────── */}
        {conditions.length > 0 && (
          <View style={styles.card}>
            <SectionHeader icon={<AlertTriangle color={THEME.primary} size={18} />} title="Predicted Conditions" />
            {conditions.map((c, i) => {
              const lc = likelihoodColor(c.likelihood);
              return (
                <View key={i} style={styles.conditionCard}>
                  <View style={styles.conditionTop}>
                    <Text style={styles.conditionName}>{c.condition}</Text>
                    <View style={[styles.likelihoodBadge, { backgroundColor: lc.bg }]}>
                      <Text style={[styles.likelihoodText, { color: lc.text }]}>{c.likelihood.toUpperCase()}</Text>
                    </View>
                  </View>
                  <Text style={styles.conditionExplanation}>{c.explanation}</Text>
                  {c.icdCode && <Text style={styles.icdCode}>ICD-10: {c.icdCode}</Text>}
                </View>
              );
            })}
          </View>
        )}

        {/* ── Recommendations ──────────────────────────────────────────────── */}
        {recs.length > 0 && (
          <View style={styles.card}>
            <SectionHeader icon={<CheckCircle color={THEME.primary} size={18} />} title="Recommendations" />
            {recs.map((r, i) => (
              <View key={i} style={styles.recRow}>
                <View style={styles.recBullet}><Text style={styles.recBulletText}>{i + 1}</Text></View>
                <Text style={styles.recText}>{r}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Meta row ─────────────────────────────────────────────────────── */}
        <View style={styles.metaCard}>
          <Text style={styles.metaTitle}>Report Metadata</Text>
          <View style={styles.metaGrid}>
            <MetaItem label="CASE ID"      value={caseId} />
            <MetaItem label="ANALYZED ON"  value={analyzedOnDisplay} />
            <MetaItem label="LATENCY"      value={latency} />
            <MetaItem label="SPECIMEN"     value={specimenType !== '—' ? specimenType : (groq?.markers.length ? 'Blood Report' : '—')} />
            <MetaItem label="SCAN MODE"    value={scanMode} />
            <MetaItem label="MODEL"        value={modelUsed} />
            {hasXAI && <MetaItem label="XAI CELLS"  value={`${cellDetections.length} detected`} />}
            {hasXAI && <MetaItem label="BLAST PROB" value={`${(blastProbability * 100).toFixed(1)}%`} />}
          </View>
        </View>

        {/* ── Disclaimer ───────────────────────────────────────────────────── */}
        {disclaimer.length > 0 && (
          <View style={styles.disclaimerBox}>
            <Info color={THEME.amberBorder} size={16} style={{ marginBottom: 6 }} />
            <Text style={styles.disclaimerText}>{disclaimer}</Text>
          </View>
        )}

        {/* ── Action buttons ────────────────────────────────────────────────
            Phase 5 Pillar F: Export PDF button added (doctor only)
            DUA gate fires on first press; accepted state persists for session
        ──────────────────────────────────────────────────────────────────── */}
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
            <Share2 color="#ffffff" size={18} />
            <Text style={styles.actionButtonText}>Share Report</Text>
          </TouchableOpacity>

          {isDoctor && (
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.actionButtonOutline,
                isExporting && styles.actionButtonDisabled,
              ]}
              onPress={handleExportPDF}
              disabled={isExporting}
            >
              {isExporting ? (
                <ActivityIndicator size="small" color={THEME.primary} />
              ) : (
                <Download color={THEME.primary} size={18} />
              )}
              <Text style={[styles.actionButtonText, { color: THEME.primary }]}>
                {isExporting ? 'Exporting…' : 'Export PDF'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* DUA accepted confirmation pill */}
        {duaAccepted && isDoctor && (
          <View style={styles.duaAcceptedPill}>
            <CheckCircle size={13} color={THEME.success} />
            <Text style={styles.duaAcceptedText}>DUA accepted for this session</Text>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles — Phase 4 styles carried forward + Pillar C/F additions
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: THEME.background },
  header:        { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, backgroundColor: '#ffffffcc' },
  backButton:    { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  brand:         { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandText:     { fontSize: 18, fontWeight: '900', color: THEME.primary, letterSpacing: -0.5 },
  scrollContent: { padding: 16, paddingBottom: 48 },

  titleSection:  { paddingVertical: 20, paddingHorizontal: 4, gap: 8 },
  caseId:        { fontSize: 12, fontWeight: '600', color: THEME.primary, letterSpacing: 2 },
  title:         { fontSize: 32, fontWeight: '800', color: THEME.text, letterSpacing: -1 },
  riskPill:      { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 99 },
  riskPillText:  { fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },

  card: {
    backgroundColor: THEME.surface, borderRadius: 20, padding: 20, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2, gap: 12,
  },
  visualCard: {
    backgroundColor: THEME.surface, borderRadius: 20, padding: 20, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2, gap: 8,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle:  { fontSize: 15, fontWeight: '800', color: THEME.text },

  summaryText:   { fontSize: 14, color: THEME.textSecondary, lineHeight: 22 },
  urgencyRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f0f2f4' },
  urgencyLabel:  { fontSize: 11, fontWeight: '700', color: THEME.textSecondary, letterSpacing: 1 },
  urgencyValue:  { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },

  visualSub:    { fontSize: 12, color: THEME.textSecondary },
  svgContainer: { borderRadius: 16, overflow: 'hidden', position: 'relative' },
  imgBadge:     { position: 'absolute', top: 10, left: 10, backgroundColor: '#00000066', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  imgBadgeText: { color: '#ffffff', fontSize: 8, fontWeight: '800', letterSpacing: 1.2 },

  gaugeWrap:     { alignItems: 'center', gap: 6 },
  gaugePill:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  gaugePillText: { fontSize: 11, fontWeight: '700' },

  blastScoreRow:   { flexDirection: 'row', justifyContent: 'space-between' },
  blastScoreBox:   { flex: 1, alignItems: 'center', gap: 2, padding: 6 },
  blastScoreBig:   { fontSize: 22, fontWeight: '900' },
  blastScoreLabel: { fontSize: 9, fontWeight: '700', color: THEME.textSecondary, letterSpacing: 0.8, textAlign: 'center' },
  blastAlert:      { flexDirection: 'row', gap: 8, backgroundColor: THEME.errorBg, borderRadius: 10, padding: 10, alignItems: 'flex-start' },
  blastAlertText:  { flex: 1, fontSize: 11, color: THEME.error, lineHeight: 16 },

  xaiTableHeader:    { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#eceef0' },
  xaiHeaderCell:     { fontSize: 9, fontWeight: '800', color: THEME.textSecondary, letterSpacing: 0.8 },
  xaiTableRow:       { flexDirection: 'row', paddingVertical: 8, alignItems: 'center' },
  xaiTableRowAlt:    { backgroundColor: '#f7f9fb', borderRadius: 8 },
  xaiCell:           { fontSize: 12 },
  xaiProbBar:        { flexDirection: 'row', alignItems: 'center', gap: 6 },
  xaiProbBarInner:   { flex: 1, height: 6, backgroundColor: '#eceef0', borderRadius: 3, overflow: 'hidden' },
  xaiProbFill:       { height: '100%', borderRadius: 3 },
  xaiProbText:       { fontSize: 11, fontWeight: '800', minWidth: 36, textAlign: 'right' },
  xaiStatusPill:     { flexDirection: 'row' },
  xaiStatusPillInner:{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  xaiStatusText:     { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },

  trendSubtitle:        { fontSize: 12, color: THEME.textSecondary, marginTop: -4 },
  trendSection:         { gap: 6, marginTop: 4 },
  trendLabelRow:        { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trendDot:             { width: 8, height: 8, borderRadius: 4 },
  trendLabel:           { fontSize: 12, fontWeight: '700', color: THEME.text },
  trendUnit:            { fontSize: 10, fontWeight: '400', color: THEME.textSecondary },
  chartPlaceholder:     { alignItems: 'center', justifyContent: 'center', backgroundColor: '#f7f9fb', borderRadius: 10 },
  chartPlaceholderText: { fontSize: 12, color: THEME.textSecondary },

  tableHeader:     { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#eceef0' },
  tableHeaderCell: { fontSize: 9, fontWeight: '800', color: THEME.textSecondary, letterSpacing: 0.8 },
  tableRow:        { flexDirection: 'row', paddingVertical: 10, alignItems: 'center' },
  tableRowAlt:     { backgroundColor: '#f7f9fb', borderRadius: 8 },
  tableCell:       { fontSize: 12, color: THEME.textSecondary },
  statusPill:      { flexDirection: 'row' },
  statusPillInner: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  statusPillText:  { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },

  conditionCard:        { backgroundColor: '#f7f9fb', borderRadius: 12, padding: 14, gap: 6, borderLeftWidth: 3, borderLeftColor: THEME.primary, marginBottom: 4 },
  conditionTop:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  conditionName:        { flex: 1, fontSize: 14, fontWeight: '700', color: THEME.text },
  likelihoodBadge:      { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  likelihoodText:       { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  conditionExplanation: { fontSize: 13, color: THEME.textSecondary, lineHeight: 19 },
  icdCode:              { fontSize: 11, color: THEME.primary, fontWeight: '600' },

  recRow:        { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  recBullet:     { width: 22, height: 22, borderRadius: 11, backgroundColor: THEME.primary, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  recBulletText: { fontSize: 10, fontWeight: '900', color: '#fff' },
  recText:       { flex: 1, fontSize: 13, color: THEME.textSecondary, lineHeight: 19 },

  metaCard:  { backgroundColor: '#f2f4f6', borderRadius: 20, padding: 20, marginBottom: 16 },
  metaTitle: { fontSize: 15, fontWeight: '800', color: THEME.text, marginBottom: 14 },
  metaGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  metaItem:  { width: '45%', gap: 2 },
  metaLabel: { fontSize: 9, fontWeight: '700', color: THEME.textSecondary, letterSpacing: 1.5 },
  metaValue: { fontSize: 13, fontWeight: '700', color: THEME.text },

  disclaimerBox:  { backgroundColor: THEME.amberBg, borderRadius: 14, padding: 16, borderLeftWidth: 3, borderLeftColor: THEME.amberBorder, marginBottom: 20, gap: 4 },
  disclaimerText: { fontSize: 12, color: THEME.amber, lineHeight: 18 },

  actionsRow:          { flexDirection: 'row', gap: 12, marginBottom: 8 },
  actionButton:        { flex: 1, height: 52, borderRadius: 16, backgroundColor: THEME.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionButtonOutline: { backgroundColor: 'transparent', borderWidth: 2, borderColor: THEME.primary },
  actionButtonDisabled:{ opacity: 0.5 },
  actionButtonText:    { fontSize: 14, fontWeight: '700', color: '#ffffff' },

  // ── Pillar F: DUA accepted pill ──────────────────────────────────────────
  duaAcceptedPill: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginBottom: 16 },
  duaAcceptedText: { fontSize: 11, color: THEME.success, fontWeight: '600' },

  // ── Pillar C: biometric lock overlay ─────────────────────────────────────
  bioLockOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 16, backgroundColor: THEME.background },
  bioLockTitle:   { fontSize: 22, fontWeight: '800', color: THEME.text },
  bioLockDesc:    { fontSize: 14, color: THEME.textSecondary, textAlign: 'center', lineHeight: 20 },
  bioLockBtn:     { marginTop: 8, height: 52, paddingHorizontal: 32, borderRadius: 16, backgroundColor: THEME.primary, alignItems: 'center', justifyContent: 'center' },
  bioLockBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  errorState:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  errorStateTitle: { fontSize: 20, fontWeight: '700', color: THEME.text },
  errorStateDesc:  { fontSize: 14, color: THEME.textSecondary, textAlign: 'center', lineHeight: 20 },
});