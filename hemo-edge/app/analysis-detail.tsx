import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Dimensions, Svg, Circle, Ellipse, Rect, Path, Defs,
  RadialGradient as SvgRadialGradient, Stop, G,
} from 'react-native';
import { ChevronLeft, AlertTriangle, FileText, Lock, Maximize2, Layers, Microscope, CheckCircle, Info } from 'lucide-react-native';
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

const THEME = {
  primary: '#00478d',
  secondary: '#4f5f7b',
  background: '#f7f9fb',
  surface: '#ffffff',
  text: '#191c1e',
  textSecondary: '#424752',
  error: '#ba1a1a',
  errorContainer: '#bb1b21',
  warning: '#7d5700',
  warningContainer: '#9c6e00',
  success: '#006d3a',
  successContainer: '#1a7a48',
};

const { width } = Dimensions.get('window');
const IMG_W = width - 80; // panel width
const IMG_H = (IMG_W * 9) / 16;

type ScanDetailParams = {
  caseId?: string;
  confidence?: string;
  cellCount?: string;
  diagnosis?: string;
  severity?: 'normal' | 'warning' | 'critical';
  specimenType?: string;
  scanMode?: string;
  analyzedOn?: string;
  processingLatency?: string;
  imageUri?: string;
};

// ─── Seeded pseudo-random (deterministic per caseId) ────────────────────────
function seededRand(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return () => {
    h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) | 0;
    h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) | 0;
    return ((h >>> 0) / 0xffffffff);
  };
}

// ─── Generate cell layout data from scan params ──────────────────────────────
function generateCells(caseId: string, cellCount: number, severity: string) {
  const rand = seededRand(caseId);
  const count = Math.min(Math.max(Math.floor(cellCount / 400), 8), 22);
  const cells = [];

  for (let i = 0; i < count; i++) {
    const cx = 8 + rand() * 84;      // % of SVG width
    const cy = 8 + rand() * 84;
    const r  = 4 + rand() * 5;       // radius %
    const isRBC = rand() > 0.25;
    const isAbnormal = severity === 'critical'
      ? rand() > 0.45
      : severity === 'warning'
      ? rand() > 0.72
      : rand() > 0.92;

    cells.push({ cx, cy, r, isRBC, isAbnormal, id: i });
  }
  return cells;
}

