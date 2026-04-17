// FILE: app/modal.tsx
// Phase 3: Compliance-aware scan share modal (DUA acceptance, audit log).
// Phase 4 Pillar D: Collaboration Module
//   - SVG Annotation Canvas (freehand, circle/lasso, arrow, text label)
//   - 3-colour picker (red, yellow, blue)
//   - Annotation persistence to /scans/{scanId}/annotations
//   - Threaded comments to /scans/{scanId}/comments
//   - Real-time onSnapshot listeners for both collections
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, PanResponder, GestureResponderEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  X, Send, ShieldCheck, AlertTriangle, Lock, Users,
  Pen, Circle, ArrowRight, Type, MessageCircle, Trash2,
} from 'lucide-react-native';
import {
  collection, addDoc, onSnapshot, serverTimestamp,
  query, orderBy, Timestamp,
} from 'firebase/firestore';
import Svg2, {
  Path as SvgPath,
  Circle as SvgCircle,
  Line as SvgLine,
  Text as SvgText,
  G as SvgG,
} from 'react-native-svg';
import { useAuthContext } from '../contexts/auth-context';
import { writeAuditLog } from '../lib/firestore-service';
import { ComplianceColors } from '../constants/theme';
import { db } from '../lib/firebase';

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────
type Recipient = 'specialist' | 'colleague' | 'patient';

const RECIPIENT_LABELS: Record<Recipient, string> = {
  specialist: 'Specialist / Second Opinion',
  colleague:  'Colleague (Same Institution)',
  patient:    'Patient (Direct Access)',
};

const REQUIRES_DUA: Recipient[] = ['specialist'];

// ── Annotation types ──────────────────────────────────────────────────────────

type AnnotationTool = 'freehand' | 'circle' | 'arrow' | 'text';
type AnnotationColor = '#ff3b30' | '#ffcc00' | '#007aff';

interface AnnotationPoint { x: number; y: number; }

interface Annotation {
  id?:        string;   // Firestore doc id (set after write)
  type:       AnnotationTool;
  points:     AnnotationPoint[];
  color:      AnnotationColor;
  label?:     string;   // for 'text' tool
  authorId:   string;
  timestamp:  string;   // ISO
}

// ── Comment types ─────────────────────────────────────────────────────────────

