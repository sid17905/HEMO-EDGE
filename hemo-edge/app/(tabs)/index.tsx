import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Bell, Microscope, FileUp, ArrowRight, PlusCircle, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

const THEME = {
  primary: '#00478d',
  secondary: '#4f5f7b',
  background: '#f7f9fb',
  surface: '#ffffff',
  text: '#191c1e',
  textSecondary: '#424752',
  border: '#e0e3e5',
  cardBg: '#f2f4f6',
};

export default function DashboardScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <RefreshCw color={THEME.primary} size={24} />
          <Text style={styles.brandText}>HEMO-EDGE</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconButton}>
            <Bell color={THEME.textSecondary} size={24} />
          </TouchableOpacity>
          <View style={styles.avatar}>
            <Image
              source={{ uri: 'https://picsum.photos/seed/doctor/100/100' }}
              style={styles.avatarImg}
            />
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.welcome}>
          <Text style={styles.welcomeLabel}>LABORATORY DASHBOARD</Text>
          <Text style={styles.welcomeTitle}>Precision Diagnostics</Text>
        </View>

        <View style={styles.bentoGrid}>
          {/* Blood Sample Scan — navigates to scan tab */}
          <TouchableOpacity
            style={[styles.bentoCard, styles.primaryCard]}
            onPress={() => router.push('/(tabs)/scan')}
          >
            <View style={styles.cardIconWrapper}>
              <Microscope color="#ffffff" size={24} />
            </View>
            <View>
              <Text style={styles.cardTitleLight}>Scan Sample</Text>
              <Text style={styles.cardDescLight}>Initiate real-time hematology analysis using edge vision.</Text>
            </View>
            <View style={styles.cardFooter}>
              <Text style={styles.cardFooterTextLight}>Start Analysis</Text>
              <ArrowRight color="#ffffff" size={16} />
            </View>
          </TouchableOpacity>

          {/* Document upload — navigates to scanner tab */}
          <TouchableOpacity
            style={[styles.bentoCard, styles.surfaceCard]}
            onPress={() => router.push('/(tabs)/scanner')}
          >
            <View style={[styles.cardIconWrapper, styles.secondaryIconWrapper]}>
              <FileUp color={THEME.primary} size={24} />
            </View>
            <View>
              <Text style={styles.cardTitleDark}>Upload Lab Report</Text>
              <Text style={styles.cardDescDark}>Digest PDF or image reports into actionable data points.</Text>
            </View>
            <View style={styles.cardFooter}>
              <Text style={styles.cardFooterTextDark}>Select Files</Text>
              <PlusCircle color={THEME.primary} size={16} />
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>TODAY'S TESTS</Text>
            <Text style={styles.statValue}>24</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>PENDING</Text>
            <Text style={[styles.statValue, { color: THEME.primary }]}>03</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: '#ba1a1a' }]}>CRITICAL</Text>
            <Text style={[styles.statValue, { color: '#ba1a1a' }]}>01</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>UPTIME</Text>
            <Text style={styles.statValue}>99.8%</Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Activities</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/explore')}>
            <Text style={styles.viewAll}>View All</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.activityList}>
          <ActivityItem
            icon={<RefreshCw color="#2563eb" size={20} />}
            title="Sample 104 Processing"
            desc="Automated blood cell count in progress"
            status="PROCESSING"
            statusColor="#2563eb"
            time="2 mins ago"
          />
          <ActivityItem
            icon={<CheckCircle color="#059669" size={20} />}
            title="Report 82 Ready"
            desc="Patient: J. Doe - CBC Analysis"
            status="COMPLETE"
            statusColor="#059669"
            time="15 mins ago"
          />
          <ActivityItem
            icon={<AlertTriangle color="#d97706" size={20} />}
            title="Sample 102 Flagged"
            desc="Low platelet count detected"
            status="ATTENTION"
            statusColor="#d97706"
            time="1 hour ago"
          />
        </View>

        <View style={styles.healthCard}>
          <View style={styles.healthInfo}>
            <Text style={styles.healthTitle}>System Health</Text>
            <Text style={styles.healthDesc}>AI analysis nodes are operating at optimal latency across all clinical modules.</Text>
          </View>
          <View style={styles.healthStats}>
            <View style={styles.miniChart}>
              <View style={[styles.bar, { height: '50%' }]} />
              <View style={[styles.bar, { height: '75%' }]} />
              <View style={[styles.bar, { height: '60%' }]} />
              <View style={[styles.bar, { height: '100%' }]} />
              <View style={[styles.bar, { height: '50%' }]} />
            </View>
            <View style={styles.latency}>
              <Text style={styles.latencyVal}>12ms</Text>
              <Text style={styles.latencyLabel}>OPTIMAL</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActivityItem({ icon, title, desc, status, statusColor, time }: any) {
  return (
    <View style={styles.activityItem}>
      <View style={styles.activityLeft}>
        <View style={styles.activityIcon}>{icon}</View>
        <View>
          <Text style={styles.activityTitle}>{title}</Text>
          <Text style={styles.activityDesc}>{desc}</Text>
        </View>
      </View>
      <View style={styles.activityRight}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '15' }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{status}</Text>
        </View>
        <Text style={styles.activityTime}>{time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.background },
  header: {
    height: 64, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 24,
    backgroundColor: '#ffffffcc',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandText: { fontSize: 20, fontWeight: '900', color: THEME.primary, letterSpacing: -1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  iconButton: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', borderWidth: 2, borderColor: THEME.primary },
  avatarImg: { width: '100%', height: '100%' },
  scrollContent: { padding: 24, paddingBottom: 100 },
  welcome: { marginBottom: 24 },
  welcomeLabel: { fontSize: 10, fontWeight: '700', color: THEME.secondary, letterSpacing: 2, marginBottom: 4 },
  welcomeTitle: { fontSize: 32, fontWeight: '800', color: THEME.text, letterSpacing: -0.5 },
  bentoGrid: { flexDirection: 'row', gap: 16, marginBottom: 24 },
  bentoCard: { flex: 1, height: 240, borderRadius: 24, padding: 24, justifyContent: 'space-between' },
  primaryCard: { backgroundColor: THEME.primary },
  surfaceCard: {
    backgroundColor: THEME.surface, shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  cardIconWrapper: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#ffffff20', alignItems: 'center', justifyContent: 'center' },
  secondaryIconWrapper: { backgroundColor: '#cdddff' },
  cardTitleLight: { fontSize: 22, fontWeight: '700', color: '#ffffff' },
  cardDescLight: { fontSize: 13, color: '#ffffffcc', marginTop: 8 },
  cardTitleDark: { fontSize: 22, fontWeight: '700', color: THEME.text },
  cardDescDark: { fontSize: 13, color: THEME.textSecondary, marginTop: 8 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardFooterTextLight: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  cardFooterTextDark: { fontSize: 14, fontWeight: '700', color: THEME.primary },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 32 },
  statItem: { flex: 1, minWidth: '45%', backgroundColor: THEME.cardBg, padding: 20, borderRadius: 20, gap: 8 },
  statLabel: { fontSize: 10, fontWeight: '700', color: THEME.secondary, letterSpacing: 1 },
  statValue: { fontSize: 24, fontWeight: '900', color: THEME.text },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: THEME.text },
  viewAll: { fontSize: 12, fontWeight: '700', color: THEME.primary },
  activityList: { gap: 8, marginBottom: 32 },
  activityItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: THEME.surface, borderRadius: 20 },
  activityLeft: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  activityIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center' },
  activityTitle: { fontSize: 14, fontWeight: '700', color: THEME.text },
  activityDesc: { fontSize: 12, color: THEME.textSecondary },
  activityRight: { alignItems: 'flex-end', gap: 4 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusText: { fontSize: 10, fontWeight: '700' },
  activityTime: { fontSize: 10, color: '#94a3b8' },
  healthCard: { backgroundColor: '#0f172a', borderRadius: 24, padding: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  healthInfo: { flex: 1, gap: 8 },
  healthTitle: { fontSize: 20, fontWeight: '700', color: '#ffffff' },
  healthDesc: { fontSize: 13, color: '#94a3b8', lineHeight: 18 },
  healthStats: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  miniChart: { height: 48, width: 64, backgroundColor: '#1e293b', borderRadius: 8, flexDirection: 'row', alignItems: 'flex-end', padding: 8, gap: 4 },
  bar: { flex: 1, backgroundColor: '#60a5fa', borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  latency: { alignItems: 'flex-end' },
  latencyVal: { fontSize: 24, fontWeight: '700', color: '#ffffff' },
  latencyLabel: { fontSize: 10, fontWeight: '700', color: '#10b981', letterSpacing: 1 },
});