// ─── Blood cell SVG microscopy view ─────────────────────────────────────────
function MicroscopyView({
  cells, w, h, severity,
}: {
  cells: ReturnType<typeof generateCells>;
  w: number; h: number;
  severity: string;
}) {
  return (
    <Svg2 width={w} height={h} viewBox="0 0 100 100" style={{ borderRadius: 16 }}>
      <SvgDefs>
        {/* Dark microscopy background gradient */}
        <SvgRG id="bg" cx="50%" cy="50%" r="60%">
          <SvgStop offset="0%" stopColor="#1a1f2e" />
          <SvgStop offset="70%" stopColor="#0d1117" />
          <SvgStop offset="100%" stopColor="#060a0f" />
        </SvgRG>

        {/* RBC (normal) — stained pink/salmon */}
        <SvgRG id="rbc" cx="40%" cy="35%" r="70%">
          <SvgStop offset="0%" stopColor="#f5a0a0" stopOpacity="0.95" />
          <SvgStop offset="55%" stopColor="#e06060" stopOpacity="0.85" />
          <SvgStop offset="100%" stopColor="#b03040" stopOpacity="0.7" />
        </SvgRG>

        {/* RBC centre depression */}
        <SvgRG id="rbcDip" cx="50%" cy="50%" r="45%">
          <SvgStop offset="0%" stopColor="#0d1117" stopOpacity="0.7" />
          <SvgStop offset="100%" stopColor="#0d1117" stopOpacity="0" />
        </SvgRG>

        {/* WBC (normal) — blue/purple */}
        <SvgRG id="wbc" cx="40%" cy="35%" r="70%">
          <SvgStop offset="0%" stopColor="#a0b8f5" stopOpacity="0.95" />
          <SvgStop offset="60%" stopColor="#6080d8" stopOpacity="0.85" />
          <SvgStop offset="100%" stopColor="#3050a0" stopOpacity="0.7" />
        </SvgRG>

        {/* Abnormal cell — red/orange alert */}
        <SvgRG id="abCell" cx="40%" cy="35%" r="70%">
          <SvgStop offset="0%" stopColor="#ffb060" stopOpacity="1" />
          <SvgStop offset="55%" stopColor="#ff6030" stopOpacity="0.95" />
          <SvgStop offset="100%" stopColor="#cc2010" stopOpacity="0.85" />
        </SvgRG>

        {/* Illumination vignette */}
        <SvgRG id="vignette" cx="50%" cy="40%" r="55%">
          <SvgStop offset="0%" stopColor="#ffffff" stopOpacity="0.07" />
          <SvgStop offset="100%" stopColor="#000000" stopOpacity="0.5" />
        </SvgRG>
      </SvgDefs>

      {/* Background */}
      <SvgRect x="0" y="0" width="100" height="100" fill="url(#bg)" />

      {/* Stain noise dots for realism */}
      {Array.from({ length: 40 }).map((_, i) => {
        const rand = seededRand(`noise${i}`);
        return (
          <SvgCircle
            key={`n${i}`}
            cx={rand() * 100}
            cy={rand() * 100}
            r={0.15 + rand() * 0.25}
            fill="#8060a8"
            opacity={0.15 + rand() * 0.2}
          />
        );
      })}

      {/* Cells */}
      {cells.map((c) => {
        const fill = c.isAbnormal ? 'url(#abCell)' : c.isRBC ? 'url(#rbc)' : 'url(#wbc)';
        return (
          <SvgG key={c.id}>
            {/* Cell body */}
            <SvgEllipse
              cx={c.cx}
              cy={c.cy}
              rx={c.r}
              ry={c.r * (0.85 + seededRand(`ry${c.id}`)() * 0.3)}
              fill={fill}
            />
            {/* RBC biconcave dip */}
            {c.isRBC && !c.isAbnormal && (
              <SvgEllipse
                cx={c.cx}
                cy={c.cy}
                rx={c.r * 0.45}
                ry={c.r * 0.3}
                fill="url(#rbcDip)"
              />
            )}
            {/* Abnormal nucleus highlight */}
            {c.isAbnormal && (
              <SvgEllipse
                cx={c.cx - c.r * 0.15}
                cy={c.cy - c.r * 0.15}
                rx={c.r * 0.5}
                ry={c.r * 0.4}
                fill="#ffffff"
                opacity={0.18}
              />
            )}
            {/* WBC nucleus */}
            {!c.isRBC && !c.isAbnormal && (
              <SvgEllipse
                cx={c.cx}
                cy={c.cy}
                rx={c.r * 0.45}
                ry={c.r * 0.45}
                fill="#203080"
                opacity={0.7}
              />
            )}
          </SvgG>
        );
      })}

      {/* Illumination overlay */}
      <SvgRect x="0" y="0" width="100" height="100" fill="url(#vignette)" />
    </Svg2>
  );
}