interface ScanComment {
  id?:              string;
  authorId:         string;
  authorRole:       'doctor' | 'patient';
  text:             string;
  timestamp:        string;
  parentCommentId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Canvas dimensions
// ─────────────────────────────────────────────────────────────────────────────

import { Dimensions } from 'react-native';
const CANVAS_W = Dimensions.get('window').width - 48;
const CANVAS_H = 220;

// ─────────────────────────────────────────────────────────────────────────────
//  SVG Annotation Canvas Component
// ─────────────────────────────────────────────────────────────────────────────

function AnnotationCanvas({
  annotations,
  activeTool,
  activeColor,
  onAnnotationComplete,
}: {
  annotations:          Annotation[];
  activeTool:           AnnotationTool;
  activeColor:          AnnotationColor;
  onAnnotationComplete: (annotation: Omit<Annotation, 'id'>) => void;
}) {
  const currentPoints = useRef<AnnotationPoint[]>([]);
  const [drawing,     setDrawing]     = useState<AnnotationPoint[]>([]);
  const [isDrawing,   setIsDrawing]   = useState(false);
  const [labelInput,  setLabelInput]  = useState('');
  const [pendingTextPt, setPendingTextPt] = useState<AnnotationPoint | null>(null);

  const getPoint = (evt: GestureResponderEvent): AnnotationPoint => ({
    x: evt.nativeEvent.locationX,
    y: evt.nativeEvent.locationY,
  });

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => activeTool !== 'text',
    onMoveShouldSetPanResponder:  () => activeTool !== 'text',

    onPanResponderGrant: (evt) => {
      const pt = getPoint(evt);
      currentPoints.current = [pt];
      setDrawing([pt]);
      setIsDrawing(true);
    },

    onPanResponderMove: (evt) => {
      if (!isDrawing) return;
      const pt = getPoint(evt);

      if (activeTool === 'freehand') {
        currentPoints.current = [...currentPoints.current, pt];
        setDrawing([...currentPoints.current]);
      } else {
        // For circle/arrow: just track start + current
        setDrawing([currentPoints.current[0], pt]);
      }
    },

    onPanResponderRelease: () => {
      if (!isDrawing || currentPoints.current.length < 2) {
        setIsDrawing(false);
        setDrawing([]);
        currentPoints.current = [];
        return;
      }

      const completed: Omit<Annotation, 'id'> = {
        type:      activeTool,
        points:    activeTool === 'freehand' ? [...currentPoints.current] : [currentPoints.current[0], drawing[drawing.length - 1] ?? currentPoints.current[0]],
        color:     activeColor,
        authorId:  '',  // filled by parent
        timestamp: new Date().toISOString(),
      };

      onAnnotationComplete(completed);
      setIsDrawing(false);
      setDrawing([]);
      currentPoints.current = [];
    },
  });

  // Text tool tap handler
  const handleCanvasTap = useCallback((evt: GestureResponderEvent) => {
    if (activeTool !== 'text') return;
    setPendingTextPt(getPoint(evt));
    setLabelInput('');
  }, [activeTool]);

  const handleTextConfirm = () => {
    if (!pendingTextPt || !labelInput.trim()) {
      setPendingTextPt(null);
      return;
    }
    onAnnotationComplete({
      type:      'text',
      points:    [pendingTextPt],
      color:     activeColor,
      label:     labelInput.trim(),
      authorId:  '',
      timestamp: new Date().toISOString(),
    });
    setPendingTextPt(null);
    setLabelInput('');
  };

  // Render a single annotation
  const renderAnnotation = (ann: Annotation, key: string | number) => {
    const color = ann.color;

    if (ann.type === 'freehand' && ann.points.length > 1) {
      const d = ann.points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ');
      return (
        <SvgPath key={key} d={d} stroke={color} strokeWidth={2.5}
          strokeLinecap="round" strokeLinejoin="round" fill="none" />
      );
    }

    if (ann.type === 'circle' && ann.points.length === 2) {
      const dx = ann.points[1].x - ann.points[0].x;
      const dy = ann.points[1].y - ann.points[0].y;
      const r  = Math.sqrt(dx * dx + dy * dy) / 2;
      const cx = (ann.points[0].x + ann.points[1].x) / 2;
      const cy = (ann.points[0].y + ann.points[1].y) / 2;
      return (
        <SvgCircle key={key} cx={cx} cy={cy} r={r}
          stroke={color} strokeWidth={2} fill="none" opacity={0.8} />
      );
    }

    if (ann.type === 'arrow' && ann.points.length === 2) {
      const x1 = ann.points[0].x, y1 = ann.points[0].y;
      const x2 = ann.points[1].x, y2 = ann.points[1].y;
      const angle   = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 12;
      const a1 = angle - Math.PI / 6;
      const a2 = angle + Math.PI / 6;
      return (
        <SvgG key={key}>
          <SvgLine x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} />
          <SvgLine
            x1={x2} y1={y2}
            x2={x2 - headLen * Math.cos(a1)} y2={y2 - headLen * Math.sin(a1)}
            stroke={color} strokeWidth={2} />
          <SvgLine
            x1={x2} y1={y2}
            x2={x2 - headLen * Math.cos(a2)} y2={y2 - headLen * Math.sin(a2)}
            stroke={color} strokeWidth={2} />
        </SvgG>
      );
    }

    if (ann.type === 'text' && ann.points.length > 0 && ann.label) {
      return (
        <SvgText key={key}
          x={ann.points[0].x} y={ann.points[0].y}
          fontSize={13} fill={color} fontWeight="bold">
          {ann.label}
        </SvgText>
      );
    }

    return null;
  };

  return (
    <View>
      <View
        style={styles.canvasWrap}
        {...(activeTool !== 'text' ? panResponder.panHandlers : {})}
        onTouchEnd={activeTool === 'text' ? handleCanvasTap as never : undefined}
      >
        {/* Mock scan background */}
        <View style={styles.canvasBackground}>
          <Text style={styles.canvasPlaceholderText}>Scan Image Placeholder</Text>
        </View>

        {/* Annotation SVG overlay */}
        <Svg2
          style={StyleSheet.absoluteFill}
          width={CANVAS_W}
          height={CANVAS_H}
        >
          {/* Persisted annotations */}
          {annotations.map((ann, i) => renderAnnotation(ann, ann.id ?? i))}

          {/* In-progress drawing */}
          {isDrawing && drawing.length > 1 && renderAnnotation(
            { type: activeTool, points: drawing, color: activeColor, authorId: '', timestamp: '' },
            'active',
          )}
        </Svg2>
      </View>

      {/* Text label input (appears when text tool taps canvas) */}
      {pendingTextPt && (
        <View style={styles.textInputRow}>
          <TextInput
            style={styles.textLabelInput}
            placeholder="Type label…"
            placeholderTextColor="#9ca3af"
            value={labelInput}
            onChangeText={setLabelInput}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleTextConfirm}
          />
          <TouchableOpacity style={styles.textConfirmBtn} onPress={handleTextConfirm}>
            <Text style={styles.textConfirmBtnText}>Add</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Threaded Comment Thread
// ─────────────────────────────────────────────────────────────────────────────

function CommentThread({
  comments,
  onSend,
  currentUserId,
  currentRole,
  sending,
}: {
  comments:      ScanComment[];
  onSend:        (text: string, parentId?: string) => Promise<void>;
  currentUserId: string;
  currentRole:   'doctor' | 'patient';
  sending:       boolean;
}) {
  const [text,      setText]      = useState('');
  const [replyTo,   setReplyTo]   = useState<string | undefined>(undefined);
  const [replying,  setReplying]  = useState(false);

  const topLevel = comments.filter(c => !c.parentCommentId);
  const replies  = (parentId: string) => comments.filter(c => c.parentCommentId === parentId);

  const handleSend = async () => {
    if (!text.trim()) return;
    setReplying(true);
    try {
      await onSend(text.trim(), replyTo);
      setText('');
      setReplyTo(undefined);
    } finally {
      setReplying(false);
    }
  };

  const formatTime = (iso: string): string => {
    try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  const renderComment = (c: ScanComment, isReply = false) => (
    <View key={c.id} style={[styles.commentItem, isReply && styles.commentReply]}>
      <View style={styles.commentHeader}>
        <View style={[styles.commentRolePill, { backgroundColor: c.authorRole === 'doctor' ? '#e8f0fb' : '#dcfce7' }]}>
          <Text style={[styles.commentRoleText, { color: c.authorRole === 'doctor' ? '#00478d' : '#006d3a' }]}>
            {c.authorRole === 'doctor' ? 'DR' : 'PT'}
          </Text>
        </View>
        <Text style={styles.commentAuthor}>
          {c.authorId === currentUserId ? 'You' : c.authorRole}
        </Text>
        <Text style={styles.commentTime}>{formatTime(c.timestamp)}</Text>
      </View>
      <Text style={styles.commentText}>{c.text}</Text>
      {!isReply && (
        <TouchableOpacity onPress={() => setReplyTo(c.id)} style={styles.replyBtn}>
          <Text style={styles.replyBtnText}>Reply</Text>
        </TouchableOpacity>
      )}

      {/* Nested replies */}
      {!isReply && replies(c.id ?? '').map(r => renderComment(r, true))}
    </View>
  );

  return (
    <View style={styles.commentThread}>
      <View style={styles.commentInputRow}>
        {replyTo && (
          <View style={styles.replyingToRow}>
            <Text style={styles.replyingToText}>Replying to comment</Text>
            <TouchableOpacity onPress={() => setReplyTo(undefined)}>
              <Text style={styles.cancelReplyText}>× Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.commentInputWrap}>
          <TextInput
            style={styles.commentInput}
            placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'}
            placeholderTextColor="#9ca3af"
            value={text}
            onChangeText={setText}
            multiline
          />
          <TouchableOpacity
            style={[styles.commentSendBtn, (!text.trim() || replying || sending) && { opacity: 0.4 }]}
            onPress={handleSend}
            disabled={!text.trim() || replying || sending}
          >
            {(replying || sending)
              ? <ActivityIndicator color="#ffffff" size="small" />
              : <Send size={14} color="#ffffff" />
            }
          </TouchableOpacity>
        </View>
      </View>

      {topLevel.length === 0 ? (
        <Text style={styles.noCommentsText}>No comments yet. Be the first to annotate.</Text>
      ) : (
        topLevel.map(c => renderComment(c))
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Share modal (main export)
// ─────────────────────────────────────────────────────────────────────────────
export default function ShareScanModal() {
  const { user, role } = useAuthContext();
  const params = useLocalSearchParams<{
    scanId?:        string;
    caseId?:        string;
    patientName?:   string;
    dataResidency?: string;
  }>();

  const [recipient,   setRecipient]   = useState<Recipient>('specialist');
  const [email,       setEmail]       = useState('');
  const [note,        setNote]        = useState('');
  const [duaAccepted, setDuaAccepted] = useState(false);
  const [sending,     setSending]     = useState(false);

  // ── Phase 4 Pillar D state ────────────────────────────────────────────────
  const [activeTab,    setActiveTab]   = useState<'share' | 'collaborate'>('share');
  const [activeTool,   setActiveTool]  = useState<AnnotationTool>('freehand');
  const [activeColor,  setActiveColor] = useState<AnnotationColor>('#ff3b30');
  const [annotations,  setAnnotations] = useState<Annotation[]>([]);
  const [comments,     setComments]    = useState<ScanComment[]>([]);
  const [savingAnnot,  setSavingAnnot] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);

  const needsDUA  = REQUIRES_DUA.includes(recipient);
  const scanId    = params.scanId;
  const hasCollaboration = !!scanId && !!user;

  // ── Real-time listeners for annotations + comments ────────────────────────
  useEffect(() => {
    if (!scanId) return;

    // Annotations listener
    const annRef   = collection(db, 'scans', scanId, 'annotations');
    const annQ     = query(annRef, orderBy('timestamp', 'asc'));
    const unsubAnn = onSnapshot(annQ, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Annotation));
      setAnnotations(data);
    }, err => {
      console.error('HEMO-EDGE: annotations onSnapshot ->', err);
    });

    // Comments listener
    const cmtRef   = collection(db, 'scans', scanId, 'comments');
    const cmtQ     = query(cmtRef, orderBy('timestamp', 'asc'));
    const unsubCmt = onSnapshot(cmtQ, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as ScanComment));
      setComments(data);
    }, err => {
      console.error('HEMO-EDGE: comments onSnapshot ->', err);
    });

    return () => { unsubAnn(); unsubCmt(); };
  }, [scanId]);

  // ── Persist annotation to Firestore ──────────────────────────────────────
  const handleAnnotationComplete = async (ann: Omit<Annotation, 'id'>) => {
    if (!scanId || !user) return;
    setSavingAnnot(true);
    try {
      const payload = {
        ...ann,
        authorId:  user.uid,
        timestamp: new Date().toISOString(),
        _server:   serverTimestamp(),
      };
      await addDoc(collection(db, 'scans', scanId, 'annotations'), payload);
      // onSnapshot will update local state automatically
    } catch (err) {
      console.error('HEMO-EDGE: save annotation ->', err);
      Alert.alert('Error', 'Could not save annotation. Try again.');
    } finally {
      setSavingAnnot(false);
    }
  };

  // ── Persist comment to Firestore ──────────────────────────────────────────
  const handleSendComment = async (text: string, parentCommentId?: string) => {
    if (!scanId || !user) return;
    setSendingComment(true);
    try {
      const payload: Omit<ScanComment, 'id'> = {
        authorId:   user.uid,
        authorRole: role as 'doctor' | 'patient',
        text,
        timestamp:  new Date().toISOString(),
        ...(parentCommentId ? { parentCommentId } : {}),
      };
      await addDoc(collection(db, 'scans', scanId, 'comments'), {
        ...payload,
        _server: serverTimestamp(),
      });
      await writeAuditLog({
        actorUid:     user.uid,
        actorRole:    role as 'doctor' | 'patient',
        action:       'view_scan', // closest existing; extend in production to 'comment_scan'
        resourceId:   scanId,
        resourceType: 'scan',
      });
    } catch (err) {
      console.error('HEMO-EDGE: save comment ->', err);
      Alert.alert('Error', 'Could not post comment. Try again.');
    } finally {
      setSendingComment(false);
    }
  };

  // ── Share handler (Phase 3 — unchanged) ──────────────────────────────────
  const handleShare = async () => {
    if (!email.trim() || !email.includes('@')) {
      Alert.alert('Invalid email', 'Enter a valid recipient email address.');
      return;
    }
    if (needsDUA && !duaAccepted) {
      Alert.alert('DUA Required', 'You must acknowledge the Data Use Agreement before sharing with external specialists.');
      return;
    }

    setSending(true);
    try {
      if (user) {
        await writeAuditLog({
          actorUid:     user.uid,
          actorRole:    role as 'doctor' | 'patient',
          action:       'share_scan',
          resourceId:   params.scanId,
          resourceType: 'scan',
          dataResidency:  params.dataResidency,
        });
      }
      Alert.alert(
        'Scan Shared',
        `A secure link has been sent to ${email}. The link expires in 48 hours.`,
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (err) {
      Alert.alert('Share failed', 'Could not send the share link. Try again or contact support.');
      console.error('HEMO-EDGE: share scan ->', err);
    } finally {
      setSending(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>Share Scan</Text>
              {params.caseId ? (
                <Text style={styles.subtitle}>{params.caseId}</Text>
              ) : null}
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
              <X size={20} color="#424752" />
            </TouchableOpacity>
          </View>

          {/* Tab switcher (Phase 4: Share | Collaborate) */}
          <View style={styles.tabRow}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'share' && styles.tabActive]}
              onPress={() => setActiveTab('share')}
            >
              <Send size={14} color={activeTab === 'share' ? '#ffffff' : '#424752'} />
              <Text style={[styles.tabText, activeTab === 'share' && styles.tabTextActive]}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'collaborate' && styles.tabActive]}
              onPress={() => {
                if (!hasCollaboration) {
                  Alert.alert('DUA Required', 'Accept the DUA on the Share tab first, then switch to Collaborate.');
                  return;
                }
                if (needsDUA && !duaAccepted) {
                  Alert.alert('DUA Required', 'Accept the Data Use Agreement before using collaboration tools.');
                  return;
                }
                setActiveTab('collaborate');
              }}
            >
              <MessageCircle size={14} color={activeTab === 'collaborate' ? '#ffffff' : '#424752'} />
              <Text style={[styles.tabText, activeTab === 'collaborate' && styles.tabTextActive]}>Collaborate</Text>
            </TouchableOpacity>
          </View>

          {/* ── SHARE TAB ───────────────────────────────────────────────────── */}
          {activeTab === 'share' && (
            <>
              {/* Compliance notice */}
              <View style={styles.complianceNotice}>
                <ShieldCheck size={15} color={ComplianceColors.hipaaBlue} />
                <Text style={styles.complianceText}>
                  This share action is logged per HIPAA §164.312(b). The recipient will only see data for the shared scan — not the full patient record.
                </Text>
              </View>

              {/* Recipient type */}
              <Text style={styles.sectionLabel}>RECIPIENT TYPE</Text>
              <View style={styles.recipientRow}>
                {(Object.keys(RECIPIENT_LABELS) as Recipient[]).map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.recipientBtn, recipient === r && styles.recipientBtnActive]}
                    onPress={() => { setRecipient(r); setDuaAccepted(false); }}
                  >
                    <Text style={[styles.recipientBtnText, recipient === r && styles.recipientBtnTextActive]}>
                      {RECIPIENT_LABELS[r]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Data residency notice */}
              {params.dataResidency && (
                <View style={styles.residencyRow}>
                  <Lock size={12} color={ComplianceColors.residencyPurple} />
                  <Text style={styles.residencyText}>
                    Data residency: <Text style={{ fontWeight: '700' }}>{params.dataResidency.toUpperCase()}</Text>
                    {' '}— ensure the recipient is in a compliant jurisdiction.
                  </Text>
                </View>
              )}

              {/* Recipient email */}
              <Text style={styles.sectionLabel}>RECIPIENT EMAIL</Text>
              <View style={styles.inputWrap}>
                <Users size={18} color="#727783" style={{ marginRight: 10 }} />
                <TextInput
                  style={styles.input}
                  placeholder="colleague@hospital.com"
                  placeholderTextColor="#9ca3af"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>

              {/* Optional note */}
              <Text style={styles.sectionLabel}>NOTE TO RECIPIENT <Text style={styles.optional}>(optional)</Text></Text>
              <TextInput
                style={styles.noteInput}
                placeholder="e.g. 'Please review the blast cell distribution on slide 3.'"
                placeholderTextColor="#9ca3af"
                value={note}
                onChangeText={setNote}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />

              {/* DUA acknowledgement */}
              {needsDUA && (
                <TouchableOpacity
                  style={[styles.duaRow, duaAccepted && styles.duaRowAccepted]}
                  onPress={() => setDuaAccepted(prev => !prev)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.duaCheckbox, duaAccepted && styles.duaCheckboxChecked]}>
                    {duaAccepted && <Text style={styles.duaCheckmark}>✓</Text>}
                  </View>
                  <View style={styles.duaTextWrap}>
                    <Text style={styles.duaTitle}>I acknowledge the Data Use Agreement</Text>
                    <Text style={styles.duaDesc}>
                      The recipient is a licensed clinician, agrees to HIPAA/GDPR terms, and will use this data solely for the purpose stated above.
                    </Text>
                  </View>
                </TouchableOpacity>
              )}

              {needsDUA && !duaAccepted && (
                <View style={styles.duaWarning}>
                  <AlertTriangle size={13} color={ComplianceColors.gdprRed} />
                  <Text style={styles.duaWarningText}>
                    DUA must be accepted before sharing with external specialists.
                  </Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.sendBtn, (sending || (needsDUA && !duaAccepted)) && styles.sendBtnDisabled]}
                onPress={handleShare}
                disabled={sending || (needsDUA && !duaAccepted)}
              >
                {sending
                  ? <ActivityIndicator color="#ffffff" />
                  : <>
                      <Send size={16} color="#ffffff" />
                      <Text style={styles.sendBtnText}>Send Secure Link</Text>
                    </>
                }
              </TouchableOpacity>

              <Text style={styles.footerNote}>
                The secure link expires in 48 hours and is single-use. HEMO-EDGE does not store recipient email addresses.
              </Text>
            </>
          )}

          {/* ── COLLABORATE TAB ─────────────────────────────────────────────── */}
          {activeTab === 'collaborate' && (
            <>
              {/* Annotation toolbar */}
              <Text style={styles.sectionLabel}>ANNOTATION TOOLS</Text>
              <View style={styles.toolbarRow}>
                {/* Tool buttons */}
                {([
                  { tool: 'freehand', icon: <Pen size={16} color={activeTool === 'freehand' ? '#ffffff' : '#424752'} /> },
                  { tool: 'circle',   icon: <Circle size={16} color={activeTool === 'circle'   ? '#ffffff' : '#424752'} /> },
                  { tool: 'arrow',    icon: <ArrowRight size={16} color={activeTool === 'arrow'    ? '#ffffff' : '#424752'} /> },
                  { tool: 'text',     icon: <Type size={16} color={activeTool === 'text'     ? '#ffffff' : '#424752'} /> },
                ] as const).map(({ tool, icon }) => (
                  <TouchableOpacity
                    key={tool}
                    style={[styles.toolBtn, activeTool === tool && styles.toolBtnActive]}
                    onPress={() => setActiveTool(tool as AnnotationTool)}
                  >
                    {icon}
                  </TouchableOpacity>
                ))}

                {/* Color swatches */}
                <View style={styles.colorRow}>
                  {(['#ff3b30', '#ffcc00', '#007aff'] as AnnotationColor[]).map(c => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.colorSwatch, { backgroundColor: c }, activeColor === c && styles.colorSwatchActive]}
                      onPress={() => setActiveColor(c)}
                    />
                  ))}
                </View>

                {savingAnnot && <ActivityIndicator size="small" color="#00478d" style={{ marginLeft: 8 }} />}
              </View>

              {/* Annotation canvas */}
              <Text style={styles.sectionLabel}>DRAW ON SCAN</Text>
              {scanId && user
                ? <AnnotationCanvas
                    annotations={annotations}
                    activeTool={activeTool}
                    activeColor={activeColor}
                    onAnnotationComplete={handleAnnotationComplete}
                  />
                : <View style={styles.canvasMissing}>
                    <Text style={styles.canvasMissingText}>No scan ID — open from a scan result to annotate.</Text>
                  </View>
              }

              <View style={styles.annotationCountRow}>
                <Text style={styles.annotationCountText}>
                  {annotations.length} annotation{annotations.length !== 1 ? 's' : ''} saved
                </Text>
              </View>

              {/* Threaded comments */}
              <Text style={[styles.sectionLabel, { marginTop: 8 }]}>COMMENTS</Text>
              {scanId && user
                ? <CommentThread
                    comments={comments}
                    onSend={handleSendComment}
                    currentUserId={user.uid}
                    currentRole={role as 'doctor' | 'patient'}
                    sending={sendingComment}
                  />
                : <Text style={styles.canvasMissingText}>No scan ID available.</Text>
              }
            </>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#f7f9fb' },
  content:    { padding: 24, gap: 16, paddingBottom: 40 },

  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  headerLeft: { gap: 2 },
  title:      { fontSize: 24, fontWeight: '800', color: '#191c1e', letterSpacing: -0.5 },
  subtitle:   { fontSize: 13, fontWeight: '600', color: '#00478d' },
  closeBtn:   { width: 36, height: 36, borderRadius: 18, backgroundColor: '#eceef0', alignItems: 'center', justifyContent: 'center' },

  // ── Tab switcher
  tabRow:         { flexDirection: 'row', backgroundColor: '#eceef0', borderRadius: 12, padding: 3, gap: 3 },
  tab:            { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 10 },
  tabActive:      { backgroundColor: '#00478d' },
  tabText:        { fontSize: 13, fontWeight: '700', color: '#424752' },
  tabTextActive:  { color: '#ffffff' },

  complianceNotice: { flexDirection: 'row', gap: 8, backgroundColor: ComplianceColors.hipaaBlueLight, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: ComplianceColors.hipaaBlueBorder, alignItems: 'flex-start' },
  complianceText:   { flex: 1, fontSize: 11, color: ComplianceColors.hipaaBlue, lineHeight: 16 },

  sectionLabel: { fontSize: 10, fontWeight: '800', color: '#424752', letterSpacing: 1.5 },
  optional:     { fontWeight: '400', fontSize: 10, color: '#9ca3af' },

  recipientRow:            { gap: 8 },
  recipientBtn:            { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: '#e0e3e5', backgroundColor: '#ffffff' },
  recipientBtnActive:      { borderColor: '#00478d', backgroundColor: '#e8f0fb' },
  recipientBtnText:        { fontSize: 13, fontWeight: '600', color: '#424752' },
  recipientBtnTextActive:  { color: '#00478d', fontWeight: '700' },

  residencyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: ComplianceColors.residencyLight, borderRadius: 10, padding: 10 },
  residencyText:{ fontSize: 11, color: ComplianceColors.residencyPurple, flex: 1, lineHeight: 15 },

  inputWrap:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 14, paddingHorizontal: 14, height: 52, borderWidth: 1, borderColor: '#e0e3e5' },
  input:      { flex: 1, fontSize: 15, color: '#191c1e' },

  noteInput:  { backgroundColor: '#ffffff', borderRadius: 14, padding: 14, fontSize: 14, color: '#191c1e', borderWidth: 1, borderColor: '#e0e3e5', minHeight: 88 },

  duaRow:         { flexDirection: 'row', gap: 12, backgroundColor: '#ffffff', borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: '#e0e3e5', alignItems: 'flex-start' },
  duaRowAccepted: { borderColor: ComplianceColors.consentGreen, backgroundColor: ComplianceColors.consentGreenLight },
  duaCheckbox:    { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#d4d6db', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  duaCheckboxChecked: { backgroundColor: ComplianceColors.consentGreen, borderColor: ComplianceColors.consentGreen },
  duaCheckmark:   { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  duaTextWrap:    { flex: 1 },
  duaTitle:       { fontSize: 13, fontWeight: '700', color: '#191c1e', marginBottom: 4 },
  duaDesc:        { fontSize: 11, color: '#424752', lineHeight: 16 },

  duaWarning:     { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: ComplianceColors.gdprRedLight, borderRadius: 10, padding: 10 },
  duaWarningText: { fontSize: 11, color: ComplianceColors.gdprRed, flex: 1 },

  sendBtn:         { flexDirection: 'row', height: 54, borderRadius: 16, backgroundColor: '#00478d', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: '#00478d', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10 },
  sendBtnDisabled: { opacity: 0.45 },
  sendBtnText:     { fontSize: 16, fontWeight: '800', color: '#ffffff' },

  footerNote: { fontSize: 11, color: '#9ca3af', textAlign: 'center', lineHeight: 16 },

  // ── Annotation toolbar
  toolbarRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  toolBtn:          { width: 38, height: 38, borderRadius: 10, borderWidth: 1.5, borderColor: '#e0e3e5', backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  toolBtnActive:    { backgroundColor: '#00478d', borderColor: '#00478d' },
  colorRow:         { flexDirection: 'row', gap: 8, marginLeft: 8 },
  colorSwatch:      { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  colorSwatchActive:{ borderColor: '#191c1e', transform: [{ scale: 1.15 }] },

  // ── Canvas
  canvasWrap:        { borderRadius: 16, overflow: 'hidden', height: CANVAS_H, position: 'relative' },
  canvasBackground:  { ...StyleSheet.absoluteFillObject, backgroundColor: '#1a1f2e', alignItems: 'center', justifyContent: 'center' },
  canvasPlaceholderText: { color: '#424752', fontSize: 12 },
  canvasMissing:     { backgroundColor: '#f7f9fb', borderRadius: 12, padding: 20, alignItems: 'center' },
  canvasMissingText: { fontSize: 13, color: '#9ca3af', textAlign: 'center' },

  textInputRow:   { flexDirection: 'row', gap: 8, marginTop: 8 },
  textLabelInput: { flex: 1, backgroundColor: '#ffffff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#e0e3e5', fontSize: 14, color: '#191c1e' },
  textConfirmBtn: { backgroundColor: '#00478d', paddingHorizontal: 16, borderRadius: 10, justifyContent: 'center' },
  textConfirmBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },

  annotationCountRow:  { alignItems: 'flex-end' },
  annotationCountText: { fontSize: 11, color: '#9ca3af' },

  // ── Comments
  commentThread:    { gap: 12 },
  commentInputWrap: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  commentInput:     { flex: 1, backgroundColor: '#ffffff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#e0e3e5', fontSize: 14, color: '#191c1e', minHeight: 44, maxHeight: 100 },
  commentSendBtn:   { width: 40, height: 40, borderRadius: 12, backgroundColor: '#00478d', alignItems: 'center', justifyContent: 'center' },
  commentItem:      { backgroundColor: '#ffffff', borderRadius: 12, padding: 12, gap: 6, borderWidth: 1, borderColor: '#f0f2f4' },
  commentReply:     { marginLeft: 20, backgroundColor: '#f7f9fb', borderLeftWidth: 3, borderLeftColor: '#e0e3e5' },
  commentHeader:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commentRolePill:  { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  commentRoleText:  { fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  commentAuthor:    { fontSize: 12, fontWeight: '700', color: '#191c1e', flex: 1 },
  commentTime:      { fontSize: 11, color: '#9ca3af' },
  commentText:      { fontSize: 13, color: '#424752', lineHeight: 18 },
  replyBtn:         { alignSelf: 'flex-start' },
  replyBtnText:     { fontSize: 11, fontWeight: '700', color: '#00478d' },

  replyingToRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  replyingToText: { fontSize: 11, color: '#9ca3af' },
  cancelReplyText:{ fontSize: 11, fontWeight: '700', color: '#ba1a1a' },

  noCommentsText: { fontSize: 13, color: '#9ca3af', textAlign: 'center', paddingVertical: 16 },

  commentInputRow: { gap: 4 },
});