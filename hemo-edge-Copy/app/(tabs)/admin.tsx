// FILE: app/(tabs)/admin.tsx
// Phase 5 — Pillar G: Admin Dashboard
// Phase 5 — Pillar H: all UI strings replaced with t() calls

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, FlatList, RefreshControl, Alert, Platform,
} from 'react-native';
import { Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useAuthContext } from '@/contexts/auth-context';
import {
  getAdminSystemStats, getAuditLogs, getAllUsers, resolveActorId,
  type AdminSystemStats, type AuditLogDoc,
  type AuditLogFilters, type AdminUserProfile,
} from '@/lib/firestore-service';
import { useTranslation } from '@/lib/i18n';

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

const AUDIT_LOG_PAGE_SIZE = 30;

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  doctor:  { bg: '#e3f2fd', text: '#0d47a1' },
  patient: { bg: '#e8f5e9', text: '#1b5e20' },
  admin:   { bg: '#fce4ec', text: '#880e4f' },
};

const FILTERABLE_ROLES: Array<AuditLogFilters['actorRole']> = [
  undefined, 'doctor', 'patient', 'admin',
];

const FILTERABLE_ACTIONS: Array<string | undefined> = [
  undefined, 'create_scan', 'user_logout', 'account_switch', 'message_sent',
  'gdpr_data_export', 'critical_alert_dispatched', 'biometric_auth_success',
  'biometric_auth_failed', 'pdf_export', 'preferences_updated', 'fhir_export', 'hl7_export',
];

