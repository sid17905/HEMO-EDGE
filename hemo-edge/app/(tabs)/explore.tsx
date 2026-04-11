import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import {
  Search, Filter, Microscope, FileText,
  CheckCircle, Clock, User,
} from 'lucide-react-native';
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
  error: '#ba1a1a',
};

export default function HistoryScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <FileText color={THEME.primary} size={24} />
          <Text style={styles.brandText}>HEMO-EDGE</Text>
        </View>
        <TouchableOpacity style={styles.avatar}>
          <User color={THEME.textSecondary} size={20} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.titleSection}>
          <Text style={styles.title}>Diagnostic History</Text>
          <Text style={styles.subtitle}>Review and manage clinical analysis records</Text>
        </View>

        <View style={styles.searchSection}>
          <View style={styles.searchWrapper}>
            <Search color={THEME.textSecondary} size={20} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by patient ID or test type..."
              placeholderTextColor="#727783"
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            <TouchableOpacity style={styles.filterButtonPrimary}>
              <Filter color="#ffffff" size={14} />
              <Text style={styles.filterTextPrimary}>Filters</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.filterButton}>
              <Text style={styles.filterText}>Last 30 Days</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.filterButton}>
              <Text style={styles.filterText}>Critical Only</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        <View style={styles.historyList}>
          <Text style={styles.dateLabel}>TODAY, OCT 24</Text>

          {/* Critical card — opens full analysis detail */}
          <TouchableOpacity
            style={[styles.historyCard, styles.criticalCard]}
            onPress={() => router.push('/analysis-detail')}
          >
            <View style={styles.cardTop}>
              <View style={styles.cardIconWrapper}>
                <Microscope color={THEME.error} size={28} />
              </View>
              <View style={styles.cardInfo}>
                <View style={styles.badgeRow}>
                  <View style={styles.criticalBadge}>
                    <Text style={styles.criticalBadgeText}>CRITICAL ALERT</Text>
                  </View>
                  <Text style={styles.timeText}>09:42 AM</Text>
                </View>
                <Text style={styles.cardTitle}>Patient RBC Morphology Scan</Text>
                <Text style={styles.cardSubtitle}>ID: #PX-9928 • Segmental Analysis Complete</Text>
              </View>
            </View>
            <View style={styles.cardFooter}>
              <View>
                <Text style={styles.footerLabel}>STATUS</Text>
                <Text style={styles.footerStatusCritical}>Urgent Review</Text>
              </View>
              <View style={styles.viewButton}>
                <Text style={styles.viewButtonText}>View Report</Text>
              </View>
            </View>
          </TouchableOpacity>

          <Text style={[styles.dateLabel, { marginTop: 24 }]}>YESTERDAY</Text>

          <HistoryItem
            icon={<FileText color={THEME.primary} size={24} />}
            title="Full Blood Count Analysis"
            subtitle="ID: #PX-8112 • Clinical Integration"
            time="4:15 PM"
            status="Normal Parameters"
            statusIcon={<CheckCircle color={THEME.primary} size={14} />}
          />

          <HistoryItem
            icon={<Microscope color="#1d4ed8" size={24} />}
            title="Platelet Aggregation Study"
            subtitle="ID: #PX-7449 • High-Res AI Imaging"
            time="11:30 AM"
            status="Processing Metadata"
            statusIcon={<Clock color={THEME.secondary} size={14} />}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function HistoryItem({ icon, title, subtitle, time, status, statusIcon }: any) {
  return (
    <TouchableOpacity style={styles.itemCard} onPress={() => router.push('/analysis-detail')}>
      <View style={styles.itemHeader}>
        <View style={styles.itemIconWrapper}>{icon}</View>
        <Text style={styles.itemTime}>{time}</Text>
      </View>
      <View style={styles.itemBody}>
        <Text style={styles.itemTitle}>{title}</Text>
        <Text style={styles.itemSubtitle}>{subtitle}</Text>
        <View style={styles.itemStatus}>
          {statusIcon}
          <Text style={styles.itemStatusText}>{status}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.background },
  header: {
    height: 64, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 24, backgroundColor: '#ffffffcc',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandText: { fontSize: 20, fontWeight: '900', color: THEME.primary, letterSpacing: -1 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f2f4f6', alignItems: 'center', justifyContent: 'center' },
  scrollContent: { padding: 24, paddingBottom: 100 },
  titleSection: { marginBottom: 24 },
  title: { fontSize: 32, fontWeight: '800', color: THEME.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 16, color: THEME.textSecondary, fontWeight: '500', marginTop: 4 },
  searchSection: { gap: 16, marginBottom: 32 },
  searchWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#eceef0', borderRadius: 16, paddingHorizontal: 16, height: 56 },
  searchIcon: { marginRight: 12 },
  searchInput: { flex: 1, fontSize: 16, color: THEME.text, fontWeight: '500' },
  filterRow: { gap: 8, paddingRight: 24 },
  filterButtonPrimary: { flexDirection: 'row', alignItems: 'center', backgroundColor: THEME.primary, paddingHorizontal: 20, height: 40, borderRadius: 12, gap: 8 },
  filterTextPrimary: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  filterButton: { backgroundColor: '#eceef0', paddingHorizontal: 20, height: 40, borderRadius: 12, justifyContent: 'center' },
  filterText: { color: THEME.textSecondary, fontSize: 14, fontWeight: '600' },
  historyList: { gap: 16 },
  dateLabel: { fontSize: 10, fontWeight: '800', color: '#727783', letterSpacing: 2, marginBottom: 8 },
  historyCard: { backgroundColor: THEME.surface, borderRadius: 24, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  criticalCard: { borderLeftWidth: 4, borderLeftColor: THEME.error },
  cardTop: { flexDirection: 'row', gap: 16, marginBottom: 24 },
  cardIconWrapper: { width: 56, height: 56, borderRadius: 16, backgroundColor: '#ba1a1a10', alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1, gap: 4 },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  criticalBadge: { backgroundColor: '#ba1a1a20', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  criticalBadgeText: { fontSize: 10, fontWeight: '800', color: THEME.error, letterSpacing: -0.5 },
  timeText: { fontSize: 12, color: THEME.textSecondary, fontWeight: '500' },
  cardTitle: { fontSize: 18, fontWeight: '700', color: THEME.text, lineHeight: 22 },
  cardSubtitle: { fontSize: 14, color: THEME.textSecondary },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTopWidth: 1, borderTopColor: '#eceef0' },
  footerLabel: { fontSize: 10, fontWeight: '800', color: '#727783', letterSpacing: 0.5 },
  footerStatusCritical: { fontSize: 14, fontWeight: '700', color: THEME.error },
  viewButton: { backgroundColor: '#005eb8', paddingHorizontal: 24, height: 48, borderRadius: 12, justifyContent: 'center' },
  viewButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  itemCard: { backgroundColor: '#f2f4f6', borderRadius: 24, padding: 24, marginBottom: 12 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  itemIconWrapper: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  itemTime: { fontSize: 12, color: THEME.textSecondary, fontWeight: '500' },
  itemBody: { gap: 4 },
  itemTitle: { fontSize: 16, fontWeight: '700', color: THEME.text },
  itemSubtitle: { fontSize: 14, color: THEME.textSecondary, marginBottom: 16 },
  itemStatus: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemStatusText: { fontSize: 12, fontWeight: '700', color: THEME.primary },
});
