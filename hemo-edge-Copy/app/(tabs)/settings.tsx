// FILE: app/(tabs)/settings.tsx
// Phase 5 — Pillar B: Settings screen
// Sections: Profile · Notifications · Data Residency · Consent · GDPR Export · Account
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path, Rect, Line, Polyline } from 'react-native-svg';

import { useAuthContext } from '@/contexts/auth-context';
import { LogoutButton } from '@/components/logout-button';
import { SwitchAccountModal } from '@/components/switch-account-modal';
import {
  getUserPreferences,
  saveUserPreferences,
  buildGDPRExport,
  type UserPreferencesDoc,
  type SupportedLocale,
  type UserPreferencesInput,
} from '@/lib/firestore-service';
import type { CachedAccount } from '@/hooks/use-auth';

// ─────────────────────────────────────────────────────────────────────────────
//  Small SVG icons (react-native-svg only, no third-party icon pack)
// ─────────────────────────────────────────────────────────────────────────────

const ICON_SIZE = 20;
const ICON_COLOR = '#00478d';

function PersonIcon(): React.ReactElement {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8" r="4" stroke={ICON_COLOR} strokeWidth="1.8" />
      <Path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={ICON_COLOR} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

function BellIcon(): React.ReactElement {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <Path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke={ICON_COLOR} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M13.73 21a2 2 0 0 1-3.46 0" stroke={ICON_COLOR} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

function GlobeIcon(): React.ReactElement {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={ICON_COLOR} strokeWidth="1.8" />
      <Path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10A15.3 15.3 0 0 1 8 12 15.3 15.3 0 0 1 12 2z" stroke={ICON_COLOR} strokeWidth="1.8" />
    </Svg>
  );
}

function ShieldIcon(): React.ReactElement {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke={ICON_COLOR} strokeWidth="1.8" strokeLinejoin="round" />
      <Polyline points="9,12 11,14 15,10" stroke={ICON_COLOR} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function DownloadIcon(): React.ReactElement {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke={ICON_COLOR} strokeWidth="1.8" strokeLinecap="round" />
      <Polyline points="7,10 12,15 17,10" stroke={ICON_COLOR} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="12" y1="15" x2="12" y2="3" stroke={ICON_COLOR} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

function UsersIcon(): React.ReactElement {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke={ICON_COLOR} strokeWidth="1.8" strokeLinecap="round" />
      <Circle cx="9" cy="7" r="4" stroke={ICON_COLOR} strokeWidth="1.8" />
      <Path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke={ICON_COLOR} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

function LanguageIcon(): React.ReactElement {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <Path d="M5 8l6 6" stroke={ICON_COLOR} strokeWidth="1.8" strokeLinecap="round" />
      <Path d="M4 6h7M2 16h5M12 6l4 10 4-10" stroke={ICON_COLOR} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ChevronIcon({ open }: { open: boolean }): React.ReactElement {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path
        d={open ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'}
        stroke="#7a8694"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  doctor:  '#0077b6',
  patient: '#2a9d8f',
  admin:   '#e76f51',
};

const DATA_RESIDENCY_OPTIONS: { label: string; value: string }[] = [
  { label: 'Mumbai (in-south1)',      value: 'in-south1'       },
  { label: 'Delhi (in-west1)',        value: 'in-west1'        },
  { label: 'Singapore (asia-southeast1)', value: 'asia-southeast1' },
  { label: 'EU (europe-west1)',       value: 'europe-west1'    },
  { label: 'US East (us-east1)',      value: 'us-east1'        },
];

const LANGUAGE_OPTIONS: { label: string; value: SupportedLocale }[] = [
  { label: 'English',    value: 'en' },
  { label: 'हिन्दी (Hindi)',   value: 'hi' },
  { label: 'मराठी (Marathi)', value: 'mr' },
  { label: 'தமிழ் (Tamil)',   value: 'ta' },
  { label: 'తెలుగు (Telugu)', value: 'te' },
  { label: 'বাংলা (Bengali)', value: 'bn' },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  icon:  React.ReactElement;
  title: string;
}

function SectionHeader({ icon, title }: SectionHeaderProps): React.ReactElement {
  return (
    <View style={styles.sectionHeader}>
      {icon}
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

interface SettingsRowProps {
  label:       string;
  sublabel?:   string;
  right:       React.ReactNode;
  onPress?:    () => void;
  disabled?:   boolean;
}

function SettingsRow({ label, sublabel, right, onPress, disabled }: SettingsRowProps): React.ReactElement {
  const inner = (
    <View style={[styles.row, disabled && styles.rowDisabled]}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sublabel ? <Text style={styles.rowSublabel}>{sublabel}</Text> : null}
      </View>
      <View style={styles.rowRight}>{right}</View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => pressed ? { opacity: 0.65 } : undefined}
        accessibilityRole="button"
      >
        {inner}
      </Pressable>
    );
  }
  return inner;
}

interface DropdownPickerProps<T extends string> {
  options:  { label: string; value: T }[];
  selected: T;
  onSelect: (value: T) => void;
  disabled?: boolean;
}

function DropdownPicker<T extends string>({
  options,
  selected,
  onSelect,
  disabled,
}: DropdownPickerProps<T>): React.ReactElement {
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find((o) => o.value === selected)?.label ?? selected;

  return (
    <View style={styles.dropdownWrapper}>
      <Pressable
        onPress={() => !disabled && setOpen((v) => !v)}
        style={({ pressed }) => [
          styles.dropdownTrigger,
          disabled && styles.dropdownDisabled,
          pressed && { opacity: 0.7 },
        ]}
        accessibilityRole="combobox"
        accessibilityState={{ expanded: open, disabled }}
      >
        <Text style={styles.dropdownTriggerText} numberOfLines={1}>
          {selectedLabel}
        </Text>
        <ChevronIcon open={open} />
      </Pressable>

      {open && (
        <View style={styles.dropdownMenu}>
          {options.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => { onSelect(opt.value); setOpen(false); }}
              style={({ pressed }) => [
                styles.dropdownOption,
                opt.value === selected && styles.dropdownOptionSelected,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="menuitem"
              accessibilityState={{ selected: opt.value === selected }}
            >
              <Text
                style={[
                  styles.dropdownOptionText,
                  opt.value === selected && styles.dropdownOptionTextSelected,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main screen
// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsScreen(): React.ReactElement {
  const { user, role, cachedAccounts } = useAuthContext() as ReturnType<typeof useAuthContext> & {
    cachedAccounts?: CachedAccount[];
  };

  const isDoctor = role === 'doctor';
  const isAdmin  = role === 'admin';

  // ── Preferences state ────────────────────────────────────────────────────
  const [prefs,       setPrefs]       = useState<UserPreferencesDoc | null>(null);
  const [isLoading,   setIsLoading]   = useState(true);
  const [isSaving,    setIsSaving]    = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // ── Account switcher modal state ─────────────────────────────────────────
  const [showSwitchModal, setShowSwitchModal] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Load preferences on mount ────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    setIsLoading(true);
    getUserPreferences(user.uid)
      .then((p) => { if (mountedRef.current) setPrefs(p); })
      .catch((err) => {
        console.error('HEMO-EDGE: load prefs failed ->', err);
        Alert.alert('Error', 'Could not load your preferences.');
      })
      .finally(() => { if (mountedRef.current) setIsLoading(false); });
  }, [user?.uid]);

  // ── Persist a partial update ─────────────────────────────────────────────
  const persist = useCallback(
    async (partial: Partial<UserPreferencesInput>): Promise<void> => {
      if (!user?.uid || !prefs) return;
      const optimistic = { ...prefs, ...partial } as UserPreferencesDoc;
      setPrefs(optimistic);   // optimistic update
      setIsSaving(true);
      try {
        await saveUserPreferences(user.uid, partial, role ?? 'patient');
      } catch (err) {
        console.error('HEMO-EDGE: saveUserPreferences failed ->', err);
        // Rollback optimistic update
        if (mountedRef.current) setPrefs(prefs);
        Alert.alert('Error', 'Could not save preference. Please try again.');
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [user?.uid, prefs, role],
  );

  // ── GDPR Export ──────────────────────────────────────────────────────────
  const handleGDPRExport = useCallback(async (): Promise<void> => {
    if (!user?.uid) return;
    setIsExporting(true);
    try {
      const exportData = await buildGDPRExport(user.uid);
      const json       = JSON.stringify(exportData, null, 2);

      await Share.share(
        {
          title:   'Hemo-Edge Data Export',
          message: Platform.OS === 'android' ? json : undefined,
          url:     Platform.OS === 'ios'
            ? `data:application/json;base64,${btoa(unescape(encodeURIComponent(json)))}`
            : undefined,
        },
        { dialogTitle: 'Export your Hemo-Edge data' },
      );
    } catch (err) {
      console.error('HEMO-EDGE: GDPR export failed ->', err);
      Alert.alert('Export Failed', 'Could not generate your data export. Please try again.');
    } finally {
      if (mountedRef.current) setIsExporting(false);
    }
  }, [user?.uid]);

  // ─────────────────────────────────────────────────────────────────────────
  //  Loading state
  // ─────────────────────────────────────────────────────────────────────────

  if (isLoading || !prefs) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#00478d" />
        <Text style={styles.loadingText}>Loading preferences…</Text>
      </View>
    );
  }

  const roleColor = ROLE_COLORS[role ?? 'patient'] ?? '#7a8694';
  const maskedUid = user?.uid
    ? `${user.uid.slice(0, 6)}••••••${user.uid.slice(-4)}`
    : '—';

  // ─────────────────────────────────────────────────────────────────────────
  //  Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Saving indicator ─────────────────────────────────────────────── */}
      {isSaving && (
        <View style={styles.savingBanner} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color="#00478d" />
          <Text style={styles.savingText}>Saving…</Text>
        </View>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 1 — Profile
      ════════════════════════════════════════════════════════════════════ */}
      <View style={styles.card}>
        <SectionHeader icon={<PersonIcon />} title="Profile" />

        {/* Avatar + name row */}
        <View style={styles.profileRow}>
          <View style={[styles.profileAvatar, { backgroundColor: roleColor + '18' }]}>
            <PersonIcon />
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName} numberOfLines={1}>
              {user?.displayName ?? user?.email ?? 'Unknown User'}
            </Text>
            <View style={[styles.roleBadge, { backgroundColor: roleColor + '15' }]}>
              <Text style={[styles.roleBadgeText, { color: roleColor }]}>
                {role ?? 'unknown'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        <SettingsRow
          label="User ID"
          sublabel="Masked for security"
          right={<Text style={styles.monoText}>{maskedUid}</Text>}
        />
        <SettingsRow
          label="Email"
          right={
            <Text style={styles.valueText} numberOfLines={1}>
              {user?.email ?? '—'}
            </Text>
          }
        />
      </View>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 2 — Notifications
      ════════════════════════════════════════════════════════════════════ */}
      <View style={styles.card}>
        <SectionHeader icon={<BellIcon />} title="Notifications" />

        <SettingsRow
          label="Push Notifications"
          sublabel="Critical alerts & scan results"
          right={
            <Switch
              value={prefs.notificationsEnabled}
              onValueChange={(val) => persist({ notificationsEnabled: val })}
              trackColor={{ false: '#e0e3e5', true: '#00478d40' }}
              thumbColor={prefs.notificationsEnabled ? '#00478d' : '#b0bec5'}
              accessibilityLabel="Toggle push notifications"
            />
          }
        />

        {/* SMS alerts — doctor and admin only */}
        {(isDoctor || isAdmin) && (
          <>
            <View style={styles.rowDivider} />
            <SettingsRow
              label="SMS Alerts"
              sublabel="Critical blast threshold alerts via SMS"
              right={
                <Switch
                  value={prefs.smsAlertsEnabled}
                  onValueChange={(val) => persist({ smsAlertsEnabled: val })}
                  trackColor={{ false: '#e0e3e5', true: '#00478d40' }}
                  thumbColor={prefs.smsAlertsEnabled ? '#00478d' : '#b0bec5'}
                  accessibilityLabel="Toggle SMS alerts"
                />
              }
            />
          </>
        )}
      </View>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 3 — Language
      ════════════════════════════════════════════════════════════════════ */}
      <View style={styles.card}>
        <SectionHeader icon={<LanguageIcon />} title="Language" />

        <View style={styles.dropdownRow}>
          <View style={styles.dropdownRowLabel}>
            <Text style={styles.rowLabel}>App Language</Text>
            <Text style={styles.rowSublabel}>Applies immediately</Text>
          </View>
          <DropdownPicker<SupportedLocale>
            options={LANGUAGE_OPTIONS}
            selected={prefs.language}
            onSelect={(val) => {
              persist({ language: val });
              // Phase 5 Pillar H: also call changeLanguage(val) here
              // import { changeLanguage } from '@/lib/i18n';
              // changeLanguage(val);
            }}
          />
        </View>
      </View>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 4 — Data & Privacy
      ════════════════════════════════════════════════════════════════════ */}
      <View style={styles.card}>
        <SectionHeader icon={<GlobeIcon />} title="Data & Privacy" />

        <View style={styles.dropdownRow}>
          <View style={styles.dropdownRowLabel}>
            <Text style={styles.rowLabel}>Data Residency</Text>
            <Text style={styles.rowSublabel}>Region where your data is stored</Text>
          </View>
          <DropdownPicker<string>
            options={DATA_RESIDENCY_OPTIONS}
            selected={prefs.dataResidency}
            onSelect={(val) => persist({ dataResidency: val })}
          />
        </View>

        <View style={styles.rowDivider} />

        <SettingsRow
          label="Consent Version"
          sublabel="Read-only — set during registration"
          right={
            <View style={styles.consentBadge}>
              <Text style={styles.consentBadgeText}>v{prefs.consentVersion}</Text>
            </View>
          }
        />
      </View>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 5 — Compliance
      ════════════════════════════════════════════════════════════════════ */}
      <View style={styles.card}>
        <SectionHeader icon={<ShieldIcon />} title="Compliance" />

        <SettingsRow
          label="Export My Data (GDPR)"
          sublabel="Download all your data as JSON"
          onPress={handleGDPRExport}
          right={
            isExporting ? (
              <ActivityIndicator size="small" color="#00478d" />
            ) : (
              <View style={styles.exportButton}>
                <DownloadIcon />
                <Text style={styles.exportButtonText}>Export</Text>
              </View>
            )
          }
        />
      </View>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 6 — Account
      ════════════════════════════════════════════════════════════════════ */}
      <View style={styles.card}>
        <SectionHeader icon={<UsersIcon />} title="Account" />

        {/* Switch Account */}
        <SettingsRow
          label="Switch Account"
          sublabel="Switch between cached accounts"
          onPress={() => setShowSwitchModal(true)}
          right={
            <View style={styles.chevronRight}>
              <ChevronIcon open={false} />
            </View>
          }
        />

        <View style={styles.rowDivider} />

        {/* Sign Out */}
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Text style={[styles.rowLabel, styles.dangerText]}>Sign Out</Text>
            <Text style={styles.rowSublabel}>You will be asked to confirm.</Text>
          </View>
          <LogoutButton size={22} color="#e53935" />
        </View>
      </View>

      {/* ── App version footer ───────────────────────────────────────────── */}
      <Text style={styles.versionFooter}>
        Hemo-Edge · Phase 5 · For clinical use only
      </Text>

      {/* ── Switch Account modal ─────────────────────────────────────────── */}
      <SwitchAccountModal
        visible={showSwitchModal}
        cachedAccounts={cachedAccounts ?? []}
        currentUid={user?.uid}
        onClose={() => setShowSwitchModal(false)}
      />
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: '#f7f9fb',
  },
  content: {
    padding:      16,
    paddingBottom: 48,
    gap:           12,
  },
  centered: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    gap:            12,
    backgroundColor: '#f7f9fb',
  },
  loadingText: {
    fontSize: 14,
    color:    '#7a8694',
  },

  // ── Saving banner ─────────────────────────────────────────────────────────
  savingBanner: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             8,
    backgroundColor: '#e8f0fe',
    borderRadius:    8,
    paddingVertical: 8,
    marginBottom:    4,
  },
  savingText: {
    fontSize:   13,
    fontWeight: '600',
    color:      '#00478d',
  },

  // ── Card ──────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: '#ffffff',
    borderRadius:    14,
    paddingVertical:   8,
    paddingHorizontal: 16,
    // iOS shadow
    shadowColor:   '#000',
    shadowOpacity: 0.05,
    shadowRadius:  6,
    shadowOffset:  { width: 0, height: 2 },
    // Android elevation
    elevation: 2,
  },

  // ── Section header ────────────────────────────────────────────────────────
  sectionHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f2f4',
    marginBottom:   4,
  },
  sectionTitle: {
    fontSize:   13,
    fontWeight: '700',
    color:      '#00478d',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // ── Rows ──────────────────────────────────────────────────────────────────
  row: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    paddingVertical: 13,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowLeft: {
    flex:      1,
    marginRight: 12,
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  rowLabel: {
    fontSize:   14,
    fontWeight: '500',
    color:      '#1a2535',
  },
  rowSublabel: {
    fontSize:  12,
    color:     '#7a8694',
    marginTop:  2,
  },
  rowDivider: {
    height:          1,
    backgroundColor: '#f0f2f4',
    marginHorizontal: -16,
  },
  divider: {
    height:          1,
    backgroundColor: '#f0f2f4',
    marginHorizontal: -16,
    marginBottom:    8,
  },

  // ── Profile ───────────────────────────────────────────────────────────────
  profileRow: {
    flexDirection: 'row',
    alignItems:    'center',
    paddingVertical: 14,
    gap:           12,
  },
  profileAvatar: {
    width:        48,
    height:       48,
    borderRadius: 24,
    alignItems:   'center',
    justifyContent: 'center',
  },
  profileInfo: {
    flex: 1,
    gap:  6,
  },
  profileName: {
    fontSize:   16,
    fontWeight: '700',
    color:      '#1a2535',
  },
  roleBadge: {
    alignSelf:         'flex-start',
    paddingHorizontal: 10,
    paddingVertical:   3,
    borderRadius:      6,
  },
  roleBadgeText: {
    fontSize:      11,
    fontWeight:    '700',
    textTransform: 'capitalize',
  },
  monoText: {
    fontSize:    12,
    fontFamily:  Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color:       '#7a8694',
    letterSpacing: 0.5,
  },
  valueText: {
    fontSize:  13,
    color:     '#7a8694',
    maxWidth:  180,
    textAlign: 'right',
  },

  // ── Dropdown ──────────────────────────────────────────────────────────────
  dropdownRow: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    paddingVertical: 12,
    gap:             12,
  },
  dropdownRowLabel: {
    flex: 1,
  },
  dropdownWrapper: {
    position: 'relative',
    minWidth:  160,
    zIndex:    10,
  },
  dropdownTrigger: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    gap:               6,
    paddingHorizontal: 12,
    paddingVertical:   8,
    borderRadius:      8,
    borderWidth:       1,
    borderColor:       '#c8d0db',
    backgroundColor:   '#f7f9fb',
    minWidth:          160,
  },
  dropdownDisabled: {
    opacity: 0.5,
  },
  dropdownTriggerText: {
    fontSize:  13,
    color:     '#1a2535',
    flex:      1,
  },
  dropdownMenu: {
    position:        'absolute',
    top:             '100%',
    right:           0,
    left:            0,
    backgroundColor: '#ffffff',
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     '#e0e3e5',
    marginTop:       4,
    // iOS shadow
    shadowColor:   '#000',
    shadowOpacity: 0.12,
    shadowRadius:  8,
    shadowOffset:  { width: 0, height: 3 },
    elevation:     6,
    zIndex:        100,
  },
  dropdownOption: {
    paddingHorizontal: 14,
    paddingVertical:   11,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f2f4',
  },
  dropdownOptionSelected: {
    backgroundColor: '#e8f0fe',
  },
  dropdownOptionText: {
    fontSize: 13,
    color:    '#1a2535',
  },
  dropdownOptionTextSelected: {
    fontWeight: '700',
    color:      '#00478d',
  },

  // ── Consent badge ─────────────────────────────────────────────────────────
  consentBadge: {
    backgroundColor:   '#f0f7ff',
    paddingHorizontal: 10,
    paddingVertical:   4,
    borderRadius:      6,
    borderWidth:       1,
    borderColor:       '#c0d4f5',
  },
  consentBadgeText: {
    fontSize:   12,
    fontWeight: '700',
    color:      '#00478d',
  },

  // ── Export button ─────────────────────────────────────────────────────────
  exportButton: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    backgroundColor:   '#e8f0fe',
    paddingHorizontal: 12,
    paddingVertical:   7,
    borderRadius:      8,
  },
  exportButtonText: {
    fontSize:   13,
    fontWeight: '600',
    color:      '#00478d',
  },

  // ── Chevron ───────────────────────────────────────────────────────────────
  chevronRight: {
    transform: [{ rotate: '-90deg' }],
  },

  // ── Danger text ───────────────────────────────────────────────────────────
  dangerText: {
    color: '#e53935',
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  versionFooter: {
    textAlign:  'center',
    fontSize:   11,
    color:      '#b0bec5',
    marginTop:  8,
  },
});
