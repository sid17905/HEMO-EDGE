// FILE: app/(tabs)/index.tsx
// Phase 5 — Pillar H: all hardcoded strings replaced with t() calls.
// No JSX restructuring — string replacement only.
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import {
  Bell, Microscope, FileUp, ArrowRight, PlusCircle,
  RefreshCw, CheckCircle, AlertTriangle, Users, TrendingUp,
  Heart, Shield, Clock, ChevronRight, Activity,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthContext } from '@/contexts/auth-context';
import {
  getScanHistory,
  getDoctorPatientScans,
  getLinkedPatients,
  getSystemStats,
  writeAuditLog,
  type StoredScanResult,
  type UserProfile,
  type SystemStats,
} from '@/lib/firestore-service';
import { useTranslation } from '@/lib/i18n';

// ─────────────────────────────────────────────────────────────────────────────
//  Design tokens
// ─────────────────────────────────────────────────────────────────────────────

const T = {
  primary:        '#00478d',
  primaryLight:   '#cce0ff',
  secondary:      '#4f5f7b',
  background:     '#f7f9fb',
  surface:        '#ffffff',
  text:           '#191c1e',
  textSecondary:  '#424752',
  border:         '#e0e3e5',
  cardBg:         '#f2f4f6',
  success:        '#059669',
  warning:        '#d97706',
  danger:         '#ba1a1a',
  info:           '#2563eb',
  patientAccent:  '#7c3aed',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Root component
// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { user, role } = useAuthContext();

  if (!user) return null;

  return role === 'doctor'
    ? <DoctorDashboard />
    : <PatientDashboard />;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DOCTOR DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

function DoctorDashboard() {
  const router = useRouter();
  const { user } = useAuthContext();
  const { t } = useTranslation();

  const [stats,          setStats]          = useState<SystemStats | null>(null);
  const [recentScans,    setRecentScans]    = useState<StoredScanResult[]>([]);
  const [linkedPatients, setLinkedPatients] = useState<UserProfile[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [criticalAlerts, setCriticalAlerts] = useState(0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      const [s, scans, patients] = await Promise.all([
        getSystemStats(user.uid),
        getDoctorPatientScans(user.uid),
        getLinkedPatients(user.uid),
      ]);
      setStats(s);
      setRecentScans(scans.slice(0, 5));
      setLinkedPatients(patients.slice(0, 4));
      setCriticalAlerts(scans.filter(sc => sc.urgency === 'CRITICAL').length);
    } catch (e) {
      console.error('DoctorDashboard fetch ->', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(() => fetchAll(true), 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchAll]);

  const onRefresh = useCallback(() => { setRefreshing(true); fetchAll(); }, [fetchAll]);

  if (loading) return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.brand}>
          <Activity color={T.primary} size={22} />
          <Text style={styles.brandText}>{t('common.appName')}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconButton}>
            <Bell color={T.textSecondary} size={22} />
            {criticalAlerts > 0 && (
              <View style={styles.alertDot}>
                <Text style={styles.alertDotText}>{criticalAlerts}</Text>
              </View>
            )}
          </TouchableOpacity>
          <View style={styles.avatar}>
            <Image source={{ uri: 'https://picsum.photos/seed/doctor/100/100' }} style={styles.avatarImg} />
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />}
      >
        {/* Welcome */}
        <View style={styles.welcome}>
          <Text style={styles.welcomeLabel}>{t('dashboard.doctor.label')}</Text>
          <Text style={styles.welcomeTitle}>{t('dashboard.doctor.title')}</Text>
        </View>

        {/* Action cards */}
        <View style={styles.bentoGrid}>
          <TouchableOpacity style={[styles.bentoCard, styles.primaryCard]} onPress={() => router.push('/(tabs)/scan')}>
            <View style={styles.cardIconWrapper}>
              <Microscope color="#fff" size={22} />
            </View>
            <View>
              <Text style={styles.cardTitleLight}>{t('dashboard.doctor.scanSample')}</Text>
              <Text style={styles.cardDescLight}>{t('dashboard.doctor.scanDesc')}</Text>
            </View>
            <View style={styles.cardFooter}>
              <Text style={styles.cardFooterTextLight}>{t('dashboard.doctor.startAnalysis')}</Text>
              <ArrowRight color="#fff" size={15} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.bentoCard, styles.surfaceCard]} onPress={() => router.push('/(tabs)/scanner')}>
            <View style={[styles.cardIconWrapper, styles.secondaryIconWrapper]}>
              <FileUp color={T.primary} size={22} />
            </View>
            <View>
              <Text style={styles.cardTitleDark}>{t('dashboard.doctor.uploadReport')}</Text>
              <Text style={styles.cardDescDark}>{t('dashboard.doctor.uploadDesc')}</Text>
            </View>
            <View style={styles.cardFooter}>
              <Text style={styles.cardFooterTextDark}>{t('dashboard.doctor.selectFiles')}</Text>
              <PlusCircle color={T.primary} size={15} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Stats grid */}
        <View style={styles.statsGrid}>
          <StatCard label={t('dashboard.doctor.todayTests')} value={String(stats?.todayTests ?? 0)} />
          <StatCard label={t('dashboard.doctor.pending')}    value={String(stats?.pending   ?? 0)} valueColor={T.primary} />
          <StatCard label={t('dashboard.doctor.critical')}   value={String(stats?.critical  ?? 0)} valueColor={T.danger} labelColor={T.danger} />
          <StatCard label={t('dashboard.doctor.uptime')}     value={`${stats?.uptimePct ?? 0}%`} />
        </View>

        {/* Linked patients */}
        {linkedPatients.length > 0 && (
          <>
            <SectionHeader title={t('dashboard.doctor.patientRoster')} onViewAll={() => router.push('/(tabs)/patients')} />
            <View style={styles.patientList}>
              {linkedPatients.map(p => (
                <TouchableOpacity
                  key={p.uid}
                  style={styles.patientRow}
                  onPress={async () => {
                    await writeAuditLog({ actorUid: p.uid, actorRole: 'doctor', action: 'view_scan', resourceId: p.uid });
                    router.push({ pathname: '/(tabs)/explore', params: { patientId: p.uid } });
                  }}
                >
                  <View style={styles.patientAvatar}>
                    <Text style={styles.patientInitial}>{p.fullName.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.patientInfo}>
                    <Text style={styles.patientName}>{p.fullName}</Text>
                    <Text style={styles.patientEmail}>{p.email}</Text>
                  </View>
                  <ChevronRight color={T.textSecondary} size={16} />
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* Recent scans */}
        <SectionHeader title={t('dashboard.doctor.recentAnalyses')} onViewAll={() => router.push('/(tabs)/explore')} />
        <View style={styles.activityList}>
          {recentScans.length === 0
            ? <EmptyState message={t('dashboard.doctor.noScans')} />
            : recentScans.map(scan => (
              <ScanActivityItem key={scan.id} scan={scan} onPress={() => router.push({ pathname: '/analysis-detail', params: { id: scan.id } })} />
            ))
          }
        </View>

        {/* System health */}
        <SystemHealthCard latencyMs={stats?.aiLatencyMs ?? 0} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATIENT DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

function PatientDashboard() {
  const router = useRouter();
  const { user } = useAuthContext();
  const { t } = useTranslation();

  const [recentScans, setRecentScans] = useState<StoredScanResult[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  const fetchScans = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      const scans = await getScanHistory(user.uid);
      setRecentScans(scans.slice(0, 5));
    } catch (e) {
      console.error('PatientDashboard fetch ->', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    fetchScans();
    intervalRef.current = setInterval(() => fetchScans(true), 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchScans]);

  const onRefresh = useCallback(() => { setRefreshing(true); fetchScans(); }, [fetchScans]);

  const lastScan   = recentScans[0] ?? null;
  const riskLevel  = lastScan?.overallRisk ?? 'N/A';
  const riskColor  = riskLevel === 'HIGH' ? T.danger : riskLevel === 'MEDIUM' ? T.warning : T.success;

  if (loading) return <LoadingScreen />;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#faf8ff' }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: '#faf8ffcc' }]}>
        <View style={styles.brand}>
          <Heart color={T.patientAccent} size={22} />
          <Text style={[styles.brandText, { color: T.patientAccent }]}>{t('common.appName')}</Text>
        </View>
        <TouchableOpacity style={styles.iconButton}>
          <Bell color={T.textSecondary} size={22} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.patientAccent} />}
      >
        {/* Welcome */}
        <View style={styles.welcome}>
          <Text style={[styles.welcomeLabel, { color: T.patientAccent }]}>{t('dashboard.patient.label')}</Text>
          <Text style={styles.welcomeTitle}>{t('dashboard.patient.title')}</Text>
        </View>

        {/* Latest result card */}
        {lastScan ? (
          <TouchableOpacity
            style={[styles.heroCard, { borderLeftColor: riskColor }]}
            onPress={() => router.push({ pathname: '/result', params: { id: lastScan.id } })}
          >
            <View style={styles.heroCardTop}>
              <View>
                <Text style={styles.heroCardLabel}>{t('dashboard.patient.latestResult')}</Text>
                <Text style={styles.heroCardDate}>{new Date(lastScan.analyzedOn).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</Text>
              </View>
              <View style={[styles.riskBadge, { backgroundColor: riskColor + '18', borderColor: riskColor + '40' }]}>
                <Text style={[styles.riskBadgeText, { color: riskColor }]}>{riskLevel}{t('dashboard.patient.riskSuffix')}</Text>
              </View>
            </View>
            <Text style={styles.heroCardSummary} numberOfLines={2}>{lastScan.summary}</Text>
            <View style={styles.cardFooter}>
              <Text style={[styles.cardFooterTextDark, { color: T.patientAccent }]}>{t('dashboard.patient.viewFullReport')}</Text>
              <ArrowRight color={T.patientAccent} size={15} />
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.heroCard}>
            <Text style={styles.heroCardLabel}>{t('dashboard.patient.noResults')}</Text>
            <Text style={styles.heroCardSummary}>{t('dashboard.patient.noResultsDesc')}</Text>
          </View>
        )}

        {/* Quick actions */}
        <View style={styles.bentoGrid}>
          <TouchableOpacity style={[styles.bentoCard, { backgroundColor: T.patientAccent, flex: 1, height: 200 }]} onPress={() => router.push('/(tabs)/scan')}>
            <View style={[styles.cardIconWrapper, { backgroundColor: '#ffffff25' }]}>
              <Microscope color="#fff" size={22} />
            </View>
            <Text style={styles.cardTitleLight}>{t('dashboard.patient.newScan')}</Text>
            <Text style={styles.cardDescLight}>{t('dashboard.patient.newScanDesc')}</Text>
            <View style={styles.cardFooter}>
              <Text style={styles.cardFooterTextLight}>{t('dashboard.patient.start')}</Text>
              <ArrowRight color="#fff" size={14} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.bentoCard, styles.surfaceCard, { flex: 1, height: 200 }]} onPress={() => router.push('/(tabs)/scanner')}>
            <View style={[styles.cardIconWrapper, { backgroundColor: '#ede9fe' }]}>
              <FileUp color={T.patientAccent} size={22} />
            </View>
            <Text style={styles.cardTitleDark}>{t('dashboard.patient.uploadReport')}</Text>
            <Text style={styles.cardDescDark}>{t('dashboard.patient.uploadDesc')}</Text>
            <View style={styles.cardFooter}>
              <Text style={[styles.cardFooterTextDark, { color: T.patientAccent }]}>{t('dashboard.patient.selectFile')}</Text>
              <PlusCircle color={T.patientAccent} size={14} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Health summary tiles */}
        {lastScan && lastScan.markers.length > 0 && (
          <>
            <SectionHeader title={t('dashboard.patient.latestMarkers')} onViewAll={() => router.push('/(tabs)/explore')} accentColor={T.patientAccent} />
            <View style={styles.statsGrid}>
              {lastScan.markers.slice(0, 4).map((m, i) => (
                <View key={i} style={[styles.statItem, { borderLeftWidth: 3, borderLeftColor: T.patientAccent + '60' }]}>
                  <Text style={[styles.statLabel, { color: T.patientAccent }]}>{m.name.toUpperCase()}</Text>
                  <Text style={[styles.statValue, { fontSize: 20 }]}>{m.value}</Text>
                  <Text style={[styles.statLabel, { marginTop: 0 }]}>{m.unit}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* History */}
        <SectionHeader title={t('dashboard.patient.myHistory')} onViewAll={() => router.push('/(tabs)/explore')} accentColor={T.patientAccent} />
        <View style={styles.activityList}>
          {recentScans.length === 0
            ? <EmptyState message={t('dashboard.patient.noHistory')} />
            : recentScans.map(scan => (
              <ScanActivityItem key={scan.id} scan={scan} onPress={() => router.push({ pathname: '/result', params: { id: scan.id } })} />
            ))
          }
        </View>

        {/* Privacy notice */}
        <View style={styles.privacyCard}>
          <Shield color={T.success} size={18} />
          <Text style={styles.privacyText}>{t('dashboard.patient.privacyNotice')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Shared sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({ label, value, valueColor, labelColor }: { label: string; value: string; valueColor?: string; labelColor?: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statLabel, labelColor ? { color: labelColor } : {}]}>{label}</Text>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

function SectionHeader({ title, onViewAll, accentColor }: { title: string; onViewAll: () => void; accentColor?: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <TouchableOpacity onPress={onViewAll}>
        <Text style={[styles.viewAll, accentColor ? { color: accentColor } : {}]}>{t('common.viewAll')}</Text>
      </TouchableOpacity>
    </View>
  );
}

function ScanActivityItem({ scan, onPress }: { scan: StoredScanResult; onPress: () => void }) {
  const { t } = useTranslation();
  const urgency      = scan.urgency ?? 'NORMAL';
  const urgencyColor =
    urgency === 'CRITICAL' ? T.danger :
    urgency === 'HIGH'     ? T.warning :
    urgency === 'pending'  ? T.info :
    T.success;
  const icon =
    urgency === 'CRITICAL' ? <AlertTriangle color={urgencyColor} size={18} /> :
    urgency === 'pending'  ? <RefreshCw color={urgencyColor} size={18} /> :
    <CheckCircle color={urgencyColor} size={18} />;

  return (
    <TouchableOpacity style={styles.activityItem} onPress={onPress}>
      <View style={styles.activityLeft}>
        <View style={styles.activityIcon}>{icon}</View>
        <View style={{ flex: 1 }}>
          <Text style={styles.activityTitle} numberOfLines={1}>{scan.caseId}</Text>
          <Text style={styles.activityDesc} numberOfLines={1}>
            {scan.patientName ? `${t('common.patientLabel')}${scan.patientName} · ` : ''}{scan.specimenType}
          </Text>
        </View>
      </View>
      <View style={styles.activityRight}>
        <View style={[styles.statusBadge, { backgroundColor: urgencyColor + '15' }]}>
          <Text style={[styles.statusText, { color: urgencyColor }]}>{urgency}</Text>
        </View>
        <Text style={styles.activityTime}>
          {new Date(scan.analyzedOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function SystemHealthCard({ latencyMs }: { latencyMs: number }) {
  const { t } = useTranslation();
  const isOptimal = latencyMs > 0 && latencyMs < 50;
  return (
    <View style={styles.healthCard}>
      <View style={styles.healthInfo}>
        <Text style={styles.healthTitle}>{t('dashboard.doctor.systemHealth')}</Text>
        <Text style={styles.healthDesc}>{t('dashboard.doctor.systemHealthDesc')}</Text>
      </View>
      <View style={styles.healthStats}>
        <View style={styles.miniChart}>
          {[50, 75, 60, 100, 50].map((h, i) => (
            <View key={i} style={[styles.bar, { height: `${h}%` }]} />
          ))}
        </View>
        <View style={styles.latency}>
          <Text style={styles.latencyVal}>{latencyMs > 0 ? `${latencyMs}ms` : '—'}</Text>
          <Text style={[styles.latencyLabel, { color: isOptimal ? '#10b981' : '#f59e0b' }]}>
            {isOptimal ? t('dashboard.doctor.optimal') : t('dashboard.doctor.checking')}
          </Text>
        </View>
      </View>
    </View>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.emptyState}>
      <TrendingUp color={T.border} size={32} />
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

function LoadingScreen() {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: T.background }}>
      <ActivityIndicator size="large" color={T.primary} />
      <Text style={{ marginTop: 12, color: T.textSecondary, fontSize: 13 }}>{t('common.loadingDashboard')}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:            { flex: 1, backgroundColor: T.background },
  header:               { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, backgroundColor: '#ffffffcc' },
  brand:                { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandText:            { fontSize: 20, fontWeight: '900', color: T.primary, letterSpacing: -1 },
  headerActions:        { flexDirection: 'row', alignItems: 'center', gap: 16 },
  iconButton:           { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  alertDot:             { position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: 8, backgroundColor: T.danger, alignItems: 'center', justifyContent: 'center' },
  alertDotText:         { fontSize: 9, fontWeight: '900', color: '#fff' },
  avatar:               { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', borderWidth: 2, borderColor: T.primary },
  avatarImg:            { width: '100%', height: '100%' },
  scrollContent:        { padding: 24, paddingBottom: 100 },
  welcome:              { marginBottom: 24 },
  welcomeLabel:         { fontSize: 10, fontWeight: '700', color: T.secondary, letterSpacing: 2, marginBottom: 4 },
  welcomeTitle:         { fontSize: 30, fontWeight: '800', color: T.text, letterSpacing: -0.5 },
  bentoGrid:            { flexDirection: 'row', gap: 14, marginBottom: 24 },
  bentoCard:            { flex: 1, height: 220, borderRadius: 22, padding: 20, justifyContent: 'space-between' },
  primaryCard:          { backgroundColor: T.primary },
  surfaceCard:          { backgroundColor: T.surface, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  cardIconWrapper:      { width: 44, height: 44, borderRadius: 12, backgroundColor: '#ffffff20', alignItems: 'center', justifyContent: 'center' },
  secondaryIconWrapper: { backgroundColor: '#cdddff' },
  cardTitleLight:       { fontSize: 20, fontWeight: '700', color: '#fff' },
  cardDescLight:        { fontSize: 12, color: '#ffffffcc', marginTop: 6 },
  cardTitleDark:        { fontSize: 20, fontWeight: '700', color: T.text },
  cardDescDark:         { fontSize: 12, color: T.textSecondary, marginTop: 6 },
  cardFooter:           { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardFooterTextLight:  { fontSize: 13, fontWeight: '700', color: '#fff' },
  cardFooterTextDark:   { fontSize: 13, fontWeight: '700', color: T.primary },
  statsGrid:            { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 28 },
  statItem:             { flex: 1, minWidth: '45%', backgroundColor: T.cardBg, padding: 18, borderRadius: 18, gap: 6 },
  statLabel:            { fontSize: 9, fontWeight: '700', color: T.secondary, letterSpacing: 1 },
  statValue:            { fontSize: 22, fontWeight: '900', color: T.text },
  sectionHeader:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle:         { fontSize: 17, fontWeight: '700', color: T.text },
  viewAll:              { fontSize: 12, fontWeight: '700', color: T.primary },
  activityList:         { gap: 8, marginBottom: 28 },
  activityItem:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, backgroundColor: T.surface, borderRadius: 18 },
  activityLeft:         { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  activityIcon:         { width: 38, height: 38, borderRadius: 10, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center' },
  activityTitle:        { fontSize: 13, fontWeight: '700', color: T.text },
  activityDesc:         { fontSize: 11, color: T.textSecondary },
  activityRight:        { alignItems: 'flex-end', gap: 4 },
  statusBadge:          { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  statusText:           { fontSize: 9, fontWeight: '700' },
  activityTime:         { fontSize: 10, color: '#94a3b8' },
  patientList:          { gap: 8, marginBottom: 28 },
  patientRow:           { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: T.surface, borderRadius: 18, gap: 12 },
  patientAvatar:        { width: 40, height: 40, borderRadius: 20, backgroundColor: T.primaryLight, alignItems: 'center', justifyContent: 'center' },
  patientInitial:       { fontSize: 18, fontWeight: '800', color: T.primary },
  patientInfo:          { flex: 1 },
  patientName:          { fontSize: 14, fontWeight: '700', color: T.text },
  patientEmail:         { fontSize: 11, color: T.textSecondary },
  healthCard:           { backgroundColor: '#0f172a', borderRadius: 22, padding: 22, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  healthInfo:           { flex: 1, gap: 6 },
  healthTitle:          { fontSize: 18, fontWeight: '700', color: '#fff' },
  healthDesc:           { fontSize: 12, color: '#94a3b8', lineHeight: 17 },
  healthStats:          { flexDirection: 'row', alignItems: 'center', gap: 14 },
  miniChart:            { height: 44, width: 60, backgroundColor: '#1e293b', borderRadius: 8, flexDirection: 'row', alignItems: 'flex-end', padding: 6, gap: 3 },
  bar:                  { flex: 1, backgroundColor: '#60a5fa', borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  latency:              { alignItems: 'flex-end' },
  latencyVal:           { fontSize: 22, fontWeight: '700', color: '#fff' },
  latencyLabel:         { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  heroCard:             { backgroundColor: T.surface, borderRadius: 22, padding: 22, marginBottom: 24, borderLeftWidth: 4, borderLeftColor: T.primary, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 2, gap: 10 },
  heroCardTop:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroCardLabel:        { fontSize: 9, fontWeight: '700', color: T.secondary, letterSpacing: 2 },
  heroCardDate:         { fontSize: 14, fontWeight: '700', color: T.text, marginTop: 2 },
  heroCardSummary:      { fontSize: 13, color: T.textSecondary, lineHeight: 18 },
  riskBadge:            { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, borderWidth: 1 },
  riskBadgeText:        { fontSize: 10, fontWeight: '800' },
  privacyCard:          { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#ecfdf5', borderRadius: 14, padding: 14 },
  privacyText:          { fontSize: 12, color: '#065f46', flex: 1, lineHeight: 17 },
  emptyState:           { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10, backgroundColor: T.surface, borderRadius: 18 },
  emptyText:            { fontSize: 13, color: T.textSecondary, textAlign: 'center' },
});