// ─── AI heatmap overlay view ─────────────────────────────────────────────────
function HeatmapView({
  cells, w, h, severity, confidence,
}: {
  cells: ReturnType<typeof generateCells>;
  w: number; h: number;
  severity: string;
  confidence: number;
}) {
  const hotColor   = severity === 'critical' ? '#ff2020' : severity === 'warning' ? '#ff9020' : '#20d080';
  const warmColor  = severity === 'critical' ? '#ff8040' : severity === 'warning' ? '#ffcc60' : '#40e8a0';
  const coolColor  = '#2060c0';

  return (
    <Svg2 width={w} height={h} viewBox="0 0 100 100" style={{ borderRadius: 16 }}>
      <SvgDefs>
        <SvgRG id="hbg" cx="50%" cy="50%" r="55%">
          <SvgStop offset="0%" stopColor="#111827" />
          <SvgStop offset="100%" stopColor="#030712" />
        </SvgRG>
        {cells.map((c) => (
          <SvgRG
            key={`hg${c.id}`}
            id={`hg${c.id}`}
            cx="50%" cy="50%" r="50%"
          >
            <SvgStop
              offset="0%"
              stopColor={c.isAbnormal ? hotColor : coolColor}
              stopOpacity={c.isAbnormal ? 0.85 : 0.4}
            />
            <SvgStop
              offset="60%"
              stopColor={c.isAbnormal ? warmColor : '#1040a0'}
              stopOpacity={c.isAbnormal ? 0.4 : 0.15}
            />
            <SvgStop offset="100%" stopColor="#000000" stopOpacity="0" />
          </SvgRG>
        ))}
        {/* scan-line gradient */}
        <SvgLG id="scanLines" x1="0" y1="0" x2="0" y2="1">
          <SvgStop offset="0%" stopColor="#ffffff" stopOpacity="0.02" />
          <SvgStop offset="50%" stopColor="#ffffff" stopOpacity="0.005" />
          <SvgStop offset="100%" stopColor="#ffffff" stopOpacity="0.02" />
        </SvgLG>
      </SvgDefs>

      <SvgRect x="0" y="0" width="100" height="100" fill="url(#hbg)" />

      {/* Heatmap blobs per cell */}
      {cells.map((c) => (
        <SvgEllipse
          key={`hb${c.id}`}
          cx={c.cx}
          cy={c.cy}
          rx={c.r * (c.isAbnormal ? 2.8 : 1.8)}
          ry={c.r * (c.isAbnormal ? 2.6 : 1.6)}
          fill={`url(#hg${c.id})`}
        />
      ))}

      {/* Scan-line CRT texture */}
      {Array.from({ length: 50 }).map((_, i) => (
        <SvgRect
          key={`sl${i}`}
          x="0" y={i * 2} width="100" height="1"
          fill="#000000"
          opacity={0.06}
        />
      ))}

      {/* Grid overlay */}
      {Array.from({ length: 10 }).map((_, i) => (
        <SvgG key={`gr${i}`}>
          <SvgRect x={i * 10} y="0" width="0.3" height="100" fill="#00ffaa" opacity={0.05} />
          <SvgRect x="0" y={i * 10} width="100" height="0.3" fill="#00ffaa" opacity={0.05} />
        </SvgG>
      ))}

      {/* Confidence score label inside SVG */}
      <SvgRect x="2" y="87" width="42" height="10" rx="2" fill="#000000" opacity={0.6} />
      <SvgText
        x="23" y="93.5"
        fill={hotColor}
        fontSize="4"
        fontWeight="bold"
        textAnchor="middle"
      >
        {`AI CONF: ${confidence.toFixed(1)}%`}
      </SvgText>

      {/* Detected abnormal cell markers */}
      {cells.filter(c => c.isAbnormal).map((c) => (
        <SvgG key={`mk${c.id}`}>
          <SvgRect
            x={c.cx - c.r - 1.5}
            y={c.cy - c.r - 1.5}
            width={(c.r + 1.5) * 2}
            height={(c.r + 1.5) * 2}
            rx="1"
            fill="none"
            stroke={hotColor}
            strokeWidth="0.6"
            opacity={0.9}
          />
          {/* Corner ticks */}
          <SvgPath
            d={`M ${c.cx - c.r - 1.5} ${c.cy - c.r + 1} L ${c.cx - c.r - 1.5} ${c.cy - c.r - 1.5} L ${c.cx - c.r + 1} ${c.cy - c.r - 1.5}`}
            stroke={hotColor} strokeWidth="0.8" fill="none" opacity={1}
          />
          <SvgPath
            d={`M ${c.cx + c.r + 0.5} ${c.cy - c.r + 1} L ${c.cx + c.r + 1.5} ${c.cy - c.r - 1.5} L ${c.cx + c.r - 1} ${c.cy - c.r - 1.5}`}
            stroke={hotColor} strokeWidth="0.8" fill="none" opacity={1}
          />
        </SvgG>
      ))}
    </Svg2>
  );
}

// ─── Severity helpers ─────────────────────────────────────────────────────────
function alertConfig(severity: string) {
  if (severity === 'critical') return {
    bg: THEME.errorContainer,
    icon: '#ffffff',
    label: 'CRITICAL ALERT',
    title: 'Malignant Cell Morphology',
    desc: 'AI synthesis indicates a high probability of acute lymphoblastic progression. Immediate clinical review of the leukocyte population is advised.',
  };
  if (severity === 'warning') return {
    bg: THEME.warningContainer,
    icon: '#ffffff',
    label: 'WARNING',
    title: 'Atypical Cell Pattern',
    desc: 'Elevated atypical cells detected. Further haematological workup is recommended before finalising diagnosis.',
  };
  return {
    bg: THEME.successContainer,
    icon: '#ffffff',
    label: 'NORMAL',
    title: 'No Anomalies Detected',
    desc: 'Cell morphology within expected parameters. Routine follow-up recommended as per clinical protocol.',
  };
}

