// FILE: app/(tabs)/messages.tsx
// Phase 5 — Pillar E: Doctor–Patient Messaging
//   - Doctor view: list of linked patients with last-message preview + unread badge
//   - Patient view: single thread with linked doctor
//   - Thread view (shared): scrollable bubbles, send bar, read receipts
//   - Attach scan: last-5-scans thumbnail picker
//   - Real-time via onSnapshot
//   - RBAC: doctors → any linked patient; patients → their linked doctor only
//   - All writes go through sendMessage() which calls writeAuditLog

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore';
import {
  Send,
  ChevronLeft,
  Paperclip,
  CheckCheck,
  Check,
  MessageCircle,
} from 'lucide-react-native';

import { useAuthContext } from '@/contexts/auth-context';
import {
  sendMessage,
  getThreadMessages,
  markMessageRead,
  getLinkedPatients,
  getScanHistory,
  type MessageDoc,
  type StoredScanResult,
  type UserProfile,
} from '@/lib/firestore-service';
import { db } from '@/lib/firebase';

// ─────────────────────────────────────────────────────────────────────────────
//  Design tokens (match codebase palette)
// ─────────────────────────────────────────────────────────────────────────────

const T = {
  primary:       '#00478d',
  primaryLight:  '#cce0ff',
  background:    '#f7f9fb',
  surface:       '#ffffff',
  text:          '#191c1e',
  textSecondary: '#424752',
  border:        '#e0e3e5',
  sent:          '#00478d',       // sender bubble
  received:      '#f2f4f6',       // recipient bubble
  sentText:      '#ffffff',
  receivedText:  '#191c1e',
  unread:        '#ba1a1a',
  muted:         '#94a3b8',
  attachBg:      '#edf3ff',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Thread ID helper  —  always  smaller_uid + '_' + larger_uid
// ─────────────────────────────────────────────────────────────────────────────

function buildThreadId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('_');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Root — decides Doctor list view vs Patient single thread
// ─────────────────────────────────────────────────────────────────────────────

export default function MessagesScreen(): React.ReactElement {
  const { user, role } = useAuthContext();

  if (!user) return <LoadingView />;

  return role === 'doctor'
    ? <DoctorInbox doctorId={user.uid} />
    : <PatientThread patientId={user.uid} />;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DOCTOR INBOX — list of patient conversation rows
// ─────────────────────────────────────────────────────────────────────────────

interface ThreadSummary {
  patient:       UserProfile;
  lastMessage:   MessageDoc | null;
  unreadCount:   number;
}

function DoctorInbox({ doctorId }: { doctorId: string }): React.ReactElement {
  const [summaries,  setSummaries]  = useState<ThreadSummary[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [activeThread, setActiveThread] = useState<{ patient: UserProfile } | null>(null);

  // Load linked patients once, then subscribe to each thread for live previews
  useEffect(() => {
    let mounted = true;
    const unsubscribers: (() => void)[] = [];

    (async () => {
      try {
        const patients = await getLinkedPatients(doctorId);
        if (!mounted) return;

        const initial: ThreadSummary[] = patients.map((p) => ({
          patient:     p,
          lastMessage: null,
          unreadCount: 0,
        }));
        setSummaries(initial);
        setLoading(false);

        // Subscribe to each thread for live last-message updates
        patients.forEach((patient) => {
          const threadId = buildThreadId(doctorId, patient.uid);
          const q = query(
            collection(db, 'messages'),
            orderBy('timestamp', 'desc'),
            limit(1),
          );

          // We use a where clause equivalent via client-side filter inside onSnapshot
          // because composite indexes aren't guaranteed in dev.
          // Production: add a composite index on (threadId, timestamp).
          const threadQ = query(
            collection(db, 'messages'),
            orderBy('timestamp', 'desc'),
            limit(50), // fetch recent batch, filter client-side
          );

          const unsub = onSnapshot(threadQ, (snap) => {
            if (!mounted) return;
            const threadMessages = snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<MessageDoc, 'id'>) }))
              .filter((m) => m.threadId === threadId && !m._deleted);

            const last      = threadMessages[0] ?? null;
            const unread    = threadMessages.filter(
              (m) => m.recipientId === doctorId && !m.readAt,
            ).length;

            setSummaries((prev) =>
              prev.map((s) =>
                s.patient.uid === patient.uid
                  ? { ...s, lastMessage: last, unreadCount: unread }
                  : s,
              ),
            );
          });

          unsubscribers.push(unsub);
        });
      } catch (err) {
        console.error('HEMO-EDGE: DoctorInbox load ->', err);
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
      unsubscribers.forEach((u) => u());
    };
  }, [doctorId]);

  // ── Thread open ──────────────────────────────────────────────────────────

  if (activeThread) {
    return (
      <ThreadView
        myId={doctorId}
        myRole="doctor"
        otherId={activeThread.patient.uid}
        otherName={activeThread.patient.fullName}
        onBack={() => setActiveThread(null)}
      />
    );
  }

  if (loading) return <LoadingView />;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.inboxHeader}>
        <MessageCircle color={T.primary} size={20} />
        <Text style={styles.inboxTitle}>Messages</Text>
      </View>

      {summaries.length === 0 ? (
        <EmptyState message="No linked patients yet. Link a patient to start messaging." />
      ) : (
        <FlatList
          data={summaries}
          keyExtractor={(item) => item.patient.uid}
          contentContainerStyle={{ paddingBottom: 24 }}
          renderItem={({ item }) => (
            <PatientRow
              summary={item}
              onPress={() => setActiveThread({ patient: item.patient })}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  PatientRow — single inbox row for DoctorInbox
// ─────────────────────────────────────────────────────────────────────────────

interface PatientRowProps {
  summary: ThreadSummary;
  onPress: () => void;
}

function PatientRow({ summary, onPress }: PatientRowProps): React.ReactElement {
  const { patient, lastMessage, unreadCount } = summary;
  const initials = patient.fullName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const preview = lastMessage
    ? lastMessage.text.length > 48
      ? lastMessage.text.slice(0, 48) + '…'
      : lastMessage.text
    : 'No messages yet';

  const timeLabel = lastMessage?.timestamp
    ? formatTime(lastMessage.timestamp as Timestamp)
    : '';

  return (
    <TouchableOpacity style={styles.patientRow} onPress={onPress} activeOpacity={0.7}>
      {/* Avatar */}
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>

      {/* Content */}
      <View style={styles.rowContent}>
        <View style={styles.rowTop}>
          <Text style={styles.rowName}>{patient.fullName}</Text>
          <Text style={styles.rowTime}>{timeLabel}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text
            style={[styles.rowPreview, unreadCount > 0 && styles.rowPreviewBold]}
            numberOfLines={1}
          >
            {preview}
          </Text>
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATIENT THREAD — auto-opens the single doctor thread
// ─────────────────────────────────────────────────────────────────────────────

function PatientThread({ patientId }: { patientId: string }): React.ReactElement {
  const [doctorId,   setDoctorId]   = useState<string | null>(null);
  const [doctorName, setDoctorName] = useState('My Doctor');
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    let mounted = true;
    // Fetch linked doctor from /patients/{patientId}/linkedDoctor or /users lookup
    // Following the existing pattern: check /doctors collection for who linked this patient
    (async () => {
      try {
        // Query all doctors' patient subcollections for this patientId
        // Simpler: read linkedDoctorId stored on the user doc at registration
        const { getDoc, doc } = await import('firebase/firestore');
        const snap = await getDoc(doc(db, 'users', patientId));
        if (!mounted) return;
        if (snap.exists()) {
          const data = snap.data() as { linkedDoctorId?: string; linkedDoctorName?: string };
          if (data.linkedDoctorId) {
            setDoctorId(data.linkedDoctorId);
            setDoctorName(data.linkedDoctorName ?? 'My Doctor');
          }
        }
        setLoading(false);
      } catch (err) {
        console.error('HEMO-EDGE: PatientThread doctor lookup ->', err);
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [patientId]);

  if (loading) return <LoadingView />;

  if (!doctorId) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <EmptyState message="No linked doctor found. Ask your doctor to link your account." />
      </SafeAreaView>
    );
  }

  return (
    <ThreadView
      myId={patientId}
      myRole="patient"
      otherId={doctorId}
      otherName={doctorName}
      onBack={null}   // patients have no back destination — tab nav handles it
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  THREAD VIEW — shared by doctor and patient
// ─────────────────────────────────────────────────────────────────────────────

interface ThreadViewProps {
  myId:      string;
  myRole:    'doctor' | 'patient';
  otherId:   string;
  otherName: string;
  onBack:    (() => void) | null;
}

function ThreadView({ myId, myRole, otherId, otherName, onBack }: ThreadViewProps): React.ReactElement {
  const threadId = buildThreadId(myId, otherId);

  const [messages,       setMessages]       = useState<MessageDoc[]>([]);
  const [inputText,      setInputText]      = useState('');
  const [isSending,      setIsSending]      = useState(false);
  const [showScanner,    setShowScanner]    = useState(false);
  const [recentScans,    setRecentScans]    = useState<StoredScanResult[]>([]);
  const [attachedScanId, setAttachedScanId] = useState<string | null>(null);
  const [scansLoading,   setScansLoading]   = useState(false);

  const flatListRef = useRef<FlatList<MessageDoc>>(null);

  // ── Real-time onSnapshot for thread messages ────────────────────────────

  useEffect(() => {
    const q = query(
      collection(db, 'messages'),
      orderBy('timestamp', 'asc'),
      limit(100),
    );

    const unsub = onSnapshot(q, (snap) => {
      const all = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<MessageDoc, 'id'>) }))
        .filter((m) => m.threadId === threadId && !m._deleted);

      setMessages(all);

      // Mark unread messages as read
      all
        .filter((m) => m.recipientId === myId && !m.readAt)
        .forEach((m) => {
          if (m.id) markMessageRead(m.id).catch(() => {});
        });

      // Scroll to bottom
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
    });

    return () => unsub();
  }, [threadId, myId]);

  // ── Send message ────────────────────────────────────────────────────────

  const handleSend = useCallback(async (): Promise<void> => {
    const text = inputText.trim();
    if (!text || isSending) return;

    setIsSending(true);
    setInputText('');
    setAttachedScanId(null);
    setShowScanner(false);

    try {
      await sendMessage({
        threadId,
        senderId:      myId,
        senderRole:    myRole,
        recipientId:   otherId,
        text,
        timestamp:     Timestamp.now(),
        _deleted:      false,
        ...(attachedScanId ? { attachedScanId } : {}),
      });
    } catch (err) {
      console.error('HEMO-EDGE: sendMessage ->', err);
    } finally {
      setIsSending(false);
    }
  }, [inputText, isSending, threadId, myId, myRole, otherId, attachedScanId]);

  // ── Load recent scans for attachment picker ─────────────────────────────

  const openScanPicker = useCallback(async (): Promise<void> => {
    setShowScanner((prev) => !prev);
    if (!showScanner && recentScans.length === 0) {
      setScansLoading(true);
      try {
        const scans = await getScanHistory(myId);
        setRecentScans(scans.slice(0, 5));
      } catch (err) {
        console.error('HEMO-EDGE: scan picker load ->', err);
      } finally {
        setScansLoading(false);
      }
    }
  }, [showScanner, recentScans, myId]);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={styles.threadHeader}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ChevronLeft color={T.primary} size={24} />
          </TouchableOpacity>
        )}
        <View style={styles.threadHeaderAvatar}>
          <Text style={styles.threadHeaderInitial}>
            {otherName[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.threadHeaderName}>{otherName}</Text>
          <Text style={styles.threadHeaderRole}>
            {myRole === 'doctor' ? 'Patient' : 'Doctor'}
          </Text>
        </View>
      </View>

      {/* ── Message list ──────────────────────────────────────────────────── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(m) => m.id ?? `${m.timestamp?.seconds}-${Math.random()}`}
          contentContainerStyle={styles.messageList}
          renderItem={({ item, index }) => (
            <MessageBubble
              message={item}
              isMine={item.senderId === myId}
              showDate={shouldShowDate(messages, index)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyThread}>
              <MessageCircle color={T.border} size={40} />
              <Text style={styles.emptyThreadText}>No messages yet. Say hello!</Text>
            </View>
          }
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />

        {/* ── Scan attachment picker ─────────────────────────────────────── */}
        {showScanner && (
          <View style={styles.scanPicker}>
            <Text style={styles.scanPickerTitle}>Attach a scan</Text>
            {scansLoading ? (
              <ActivityIndicator size="small" color={T.primary} style={{ marginVertical: 12 }} />
            ) : recentScans.length === 0 ? (
              <Text style={styles.scanPickerEmpty}>No recent scans found.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                {recentScans.map((scan) => (
                  <TouchableOpacity
                    key={scan.id}
                    style={[
                      styles.scanThumb,
                      attachedScanId === scan.id && styles.scanThumbSelected,
                    ]}
                    onPress={() =>
                      setAttachedScanId((prev) => (prev === scan.id ? null : scan.id))
                    }
                  >
                    {scan.imageUri ? (
                      <Image source={{ uri: scan.imageUri }} style={styles.scanThumbImage} />
                    ) : (
                      <View style={styles.scanThumbPlaceholder}>
                        <Text style={styles.scanThumbLabel} numberOfLines={2}>{scan.caseId}</Text>
                      </View>
                    )}
                    <Text style={styles.scanThumbDate} numberOfLines={1}>
                      {new Date(scan.analyzedOn).toLocaleDateString('en-IN', {
                        day: '2-digit', month: 'short',
                      })}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            {attachedScanId && (
              <View style={styles.attachedBadge}>
                <Text style={styles.attachedBadgeText}>
                  Scan attached · Tap again to remove
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── Input bar ─────────────────────────────────────────────────── */}
        <View style={styles.inputBar}>
          <TouchableOpacity
            style={[styles.attachBtn, showScanner && styles.attachBtnActive]}
            onPress={openScanPicker}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Paperclip
              size={20}
              color={showScanner ? T.primary : T.textSecondary}
            />
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message…"
            placeholderTextColor={T.muted}
            multiline
            maxLength={1000}
            returnKeyType="default"
          />

          <TouchableOpacity
            style={[
              styles.sendBtn,
              (!inputText.trim() || isSending) && styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={!inputText.trim() || isSending}
          >
            {isSending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Send size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  MessageBubble
// ─────────────────────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message:  MessageDoc;
  isMine:   boolean;
  showDate: boolean;
}

function MessageBubble({ message, isMine, showDate }: MessageBubbleProps): React.ReactElement {
  const timeLabel = message.timestamp
    ? formatTime(message.timestamp as Timestamp)
    : '';

  return (
    <>
      {showDate && (
        <View style={styles.dateSeparator}>
          <Text style={styles.dateSeparatorText}>
            {formatDate(message.timestamp as Timestamp)}
          </Text>
        </View>
      )}

      <View style={[styles.bubbleRow, isMine ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <View
          style={[
            styles.bubble,
            isMine ? styles.bubbleSent : styles.bubbleReceived,
          ]}
        >
          {/* Attached scan badge */}
          {message.attachedScanId && (
            <View style={styles.attachedScanBadge}>
              <Paperclip size={11} color={isMine ? '#ffffffaa' : T.primary} />
              <Text
                style={[
                  styles.attachedScanText,
                  { color: isMine ? '#ffffffcc' : T.primary },
                ]}
              >
                Scan attached
              </Text>
            </View>
          )}

          <Text style={[styles.bubbleText, isMine ? styles.bubbleTextSent : styles.bubbleTextReceived]}>
            {message.text}
          </Text>

          {/* Timestamp + read receipt */}
          <View style={styles.bubbleMeta}>
            <Text style={[styles.bubbleTime, { color: isMine ? '#ffffffaa' : T.muted }]}>
              {timeLabel}
            </Text>
            {isMine && (
              message.readAt
                ? <CheckCheck size={12} color="#ffffffaa" style={{ marginLeft: 4 }} />
                : <Check size={12} color="#ffffff66" style={{ marginLeft: 4 }} />
            )}
          </View>
        </View>
      </View>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatTime(ts: Timestamp | undefined): string {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date((ts as unknown as { seconds: number }).seconds * 1000);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDate(ts: Timestamp | undefined): string {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date((ts as unknown as { seconds: number }).seconds * 1000);
  const today     = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString())     return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function shouldShowDate(messages: MessageDoc[], index: number): boolean {
  if (index === 0) return true;
  const prev = messages[index - 1];
  const curr = messages[index];
  if (!prev?.timestamp || !curr?.timestamp) return false;

  const prevTs = prev.timestamp as Timestamp;
  const currTs = curr.timestamp as Timestamp;

  const prevDate = prevTs.toDate ? prevTs.toDate() : new Date((prevTs as unknown as { seconds: number }).seconds * 1000);
  const currDate = currTs.toDate ? currTs.toDate() : new Date((currTs as unknown as { seconds: number }).seconds * 1000);

  return prevDate.toDateString() !== currDate.toDateString();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Shared small components
// ─────────────────────────────────────────────────────────────────────────────

function LoadingView(): React.ReactElement {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: T.background }}>
      <ActivityIndicator size="large" color={T.primary} />
    </View>
  );
}

function EmptyState({ message }: { message: string }): React.ReactElement {
  return (
    <View style={styles.emptyState}>
      <MessageCircle color={T.border} size={36} />
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:           { flex: 1, backgroundColor: T.background },

  // ── Inbox ────────────────────────────────────────────────────────────────
  inboxHeader:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 16, backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.border },
  inboxTitle:          { fontSize: 20, fontWeight: '800', color: T.text },
  separator:           { height: 1, backgroundColor: T.border, marginLeft: 80 },

  patientRow:          { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14, backgroundColor: T.surface },
  avatar:              { width: 48, height: 48, borderRadius: 24, backgroundColor: T.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText:          { fontSize: 18, fontWeight: '800', color: T.primary },
  rowContent:          { flex: 1, gap: 3 },
  rowTop:              { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowName:             { fontSize: 15, fontWeight: '700', color: T.text },
  rowTime:             { fontSize: 11, color: T.muted },
  rowBottom:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowPreview:          { fontSize: 13, color: T.textSecondary, flex: 1 },
  rowPreviewBold:      { fontWeight: '700', color: T.text },
  badge:               { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: T.unread, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText:           { fontSize: 10, fontWeight: '800', color: '#fff' },

  // ── Thread ───────────────────────────────────────────────────────────────
  threadHeader:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.border },
  backBtn:             { marginRight: 4 },
  threadHeaderAvatar:  { width: 38, height: 38, borderRadius: 19, backgroundColor: T.primaryLight, alignItems: 'center', justifyContent: 'center' },
  threadHeaderInitial: { fontSize: 16, fontWeight: '800', color: T.primary },
  threadHeaderName:    { fontSize: 15, fontWeight: '700', color: T.text },
  threadHeaderRole:    { fontSize: 11, color: T.muted },

  messageList:         { paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 8 },

  bubbleRow:           { marginVertical: 3 },
  bubbleRowRight:      { alignItems: 'flex-end' },
  bubbleRowLeft:       { alignItems: 'flex-start' },
  bubble:              { maxWidth: '78%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  bubbleSent:          { backgroundColor: T.sent, borderBottomRightRadius: 4 },
  bubbleReceived:      { backgroundColor: T.received, borderBottomLeftRadius: 4 },
  bubbleText:          { fontSize: 14, lineHeight: 20 },
  bubbleTextSent:      { color: T.sentText },
  bubbleTextReceived:  { color: T.receivedText },
  bubbleMeta:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  bubbleTime:          { fontSize: 10 },

  attachedScanBadge:   { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  attachedScanText:    { fontSize: 11 },

  dateSeparator:       { alignItems: 'center', marginVertical: 12 },
  dateSeparatorText:   { fontSize: 11, color: T.muted, backgroundColor: '#e9ecef', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },

  // ── Input bar ────────────────────────────────────────────────────────────
  inputBar:            { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingVertical: 10, paddingBottom: Platform.OS === 'ios' ? 10 : 10, backgroundColor: T.surface, borderTopWidth: 1, borderTopColor: T.border },
  attachBtn:           { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  attachBtnActive:     { backgroundColor: T.primaryLight },
  input:               { flex: 1, minHeight: 38, maxHeight: 120, backgroundColor: T.background, borderRadius: 20, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, fontSize: 14, color: T.text },
  sendBtn:             { width: 38, height: 38, borderRadius: 19, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled:     { backgroundColor: T.border },

  // ── Scan picker ──────────────────────────────────────────────────────────
  scanPicker:          { backgroundColor: T.surface, borderTopWidth: 1, borderTopColor: T.border, paddingHorizontal: 16, paddingVertical: 12 },
  scanPickerTitle:     { fontSize: 12, fontWeight: '700', color: T.textSecondary, letterSpacing: 0.5 },
  scanPickerEmpty:     { fontSize: 13, color: T.muted, marginTop: 8 },
  scanThumb:           { width: 72, height: 88, borderRadius: 12, marginRight: 10, borderWidth: 2, borderColor: T.border, overflow: 'hidden', backgroundColor: T.attachBg },
  scanThumbSelected:   { borderColor: T.primary },
  scanThumbImage:      { width: '100%', height: 56, resizeMode: 'cover' },
  scanThumbPlaceholder:{ width: '100%', height: 56, alignItems: 'center', justifyContent: 'center', padding: 4 },
  scanThumbLabel:      { fontSize: 9, fontWeight: '700', color: T.primary, textAlign: 'center' },
  scanThumbDate:       { fontSize: 9, color: T.muted, textAlign: 'center', paddingHorizontal: 4, paddingTop: 4 },
  attachedBadge:       { marginTop: 8, backgroundColor: T.primaryLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  attachedBadgeText:   { fontSize: 11, color: T.primary, fontWeight: '600' },

  // ── Shared empty states ──────────────────────────────────────────────────
  emptyState:          { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyText:           { fontSize: 14, color: T.textSecondary, textAlign: 'center', lineHeight: 20 },
  emptyThread:         { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  emptyThreadText:     { fontSize: 14, color: T.muted, textAlign: 'center' },
});
