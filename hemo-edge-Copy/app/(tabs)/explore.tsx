// FILE: app/(tabs)/explore.tsx
// Enhanced Diagnostic History — Firestore real-time, RBAC, search, date grouping, sparklines
import React, { useState, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ScrollView, Dimensions, ActivityIndicator,
} from 'react-native';
import { Svg as SvgView, Polyline, Circle } from 'react-native-svg';
import { router } from 'expo-router';
import {
  Search, Microscope, FileText,
  CheckCircle, Clock, User, X, TrendingUp,
  TrendingDown, Minus, ChevronRight, Calendar,
  AlertCircle, Activity,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  collection, query, where, orderBy, onSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthContext } from '@/contexts/auth-context';
import { timestampToISO } from '@/lib/firebase';

const { width: SCREEN_W } = Dimensions.get('window');

const THEME = {
  primary:        '#00478d',
  primaryLight:   '#e8f0fb',
  secondary:      '#4f5f7b',
  background:     '#f7f9fb',
  surface:        '#ffffff',
  text:           '#191c1e',
  textSecondary:  '#424752',
  border:         '#e0e3e5',
  cardBg:         '#f2f4f6',
  error:          '#ba1a1a',
  errorLight:     '#ffdad6',
  warning:        '#7d5700',
  warningLight:   '#fff3cd',
  success:        '#006d3a',
  successLight:   '#dcfce7',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Scan record type
// ─────────────────────────────────────────────────────────────────────────────
type ScanRecord = {
  id:               string;
  caseId:           string;
  title:            string;
  subtitle:         string;
  time:             string;
  dateLabel:        string;
  risk:             string;
  icon:             string;
  blastProbability: number;
  summary:          string;
  wbcHistory:       number[];
  rbcHistory:       number[];
};

// ─────────────────────────────────────────────────────────────────────────────
//  Helper: format Firestore timestamp → "HH:MM AM/PM" and date label
// ─────────────────────────────────────────────────────────────────────────────
function formatDateLabel(isoString: string): string {
  const date  = new Date(isoString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString())     return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sparkline component
// ─────────────────────────────────────────────────────────────────────────────
function Sparkline({ values, color, w = 56, h = 24 }: {
  values: number[]; color: string; w?: number; h?: number;
}) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const xStep = w / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * xStep;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  const lastX = (values.length - 1) * xStep;
  const lastY = h - ((values[values.length - 1] - min) / range) * (h - 4) - 2;
  const trend = values[values.length - 1] - values[0];

  return (
    <View style={{ width: w, height: h + 12 }}>
      <SvgView width={w} height={h}>
        <Polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        <Circle cx={lastX} cy={lastY} r="2.5" fill={color} />
      </SvgView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 }}>
        {trend > 0.3
          ? <TrendingUp size={8} color={THEME.error} />
          : trend < -0.3
          ? <TrendingDown size={8} color={THEME.success} />
          : <Minus size={8} color={THEME.textSecondary} />}
        <Text style={{ fontSize: 9, fontWeight: '700', color }}>{values[values.length - 1].toFixed(1)}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Blast probability bar
// ─────────────────────────────────────────────────────────────────────────────
function BlastBar({ probability }: { probability: number }) {
  const pct   = Math.round(probability * 100);
  const color = probability >= 0.7 ? THEME.error : probability >= 0.4 ? THEME.warning : THEME.success;
  return (
    <View style={blastStyles.wrap}>
      <Text style={blastStyles.label}>Blast</Text>
      <View style={blastStyles.track}>
        <View style={[blastStyles.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[blastStyles.pct, { color }]}>{pct}%</Text>
    </View>
  );
}

const blastStyles = StyleSheet.create({
  wrap:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 9, fontWeight: '700', color: THEME.textSecondary, width: 28 },
  track: { flex: 1, height: 3, backgroundColor: '#e0e3e5', borderRadius: 2, overflow: 'hidden' },
  fill:  { height: 3, borderRadius: 2 },
  pct:   { fontSize: 10, fontWeight: '800', width: 28, textAlign: 'right' },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Summary stats bar
// ─────────────────────────────────────────────────────────────────────────────
function SummaryBar({ scans }: { scans: ScanRecord[] }) {
  const critical = scans.filter(s => s.risk === 'critical').length;
  const moderate = scans.filter(s => s.risk === 'moderate').length;
  const normal   = scans.filter(s => s.risk === 'low').length;
  return (
    <View style={sumStyles.wrap}>
      <View style={sumStyles.item}>
        <Text style={[sumStyles.value, { color: THEME.error }]}>{critical}</Text>
        <Text style={sumStyles.label}>Critical</Text>
      </View>
      <View style={sumStyles.sep} />
      <View style={sumStyles.item}>
        <Text style={[sumStyles.value, { color: THEME.warning }]}>{moderate}</Text>
        <Text style={sumStyles.label}>Moderate</Text>
      </View>
      <View style={sumStyles.sep} />
      <View style={sumStyles.item}>
        <Text style={[sumStyles.value, { color: THEME.success }]}>{normal}</Text>
        <Text style={sumStyles.label}>Normal</Text>
      </View>
      <View style={sumStyles.sep} />
      <View style={sumStyles.item}>
        <Text style={[sumStyles.value, { color: THEME.primary }]}>{scans.length}</Text>
        <Text style={sumStyles.label}>Total</Text>
      </View>
    </View>
  );
}

const sumStyles = StyleSheet.create({
  wrap:  { flexDirection: 'row', backgroundColor: THEME.surface, borderRadius: 16, padding: 14, marginBottom: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  item:  { flex: 1, alignItems: 'center', gap: 3 },
  value: { fontSize: 22, fontWeight: '900' },
  label: { fontSize: 9, fontWeight: '700', color: THEME.textSecondary, letterSpacing: 0.3 },
  sep:   { width: 1, backgroundColor: THEME.border, marginHorizontal: 2 },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Date section header
// ─────────────────────────────────────────────────────────────────────────────
function DateSection({ label, count }: { label: string; count: number }) {
  return (
    <View style={dateStyles.wrap}>
      <View style={dateStyles.line} />
      <View style={dateStyles.pill}>
        <Calendar size={9} color={THEME.textSecondary} />
        <Text style={dateStyles.text}>{label.toUpperCase()}</Text>
        <View style={dateStyles.badge}><Text style={dateStyles.badgeText}>{count}</Text></View>
      </View>
      <View style={dateStyles.line} />
    </View>
  );
}

const dateStyles = StyleSheet.create({
  wrap:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, marginTop: 4 },
  line:      { flex: 1, height: 1, backgroundColor: THEME.border },
  pill:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#eceef0', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  text:      { fontSize: 9, fontWeight: '800', color: THEME.textSecondary, letterSpacing: 0.5 },
  badge:     { backgroundColor: THEME.primary, borderRadius: 99, minWidth: 15, height: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { fontSize: 8, fontWeight: '900', color: '#fff' },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Critical card
// ─────────────────────────────────────────────────────────────────────────────
function CriticalCard({ scan }: { scan: ScanRecord }) {
  return (
    <TouchableOpacity
      style={critStyles.card}
      onPress={() => router.push({ pathname: '/analysis-detail', params: { id: scan.id } })}
      activeOpacity={0.85}
    >
      <View style={critStyles.topRow}>
        <View style={critStyles.iconWrap}>
          <Microscope color={THEME.error} size={26} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={critStyles.badgeRow}>
            <View style={critStyles.alertBadge}>
              <AlertCircle size={10} color={THEME.error} />
              <Text style={critStyles.alertBadgeText}>CRITICAL ALERT</Text>
            </View>
            <Text style={critStyles.timeText}>{scan.time}</Text>
          </View>
          <Text style={critStyles.title}>{scan.title}</Text>
          <Text style={critStyles.subtitle}>{scan.caseId} · {scan.subtitle}</Text>
        </View>
      </View>

      <BlastBar probability={scan.blastProbability} />

      <Text style={critStyles.summary} numberOfLines={2}>{scan.summary}</Text>

      <View style={critStyles.sparkRow}>
        <View style={critStyles.sparkItem}>
          <Text style={critStyles.sparkLabel}>WBC ×10⁹/L</Text>
          <Sparkline values={scan.wbcHistory} color="#3b82f6" />
        </View>
        <View style={critStyles.sparkItem}>
          <Text style={critStyles.sparkLabel}>RBC ×10¹²/L</Text>
          <Sparkline values={scan.rbcHistory} color="#ef4444" />
        </View>
      </View>

      <View style={critStyles.footer}>
        <View>
          <Text style={critStyles.footerLabel}>STATUS</Text>
          <Text style={critStyles.footerStatus}>Urgent Review</Text>
        </View>
        <View style={critStyles.viewBtn}>
          <Text style={critStyles.viewBtnText}>View Report</Text>
          <ChevronRight size={14} color="#fff" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const critStyles = StyleSheet.create({
  card:          { backgroundColor: THEME.surface, borderRadius: 24, padding: 20, borderLeftWidth: 4, borderLeftColor: THEME.error, shadowColor: '#ba1a1a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 3, gap: 12 },
  topRow:        { flexDirection: 'row', gap: 14 },
  iconWrap:      { width: 52, height: 52, borderRadius: 16, backgroundColor: THEME.errorLight, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  badgeRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  alertBadge:    { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: THEME.errorLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  alertBadgeText:{ fontSize: 10, fontWeight: '800', color: THEME.error, letterSpacing: 0.3 },
  timeText:      { fontSize: 12, color: THEME.textSecondary, fontWeight: '500' },
  title:         { fontSize: 17, fontWeight: '800', color: THEME.text, lineHeight: 22 },
  subtitle:      { fontSize: 13, color: THEME.textSecondary, marginTop: 2 },
  summary:       { fontSize: 13, color: THEME.textSecondary, lineHeight: 18 },
  sparkRow:      { flexDirection: 'row', gap: 24, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f0f1f3' },
  sparkItem:     { gap: 3 },
  sparkLabel:    { fontSize: 9, fontWeight: '800', color: THEME.textSecondary, letterSpacing: 0.3 },
  footer:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f1f3' },
  footerLabel:   { fontSize: 9, fontWeight: '800', color: THEME.textSecondary, letterSpacing: 1, marginBottom: 2 },
  footerStatus:  { fontSize: 14, fontWeight: '700', color: THEME.error },
  viewBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: THEME.primary, paddingHorizontal: 18, height: 44, borderRadius: 12 },
  viewBtnText:   { color: '#fff', fontSize: 13, fontWeight: '700' },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Standard history card
// ─────────────────────────────────────────────────────────────────────────────
function HistoryCard({ scan }: { scan: ScanRecord }) {
  const isModerate = scan.risk === 'moderate';
  const riskColor  = isModerate ? THEME.warning : THEME.success;
  const riskBg     = isModerate ? THEME.warningLight : THEME.successLight;
  const riskLabel  = isModerate ? 'MODERATE' : 'NORMAL';

  return (
    <TouchableOpacity
      style={cardStyles.card}
      onPress={() => router.push({ pathname: '/analysis-detail', params: { id: scan.id } })}
      activeOpacity={0.85}
    >
      <View style={cardStyles.topRow}>
        <View style={[cardStyles.iconWrap, { backgroundColor: isModerate ? THEME.warningLight : THEME.primaryLight }]}>
          {scan.icon === 'scope'
            ? <Microscope color={isModerate ? THEME.warning : THEME.primary} size={22} />
            : <FileText color={THEME.primary} size={22} />}
        </View>
        <View style={{ flex: 1 }}>
          <View style={cardStyles.titleRow}>
            <Text style={cardStyles.title} numberOfLines={1}>{scan.title}</Text>
            <Text style={cardStyles.time}>{scan.time}</Text>
          </View>
          <Text style={cardStyles.subtitle}>{scan.caseId} · {scan.subtitle}</Text>
        </View>
      </View>

      <BlastBar probability={scan.blastProbability} />

      <Text style={cardStyles.summary} numberOfLines={2}>{scan.summary}</Text>

      <View style={cardStyles.sparkRow}>
        <View style={cardStyles.sparkItem}>
          <Text style={cardStyles.sparkLabel}>WBC</Text>
          <Sparkline values={scan.wbcHistory} color="#3b82f6" w={48} h={20} />
        </View>
        <View style={cardStyles.sparkItem}>
          <Text style={cardStyles.sparkLabel}>RBC</Text>
          <Sparkline values={scan.rbcHistory} color="#ef4444" w={48} h={20} />
        </View>
        <View style={{ flex: 1 }} />
        <View style={[cardStyles.riskBadge, { backgroundColor: riskBg }]}>
          {isModerate
            ? <Clock size={11} color={riskColor} />
            : <CheckCircle size={11} color={riskColor} />}
          <Text style={[cardStyles.riskText, { color: riskColor }]}>{riskLabel}</Text>
        </View>
      </View>

      <View style={cardStyles.footer}>
        <Text style={cardStyles.footerText}>View full report</Text>
        <ChevronRight size={12} color={THEME.textSecondary} />
      </View>
    </TouchableOpacity>
  );
}

const cardStyles = StyleSheet.create({
  card:      { backgroundColor: THEME.surface, borderRadius: 20, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2, gap: 10 },
  topRow:    { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  iconWrap:  { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  titleRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  title:     { fontSize: 15, fontWeight: '700', color: THEME.text, flex: 1, lineHeight: 20 },
  time:      { fontSize: 11, color: THEME.textSecondary, fontWeight: '500', flexShrink: 0 },
  subtitle:  { fontSize: 12, color: THEME.textSecondary, marginTop: 2 },
  summary:   { fontSize: 12, color: THEME.textSecondary, lineHeight: 17 },
  sparkRow:  { flexDirection: 'row', alignItems: 'flex-end', gap: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f0f1f3' },
  sparkItem: { gap: 2 },
  sparkLabel:{ fontSize: 9, fontWeight: '800', color: THEME.textSecondary, letterSpacing: 0.3 },
  riskBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  riskText:  { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  footer:    { flexDirection: 'row', alignItems: 'center', gap: 2, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f0f1f3' },
  footerText:{ fontSize: 11, fontWeight: '600', color: THEME.textSecondary },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Main screen
// ─────────────────────────────────────────────────────────────────────────────
export default function HistoryScreen() {
  const { user, role } = useAuthContext();
  const isDoctor = role === 'doctor';

  const [scans,        setScans]       = useState<ScanRecord[]>([]);
  const [isLoading,    setIsLoading]   = useState(true);
  const [search,       setSearch]      = useState('');
  const [activeFilter, setFilter]      = useState<'all' | 'critical' | 'moderate' | 'normal'>('all');

  // ── Firestore real-time listener ──────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    setIsLoading(true);

    // Patients: query their own scans subcollection (matches Firestore rules).
    // Doctors: also query their own scans subcollection — cross-patient queries
    // require either collectionGroup + broad rules, or a server-side aggregator.
    // For now doctors see their own records; extend via a Cloud Function if needed.
    const scansRef = collection(db, 'scans', user.uid, 'results');
    const q = query(scansRef, orderBy('analyzedOn', 'desc'));

    const unsubscribe = onSnapshot(q, (snap) => {
      const records: ScanRecord[] = snap.docs.map(doc => {
        const d = doc.data();
        const iso = timestampToISO(d.analyzedOn ?? d.createdAt ?? new Date().toISOString());
        return {
          id:               doc.id,
          caseId:           d.caseId           ?? '',
          title:            d.specimenType      ?? 'Untitled Scan',
          subtitle:         d.scanMode         ?? '',
          time:             formatTime(iso),
          dateLabel:        formatDateLabel(iso),
          risk:             (d.overallRisk ?? 'low').toLowerCase(),
          icon:             'file',
          blastProbability: d.blastProbability ?? 0,
          summary:          d.summary          ?? '',
          wbcHistory:       d.wbcHistory       ?? [],
          rbcHistory:       d.rbcHistory       ?? [],
        };
      });
      setScans(records);
      setIsLoading(false);
    }, (err) => {
      console.error('Firestore onSnapshot error:', err);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [user?.uid, isDoctor]);

  // ── Filter + search ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = scans;
    if (activeFilter !== 'all') {
      const map = { critical: 'critical', moderate: 'moderate', normal: 'low' } as const;
      list = list.filter(s => s.risk === map[activeFilter]);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.caseId.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        s.subtitle.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q),
      );
    }
    return list;
  }, [scans, search, activeFilter]);

  // ── Group by date label ───────────────────────────────────────────────────
  const groups = useMemo(() => {
    const g: Record<string, ScanRecord[]> = {};
    for (const s of filtered) {
      if (!g[s.dateLabel]) g[s.dateLabel] = [];
      g[s.dateLabel].push(s);
    }
    return Object.entries(g);
  }, [filtered]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={THEME.primary} />
          <Text style={styles.loadingText}>Loading diagnostics…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.brand}>
          <Activity color={THEME.primary} size={22} />
          <Text style={styles.brandText}>HEMO-EDGE</Text>
        </View>
        <TouchableOpacity style={styles.avatar}>
          <User color={THEME.textSecondary} size={20} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Title — changes based on role */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>
            {isDoctor ? 'All Diagnostics' : 'My History'}
          </Text>
          <Text style={styles.subtitle}>
            {isDoctor
              ? 'All patients · clinical analysis records'
              : 'Review and manage your analysis records'}
          </Text>
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Search color={THEME.textSecondary} size={17} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by case ID, patient, test type…"
            placeholderTextColor="#9ca3af"
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={15} color={THEME.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {([
            { key: 'all',      label: `All (${scans.length})` },
            { key: 'critical', label: '⚠ Critical' },
            { key: 'moderate', label: 'Moderate' },
            { key: 'normal',   label: 'Normal' },
          ] as const).map(f => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, activeFilter === f.key && styles.filterChipActive]}
              onPress={() => setFilter(f.key)}
            >
              <Text style={[styles.filterChipText, activeFilter === f.key && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Summary stats */}
        <SummaryBar scans={filtered} />

        {/* Grouped scan list */}
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Microscope color="#d1d5db" size={48} />
            <Text style={styles.emptyTitle}>{search ? 'No results found' : 'No scans yet'}</Text>
            <Text style={styles.emptyDesc}>
              {search
                ? `Nothing matches "${search}". Try a different search.`
                : 'Upload a blood report or run a scan to get started.'}
            </Text>
          </View>
        ) : (
          groups.map(([label, groupScans]) => (
            <View key={label}>
              <DateSection label={label} count={groupScans.length} />
              {groupScans.map(scan =>
                scan.risk === 'critical'
                  ? <CriticalCard key={scan.id} scan={scan} />
                  : <HistoryCard  key={scan.id} scan={scan} />
              )}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:           { flex: 1, backgroundColor: THEME.background },
  loadingWrap:         { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText:         { fontSize: 14, color: THEME.textSecondary, fontWeight: '500' },
  header:              { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, backgroundColor: '#ffffffcc' },
  brand:               { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandText:           { fontSize: 20, fontWeight: '900', color: THEME.primary, letterSpacing: -1 },
  avatar:              { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f2f4f6', alignItems: 'center', justifyContent: 'center' },
  scroll:              { padding: 20, paddingBottom: 100 },
  titleSection:        { marginBottom: 20 },
  title:               { fontSize: 30, fontWeight: '800', color: THEME.text, letterSpacing: -0.5 },
  subtitle:            { fontSize: 15, color: THEME.textSecondary, fontWeight: '500', marginTop: 4 },
  searchWrap:          { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#eceef0', borderRadius: 16, paddingHorizontal: 16, height: 52, marginBottom: 14 },
  searchInput:         { flex: 1, fontSize: 15, color: THEME.text, fontWeight: '500' },
  filterRow:           { gap: 8, marginBottom: 20, paddingRight: 8 },
  filterChip:          { backgroundColor: '#eceef0', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 99 },
  filterChipActive:    { backgroundColor: THEME.primary },
  filterChipText:      { fontSize: 13, fontWeight: '600', color: THEME.textSecondary },
  filterChipTextActive:{ color: '#fff', fontWeight: '700' },
  empty:               { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle:          { fontSize: 18, fontWeight: '700', color: THEME.text },
  emptyDesc:           { fontSize: 14, color: THEME.textSecondary, textAlign: 'center' },
});