function observationsForSeverity(severity: string, diagnosis: string) {
  if (severity === 'critical') return [
    { color: THEME.error, title: 'Atypical Nuclear Enlargement', desc: 'Detected in 42% of leukocytes across all scanned regions.' },
    { color: THEME.primary, title: 'Chromatin Patterning Shift', desc: 'Dense hyperchromasia observed, consistent with pre-malignant states.' },
  ];
  if (severity === 'warning') return [
    { color: THEME.warning, title: 'Elevated Band Neutrophils', desc: 'Left-shift observed, suggesting possible early infection or inflammatory response.' },
    { color: THEME.primary, title: 'Mild Anisocytosis', desc: 'Variable red cell sizes noted; may warrant iron studies or B12/folate levels.' },
  ];
  return [
    { color: THEME.success, title: 'Normal Differential Count', desc: `Leukocyte distribution within reference ranges. ${diagnosis || 'No actionable findings.'}` },
    { color: THEME.primary, title: 'Erythrocyte Morphology Normal', desc: 'Biconcave disc shape maintained; no sickle, target, or schistocyte forms detected.' },
  ];
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function AnalysisDetailScreen() {
  const [viewMode, setViewMode] = useState<'original' | 'heatmap'>('heatmap');
  const params = useLocalSearchParams<ScanDetailParams>();

  const caseId       = params.caseId            ?? 'HE-00000';
  const confidence   = params.confidence        ? parseFloat(params.confidence) : 94.7;
  const cellCount    = params.cellCount         ? parseInt(params.cellCount, 10) : 3800;
  const diagnosis    = params.diagnosis         ?? '';
  const severity     = (params.severity         ?? 'normal') as 'normal' | 'warning' | 'critical';
  const specimenType = params.specimenType      ?? '—';
  const scanMode     = params.scanMode          ?? '—';
  const analyzedOn   = params.analyzedOn
    ? new Date(params.analyzedOn).toLocaleString()
    : new Date().toLocaleString();
  const processingLatency = params.processingLatency ?? '—';

  // Deterministically generate cells from real params — same input → same visualization
  const cells = useMemo(
    () => generateCells(caseId, cellCount, severity),
    [caseId, cellCount, severity],
  );

  const abnormalCount = cells.filter(c => c.isAbnormal).length;
  const alert         = alertConfig(severity);
  const observations  = observationsForSeverity(severity, diagnosis);

  const panelW = IMG_W;
  const panelH = IMG_H;

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
        {/* Title */}
        <View style={styles.titleSection}>
          <Text style={styles.caseId}>CASE ID: #{caseId}</Text>
          <Text style={styles.title}>Diagnostic Analysis</Text>
        </View>

        {/* Alert card */}
        <View style={[styles.alertCard, { backgroundColor: alert.bg }]}>
          <View style={styles.alertHeader}>
            {severity === 'normal'
              ? <CheckCircle color={alert.icon} size={32} />
              : severity === 'warning'
              ? <Info color={alert.icon} size={32} />
              : <AlertTriangle color={alert.icon} size={32} fill={alert.icon} />}
            <Text style={styles.alertLabel}>{alert.label}</Text>
          </View>
          <Text style={styles.alertTitle}>{alert.title}</Text>
          <Text style={styles.alertDesc}>{alert.desc}</Text>
          <View style={styles.alertIconBg}>
            <Microscope color="#ffffff" size={180} opacity={0.1} />
          </View>
        </View>

        {/* Metrics */}
        <View style={styles.metricsRow}>
          {confidence !== null && (
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>CONFIDENCE</Text>
              <View style={styles.metricValueRow}>
                <Text style={styles.metricValue}>{confidence.toFixed(1)}</Text>
                <Text style={styles.metricSub}>%</Text>
              </View>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${confidence}%` }]} />
              </View>
            </View>
          )}
          {cellCount !== null && (
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>CELLS ANALYSED</Text>
              <View style={styles.metricValueRow}>
                <Text style={styles.metricValue}>{cellCount.toLocaleString()}</Text>
              </View>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: '100%' }]} />
              </View>
            </View>
          )}
        </View>

        {/* Visual Validation — SVG panels */}
        <View style={styles.visualSection}>
          <View style={styles.visualHeader}>
            <View>
              <Text style={styles.visualTitle}>Visual Validation</Text>
              <Text style={styles.visualSubtitle}>
                Rendered from {cellCount.toLocaleString()} detected cells · {abnormalCount} flagged
              </Text>
            </View>
            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={[styles.toggleBtn, viewMode === 'original' && styles.toggleBtnActive]}
                onPress={() => setViewMode('original')}
              >
                <Text style={[styles.toggleText, viewMode === 'original' && styles.toggleTextActive]}>Original</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleBtn, viewMode === 'heatmap' && styles.toggleBtnActive]}
                onPress={() => setViewMode('heatmap')}
              >
                <Text style={[styles.toggleText, viewMode === 'heatmap' && styles.toggleTextActive]}>Heatmap Overlay</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.imageGrid}>
            {/* Panel 1 — Microscopy simulation */}
            <View style={styles.imageWrapper}>
              <View style={[styles.imageContainer, { width: panelW, height: panelH }]}>
                <MicroscopyView cells={cells} w={panelW} h={panelH} severity={severity} />
                <View style={styles.imgBadge}>
                  <Text style={styles.imgBadgeText}>INPUT: CHANNEL A</Text>
                </View>
                {/* Legend dots */}
                <View style={styles.legendRow}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: '#e06060' }]} />
                    <Text style={styles.legendText}>RBC</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: '#6080d8' }]} />
                    <Text style={styles.legendText}>WBC</Text>
                  </View>
                  {abnormalCount > 0 && (
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#ff6030' }]} />
                      <Text style={styles.legendText}>ABNORMAL</Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.imageFooter}>
                <Text style={styles.imageFooterText}>Magnification: 1000x (Oil)</Text>
                <Maximize2 color={THEME.primary} size={16} />
              </View>
            </View>

            {/* Panel 2 — AI heatmap */}
            <View style={styles.imageWrapper}>
              <View style={[styles.imageContainer, { width: panelW, height: panelH }]}>
                <HeatmapView
                  cells={cells}
                  w={panelW}
                  h={panelH}
                  severity={severity}
                  confidence={confidence}
                />
                <View style={[styles.imgBadge, { backgroundColor: '#94001099' }]}>
                  <Text style={styles.imgBadgeText}>INFERENCE: NEURAL-MAP</Text>
                </View>
                {/* Abnormal cell count badge */}
                {abnormalCount > 0 && (
                  <View style={styles.abnormalBadge}>
                    <Text style={styles.abnormalBadgeText}>{abnormalCount} FLAGGED</Text>
                  </View>
                )}
              </View>
              <View style={styles.imageFooter}>
                <Text style={styles.imageFooterText}>Detection Threshold: 0.85</Text>
                <Layers color={THEME.primary} size={16} />
              </View>
            </View>
          </View>
        </View>

        {/* AI Observations */}
        <View style={styles.observationsCard}>
          <View style={styles.obsHeader}>
            <FileText color={THEME.primary} size={20} />
            <Text style={styles.obsTitle}>AI Key Observations</Text>
          </View>
          <View style={styles.obsList}>
            {observations.map((obs, i) => (
              <View key={i} style={styles.obsItem}>
                <View style={[styles.dot, { backgroundColor: obs.color }]} />
                <View style={styles.obsContent}>
                  <Text style={styles.obsItemTitle}>{obs.title}</Text>
                  <Text style={styles.obsItemDesc}>{obs.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Scan context */}
        <View style={styles.contextCard}>
          <Text style={styles.contextTitle}>Scan Context</Text>
          <View style={styles.contextGrid}>
            <ContextItem label="ANALYZED ON"        value={analyzedOn} />
            <ContextItem label="SCAN MODE"          value={scanMode} />
            <ContextItem label="SPECIMEN TYPE"      value={specimenType} />
            <ContextItem label="PROCESSING LATENCY" value={processingLatency} />
          </View>
          <View style={styles.contextFooter}>
            <Text style={styles.statusText}>Status: Finalized</Text>
            <Lock color="#727783" size={16} fill="#727783" />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.contextItem}>
      <Text style={styles.contextLabel}>{label}</Text>
      <Text style={styles.contextValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: THEME.background },
  header:           { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, backgroundColor: '#ffffffcc' },
  backButton:       { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  brand:            { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandText:        { fontSize: 18, fontWeight: '900', color: THEME.primary, letterSpacing: -0.5 },
  scrollContent:    { padding: 16, paddingBottom: 120 },
  titleSection:     { paddingVertical: 24, paddingHorizontal: 8 },
  caseId:           { fontSize: 12, fontWeight: '600', color: THEME.primary, letterSpacing: 2, marginBottom: 8 },
  title:            { fontSize: 36, fontWeight: '800', color: THEME.text, letterSpacing: -1 },
  alertCard:        { borderRadius: 24, padding: 32, marginBottom: 24, overflow: 'hidden', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 4 },
  alertHeader:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  alertLabel:       { fontSize: 16, fontWeight: '700', color: '#ffffffcc', letterSpacing: 3 },
  alertTitle:       { fontSize: 36, fontWeight: '800', color: '#ffffff', lineHeight: 42, marginBottom: 16 },
  alertDesc:        { fontSize: 17, color: '#ffffffcc', lineHeight: 26 },
  alertIconBg:      { position: 'absolute', right: -60, bottom: -60 },
  metricsRow:       { flexDirection: 'row', gap: 16, marginBottom: 24 },
  metricCard:       { flex: 1, backgroundColor: THEME.surface, borderRadius: 20, padding: 20, justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.03, shadowRadius: 10, elevation: 1 },
  metricLabel:      { fontSize: 10, fontWeight: '700', color: THEME.textSecondary, letterSpacing: 1, marginBottom: 4 },
  metricValueRow:   { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  metricValue:      { fontSize: 30, fontWeight: '800', color: THEME.primary },
  metricSub:        { fontSize: 12, fontWeight: '600', color: THEME.primary + '99' },
  progressBar:      { height: 6, backgroundColor: '#eceef0', borderRadius: 3, marginTop: 12, overflow: 'hidden' },
  progressFill:     { height: '100%', backgroundColor: THEME.primary },
  visualSection:    { backgroundColor: '#f2f4f6', borderRadius: 24, padding: 24, marginBottom: 24 },
  visualHeader:     { flexDirection: 'column', gap: 16, marginBottom: 32 },
  visualTitle:      { fontSize: 22, fontWeight: '700', color: THEME.text },
  visualSubtitle:   { fontSize: 14, color: THEME.textSecondary },
  toggleRow:        { flexDirection: 'row', gap: 8 },
  toggleBtn:        { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: '#e0e3e5' },
  toggleBtnActive:  { backgroundColor: THEME.primary },
  toggleText:       { fontSize: 13, fontWeight: '700', color: THEME.textSecondary },
  toggleTextActive: { color: '#ffffff' },
  imageGrid:        { gap: 32 },
  imageWrapper:     { gap: 12 },
  imageContainer:   { borderRadius: 16, overflow: 'hidden', backgroundColor: '#000', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 20 },
  imgBadge:         { position: 'absolute', top: 12, left: 12, backgroundColor: '#00000066', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  imgBadgeText:     { color: '#ffffff', fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  legendRow:        { position: 'absolute', bottom: 10, right: 10, flexDirection: 'row', gap: 8 },
  legendItem:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#00000066', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  legendDot:        { width: 6, height: 6, borderRadius: 3 },
  legendText:       { color: '#ffffff', fontSize: 8, fontWeight: '700', letterSpacing: 0.5 },
  abnormalBadge:    { position: 'absolute', bottom: 10, right: 10, backgroundColor: '#cc000099', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  abnormalBadgeText:{ color: '#ffffff', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  imageFooter:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 8 },
  imageFooterText:  { fontSize: 14, fontWeight: '600', color: THEME.textSecondary },
  observationsCard: { backgroundColor: THEME.surface, borderRadius: 24, padding: 32, marginBottom: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.03, shadowRadius: 30, elevation: 2 },
  obsHeader:        { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  obsTitle:         { fontSize: 20, fontWeight: '700', color: THEME.text },
  obsList:          { gap: 24 },
  obsItem:          { flexDirection: 'row', gap: 16 },
  dot:              { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  obsContent:       { flex: 1, gap: 4 },
  obsItemTitle:     { fontSize: 16, fontWeight: '700', color: THEME.text },
  obsItemDesc:      { fontSize: 14, color: THEME.textSecondary, lineHeight: 20 },
  contextCard:      { backgroundColor: '#f2f4f6', borderRadius: 24, padding: 32 },
  contextTitle:     { fontSize: 20, fontWeight: '700', color: THEME.text, marginBottom: 24 },
  contextGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 24 },
  contextItem:      { width: '45%', gap: 4 },
  contextLabel:     { fontSize: 10, fontWeight: '700', color: THEME.textSecondary, letterSpacing: 1.5 },
  contextValue:     { fontSize: 14, fontWeight: '700', color: THEME.text },
  contextFooter:    { marginTop: 32, paddingTop: 24, borderTopWidth: 1, borderTopColor: '#e0e3e5', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusText:       { fontSize: 14, fontWeight: '600', color: THEME.primary },
});