// ─────────────────────────────────────────────────────────────────────────────
//  StatCard
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, accent, subLabel }: {
  label: string; value: number | string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  accent: string; subLabel?: string;
}): React.ReactElement {
  return (
    <View style={[styles.statCard, { borderLeftColor: accent }]}>
      <View style={[styles.statIconWrap, { backgroundColor: accent + '22' }]}>
        <Ionicons name={icon} size={22} color={accent} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {subLabel ? <Text style={styles.statSub}>{subLabel}</Text> : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  RoleBadge
// ─────────────────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }): React.ReactElement {
  const colours = ROLE_COLORS[role] ?? { bg: '#f5f5f5', text: '#333' };
  return (
    <View style={[styles.roleBadge, { backgroundColor: colours.bg }]}>
      <Text style={[styles.roleBadgeText, { color: colours.text }]}>{role.toUpperCase()}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  FilterChip
// ─────────────────────────────────────────────────────────────────────────────

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }): React.ReactElement {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  AuditLogRow
// ─────────────────────────────────────────────────────────────────────────────

function AuditLogRow({ log }: { log: AuditLogDoc }): React.ReactElement {
  const actorId  = resolveActorId(log);
  const maskedId = actorId.length > 6 ? `…${actorId.slice(-6)}` : actorId;
  let displayTime = '—';
  try {
    const d = new Date(log.timestamp);
    displayTime = `${d.toLocaleDateString('en-IN')} ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  } catch { displayTime = log.timestamp.slice(0, 16); }

  return (
    <View style={styles.auditRow}>
      <View style={styles.auditRowLeft}>
        <Text style={styles.auditAction} numberOfLines={1}>{log.action}</Text>
        <Text style={styles.auditMeta}>{maskedId}{log.resourceType ? `  ·  ${log.resourceType}` : ''}</Text>
      </View>
      <View style={styles.auditRowRight}>
        <RoleBadge role={log.actorRole ?? '—'} />
        <Text style={styles.auditTime}>{displayTime}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  UserRow
// ─────────────────────────────────────────────────────────────────────────────

function UserRow({ user }: { user: AdminUserProfile }): React.ReactElement {
  const { t } = useTranslation();
  const handleActionPress = useCallback((): void => {
    Alert.alert(t('common.comingSoon'), t('admin.comingSoonMessage'));
  }, [t]);
  const emailParts  = user.email.split('@');
  const maskedEmail = emailParts.length === 2 ? `${user.email.slice(0, 2)}***@${emailParts[1]}` : '***';

  return (
    <View style={styles.userRow}>
      <View style={styles.userRowLeft}>
        <Text style={styles.userName} numberOfLines={1}>{user.fullName || '—'}</Text>
        <Text style={styles.userEmail}>{maskedEmail}</Text>
      </View>
      <View style={styles.userRowRight}>
        <RoleBadge role={user.role} />
        <TouchableOpacity style={styles.comingSoonPill} onPress={handleActionPress} accessibilityRole="button">
          <Text style={styles.comingSoonText}>{t('common.comingSoon')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main screen
// ─────────────────────────────────────────────────────────────────────────────

type ActivePanel    = 'stats' | 'audit' | 'users';
type UserRoleFilter = 'all' | 'doctor' | 'patient';

export default function AdminScreen(): React.ReactElement {
  const { user, role } = useAuthContext();
  const { t } = useTranslation();

  if (!user || role !== 'admin') return <Redirect href="/" />;

  const [activePanel,    setActivePanel]    = useState<ActivePanel>('stats');
  const [stats,          setStats]          = useState<AdminSystemStats | null>(null);
  const [statsLoading,   setStatsLoading]   = useState(true);
  const [statsError,     setStatsError]     = useState<string | null>(null);
  const [auditLogs,      setAuditLogs]      = useState<AuditLogDoc[]>([]);
  const [auditLoading,   setAuditLoading]   = useState(false);
  const [auditRefreshing,setAuditRefreshing]= useState(false);
  const [auditError,     setAuditError]     = useState<string | null>(null);
  const [roleFilter,     setRoleFilter]     = useState<AuditLogFilters['actorRole']>(undefined);
  const [actionFilter,   setActionFilter]   = useState<string | undefined>(undefined);
  const [users,          setUsers]          = useState<AdminUserProfile[]>([]);
  const [usersLoading,   setUsersLoading]   = useState(false);
  const [usersError,     setUsersError]     = useState<string | null>(null);
  const [userRoleFilter, setUserRoleFilter] = useState<UserRoleFilter>('all');

  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const fetchStats = useCallback(async (): Promise<void> => {
    if (!mounted.current) return;
    setStatsLoading(true); setStatsError(null);
    try {
      const data = await getAdminSystemStats();
      if (mounted.current) setStats(data);
    } catch (err) {
      if (mounted.current) setStatsError(err instanceof Error ? err.message : t('error.loadFailed'));
    } finally { if (mounted.current) setStatsLoading(false); }
  }, [t]);

  const fetchAuditLogs = useCallback(async (refreshing = false): Promise<void> => {
    if (!mounted.current) return;
    if (refreshing) setAuditRefreshing(true); else setAuditLoading(true);
    setAuditError(null);
    try {
      const filters: AuditLogFilters = {};
      if (roleFilter)   filters.actorRole = roleFilter;
      if (actionFilter) filters.action    = actionFilter;
      const logs = await getAuditLogs(AUDIT_LOG_PAGE_SIZE, filters);
      if (mounted.current) setAuditLogs(logs);
    } catch (err) {
      if (mounted.current) setAuditError(err instanceof Error ? err.message : t('error.loadFailed'));
    } finally { if (mounted.current) { setAuditLoading(false); setAuditRefreshing(false); } }
  }, [roleFilter, actionFilter, t]);

  const fetchUsers = useCallback(async (): Promise<void> => {
    if (!mounted.current) return;
    setUsersLoading(true); setUsersError(null);
    try {
      const roleArg = userRoleFilter === 'all' ? undefined : (userRoleFilter as 'doctor' | 'patient');
      const data = await getAllUsers(roleArg);
      if (mounted.current) setUsers(data);
    } catch (err) {
      if (mounted.current) setUsersError(err instanceof Error ? err.message : t('error.loadFailed'));
    } finally { if (mounted.current) setUsersLoading(false); }
  }, [userRoleFilter, t]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { if (activePanel === 'audit') fetchAuditLogs(); }, [activePanel, fetchAuditLogs]);
  useEffect(() => { if (activePanel === 'users') fetchUsers(); }, [activePanel, fetchUsers]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (activePanel === 'audit') fetchAuditLogs(); }, [roleFilter, actionFilter]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (activePanel === 'users') fetchUsers(); }, [userRoleFilter]);

  function PanelTab({ id, label, icon }: {
    id: ActivePanel; label: string; icon: React.ComponentProps<typeof Ionicons>['name'];
  }): React.ReactElement {
    const active = activePanel === id;
    return (
      <TouchableOpacity
        style={[styles.panelTab, active && styles.panelTabActive]}
        onPress={() => setActivePanel(id)}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
      >
        <Ionicons name={icon} size={18} color={active ? '#00478d' : '#666'} style={{ marginBottom: 2 }} />
        <Text style={[styles.panelTabText, active && styles.panelTabTextActive]}>{label}</Text>
      </TouchableOpacity>
    );
  }

  function StatsPanel(): React.ReactElement {
    if (statsLoading) return (
      <View style={styles.centeredState}>
        <ActivityIndicator size="large" color="#00478d" />
        <Text style={styles.loadingText}>{t('admin.loadingStats')}</Text>
      </View>
    );
    if (statsError) return (
      <View style={styles.centeredState}>
        <Ionicons name="alert-circle-outline" size={40} color="#e53935" />
        <Text style={styles.errorText}>{statsError}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={fetchStats}>
          <Text style={styles.retryBtnText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
    const s = stats ?? { totalScans: 0, totalPatients: 0, totalDoctors: 0, criticalAlertsToday: 0, aiLatencyMs: 0, uptimePct: 0 };
    return (
      <ScrollView contentContainerStyle={styles.statGrid} showsVerticalScrollIndicator={false}>
        <Text style={styles.panelTitle}>{t('admin.systemOverview')}</Text>
        <Text style={styles.panelSubtitle}>{t('admin.systemMetrics')}</Text>
        <View style={styles.statRow}>
          <StatCard label={t('admin.totalScans')}    value={s.totalScans}          icon="document-text-outline" accent="#00478d" />
          <StatCard label={t('admin.patients')}       value={s.totalPatients}        icon="people-outline"        accent="#388e3c" />
        </View>
        <View style={styles.statRow}>
          <StatCard label={t('admin.doctors')}        value={s.totalDoctors}         icon="medkit-outline"   accent="#7b1fa2" />
          <StatCard label={t('admin.criticalAlerts')} value={s.criticalAlertsToday}  icon="warning-outline"  accent="#e53935" subLabel={t('admin.today')} />
        </View>
        <View style={styles.statRow}>
          <StatCard label={t('admin.aiLatency')} value={`${s.aiLatencyMs} ms`} icon="flash-outline" accent="#f57c00" />
          <StatCard label={t('admin.uptime')}    value={`${s.uptimePct}%`}     icon="pulse-outline"  accent="#0097a7" />
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={fetchStats}>
          <Ionicons name="refresh-outline" size={16} color="#00478d" />
          <Text style={styles.refreshBtnText}>{t('admin.refreshStats')}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  function AuditLogPanel(): React.ReactElement {
    return (
      <View style={styles.panelFlex}>
        <Text style={styles.filterLabel}>{t('admin.filterByRole')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {FILTERABLE_ROLES.map((r, i) => (
            <FilterChip key={i} label={r ?? t('admin.allRoles')} active={roleFilter === r} onPress={() => setRoleFilter(r)} />
          ))}
        </ScrollView>
        <Text style={styles.filterLabel}>{t('admin.filterByAction')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {FILTERABLE_ACTIONS.map((a, i) => (
            <FilterChip key={i} label={a ?? t('admin.allActions')} active={actionFilter === a} onPress={() => setActionFilter(a)} />
          ))}
        </ScrollView>
        <View style={styles.auditHeader}>
          <Text style={[styles.auditHeaderCell, { flex: 3 }]}>Action / Actor</Text>
          <Text style={[styles.auditHeaderCell, { flex: 2, textAlign: 'right' }]}>Role / Time</Text>
        </View>
        {auditLoading && !auditRefreshing ? (
          <View style={styles.centeredState}><ActivityIndicator size="large" color="#00478d" /></View>
        ) : auditError ? (
          <View style={styles.centeredState}>
            <Ionicons name="alert-circle-outline" size={36} color="#e53935" />
            <Text style={styles.errorText}>{auditError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => fetchAuditLogs()}>
              <Text style={styles.retryBtnText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList<AuditLogDoc>
            data={auditLogs}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <AuditLogRow log={item} />}
            ListEmptyComponent={
              <View style={styles.centeredState}>
                <Ionicons name="reader-outline" size={40} color="#bbb" />
                <Text style={styles.emptyText}>{t('admin.noAuditLogs')}</Text>
              </View>
            }
            refreshControl={<RefreshControl refreshing={auditRefreshing} onRefresh={() => fetchAuditLogs(true)} colors={['#00478d']} />}
            contentContainerStyle={{ paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}
      </View>
    );
  }

  function UsersPanel(): React.ReactElement {
    return (
      <View style={styles.panelFlex}>
        <Text style={styles.filterLabel}>{t('admin.filterByRole')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {(['all', 'doctor', 'patient'] as UserRoleFilter[]).map((r) => (
            <FilterChip key={r} label={r.charAt(0).toUpperCase() + r.slice(1)} active={userRoleFilter === r} onPress={() => setUserRoleFilter(r)} />
          ))}
        </ScrollView>
        <View style={styles.comingSoonBanner}>
          <Ionicons name="construct-outline" size={14} color="#7d4e00" />
          <Text style={styles.comingSoonBannerText}>{'  '}{t('admin.editActionsComingSoon')}</Text>
        </View>
        {usersLoading ? (
          <View style={styles.centeredState}><ActivityIndicator size="large" color="#00478d" /></View>
        ) : usersError ? (
          <View style={styles.centeredState}>
            <Ionicons name="alert-circle-outline" size={36} color="#e53935" />
            <Text style={styles.errorText}>{usersError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={fetchUsers}>
              <Text style={styles.retryBtnText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList<AdminUserProfile>
            data={users}
            keyExtractor={(item) => item.uid}
            renderItem={({ item }) => <UserRow user={item} />}
            ListEmptyComponent={
              <View style={styles.centeredState}>
                <Ionicons name="people-outline" size={40} color="#bbb" />
                <Text style={styles.emptyText}>{t('admin.noUsers')}</Text>
              </View>
            }
            contentContainerStyle={{ paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.adminHeader}>
        <Ionicons name="shield-checkmark" size={18} color="#880e4f" />
        <Text style={styles.adminHeaderText}>{t('admin.console')}</Text>
        <View style={styles.adminBadge}>
          <Text style={styles.adminBadgeText}>{t('admin.restricted')}</Text>
        </View>
      </View>
      <View style={styles.panelNav}>
        <PanelTab id="stats" label={t('admin.stats')}    icon="bar-chart-outline" />
        <PanelTab id="audit" label={t('admin.auditLog')} icon="reader-outline" />
        <PanelTab id="users" label={t('admin.users')}    icon="people-outline" />
      </View>
      <View style={styles.panelContent}>
        {activePanel === 'stats' && <StatsPanel />}
        {activePanel === 'audit' && <AuditLogPanel />}
        {activePanel === 'users' && <UsersPanel />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:                 { flex: 1, backgroundColor: '#f7f9fb' },
  adminHeader:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fce4ec', borderBottomWidth: 1, borderBottomColor: '#f48fb1' },
  adminHeaderText:      { fontSize: 13, fontWeight: '800', color: '#880e4f', marginLeft: 6, letterSpacing: 1.2, flex: 1 },
  adminBadge:           { backgroundColor: '#880e4f', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 },
  adminBadgeText:       { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 0.8 },
  panelNav:             { flexDirection: 'row', backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#e0e3e5' },
  panelTab:             { flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  panelTabActive:       { borderBottomColor: '#00478d' },
  panelTabText:         { fontSize: 11, fontWeight: '600', color: '#666' },
  panelTabTextActive:   { color: '#00478d' },
  panelContent:         { flex: 1 },
  panelFlex:            { flex: 1, paddingTop: 8 },
  statGrid:             { padding: 16 },
  panelTitle:           { fontSize: 18, fontWeight: '700', color: '#1a2535', marginBottom: 4 },
  panelSubtitle:        { fontSize: 13, color: '#666', marginBottom: 20 },
  statRow:              { flexDirection: 'row', gap: 12, marginBottom: 12 },
  statCard:             { flex: 1, backgroundColor: '#ffffff', borderRadius: 12, padding: 16, borderLeftWidth: 4, ...Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }, android: { elevation: 2 } }) },
  statIconWrap:         { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  statValue:            { fontSize: 24, fontWeight: '800', color: '#1a2535' },
  statLabel:            { fontSize: 12, fontWeight: '600', color: '#666', marginTop: 2 },
  statSub:              { fontSize: 11, color: '#999', marginTop: 1 },
  refreshBtn:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#00478d', gap: 6 },
  refreshBtnText:       { fontSize: 14, fontWeight: '600', color: '#00478d' },
  filterLabel:          { fontSize: 11, fontWeight: '700', color: '#999', letterSpacing: 0.8, textTransform: 'uppercase', paddingHorizontal: 16, marginTop: 12, marginBottom: 6 },
  chipRow:              { paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
  chip:                 { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#e8eef4', borderWidth: 1, borderColor: '#d0d8e0' },
  chipActive:           { backgroundColor: '#00478d', borderColor: '#00478d' },
  chipText:             { fontSize: 12, fontWeight: '600', color: '#444' },
  chipTextActive:       { color: '#fff' },
  auditHeader:          { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#eef2f7', marginTop: 12, marginBottom: 2 },
  auditHeaderCell:      { fontSize: 11, fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: 0.6 },
  auditRow:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff' },
  auditRowLeft:         { flex: 3 },
  auditAction:          { fontSize: 13, fontWeight: '700', color: '#1a2535' },
  auditMeta:            { fontSize: 11, color: '#888', marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  auditRowRight:        { flex: 2, alignItems: 'flex-end', gap: 4 },
  auditTime:            { fontSize: 10, color: '#aaa', marginTop: 2 },
  comingSoonBanner:     { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 10, marginBottom: 2, padding: 10, backgroundColor: '#fff8e1', borderRadius: 8, borderWidth: 1, borderColor: '#ffe082' },
  comingSoonBannerText: { fontSize: 12, color: '#7d4e00', fontWeight: '500', flex: 1 },
  userRow:              { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff' },
  userRowLeft:          { flex: 3 },
  userRowRight:         { flex: 2, alignItems: 'flex-end', gap: 6 },
  userName:             { fontSize: 14, fontWeight: '600', color: '#1a2535' },
  userEmail:            { fontSize: 11, color: '#888', marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  comingSoonPill:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#ddd' },
  comingSoonText:       { fontSize: 10, color: '#999', fontWeight: '600' },
  roleBadge:            { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  roleBadgeText:        { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  centeredState:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  loadingText:          { fontSize: 14, color: '#888', marginTop: 8 },
  errorText:            { fontSize: 14, color: '#e53935', textAlign: 'center', marginTop: 8 },
  emptyText:            { fontSize: 14, color: '#aaa', textAlign: 'center', marginTop: 8 },
  retryBtn:             { marginTop: 8, paddingVertical: 8, paddingHorizontal: 20, backgroundColor: '#00478d', borderRadius: 8 },
  retryBtnText:         { fontSize: 14, fontWeight: '700', color: '#fff' },
  separator:            { height: 1, backgroundColor: '#f0f0f0', marginLeft: 16 },
});
